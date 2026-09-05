"""Redis output layer.

Channels (pub/sub, JSON payloads):
    feed.assets                 asset catalog refresh summary
    feed.candles.<asset>.<tf>   each closed candle
    feed.ticks.<asset>          latest tick per poll cycle
    feed.health                 health heartbeat

Keys (snapshots for late joiners):
    feed:assets                 full catalog JSON
    feed:tick:<asset>           last tick JSON
    feed:candles:<asset>:<tf>   list of recent closed candles (newest first)
    feed:health                 latest health JSON
"""
from __future__ import annotations

import json
import logging
from typing import Any

import redis.asyncio as aioredis

logger = logging.getLogger(__name__)


class RedisPublisher:
    def __init__(self, url: str):
        self._redis = aioredis.from_url(url, decode_responses=True)

    async def ping(self) -> bool:
        return bool(await self._redis.ping())

    async def close(self) -> None:
        await self._redis.aclose()

    async def publish_json(self, channel: str, payload: dict[str, Any]) -> None:
        await self._redis.publish(channel, json.dumps(payload))

    async def set_json(self, key: str, payload: Any) -> None:
        await self._redis.set(key, json.dumps(payload))

    async def get_json(self, key: str) -> Any | None:
        raw = await self._redis.get(key)
        return json.loads(raw) if raw else None

    async def push_candle(
        self, asset: str, timeframe: int, candle: dict[str, Any], maxlen: int
    ) -> None:
        await self.push_list(f"feed:candles:{asset}:{timeframe}", json.dumps(candle), maxlen)

    async def push_list(self, key: str, value: str, maxlen: int) -> None:
        pipe = self._redis.pipeline()
        pipe.lpush(key, value)
        pipe.ltrim(key, 0, maxlen - 1)
        await pipe.execute()

    async def get_candles(self, asset: str, timeframe: int, limit: int) -> list[dict[str, Any]]:
        """Recent closed candles, oldest first (for indicator warm-up)."""
        raw = await self._redis.lrange(f"feed:candles:{asset}:{timeframe}", 0, limit - 1)
        candles = [json.loads(x) for x in raw]
        candles.reverse()
        return candles
