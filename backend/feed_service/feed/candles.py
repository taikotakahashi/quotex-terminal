"""Per-asset tick consumption and candle publishing."""
from __future__ import annotations

import asyncio
import logging

from .aggregator import CandleAggregator

logger = logging.getLogger(__name__)

POLL_INTERVAL = 0.5
RESUBSCRIBE_BACKOFF = 10


class CandleStreamer:
    """Owns one asset: subscribes to its stream, drains new ticks, feeds the
    aggregator, and publishes ticks + closed candles to Redis."""

    def __init__(self, client, publisher, health, asset: str,
                 timeframes: tuple[int, ...], history_size: int, signal_engine=None):
        self.client = client
        self.publisher = publisher
        self.health = health
        self.asset = asset
        self.history_size = history_size
        self.aggregator = CandleAggregator(asset, timeframes)
        self.signal_engine = signal_engine
        self._last_tick_ts: float = 0.0

    async def run(self) -> None:
        while True:
            try:
                await self.client.subscribe_asset(self.asset)
                logger.info("[%s] subscribed", self.asset)
                await self._consume_loop()
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception(
                    "[%s] stream failed; resubscribing in %ss",
                    self.asset, RESUBSCRIBE_BACKOFF,
                )
                await asyncio.sleep(RESUBSCRIBE_BACKOFF)

    async def _consume_loop(self) -> None:
        while True:
            ticks = await self.client.get_ticks(self.asset)
            fresh = [t for t in ticks if t.get("time", 0) > self._last_tick_ts]

            if fresh:
                self._last_tick_ts = fresh[-1]["time"]
                await self._process(fresh)

            await asyncio.sleep(POLL_INTERVAL)

    async def _process(self, fresh: list[dict]) -> None:
        closed = []
        for tick in fresh:
            closed.extend(self.aggregator.ingest(tick["time"], tick["price"]))

        latest = fresh[-1]
        tick_payload = {
            "asset": self.asset,
            "ts": latest["time"],
            "price": latest["price"],
        }
        await self.publisher.set_json(f"feed:tick:{self.asset}", tick_payload)
        await self.publisher.publish_json(f"feed.ticks.{self.asset}", tick_payload)
        self.health.note_tick(self.asset, latest["time"])

        for candle in closed:
            payload = candle.as_dict()
            await self.publisher.push_candle(
                self.asset, candle.timeframe, payload, self.history_size
            )
            await self.publisher.publish_json(
                f"feed.candles.{self.asset}.{candle.timeframe}", payload
            )
            if self.signal_engine is not None:
                try:
                    await self.signal_engine.on_candle(payload)
                except Exception:
                    logger.exception("[%s] signal engine failed on candle", self.asset)
            logger.info(
                "[%s] M%d candle closed  O=%s H=%s L=%s C=%s (%d ticks)",
                self.asset, candle.timeframe // 60,
                candle.open, candle.high, candle.low, candle.close, candle.ticks,
            )
