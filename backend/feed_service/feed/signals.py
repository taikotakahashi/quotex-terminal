"""Signal engine: turns closed candles into CALL/PUT signals and scores them.

For each (asset, timeframe) it keeps a rolling buffer of closes, computes
EMA 9 / EMA 21 / RSI 14 / MACD / momentum on every candle close, emits a
*quality-filtered* signal with a broker entry time, and — when that entry
candle closes — scores it WIN/LOSS/DRAW against the real entry/exit price.

Quality gates (high-selectivity / anti-chop — NOT a mathematical win-rate guarantee):
  - Longer candle history before any signal
  - EMA trend + MACD + momentum must all agree
  - Minimum EMA separation + non-tiny MACD histogram (avoid flat/choppy markets)
  - RSI must sit in a supportive band (not merely "not opposed")
  - Very high minimum confidence
  - Last N closes must net-move with the signal direction
  - Skip obvious whipsaw (too many direction flips in recent closes)
  - Multi-timeframe confirmation when higher TF is warm; soft-allow while thin
  - Cool-down after losses / recent signals on the same asset+timeframe

Lead-time (client requirement): users see each signal 2–5 minutes before the
scheduled entry on Quotex (M1 ~3 min, M5 5 min, M15 delayed notify ~3 min).

Only one pending signal exists per (asset, timeframe) until it is scored.
"""
from __future__ import annotations

import asyncio
import json
import logging
import time
from typing import Any, Callable

from . import indicators as ind

logger = logging.getLogger("feed.signals")

BUFFER = 120       # closes kept per (asset, tf)
HISTORY = 20       # scored signals kept per (asset, tf)

# Client requirement: notify 2–5 minutes before broker entry.
MIN_LEAD_SEC = 120
MAX_LEAD_SEC = 300
TARGET_LEAD_SEC = 180  # prefer ~3 minutes when several aligned opens fit

# Quality gates — fewer signals, stronger anti-chop filters.
MIN_CANDLES = 45
MIN_CONFIDENCE = 90
MIN_EMA_SEP_RATIO = 0.0004   # |ema9-ema21|/|ema21| — skip flat markets
MIN_MACD_HIST_RATIO = 1e-7   # |macd_hist|/|ema21| — skip near-zero MACD only
MIN_TREND_CLOSES = 4         # last N closes must net-move with direction
MAX_FLIP_IN_8 = 5            # max sign flips in last 8 bars (chop detector)
HIGHER_TF = {60: 300, 300: 900}  # M1 confirms with M5; M5 with M15
MTF_MIN_CANDLES = MIN_CANDLES  # higher TF must pass the same history bar before confirming
LOSS_STREAK_BLOCK = 2        # consecutive losses → cool down
COOLDOWN_AFTER_LOSS_SEC = 900   # 15 min pause after loss streak
COOLDOWN_AFTER_SIGNAL_SEC = 360  # min gap between signals on same asset/tf
# After WIN/LOSS is scored, keep the TF slot free so the UI can show the result
# (~10s) and return to analyzing before the next signal arrives.
RESULT_DISPLAY_PAUSE_SEC = 12


def compute_indicators(closes: list[float]) -> dict[str, Any]:
    macd = ind.macd(closes)
    return {
        "ema9": ind.ema(closes, 9),
        "ema21": ind.ema(closes, 21),
        "rsi14": ind.rsi(closes, 14),
        "macd_line": macd[0] if macd else None,
        "macd_signal": macd[1] if macd else None,
        "macd_hist": macd[2] if macd else None,
        "momentum": ind.momentum(closes, 10),
        "candles": len(closes),
    }


def _trend_closes_ok(closes: list[float], direction: str) -> bool:
    """Net move over the last MIN_TREND_CLOSES bars must agree with direction.

    Allows small pullbacks (so RSI can sit in a supportive band) but requires
    the window end to finish in the signal's favor.
    """
    need = MIN_TREND_CLOSES + 1
    if len(closes) < need:
        return False
    window = closes[-need:]
    net = window[-1] - window[0]
    if direction == "CALL":
        return net > 0 and window[-1] >= window[-2]
    return net < 0 and window[-1] <= window[-2]


