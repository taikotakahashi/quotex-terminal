import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, connectFeed } from './api'
import type { Asset, Candle, Indicators, Signal, SignalResult, Status } from './types'
import { StatusHeader } from './components/StatusHeader'
import { AssetTable } from './components/AssetTable'
import { CustomChart } from './components/CustomChart'
import { SignalCard, type SignalOutcome } from './components/SignalCard'
import { ActiveSignalsPanel } from './components/ActiveSignalsPanel'
import { IndicatorsPanel } from './components/IndicatorsPanel'
import { SignalHistory } from './components/SignalHistory'
import { SignalHistoryAnalysis } from './components/SignalHistoryAnalysis'
import { AssetIcon } from './components/AssetIcon'
import {
  assetInMarket,
  formatAssetLabel,
  isLiveSignal,
  isMarket,
  num,
  payoutClass,
  pickSoonestActive,
  signalFocusKey,
  TIMEFRAMES,
  tfLabel,
} from './util'
import { useI18n } from './i18n'
import { announceSignal, unlockAudio, ensureNotifyPermission } from './signalNotify'

const SELECTED_KEY = 'qx_selected_asset'
const MARKET_KEY = 'qx_market'
const DEFAULT_MARKET = 'currency'

function readSavedAsset(): string {
  try {
    return localStorage.getItem(SELECTED_KEY) || ''
  } catch {
    return ''
  }
}

function saveSelectedAsset(symbol: string) {
  try {
    localStorage.setItem(SELECTED_KEY, symbol)
  } catch {
    /* ignore */
  }
}

function readSavedMarket(): string {
  try {
    const v = localStorage.getItem(MARKET_KEY)
    if (v === null) return DEFAULT_MARKET
    if (v === '' || isMarket(v)) return v
  } catch {
    /* ignore */
  }
  return DEFAULT_MARKET
}

function saveMarket(market: string) {
  try {
    localStorage.setItem(MARKET_KEY, market)
  } catch {
    /* ignore */
  }
}

function pickDefaultAsset(list: Asset[], preferred = '', market = ''): Asset | undefined {
  const pool = market ? list.filter((a) => a.category === market) : list
  const src = pool.length ? pool : list
  if (preferred) {
    const saved = src.find((a) => a.symbol === preferred)
    if (saved) return saved
  }
  return (
    src.find((a) => a.streamed && a.open) ||
    src.find((a) => a.streamed) ||
    src.find((a) => a.open) ||
    src[0]
  )
}

