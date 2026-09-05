"""Signal engine: turns closed candles into CALL/PUT signals and scores them.

For each (asset, timeframe) it keeps a rolling buffer of closes, computes
EMA 9 / EMA 21 / RSI 14 / MACD / momentum on every candle close, emits a signal
for the NEXT candle (direction + confidence + reasons), and — when that candle
closes — scores it WIN/LOSS/DRAW against the real entry/exit price. Everything is
published to Redis for the API/dashboard.

The scoring is genuine (real prices), and confidence is derived from indicator
agreement — it is NOT a guarantee. Short-expiry outcomes are close to random;
the honest win/loss record is the point.
"""
from __future__ import annotations

import json
import logging
from typing import Any

from . import indicators as ind

logger = logging.getLogger("feed.signals")

BUFFER = 120       # closes kept per (asset, tf)
HISTORY = 20       # scored signals kept per (asset, tf)


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


def generate_signal(ind_snap: dict[str, Any]) -> tuple[str, int, list[str]]:
    """Combine indicators into (direction, confidence%, reasons).

    Each indicator casts a signed vote (+ bullish / - bearish) with a phrase.
    The final reasons list keeps only the phrases that agree with the chosen
    direction, so the rationale never contradicts the call.
    """
    factors: list[tuple[float, str]] = []  # (vote, phrase)

    ema9, ema21 = ind_snap["ema9"], ind_snap["ema21"]
    if ema9 is not None and ema21 is not None:
        factors.append((1.0, "EMA 9 above EMA 21") if ema9 > ema21
                       else (-1.0, "EMA 9 below EMA 21"))

    hist = ind_snap["macd_hist"]
    if hist is not None:
        factors.append((1.0, "MACD bullish") if hist > 0 else (-1.0, "MACD bearish"))

    rsi = ind_snap["rsi14"]
    if rsi is not None:
        if rsi >= 55:
            factors.append((1.0, "RSI favors up"))
        elif rsi <= 45:
            factors.append((-1.0, "RSI favors down"))

    mom = ind_snap["momentum"]
    if mom is not None:
        factors.append((0.5, "Momentum up") if mom > 0 else (-0.5, "Momentum down"))

    votes = sum(v for v, _ in factors)
    direction = "CALL" if votes >= 0 else "PUT"
    want = 1 if direction == "CALL" else -1
    reasons = [phrase for v, phrase in factors if (v > 0) == (want > 0)]

    # Confidence scales with how strongly the agreeing factors outweigh the rest.
    agree = sum(abs(v) for v, _ in factors if (v > 0) == (want > 0))
    strength = min(agree, 3.5) / 3.5           # 0..1
    confidence = int(round(55 + strength * 40))  # 55..95
    return direction, confidence, reasons or ["Mixed indicators"]


def score(direction: str, entry: float, closure: float) -> str:
    if closure == entry:
        return "DRAW"
    up = closure > entry
    if direction == "CALL":
        return "WIN" if up else "LOSS"
    return "WIN" if not up else "LOSS"


class SignalEngine:
    """One instance handles all (asset, timeframe) pairs it sees."""

    def __init__(self, publisher, gateway_get_candles):
        self.publisher = publisher
        self._get_candles = gateway_get_candles  # async (asset, tf, limit) -> [candle]
        self._closes: dict[tuple[str, int], list[float]] = {}
        self._warmed: set[tuple[str, int]] = set()
        self._pending: dict[tuple[str, int], dict[str, Any]] = {}

    async def on_candle(self, candle: dict[str, Any]) -> None:
        asset = candle.get("asset")
        tf = candle.get("timeframe")
        if asset is None or tf is None:
            return
        key = (asset, tf)

        # Warm the buffer from stored history the first time we see this pair.
        if key not in self._warmed:
            self._warmed.add(key)
            try:
                hist = await self._get_candles(asset, tf, BUFFER)
                self._closes[key] = [c["close"] for c in hist][-BUFFER:]
            except Exception:
                self._closes[key] = []

        closes = self._closes.setdefault(key, [])
        closes.append(candle["close"])
        del closes[:-BUFFER]

        snapshot = compute_indicators(closes)

        # Score the pending signal whose entry candle is the one that just closed.
        pending = self._pending.get(key)
        if pending and pending["entry_start"] == candle["start"]:
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
            self._pending.pop(key, None)

        # Emit a new signal for the NEXT candle.
        direction, confidence, reasons = generate_signal(snapshot)
        entry_start = candle["start"] + tf
        signal = {
            "asset": asset,
            "timeframe": tf,
            "direction": direction,
            "confidence": confidence,
            "reasons": reasons,
            "schedule_start": entry_start,   # when the entry candle opens (unix s)
            "entry_start": entry_start,
            "current_price": candle["close"],
            "indicators": snapshot,
            "generated_at": candle["end"],
        }
        self._pending[key] = signal
        await self._publish_signal(key, signal)

    async def _publish_signal(self, key: tuple[str, int], signal: dict) -> None:
        asset, tf = key
        try:
            await self.publisher.set_json(f"feed:signal:{asset}:{tf}", signal)
            await self.publisher.publish_json(f"feed.signal.{asset}.{tf}", signal)
        except Exception:
            logger.exception("Failed to publish signal for %s/%s", asset, tf)

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
