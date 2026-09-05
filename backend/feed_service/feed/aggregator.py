"""Tick → candle aggregation.

Quotex streams ticks (timestamp + price). We build our own M1/M5/M15 candles
from them so every downstream consumer sees one consistent, locally-verified
series regardless of what the upstream protocol changes.
"""
from __future__ import annotations

from dataclasses import dataclass, asdict


@dataclass
class Candle:
    asset: str
    timeframe: int          # seconds
    start: int              # bucket start, unix seconds (UTC)
    end: int                # bucket end (exclusive)
    open: float
    high: float
    low: float
    close: float
    ticks: int

    def as_dict(self) -> dict:
        return asdict(self)


class CandleAggregator:
    """Aggregates a single asset's ticks into candles for several timeframes.

    Ticks may arrive slightly out of order; a tick older than the currently
    open bucket is dropped (counted in `stale_ticks`) rather than corrupting
    an already-closed candle.
    """

    def __init__(self, asset: str, timeframes: tuple[int, ...]):
        self.asset = asset
        self.timeframes = tuple(sorted(timeframes))
        self._open: dict[int, Candle] = {}  # timeframe -> current candle
        self.stale_ticks = 0

    def ingest(self, ts: float, price: float) -> list[Candle]:
        """Feed one tick; returns candles that this tick closed (possibly [])."""
        closed: list[Candle] = []
        ts_int = int(ts)

        for tf in self.timeframes:
            bucket = ts_int - (ts_int % tf)
            current = self._open.get(tf)

            if current is None:
                self._open[tf] = self._new_candle(tf, bucket, price)
                continue

            if bucket == current.start:
                current.high = max(current.high, price)
                current.low = min(current.low, price)
                current.close = price
                current.ticks += 1
            elif bucket > current.start:
                closed.append(current)
                self._open[tf] = self._new_candle(tf, bucket, price)
            else:  # tick from an already-closed bucket
                self.stale_ticks += 1

        return closed

    def current(self, timeframe: int) -> Candle | None:
        """The still-forming candle for a timeframe (for live display)."""
        return self._open.get(timeframe)

    def _new_candle(self, tf: int, bucket: int, price: float) -> Candle:
        return Candle(
            asset=self.asset,
            timeframe=tf,
            start=bucket,
            end=bucket + tf,
            open=price,
            high=price,
            low=price,
            close=price,
            ticks=1,
        )