export default function App() {
  const { t } = useI18n()
  const [status, setStatus] = useState<Status | null>(null)
  const [assets, setAssets] = useState<Asset[]>([])
  const [prices, setPrices] = useState<Record<string, number>>({})
  const [selected, setSelected] = useState<string>('')
  const [market, setMarket] = useState<string>(readSavedMarket)
  const [timeframe, setTimeframe] = useState<number>(60)
  const [chartTimeframe, setChartTimeframe] = useState<number>(60)
  const [candles, setCandles] = useState<Candle[]>([])
  const [liveCandle, setLiveCandle] = useState<Candle | null>(null)
  const [signal, setSignal] = useState<Signal | null>(null)
  const [indicators, setIndicators] = useState<Indicators | null>(null)
  const [activeSignals, setActiveSignals] = useState<Signal[]>([])
  /** Which active signal the hero SignalCard is focused on. */
  const [focusedKey, setFocusedKey] = useState<string | null>(null)
  const [closingSignal, setClosingSignal] = useState<Signal | null>(null)
  /** Closed trade we still want a score for (confirming UI and/or late WIN/LOSS). */
  const [scoreWatch, setScoreWatch] = useState<Signal | null>(null)
  const [outcome, setOutcome] = useState<SignalOutcome | null>(null)
  const [signalHistory, setSignalHistory] = useState<SignalResult[]>([])
  const [wsConnected, setWsConnected] = useState(false)
  const [nowTick, setNowTick] = useState(() => Date.now() / 1000)

  const forming = useRef<Candle | null>(null)
  const selectedRef = useRef(selected)
  const tfRef = useRef(timeframe)
  const chartTfRef = useRef(chartTimeframe)
  const marketRef = useRef(market)
  const pendingPrices = useRef<Record<string, number>>({})
  const focusedKeyRef = useRef<string | null>(null)
  const displaySignalRef = useRef<Signal | null>(null)
  const assetNameBySymbolRef = useRef<Record<string, string>>({})
  const categoryBySymbolRef = useRef<Record<string, string>>({})
  const lastLiveRef = useRef<Signal | null>(null)
  const scoreWatchRef = useRef<Signal | null>(null)
  /** Prevents re-arming "confirming…" after we already gave up / showed a result. */
  const closingDoneKeyRef = useRef<string | null>(null)
  /** Keys we already rendered as WIN/LOSS so we never flash the same result twice. */
  const shownOutcomeKeysRef = useRef<Set<string>>(new Set())
  const announcedKeyRef = useRef<string | null>(null)
  selectedRef.current = selected
  tfRef.current = timeframe
  chartTfRef.current = chartTimeframe
  marketRef.current = market
  scoreWatchRef.current = scoreWatch

  const applyOutcome = useCallback((rec: SignalResult, from: Signal | null) => {
    const doneKey = from
      ? signalFocusKey(from)
      : `${rec.asset}:${rec.timeframe}:${Number(rec.time)}`
    const recKey = `${rec.asset}:${rec.timeframe}:${Number(rec.time)}`
    if (shownOutcomeKeysRef.current.has(doneKey) || shownOutcomeKeysRef.current.has(recKey)) {
      return false
    }
    shownOutcomeKeysRef.current.add(doneKey)
    shownOutcomeKeysRef.current.add(recKey)
    closingDoneKeyRef.current = doneKey
    lastLiveRef.current = null
    setOutcome({
      result: rec,
      reasons: from?.reasons ?? [],
      name: formatAssetLabel(rec.asset, assetNameBySymbolRef.current),
    })
    setClosingSignal(null)
    setScoreWatch(null)
    setFocusedKey(null)
    return true
  }, [])

  function historyMatchesWatch(h: SignalResult, watch: Signal): boolean {
    if (h.asset !== watch.asset) return false
    if (Number(h.timeframe) !== Number(watch.timeframe)) return false
    const entry = Number(watch.entry_start)
    const ht = Number(h.time)
    if (!Number.isFinite(ht) || !Number.isFinite(entry)) return false
    return Math.abs(ht - entry) <= 1
  }

  useEffect(() => {
    const id = setInterval(() => {
      if (Object.keys(pendingPrices.current).length === 0) return
      setPrices((p) => ({ ...p, ...pendingPrices.current }))
      pendingPrices.current = {}
    }, 100)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    const id = window.setInterval(() => setNowTick(Date.now() / 1000), 500)
    return () => window.clearInterval(id)
  }, [])

  const selectedAsset = useMemo(
    () => assets.find((a) => a.symbol === selected) || null,
    [assets, selected],
  )

  const assetNameBySymbol = useMemo(() => {
    const map: Record<string, string> = {}
    for (const a of assets) map[a.symbol] = a.name
    return map
  }, [assets])

  const categoryBySymbol = useMemo(() => {
    const map: Record<string, string> = {}
    for (const a of assets) map[a.symbol] = a.category
    return map
  }, [assets])

  const liveActives = useMemo(
    () => activeSignals.filter((s) => isLiveSignal(s, nowTick)),
    [activeSignals, nowTick],
  )

  const liveForTf = useMemo(
    () =>
      liveActives.filter(
        (s) =>
          Number(s.timeframe) === timeframe &&
          assetInMarket(s.asset, market, categoryBySymbol),
      ),
    [liveActives, timeframe, market, categoryBySymbol],
  )

  const historyForMarket = useMemo(
    () => signalHistory.filter((h) => assetInMarket(h.asset, market, categoryBySymbol)),
    [signalHistory, market, categoryBySymbol],
  )

  const displaySignal = useMemo(() => {
    if (!liveForTf.length) return null
    if (focusedKey) {
      const match = liveForTf.find((s) => signalFocusKey(s) === focusedKey)
      if (match) return match
    }
    return pickSoonestActive(liveForTf, nowTick)
  }, [liveForTf, focusedKey, nowTick])

  /** Client UX: show only the one focused signal (never a multi-signal list). */
  const singleActive = useMemo(() => {
    if (outcome) return []
    return displaySignal ? [displaySignal] : []
  }, [outcome, displaySignal])

  focusedKeyRef.current = focusedKey
  displaySignalRef.current = displaySignal
  assetNameBySymbolRef.current = assetNameBySymbol
  categoryBySymbolRef.current = categoryBySymbol
  if (displaySignal && !outcome) lastLiveRef.current = displaySignal

  // Unlock audio + ask notification permission on first gesture.
  useEffect(() => {
    const unlock = () => {
      void unlockAudio()
      void ensureNotifyPermission()
    }
    window.addEventListener('pointerdown', unlock, { once: true })
    return () => window.removeEventListener('pointerdown', unlock)
  }, [])

  // Sound + push when a new live focused signal appears.
  useEffect(() => {
    if (!displaySignal || outcome || closingSignal) return
    const key = signalFocusKey(displaySignal)
    if (announcedKeyRef.current === key) return
    announcedKeyRef.current = key
    const name = formatAssetLabel(displaySignal.asset, assetNameBySymbol)
    const dir = displaySignal.direction === 'CALL' ? 'CALL' : 'PUT'
    void announceSignal({
      title: t('signal_alert'),
      body: `${name} · ${dir} · ${t('signal_alert_desc')}`,
    })
  }, [displaySignal, outcome, closingSignal, assetNameBySymbol, t])

  // After the focused candle closes, keep that trade on the card until it is scored.
  useEffect(() => {
    if (displaySignal) {
      if (closingSignal) setClosingSignal(null)
      if (scoreWatch && signalFocusKey(scoreWatch) !== signalFocusKey(displaySignal)) {
        setScoreWatch(null)
      }
      return
    }
    if (outcome) {
      if (closingSignal) setClosingSignal(null)
      return
    }
    const last = lastLiveRef.current
    if (!last || Number(last.timeframe) !== timeframe) return
    if (market && categoryBySymbol[last.asset] && categoryBySymbol[last.asset] !== market) return
    if (isLiveSignal(last, nowTick)) return
    const doneKey = signalFocusKey(last)
    if (closingDoneKeyRef.current === doneKey) return
    if (shownOutcomeKeysRef.current.has(doneKey)) return
    if (closingSignal?.asset === last.asset && closingSignal.entry_start === last.entry_start) return
    setClosingSignal(last)
    setScoreWatch(last)
  }, [displaySignal, outcome, nowTick, closingSignal, scoreWatch, timeframe, market, categoryBySymbol])

  // While watching a closed trade, promote a matching history row to WIN/LOSS.
  useEffect(() => {
    if (!scoreWatch || outcome) return
    const match = signalHistory.find((h) => historyMatchesWatch(h, scoreWatch))
    if (!match) return
    applyOutcome(match, scoreWatch)
  }, [scoreWatch, outcome, signalHistory, applyOutcome])

  // Poll history while confirming / awaiting a late score.
  useEffect(() => {
    if (!scoreWatch || outcome) return
    let ok = true
    const pull = () => {
      api
        .signalHistory(timeframe)
        .then((r) => {
          if (ok) setSignalHistory(r.history || [])
        })
        .catch(() => {})
    }
    pull()
    const id = window.setInterval(pull, 2000)
    return () => {
      ok = false
      window.clearInterval(id)
    }
  }, [scoreWatch, outcome, timeframe])

  // If no score arrives, leave confirming and return to analyzing (do not re-arm).
  // Keep scoreWatch briefly so a late WS/history score can still show WIN/LOSS.
  useEffect(() => {
    if (!closingSignal || outcome) return
    const key = signalFocusKey(closingSignal)
    const id = window.setTimeout(() => {
      closingDoneKeyRef.current = key
      lastLiveRef.current = null
      setClosingSignal(null)
    }, 12_000)
    return () => window.clearTimeout(id)
  }, [closingSignal, outcome])

  useEffect(() => {
    if (!scoreWatch || closingSignal || outcome) return
    const key = signalFocusKey(scoreWatch)
    const id = window.setTimeout(() => {
      if (scoreWatchRef.current && signalFocusKey(scoreWatchRef.current) === key) {
        setScoreWatch(null)
      }
    }, 45_000)
    return () => window.clearTimeout(id)
  }, [scoreWatch, closingSignal, outcome])

  useEffect(() => {
    lastLiveRef.current = null
    closingDoneKeyRef.current = null
    announcedKeyRef.current = null
    setClosingSignal(null)
    setScoreWatch(null)
    setOutcome(null)
    setFocusedKey(null)
  }, [timeframe, market])

  useEffect(() => {
    if (!assets.length) return
    if (market && selected) {
      const cur = assets.find((a) => a.symbol === selected)
      if (cur && cur.category === market) return
    }
    if (!market && selected) return
    const def = pickDefaultAsset(assets, readSavedAsset(), market)
    if (def && def.symbol !== selected) {
      setSelected(def.symbol)
      saveSelectedAsset(def.symbol)
    }
  }, [market, assets])

  function onMarketChange(next: string) {
    setMarket(next)
    saveMarket(next)
  }

  // Keep focus on a live signal for the chosen operation time only.
  // Do not steal the WIN/LOSS confirmation — it stays ~10s, then analyzing.
  useEffect(() => {
    if (outcome) return
    if (!liveForTf.length) {
      if (focusedKey !== null) setFocusedKey(null)
      return
    }
    if (focusedKey && liveForTf.some((s) => signalFocusKey(s) === focusedKey)) return
    const soonest = pickSoonestActive(liveForTf, nowTick)
    if (!soonest) return
    setClosingSignal(null)
    setFocusedKey(signalFocusKey(soonest))
    setSelected(soonest.asset)
    saveSelectedAsset(soonest.asset)
    setSignal(soonest)
    if (soonest.indicators) setIndicators(soonest.indicators)
  }, [liveForTf, focusedKey, nowTick, outcome])

  const loadAssets = useCallback(async () => {
    const r = await api.assets()
    setAssets(r.assets)
    setStatus((s) =>
      s
        ? { ...s, asset_count: r.total ?? r.count, open_count: r.assets.filter((a) => a.open).length }
        : s,
    )
    return r.assets
  }, [])

  useEffect(() => {
    let disposed = false
    ;(async () => {
      try {
        const [st, list] = await Promise.all([api.status(), api.assets()])
        if (disposed) return
        setStatus(st)
        setAssets(list.assets)
        const def = pickDefaultAsset(list.assets, readSavedAsset(), readSavedMarket())
        if (def) {
          setSelected(def.symbol)
          saveSelectedAsset(def.symbol)
        }
      } catch {
        /* backend not up yet */
      }
    })()

    const disconnect = connectFeed(
      (e) => {
        if (e.type === 'health') {
          const d = e.data
          setStatus((s) => ({
            feed_status: (d.status as string) ?? 'offline',
            connected: !!d.connected,
            account_mode: (d.account_mode as string) ?? s?.account_mode ?? null,
            uptime_sec: (d.uptime_sec as number) ?? null,
            asset_count: s?.asset_count ?? 0,
            open_count: s?.open_count ?? 0,
            instruments_age_sec: (d.instruments_age_sec as number) ?? null,
          }))
        } else if (e.type === 'assets_update') {
          loadAssets().catch(() => {})
        } else if (e.type === 'tick') {
          const tick = e.data
          if (e.asset === selectedRef.current) {
            setPrices((p) => ({ ...p, [e.asset]: tick.price }))
            updateForming(tick.ts, tick.price)
          } else {
            pendingPrices.current[e.asset] = tick.price
          }
        } else if (e.type === 'candle') {
          if (e.asset === selectedRef.current && e.timeframe === chartTfRef.current) {
            setLiveCandle(e.data)
            forming.current = null
          }
        } else if (e.type === 'signal') {
          if (e.asset === selectedRef.current && e.timeframe === tfRef.current) {
            if (isLiveSignal(e.data)) {
              setSignal(e.data)
              if (e.data.indicators) setIndicators(e.data.indicators)
            }
          }
          setActiveSignals((list) => {
            const next = list.filter(
              (s) => !(s.asset === e.data.asset && s.timeframe === e.data.timeframe),
            )
            return isLiveSignal(e.data) ? [e.data, ...next].slice(0, 40) : next
          })
        } else if (e.type === 'signal_result') {
          const rec = e.data
          const sameTf = Number(rec.timeframe) === tfRef.current
          const focus = focusedKeyRef.current
          const shown = displaySignalRef.current
          const last = lastLiveRef.current
          const watch = scoreWatchRef.current
          const entryTime = Number(rec.time)
          const near = (a: number, b: number) =>
            Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= 1
          const matchesFocus =
            (focus != null && focus === `${rec.asset}:${rec.timeframe}:${entryTime}`) ||
            (focus != null &&
              focus.startsWith(`${rec.asset}:${rec.timeframe}:`) &&
              near(Number(focus.split(':').pop()), entryTime)) ||
            (shown != null &&
              shown.asset === rec.asset &&
              Number(shown.timeframe) === Number(rec.timeframe) &&
              near(Number(shown.entry_start), entryTime))
          const matchesLast =
            last != null &&
            last.asset === rec.asset &&
            Number(last.timeframe) === Number(rec.timeframe) &&
            (near(Number(last.entry_start), entryTime) || !Number.isFinite(entryTime))
          const matchesWatch =
            watch != null &&
            watch.asset === rec.asset &&
            Number(watch.timeframe) === Number(rec.timeframe) &&
            near(Number(watch.entry_start), entryTime)
          if (sameTf) {
            setSignalHistory((h) =>
              [rec, ...h.filter((x) => !(x.asset === rec.asset && x.time === rec.time))].slice(0, 20),
            )
          }
          if (e.asset === selectedRef.current && e.timeframe === tfRef.current) {
            setSignal(null)
          }
          setActiveSignals((list) =>
            list.filter((s) => !(s.asset === rec.asset && s.timeframe === rec.timeframe)),
          )
          if (
            sameTf &&
            (matchesFocus || matchesLast || matchesWatch) &&
            assetInMarket(rec.asset, marketRef.current, categoryBySymbolRef.current)
          ) {
            const from =
              (matchesWatch && watch) ||
              (shown &&
              shown.asset === rec.asset &&
              Number(shown.timeframe) === Number(rec.timeframe)
                ? shown
                : null) ||
              (matchesLast ? last : null)
            applyOutcome(rec, from)
          }
        }
      },
      setWsConnected,
    )
    return () => {
      disposed = true
      disconnect()
    }
  }, [loadAssets, applyOutcome])

  function updateForming(ts: number, price: number) {
    const tf = chartTfRef.current
    const start = Math.floor(ts - (ts % tf))
    const f = forming.current
    if (!f || f.start !== start) {
      forming.current = {
        asset: selectedRef.current,
        timeframe: tf,
        start,
        end: start + tf,
        open: price,
        high: price,
        low: price,
        close: price,
        ticks: 1,
      }
    } else {
      f.high = Math.max(f.high, price)
      f.low = Math.min(f.low, price)
      f.close = price
      f.ticks += 1
    }
    setLiveCandle({ ...(forming.current as Candle) })
  }

  useEffect(() => {
    if (!selected) return
    forming.current = null
    setLiveCandle(null)
    let ok = true
    api
      .candles(selected, chartTimeframe, 300)
      .then((r) => ok && setCandles(r.candles))
      .catch(() => ok && setCandles([]))
    return () => {
      ok = false
    }
  }, [selected, chartTimeframe])

  useEffect(() => {
    if (!selected) return
    setSignal(null)
    setIndicators(null)
    let ok = true
    api
      .signal(selected, timeframe)
      .then((r) => {
        if (!ok) return
        setSignal(isLiveSignal(r.signal) ? r.signal : null)
        setIndicators(r.indicators ?? r.signal?.indicators ?? null)
      })
      .catch(() => {})
    return () => {
      ok = false
    }
  }, [selected, timeframe])

  useEffect(() => {
    let ok = true
    api
      .signalHistory(timeframe)
      .then((r) => {
        if (!ok) return
        setSignalHistory(r.history || [])
      })
      .catch(() => {
        if (ok) setSignalHistory([])
      })
    return () => {
      ok = false
    }
  }, [timeframe])

  useEffect(() => {
    let ok = true
    const pull = () => {
      api
        .activeSignals()
        .then((r) => {
          if (!ok) return
          setActiveSignals((r.signals || []).filter((s) => isLiveSignal(s)))
        })
        .catch(() => {})
    }
    pull()
    const id = window.setInterval(pull, 5000)
    return () => {
      ok = false
      window.clearInterval(id)
    }
  }, [])

  useEffect(() => {
    if (!selected) return
    let ok = true
    api
      .indicators(selected, timeframe)
      .then((r) => {
        if (ok && r.indicators) setIndicators(r.indicators)
      })
      .catch(() => {})
    return () => {
      ok = false
    }
  }, [selected, timeframe])

  const livePrice = prices[selected]
  const [priceDir, setPriceDir] = useState('')
  const prevPrice = useRef<number | undefined>(undefined)
  useEffect(() => {
    if (livePrice == null) return
    if (prevPrice.current != null && livePrice !== prevPrice.current) {
      setPriceDir(livePrice > prevPrice.current ? 'up' : 'down')
    }
    prevPrice.current = livePrice
  }, [livePrice])
  useEffect(() => {
    prevPrice.current = undefined
    setPriceDir('')
  }, [selected])

  const displayAssetName = useMemo(() => {
    if (!displaySignal) return selectedAsset?.name ?? selected
    return formatAssetLabel(displaySignal.asset, assetNameBySymbol)
  }, [displaySignal, selectedAsset, selected, assetNameBySymbol])

  const onOutcomeDone = useCallback(() => {
    lastLiveRef.current = null
    setOutcome(null)
    setClosingSignal(null)
    // closingDoneKey stays set so the same trade never re-enters "confirming…"
  }, [])

  function onSelectAsset(symbol: string) {
    setSelected(symbol)
    saveSelectedAsset(symbol)
    // If this asset has a live signal, focus it in Trade Signal / Active Signals.
    // Otherwise keep the current focused signal card, but chart + Key Indicators
    // follow the newly selected asset.
    const forAsset = liveForTf.filter((s) => s.asset === symbol)
    const pick = pickSoonestActive(forAsset, Date.now() / 1000)
    if (pick) {
      setOutcome(null)
      setClosingSignal(null)
      setFocusedKey(signalFocusKey(pick))
      setSignal(pick)
      if (pick.indicators) setIndicators(pick.indicators)
    }
  }

  function onPickActive(s: Signal) {
    setOutcome(null)
    setClosingSignal(null)
    setFocusedKey(signalFocusKey(s))
    setSelected(s.asset)
    saveSelectedAsset(s.asset)
    if (isLiveSignal(s)) {
      setSignal(s)
      if (s.indicators) setIndicators(s.indicators)
    }
  }

  return (
    <div className="app dash">
      <StatusHeader status={status} wsConnected={wsConnected} showStatus={false} />

      {status && status.feed_status !== 'ok' && (
        <div
          className={`banner ${
            status.feed_status === 'session_expired' || status.feed_status === 'throttled'
              ? 'expired'
              : ''
          }`}
        >
          <span className="banner-dot" />
          {status.feed_status === 'throttled'
            ? t('banner_throttled')
            : status.feed_status === 'stalled'
              ? t('banner_stalled')
              : status.feed_status === 'session_expired'
                ? t('banner_expired')
                : t('banner_reconnect')}
        </div>
      )}

      <main className="dash-grid" id="trade">
          <SignalCard
            signal={outcome ? null : displaySignal}
            closing={outcome || displaySignal ? null : closingSignal}
            outcome={outcome}
            assetName={
              outcome
                ? outcome.name
                : displaySignal
                  ? displayAssetName
                  : closingSignal
                    ? formatAssetLabel(closingSignal.asset, assetNameBySymbol)
                    : displayAssetName
            }
            assetSymbol={
              outcome?.result.asset ??
              displaySignal?.asset ??
              closingSignal?.asset ??
              selected
            }
            timeframe={timeframe}
            timeframeLabel={tfLabel(timeframe)}
            connected={!!wsConnected && status?.feed_status === 'ok'}
            onTimeframeChange={setTimeframe}
            onOutcomeDone={onOutcomeDone}
          />
          <IndicatorsPanel
            indicators={indicators}
            timeframeLabel={tfLabel(timeframe)}
            assetName={selectedAsset?.name ?? selected}
            assetSymbol={selected}
            candles={candles}
          />

        <ActiveSignalsPanel
          signals={singleActive}
          focusedKey={focusedKey}
          onPick={onPickActive}
          nameBySymbol={assetNameBySymbol}
          timeframe={timeframe}
          onTimeframeChange={setTimeframe}
          marketLabel={market ? t(`cat_${market}`) : undefined}
          emptyText={
            market
              ? t('active_signals_empty_market').replace('{market}', t(`cat_${market}`))
              : t('active_signals_empty')
          }
        />

        <section className="panel chart-panel dash-card">
          <div className="panel-head chart-head">
            <div className="chart-head-left">
              <div className="asset-title">
                {selected && (
                  <AssetIcon
                    symbol={selected}
                    name={selectedAsset?.name}
                    size="sm"
                    className="chart-asset-icon"
                  />
                )}
                <h2>{selectedAsset ? selectedAsset.name : 'Select an asset'}</h2>
              </div>
              <div className="tf-toggle compact" role="tablist" aria-label={t('current_tf')}>
                {TIMEFRAMES.map((item) => (
                  <button
                    key={item.tf}
                    type="button"
                    className={item.tf === chartTimeframe ? 'on' : ''}
                    onClick={() => setChartTimeframe(item.tf)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="chart-right">
              <span className={`live-price ${priceDir}`}>
                {livePrice != null ? livePrice : '—'}
              </span>
              {selectedAsset && (
                <span className={`payout ${payoutClass(selectedAsset.payout)}`}>
                  {num(selectedAsset.payout)}% {t('payout')}
                </span>
              )}
            </div>
          </div>
          <div className="chart-wrap">
            <CustomChart
              candles={candles}
              liveCandle={liveCandle}
              viewKey={`${selected}:${chartTimeframe}`}
            />
            {selectedAsset && selectedAsset.streamed === false && (
              <div className="chart-overlay">
                <p>
                  <strong>{selectedAsset.name}</strong> {t('chart_catalog_only_1')}
                </p>
                <p className="muted">{t('chart_catalog_only_2')}</p>
              </div>
            )}
          </div>
        </section>

        <AssetTable
          assets={assets}
          prices={prices}
          selected={selected}
          onSelect={onSelectAsset}
          activeSymbols={singleActive.map((s) => s.asset)}
          category={market}
          onCategoryChange={onMarketChange}
        />

        <SignalHistory
          history={historyForMarket}
          timeframeLabel={tfLabel(timeframe)}
          nameBySymbol={assetNameBySymbol}
        />
        <SignalHistoryAnalysis history={historyForMarket} />
      </main>

      <footer className="foot">{t('footer')}</footer>
    </div>
  )
}
