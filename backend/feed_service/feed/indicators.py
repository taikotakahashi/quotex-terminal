"""Technical indicators computed from a series of candle closes.

Pure functions, no state — the signal engine calls these on a rolling buffer of
recent closes. Kept dependency-free (plain Python) to match the vendored client.
"""
from __future__ import annotations

from typing import Sequence


def ema_series(values: Sequence[float], period: int) -> list[float]:
    """Exponential moving average, returning the full series (same length)."""
    if not values:
        return []
    k = 2 / (period + 1)
    out = [float(values[0])]
    for v in values[1:]:
        out.append(v * k + out[-1] * (1 - k))
    return out


def ema(values: Sequence[float], period: int) -> float | None:
    s = ema_series(values, period)
    return s[-1] if s else None


def rsi(values: Sequence[float], period: int = 14) -> float | None:
    """Wilder's RSI over `period` (needs > period values)."""
    if len(values) <= period:
        return None
    gains = 0.0
    losses = 0.0
    # seed with the first `period` deltas
    for i in range(1, period + 1):
        delta = values[i] - values[i - 1]
        gains += max(delta, 0.0)
        losses += max(-delta, 0.0)
    avg_gain = gains / period
    avg_loss = losses / period
    # smooth over the rest
    for i in range(period + 1, len(values)):
        delta = values[i] - values[i - 1]
        avg_gain = (avg_gain * (period - 1) + max(delta, 0.0)) / period
        avg_loss = (avg_loss * (period - 1) + max(-delta, 0.0)) / period
    if avg_loss == 0:
        return 100.0
    rs = avg_gain / avg_loss
    return 100.0 - (100.0 / (1.0 + rs))


def macd(
    values: Sequence[float], fast: int = 12, slow: int = 26, signal: int = 9
) -> tuple[float, float, float] | None:
    """Returns (macd_line, signal_line, histogram) or None if too short."""
    if len(values) < slow:
        return None
    fast_e = ema_series(values, fast)
    slow_e = ema_series(values, slow)
    macd_line = [f - s for f, s in zip(fast_e, slow_e)]
    signal_line = ema_series(macd_line, signal)
    line = macd_line[-1]
    sig = signal_line[-1]
    return line, sig, line - sig


def momentum(values: Sequence[float], period: int = 10) -> float | None:
    """Percent change over `period` candles."""
    if len(values) <= period:
        return None
    past = values[-period - 1]
    if past == 0:
        return None
    return (values[-1] - past) / past * 100.0
