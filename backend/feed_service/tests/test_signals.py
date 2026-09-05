import json

from feed import indicators as ind
from feed.signals import SignalEngine, compute_indicators, generate_signal, score


# ---- indicators ----------------------------------------------------------
def test_ema_trends_with_data():
    up = list(range(1, 30))
    e9 = ind.ema(up, 9)
    e21 = ind.ema(up, 21)
    assert e9 > e21  # faster EMA leads in an uptrend


def test_rsi_bounds():
    assert ind.rsi([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]) > 90  # all gains
    assert ind.rsi([16, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1]) < 10  # all losses


def test_macd_and_momentum_shapes():
    vals = [float(x) for x in range(1, 40)]
    m = ind.macd(vals)
    assert m is not None and len(m) == 3
    assert ind.momentum(vals, 10) > 0


# ---- signal logic --------------------------------------------------------
def test_generate_signal_bullish_is_call():
    snap = {"ema9": 2, "ema21": 1, "rsi14": 60, "macd_hist": 0.5,
            "macd_line": 1, "macd_signal": 0.5, "momentum": 0.2, "candles": 30}
    d, conf, reasons = generate_signal(snap)
    assert d == "CALL"
    assert 55 <= conf <= 95
    assert any("EMA 9 above" in r for r in reasons)


def test_generate_signal_bearish_is_put():
    snap = {"ema9": 1, "ema21": 2, "rsi14": 40, "macd_hist": -0.5,
            "macd_line": -1, "macd_signal": -0.5, "momentum": -0.2, "candles": 30}
    d, conf, _ = generate_signal(snap)
    assert d == "PUT"


def test_score_outcomes():
    assert score("CALL", 1.0, 1.1) == "WIN"
    assert score("CALL", 1.0, 0.9) == "LOSS"
    assert score("PUT", 1.0, 0.9) == "WIN"
    assert score("PUT", 1.0, 1.1) == "LOSS"
    assert score("CALL", 1.0, 1.0) == "DRAW"


# ---- engine --------------------------------------------------------------
class FakePublisher:
    def __init__(self):
        self.signals = {}
        self.history = {}

    async def set_json(self, key, payload):
        self.signals[key] = payload

    async def publish_json(self, channel, payload):
        pass

    async def push_list(self, key, value, maxlen):
        self.history.setdefault(key, []).insert(0, json.loads(value))


async def _no_candles(asset, tf, limit):
    return []


async def test_engine_emits_signal_and_scores():
    pub = FakePublisher()
    engine = SignalEngine(pub, _no_candles)

    tf = 60
    start = 1_700_000_000
    # feed a rising series of closed candles
    for i in range(30):
        c = {"asset": "EURUSD", "timeframe": tf, "start": start + i * tf,
             "end": start + (i + 1) * tf, "open": 1.0 + i * 0.001,
             "high": 1.0 + i * 0.001, "low": 1.0 + i * 0.001, "close": 1.0 + i * 0.001,
             "ticks": 10}
        await engine.on_candle(c)

    # a current signal is published for the next candle
    sig = pub.signals.get(f"feed:signal:EURUSD:{tf}")
    assert sig is not None
    assert sig["direction"] in ("CALL", "PUT")
    assert sig["indicators"]["candles"] == 30

    # after 30 candles, earlier signals have been scored into history
    hist = pub.history.get(f"feed:signal_history:EURUSD:{tf}", [])
    assert len(hist) >= 1
    assert hist[0]["result"] in ("WIN", "LOSS", "DRAW")