def _is_choppy(closes: list[float]) -> bool:
    """True when recent closes flip direction too often (whipsaw)."""
    if len(closes) < 9:
        return False
    flips = 0
    for i in range(len(closes) - 7, len(closes)):
        d1 = closes[i - 1] - closes[i - 2]
        d2 = closes[i] - closes[i - 1]
        if d1 == 0 or d2 == 0:
            continue
        if (d1 > 0) != (d2 > 0):
            flips += 1
    return flips >= MAX_FLIP_IN_8


def generate_signal(
    ind_snap: dict[str, Any],
    closes: list[float] | None = None,
) -> tuple[str, int, list[str]] | None:
    """Combine indicators into (direction, confidence%, reasons) or None.

    Returns None when the setup fails ultra-strict quality gates.
    Confidence is from indicator agreement — it is NOT a guarantee of profit.
    """
    if ind_snap.get("candles", 0) < MIN_CANDLES:
        return None

    ema9, ema21 = ind_snap["ema9"], ind_snap["ema21"]
    hist = ind_snap["macd_hist"]
    mom = ind_snap["momentum"]
    rsi = ind_snap["rsi14"]
    if ema9 is None or ema21 is None or hist is None or mom is None or rsi is None:
        return None

    # Core trend must be unambiguous: EMA cross, MACD, and momentum agree.
    ema_bull = ema9 > ema21
    macd_bull = hist > 0
    mom_bull = mom > 0
    if not (ema_bull == macd_bull == mom_bull):
        return None

    # Skip flat / choppy markets — EMAs and MACD must be meaningfully separated.
    base = abs(ema21) if abs(ema21) > 1e-12 else 1e-12
    if abs(ema9 - ema21) / base < MIN_EMA_SEP_RATIO:
        return None
    if abs(hist) / base < MIN_MACD_HIST_RATIO:
        return None

    direction = "CALL" if ema_bull else "PUT"

    # RSI must support the direction without chasing extremes.
    if direction == "CALL" and not (52 <= rsi <= 72):
        return None
    if direction == "PUT" and not (28 <= rsi <= 48):
        return None

    if closes is not None:
        if not _trend_closes_ok(closes, direction):
            return None
        if _is_choppy(closes):
            return None

    factors: list[tuple[float, str]] = [
        (1.0 if ema_bull else -1.0,
         "EMA 9 above EMA 21" if ema_bull else "EMA 9 below EMA 21"),
        (1.0 if macd_bull else -1.0,
         "MACD bullish" if macd_bull else "MACD bearish"),
        (1.0 if mom_bull else -1.0,
         "Momentum up" if mom_bull else "Momentum down"),
        (1.0 if direction == "CALL" else -1.0,
         "RSI favors up" if direction == "CALL" else "RSI favors down"),
    ]

    want = 1 if direction == "CALL" else -1
    reasons = [phrase for v, phrase in factors if (v > 0) == (want > 0)]
    agree = sum(abs(v) for v, _ in factors if (v > 0) == (want > 0))
    strength = min(agree, 4.0) / 4.0
    confidence = int(round(70 + strength * 25))  # 70..95 — elite band only
    if confidence < MIN_CONFIDENCE:
        return None
    return direction, confidence, reasons or ["Trend aligned"]


def score(direction: str, entry: float, closure: float) -> str:
    if closure == entry:
        return "DRAW"
    up = closure > entry
    if direction == "CALL":
        return "WIN" if up else "LOSS"
    return "WIN" if not up else "LOSS"


def choose_entry_start(candle_start: int, tf: int, generated_at: int) -> int:
    """Pick a TF-aligned entry open aiming for lead time in [MIN_LEAD, MAX_LEAD].

    Walks candle_start + n*tf for n = 1, 2, … and prefers the open whose lead
    is closest to TARGET_LEAD_SEC. If no open falls inside the window (M15),
    returns the first open at least MIN_LEAD ahead — the notifier delays
    publishing until TARGET_LEAD before that entry.
    """
    best_in_window: int | None = None
    first_after_min: int | None = None
    for n in range(1, 32):
        entry = candle_start + n * tf
        lead = entry - generated_at
        if lead < MIN_LEAD_SEC:
            continue
        if first_after_min is None:
            first_after_min = entry
        if lead <= MAX_LEAD_SEC:
            if best_in_window is None:
                best_in_window = entry
            else:
                prev = best_in_window - generated_at
                if abs(lead - TARGET_LEAD_SEC) < abs(prev - TARGET_LEAD_SEC):
                    best_in_window = entry
        elif best_in_window is not None:
            break
    if best_in_window is not None:
        return best_in_window
    return first_after_min if first_after_min is not None else candle_start + tf


