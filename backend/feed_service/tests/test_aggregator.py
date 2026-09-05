from feed.aggregator import CandleAggregator


def test_single_timeframe_ohlc():
    agg = CandleAggregator("EURUSD", (60,))
    base = 1_700_000_040  # minute-aligned bucket start

    assert agg.ingest(base, 1.10) == []       # opens bucket
    assert agg.ingest(base + 5, 1.30) == []   # high
    assert agg.ingest(base + 10, 1.05) == []  # low
    assert agg.ingest(base + 20, 1.20) == []  # close of this bucket
    closed = agg.ingest(base + 65, 1.15)      # crosses into next bucket
    assert len(closed) == 1

    c = closed[0]
    assert (c.open, c.high, c.low, c.close) == (1.10, 1.30, 1.05, 1.20)
    assert c.start == base
    assert c.end - c.start == 60
    assert c.ticks == 4


def test_multi_timeframe_closes_independently():
    agg = CandleAggregator("EURUSD", (60, 300))
    t0 = 1_700_000_100  # M1 bucket 100..160? no: bucket floor(100/60)*60 = 1_700_000_100 - 0? use aligned start
    t0 = 1_700_000_400  # aligned to both 60 and 300

    agg.ingest(t0, 1.0)
    agg.ingest(t0 + 59, 1.1)
    closed = agg.ingest(t0 + 61, 1.2)   # closes M1 only
    assert [c.timeframe for c in closed] == [60]

    closed = agg.ingest(t0 + 301, 1.3)  # closes next M1 and the M5
    assert sorted(c.timeframe for c in closed) == [60, 300]

    m5 = next(c for c in closed if c.timeframe == 300)
    assert m5.open == 1.0 and m5.close == 1.2
    assert m5.high == 1.2 and m5.low == 1.0


def test_stale_tick_ignored():
    agg = CandleAggregator("EURUSD", (60,))
    t0 = 1_700_000_400
    agg.ingest(t0 + 61, 1.0)       # open bucket at t0+60
    closed = agg.ingest(t0 + 30, 9.9)  # tick from previous, already-passed bucket
    assert closed == []
    assert agg.stale_ticks == 1
    assert agg.current(60).high == 1.0  # untouched by stale tick


def test_current_candle_progress():
    agg = CandleAggregator("BTCUSD_otc", (60,))
    t0 = 1_700_000_400
    agg.ingest(t0 + 1, 100.0)
    agg.ingest(t0 + 2, 101.5)
    cur = agg.current(60)
    assert cur is not None
    assert cur.close == 101.5 and cur.ticks == 2
