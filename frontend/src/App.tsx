import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, connectFeed } from './api'
import type { Asset, Candle, Signal, SignalResult, Status } from './types'
import { StatusHeader } from './components/StatusHeader'
import { AssetTable } from './components/AssetTable'
import { CustomChart } from './components/CustomChart'
import { SignalCard } from './components/SignalCard'
import { IndicatorsPanel } from './components/IndicatorsPanel'
import { SignalHistory } from './components/SignalHistory'
import { num, payoutClass } from './util'
import { useI18n } from './i18n'

const TIMEFRAMES = [
  { tf: 60, label: 'M1' },
  { tf: 300, label: 'M5' },
  { tf: 900, label: 'M15' },
]
const tfLabel = (tf: number) => TIMEFRAMES.find((t) => t.tf === tf)?.label ?? `${tf}s`

export default function App() {
  const { t } = useI18n()
  const [status, setStatus] = useState<Status | null>(null)
  const [assets, setAssets] = useState<Asset[]>([])
  const [prices, setPrices] = useState<Record<string, number>>({})
  const [selected, setSelected] = useState<string>('')
  const [timeframe, setTimeframe] = useState<number>(60)
  const [candles, setCandles] = useState<Candle[]>([])
  const [liveCandle, setLiveCandle] = useState<Candle | null>(null)
  const [signal, setSignal] = useState<Signal | null>(null)
  const [signalHistory, setSignalHistory] = useState<SignalResult[]>([])
  const [wsConnected, setWsConnected] = useState(false)

  const forming = useRef<Candle | null>(null)
  const selectedRef = useRef(selected)
  const tfRef = useRef(timeframe)
  const pendingPrices = useRef<Record<string, number>>({})
  selectedRef.current = selected
  tfRef.current = timeframe

  // Flush accumulated tick prices to state at 4Hz (decouples render from tick rate).
  useEffect(() => {
    const id = setInterval(() => {
      if (Object.keys(pendingPrices.current).length === 0) return
      setPrices((p) => ({ ...p, ...pendingPrices.current }))
      pendingPrices.current = {}
    }, 250)
    return () => clearInterval(id)
  }, [])

  const selectedAsset = useMemo(
    () => assets.find((a) => a.symbol === selected) || null,
    [assets, selected],
  )

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

  // Initial load + WebSocket wiring.
  useEffect(() => {
    let disposed = false
    ;(async () => {
      try {
        const [st, list] = await Promise.all([api.status(), api.assets()])
        if (disposed) return
        setStatus(st)
        setAssets(list.assets)
        // Default to an asset we actually stream (so the chart has data),
        // preferring one that is currently open.
        const def =
          list.assets.find((a) => a.streamed && a.open) ||
          list.assets.find((a) => a.streamed) ||
          list.assets.find((a) => a.open) ||
          list.assets[0]
        if (def) setSelected(def.symbol)
      } catch {
        /* backend not up yet; WS state badge will show offline */
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
          const t = e.data
          // Accumulate into a ref; a timer flushes to state at ~4Hz so the
          // render rate stays smooth even with dozens of assets ticking.
          pendingPrices.current[e.asset] = t.price
          if (e.asset === selectedRef.current) updateForming(t.ts, t.price)
        } else if (e.type === 'candle') {
          if (e.asset === selectedRef.current && e.timeframe === tfRef.current) {
            setLiveCandle(e.data)
            forming.current = null
          }
        } else if (e.type === 'signal') {
          if (e.asset === selectedRef.current && e.timeframe === tfRef.current) {
            setSignal(e.data)
          }
        } else if (e.type === 'signal_result') {
          if (e.asset === selectedRef.current && e.timeframe === tfRef.current) {
            setSignalHistory((h) => [e.data, ...h].slice(0, 12))
          }
        }
      },
      setWsConnected,
    )
    return () => {
      disposed = true
      disconnect()
    }
  }, [loadAssets])

  // Build a client-side forming candle from ticks so the chart moves live.
  function updateForming(ts: number, price: number) {
    const tf = tfRef.current
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

  // Load history when the selection or timeframe changes.
  useEffect(() => {
    if (!selected) return
    forming.current = null
    setLiveCandle(null)
    let ok = true
    api
      .candles(selected, timeframe, 300)
      .then((r) => ok && setCandles(r.candles))
      .catch(() => ok && setCandles([]))
    return () => {
      ok = false
    }
  }, [selected, timeframe])

  // Load the signal + its history when the selection or timeframe changes.
  useEffect(() => {
    if (!selected) return
    setSignal(null)
    setSignalHistory([])
    let ok = true
    api
      .signal(selected, timeframe)
      .then((r) => {
        if (!ok) return
        setSignal(r.signal)
        setSignalHistory(r.history)
      })
      .catch(() => {})
    return () => {
      ok = false
    }
  }, [selected, timeframe])

  const livePrice = prices[selected]

  // Direction of the last price move on the selected asset (colors the big price).
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

  return (
    <div className="app">
      <StatusHeader status={status} wsConnected={wsConnected} />

      {status && status.feed_status !== 'ok' && (
        <div className={`banner ${status.feed_status === 'session_expired' || status.feed_status === 'throttled' ? 'expired' : ''}`}>
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

      <main className="grid">
        <div className="chart-col">
          <div className="signal-row">
            <SignalCard
              signal={signal}
              assetName={selectedAsset?.name ?? selected}
              livePrice={livePrice}
              timeframeLabel={tfLabel(timeframe)}
            />
            <IndicatorsPanel
              indicators={signal?.indicators ?? null}
              timeframeLabel={tfLabel(timeframe)}
            />
          </div>

          <section className="panel chart-panel">
            <div className="panel-head chart-head">
              <div className="asset-title">
                <h2>{selectedAsset ? selectedAsset.name : 'Select an asset'}</h2>
                <span className="sym">{selected || '—'}</span>
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
            <div className="tf-toggle">
              {TIMEFRAMES.map((t) => (
                <button
                  key={t.tf}
                  className={t.tf === timeframe ? 'on' : ''}
                  onClick={() => setTimeframe(t.tf)}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <div className="chart-wrap">
              <CustomChart
                candles={candles}
                liveCandle={liveCandle}
                viewKey={`${selected}:${timeframe}`}
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

          <SignalHistory history={signalHistory} />
        </div>

        <AssetTable assets={assets} prices={prices} selected={selected} onSelect={setSelected} />
      </main>

      <footer className="foot">{t('footer')}</footer>
    </div>
  )
}