def notify_at_for(entry_start: int, generated_at: int) -> int:
    """When the signal should be shown to users (always within 2–5 min of entry)."""
    lead = entry_start - generated_at
    if lead <= MAX_LEAD_SEC:
        return generated_at
    return entry_start - TARGET_LEAD_SEC


class SignalEngine:
    """One instance handles all (asset, timeframe) pairs it sees."""

    def __init__(
        self,
        publisher,
        gateway_get_candles,
        time_fn: Callable[[], float] | None = None,
    ):
        self.publisher = publisher
        self._get_candles = gateway_get_candles  # async (asset, tf, limit) -> [candle]
        self._time = time_fn or time.time
        self._closes: dict[tuple[str, int], list[float]] = {}
        self._warmed: set[tuple[str, int]] = set()
        self._pending: dict[tuple[str, int], dict[str, Any]] = {}
        self._recent_results: dict[tuple[str, int], list[str]] = {}
        self._cooldown_until: dict[tuple[str, int], float] = {}
        self._last_signal_at: dict[tuple[str, int], float] = {}
        # timeframe → unix seconds; blocks scheduling a new signal on that TF
        self._tf_busy_until: dict[int, float] = {}

    async def _warm_closes(self, asset: str, tf: int) -> None:
        """Load closes from Redis/Quotex history once per (asset, tf)."""
        key = (asset, int(tf))
        if key in self._warmed:
            return
        self._warmed.add(key)
        existing = self._closes.get(key) or []
        if len(existing) >= MIN_CANDLES:
            logger.info(
                "Warmed %s/%ss from existing buffer (%d closes)",
                asset, tf, len(existing),
            )
        else:
            try:
                hist = await self._get_candles(asset, int(tf), BUFFER)
                self._closes[key] = [c["close"] for c in hist if "close" in c][-BUFFER:]
                logger.info(
                    "Warmed %s/%ss with %d closes",
                    asset, tf, len(self._closes[key]),
                )
            except Exception:
                logger.exception("Failed to warm candles for %s/%s", asset, tf)
                self._closes.setdefault(key, [])

        # Prefetch higher TF from Redis only (no Quotex) so MTF can engage later.
        higher = HIGHER_TF.get(int(tf))
        if higher is not None and (asset, higher) not in self._warmed:
            hkey = (asset, higher)
            self._warmed.add(hkey)
            getter = getattr(self.publisher, "get_candles", None)
            if callable(getter):
                try:
                    hist = await getter(asset, higher, BUFFER)
                    self._closes[hkey] = [c["close"] for c in hist if "close" in c][-BUFFER:]
                    logger.info(
                        "Warmed %s/%ss (MTF/Redis) with %d closes",
                        asset, higher, len(self._closes[hkey]),
                    )
                except Exception:
                    logger.exception("Failed to warm MTF candles for %s/%s", asset, higher)
                    self._closes.setdefault(hkey, [])
            else:
                self._closes.setdefault(hkey, [])

    def _mtf_direction(self, closes: list[float]) -> str | None:
        """Lightweight higher-TF bias: EMA+MACD+momentum agree (no full elite RSI gate)."""
        if len(closes) < MTF_MIN_CANDLES:
            return None
        snap = compute_indicators(closes)
        ema9, ema21 = snap["ema9"], snap["ema21"]
        hist, mom = snap["macd_hist"], snap["momentum"]
        if ema9 is None or ema21 is None or hist is None or mom is None:
            return None
        ema_bull = ema9 > ema21
        if not (ema_bull == (hist > 0) == (mom > 0)):
            return None
        return "CALL" if ema_bull else "PUT"

    def _mtf_confirms(self, asset: str, tf: int, direction: str) -> bool:
        """Confirm with higher TF when warm; do not hard-block while it is still thin."""
        higher = HIGHER_TF.get(tf)
        if higher is None:
            return True
        closes = self._closes.get((asset, higher))
        if not closes or len(closes) < MTF_MIN_CANDLES:
            # Higher TF still warming — allow M1/M5 rather than stall the board empty.
            return True
        bias = self._mtf_direction(closes)
        if bias is None:
            return False
        return bias == direction

    def _cooldown_blocks(self, key: tuple[str, int]) -> str | None:
        """Return a reason string if cool-down / loss-streak blocks a new signal."""
        now = float(self._time())
        until = self._cooldown_until.get(key, 0.0)
        if now < until:
            return f"loss-streak cooldown ({int(until - now)}s left)"
        last = self._last_signal_at.get(key, 0.0)
        if last and now - last < COOLDOWN_AFTER_SIGNAL_SEC:
            return f"signal spacing ({int(COOLDOWN_AFTER_SIGNAL_SEC - (now - last))}s left)"
        return None

    def _tf_slot_busy(self, tf: int) -> str | None:
        """One live/scheduled signal per timeframe across all assets (client UX)."""
        tf = int(tf)
        for asset, pending_tf in self._pending:
            if int(pending_tf) == tf:
                return f"one-at-a-time (active {asset}/{tf}s)"
        until = float(self._tf_busy_until.get(tf, 0.0))
        now = float(self._time())
        if now < until:
            return f"post-result pause ({int(until - now)}s left)"
        return None

    def _note_result(self, key: tuple[str, int], result: str) -> None:
        recent = self._recent_results.setdefault(key, [])
        recent.append(result)
        del recent[:-8]
        if result == "LOSS":
            streak = 0
            for r in reversed(recent):
                if r != "LOSS":
                    break
                streak += 1
            if streak >= LOSS_STREAK_BLOCK:
                self._cooldown_until[key] = float(self._time()) + COOLDOWN_AFTER_LOSS_SEC
                logger.info(
                    "Cool-down %s/%ss for %ss after %d losses",
                    key[0], key[1], COOLDOWN_AFTER_LOSS_SEC, streak,
                )
        elif result == "WIN":
            # Clear cool-down on a win so a recovered asset can trade again.
            self._cooldown_until.pop(key, None)

    async def on_candle(self, candle: dict[str, Any]) -> None:
        asset = candle.get("asset")
        tf = candle.get("timeframe")
        if asset is None or tf is None:
            return
        key = (asset, tf)

        await self._warm_closes(asset, int(tf))

        closes = self._closes.setdefault(key, [])
        closes.append(candle["close"])
        del closes[:-BUFFER]

        snapshot = compute_indicators(closes)
        # Always refresh latest indicators so the UI can show them without a signal.
        try:
            await self.publisher.set_json(
                f"feed:indicators:{asset}:{tf}", snapshot, ttl=3600
            )
        except Exception:
            logger.exception("Failed to store indicators for %s/%s", asset, tf)

        # Score the pending signal whose entry candle is the one that just closed.
        pending = self._pending.get(key)
        if pending:
            entry_start = int(pending["entry_start"])
            candle_start = int(candle["start"])
            if entry_start == candle_start:
                result = score(pending["direction"], candle["open"], candle["close"])
                record = {
                    "asset": asset,
                    "timeframe": tf,
                    "time": candle["start"],
                    "direction": pending["direction"],
                    "confidence": pending["confidence"],
                    "entry_price": candle["open"],
                    "closure_price": candle["close"],
                    "result": result,
                }
                await self._push_history(key, record)
                self._note_result(key, result)
                self._pending.pop(key, None)
                # Free the TF only after a short pause so the UI can show WIN/LOSS.
                self._tf_busy_until[int(tf)] = float(self._time()) + RESULT_DISPLAY_PAUSE_SEC
                await self._clear_signal(key)
            elif candle_start > entry_start:
                # Entry candle already passed without a match (gap/restart).
                logger.info(
                    "Clearing missed pending signal %s/%ss entry=%s candle=%s",
                    asset, tf, entry_start, candle_start,
                )
                self._pending.pop(key, None)
                await self._clear_signal(key)

        # One active (or scheduled) signal at a time until it is scored.
        if key in self._pending:
            return

        # Client: only one signal per timeframe across the whole catalog.
        busy = self._tf_slot_busy(int(tf))
        if busy:
            logger.info("Signal skipped (%s) %s/%ss", busy, asset, tf)
            return

        blocked = self._cooldown_blocks(key)
        if blocked:
            logger.info("Signal skipped (%s) %s/%ss", blocked, asset, tf)
            return

        evaluated = generate_signal(snapshot, closes)
        if evaluated is None:
            return
        direction, confidence, reasons = evaluated
        if not self._mtf_confirms(asset, int(tf), direction):
            logger.info(
                "Signal skipped (higher-TF disagree) %s/%ss %s",
                asset, tf, direction,
            )
            return

        generated_at = int(candle["end"])
        entry_start = choose_entry_start(int(candle["start"]), int(tf), generated_at)
        notify_at = notify_at_for(entry_start, generated_at)
        lead_sec = entry_start - generated_at
        signal = {
            "asset": asset,
            "timeframe": tf,
            "direction": direction,
            "confidence": confidence,
            "reasons": reasons,
            "quality": "elite",
            "min_confidence": MIN_CONFIDENCE,
            "schedule_start": entry_start,
            "entry_start": entry_start,
            "notify_at": notify_at,
            "lead_sec": lead_sec,
            "current_price": candle["close"],
            "indicators": snapshot,
            "generated_at": generated_at,
            "published": False,
        }
        self._pending[key] = signal
        self._last_signal_at[key] = float(self._time())
        logger.info(
            "Signal scheduled %s/%ss %s conf=%s @ entry=%s lead=%ss notify_in=%ss",
            asset, tf, direction, confidence, entry_start, lead_sec,
            max(0, notify_at - generated_at),
        )
        if notify_at <= generated_at:
            await self._publish_signal(key, signal)
        else:
            # Hold until the 2–5 min window (e.g. M15). Clear any stale card.
            await self._clear_signal(key)

    async def run_notifier(self) -> None:
        """Publish delayed signals once their notify_at time is reached."""
        while True:
            try:
                await self.flush_due_notifications()
            except Exception:
                logger.exception("Signal notifier flush failed")
            await asyncio.sleep(0.25)

    async def flush_due_notifications(self) -> None:
        now = self._time()
        for key, signal in list(self._pending.items()):
            asset, tf = key
            entry_start = int(signal["entry_start"])
            close_at = entry_start + int(tf)
            # Drop in-memory pending that can never be scored anymore.
            if now >= close_at + int(tf):
                self._pending.pop(key, None)
                await self._clear_signal(key)
                continue
            if signal.get("published"):
                continue
            if now >= signal["notify_at"]:
                await self._publish_signal(key, signal)

        # Opportunistic Redis cleanup for leftovers from restarts.
        if not hasattr(self, "_last_purge") or now - self._last_purge >= 15:
            self._last_purge = now
            await self._purge_expired_redis(now)

    async def _purge_expired_redis(self, now: float) -> None:
        try:
            keys = await self.publisher.scan_keys("feed:signal:*")
        except Exception:
            logger.exception("Failed scanning signal keys")
            return
        for key in keys:
            try:
                payload = await self.publisher.get_json(key)
                if not isinstance(payload, dict):
                    continue
                entry = float(payload.get("entry_start") or 0)
                tf = float(payload.get("timeframe") or 60)
                if now >= entry + tf:
                    await self.publisher.delete(key)
            except Exception:
                logger.exception("Failed purging %s", key)

    async def _publish_signal(self, key: tuple[str, int], signal: dict) -> None:
        asset, tf = key
        signal["published"] = True
        signal["published_at"] = int(self._time())
        payload = {k: v for k, v in signal.items() if k != "published"}
        close_at = int(payload["entry_start"]) + int(tf)
        ttl = max(30, int(close_at - self._time()) + 45)
        try:
            await self.publisher.set_json(f"feed:signal:{asset}:{tf}", payload, ttl=ttl)
            await self.publisher.publish_json(f"feed.signal.{asset}.{tf}", payload)
        except Exception:
            logger.exception("Failed to publish signal for %s/%s", asset, tf)

    async def _clear_signal(self, key: tuple[str, int]) -> None:
        asset, tf = key
        try:
            await self.publisher.delete(f"feed:signal:{asset}:{tf}")
        except Exception:
            logger.exception("Failed to clear signal for %s/%s", asset, tf)

    async def _push_history(self, key: tuple[str, int], record: dict) -> None:
        asset, tf = key
        try:
            await self.publisher.push_list(
                f"feed:signal_history:{asset}:{tf}", json.dumps(record), HISTORY
            )
            await self.publisher.publish_json(
                f"feed.signal_result.{asset}.{tf}", record
            )
        except Exception:
            logger.exception("Failed to push signal history for %s/%s", asset, tf)
