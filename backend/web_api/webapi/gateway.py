"""Redis read/pubsub gateway for the web API.

All access to the feed's data goes through here. Read methods return plain
Python objects; ``events()`` is an async generator that yields normalized live
events parsed from the feed's pub/sub channels.
"""
from __future__ import annotations

import json
import time
from typing import Any, AsyncIterator

import redis.asyncio as aioredis

# If the feed's last heartbeat is older than this, treat it as not live even
# though the snapshot persists in Redis (the feed heartbeats every ~2s).
# Keep this generous so brief Chrome auto-refresh / reconnect work does not
# flash the dashboard as OFFLINE.
HEALTH_STALE_SEC = 90


def _num(v: Any) -> Any:
    """Payouts arrive as ints or numeric strings; coerce for consistent JSON."""
    try:
        return float(v) if v not in (None, "") else None
    except (TypeError, ValueError):
        return v


class RedisGateway:
    def __init__(self, url: str):
        self._r = aioredis.from_url(url, decode_responses=True)

    async def ping(self) -> bool:
        return bool(await self._r.ping())

    async def close(self) -> None:
        await self._r.aclose()

    # ---- reads -----------------------------------------------------------
    async def _get_json(self, key: str) -> Any | None:
        raw = await self._r.get(key)
        return json.loads(raw) if raw else None

    async def get_health(self) -> dict[str, Any]:
        health = await self._get_json("feed:health")
        if not health:
            # The feed isn't running / hasn't published yet.
            return {"status": "offline", "connected": False,
                    "detail": "feed service not publishing"}
        ts = health.get("ts")
        if ts and (time.time() - ts) > HEALTH_STALE_SEC:
            # Prefer preserving session/throttle/recovery context over a blank
            # offline overwrite — the feed is often mid-refresh, not dead.
            if health.get("session_expired") or health.get("throttled") or health.get("recovering"):
                health = {**health, "heartbeat_stale": True, "connected": False}
            else:
                health = {**health, "status": "offline", "connected": False,
                          "detail": f"feed heartbeat is {int(time.time() - ts)}s old"}
        health.pop("balance", None)  # never expose the account balance
        return health

    async def get_streamed_assets(self) -> set[str]:
        """Assets the feed actively streams — derived from the live tick keys."""
        keys = await self._r.keys("feed:tick:*")
        return {k.split("feed:tick:", 1)[1] for k in keys}

    async def get_assets(
        self,
        open_only: bool = False,
        category: str | None = None,
        min_payout: float | None = None,
    ) -> dict[str, Any]:
        snapshot = await self._get_json("feed:assets")
        if not snapshot:
            return {"ts": None, "count": 0, "assets": [], "streamed": []}
        streamed = await self.get_streamed_assets()
        assets = []
        for a in snapshot.get("assets", []):
            assets.append({**a, "streamed": a.get("symbol") in streamed})
        if open_only:
            assets = [a for a in assets if a.get("open")]
        if category:
            assets = [a for a in assets if a.get("category") == category]
        if min_payout is not None:
            assets = [a for a in assets if (_num(a.get("payout")) or 0) >= min_payout]
        return {
            "ts": snapshot.get("ts"),
            "count": len(assets),
            "total": snapshot.get("count"),
            "streamed": sorted(streamed),
            "assets": assets,
        }

    async def get_candles(self, asset: str, timeframe: int, limit: int) -> list[dict]:
        raw = await self._r.lrange(f"feed:candles:{asset}:{timeframe}", 0, limit - 1)
        candles = [json.loads(x) for x in raw]
        candles.reverse()  # oldest first, for charting
        return candles

    async def get_tick(self, asset: str) -> dict | None:
        return await self._get_json(f"feed:tick:{asset}")

    async def get_signal(self, asset: str, timeframe: int) -> dict | None:
        sig = await self._get_json(f"feed:signal:{asset}:{timeframe}")
        return sig if self._signal_is_live(sig) else None

    async def get_indicators(self, asset: str, timeframe: int) -> dict | None:
        return await self._get_json(f"feed:indicators:{asset}:{timeframe}")

    async def list_active_signals(self) -> list[dict]:
        import time

        now = time.time()
        out: list[dict] = []
        async for key in self._r.scan_iter(match="feed:signal:*", count=200):
            sig = await self._get_json(key)
            if self._signal_is_live(sig, now=now):
                out.append(sig)  # type: ignore[arg-type]
        out.sort(key=lambda s: (int(s.get("entry_start") or 0), str(s.get("asset") or "")))
        return out

    @staticmethod
    def _signal_is_live(sig: dict | None, now: float | None = None) -> bool:
        if not isinstance(sig, dict):
            return False
        try:
            entry = float(sig.get("entry_start") or 0)
            tf = float(sig.get("timeframe") or 0)
        except (TypeError, ValueError):
            return False
        if entry <= 0 or tf <= 0:
            return False
        t = time.time() if now is None else now
        return t < entry + tf

    async def get_signal_history(self, asset: str, timeframe: int, limit: int) -> list[dict]:
        raw = await self._r.lrange(f"feed:signal_history:{asset}:{timeframe}", 0, limit - 1)
        return [json.loads(x) for x in raw]  # newest first

    async def get_recent_signal_history(self, timeframe: int, limit: int) -> list[dict]:
        """Newest scored signals across every asset for one operation time."""
        rows: list[dict] = []
        match = f"feed:signal_history:*:{int(timeframe)}"
        async for key in self._r.scan_iter(match=match, count=200):
            raw = await self._r.lrange(key, 0, max(limit - 1, 0))
            for item in raw:
                try:
                    rec = json.loads(item)
                except json.JSONDecodeError:
                    continue
                if isinstance(rec, dict):
                    rows.append(rec)
        rows.sort(key=lambda r: int(r.get("time") or 0), reverse=True)
        return rows[:limit]

    # ---- live events -----------------------------------------------------
    async def events(self) -> AsyncIterator[dict[str, Any]]:
        """Yield normalized events from all feed.* channels."""
        pubsub = self._r.pubsub()
        await pubsub.psubscribe("feed.*")
        try:
            async for msg in pubsub.listen():
                if msg.get("type") != "pmessage":
                    continue
                event = self._normalize(msg.get("channel", ""), msg.get("data"))
                if event:
                    yield event
        finally:
            await pubsub.aclose()

    @staticmethod
    def _normalize(channel: str, data: str) -> dict[str, Any] | None:
        try:
            payload = json.loads(data)
        except (TypeError, ValueError):
            return None
        # channel forms: feed.health | feed.assets | feed.ticks.<asset>
        #                | feed.candles.<asset>.<tf>
        parts = channel.split(".")
        if channel == "feed.health":
            if isinstance(payload, dict):
                payload.pop("balance", None)  # never expose the account balance
            return {"type": "health", "data": payload}
        if channel == "feed.assets":
            return {"type": "assets_update", "data": payload}
        if len(parts) >= 3 and parts[1] == "ticks":
            return {"type": "tick", "asset": parts[2], "data": payload}
        if len(parts) >= 4 and parts[1] == "candles":
            return {"type": "candle", "asset": parts[2],
                    "timeframe": int(parts[3]), "data": payload}
        if len(parts) >= 4 and parts[1] == "signal":
            return {"type": "signal", "asset": parts[2],
                    "timeframe": int(parts[3]), "data": payload}
        if len(parts) >= 4 and parts[1] == "signal_result":
            return {"type": "signal_result", "asset": parts[2],
                    "timeframe": int(parts[3]), "data": payload}
        return None
