import { useEffect, useMemo, useState } from 'react'
import type { Signal } from '../types'
import { useI18n } from '../i18n'
import { AssetIcon } from './AssetIcon'
import { formatAssetLabel, isLiveSignal, signalFocusKey, TIMEFRAMES, tfShort } from '../util'

interface Props {
  signals: Signal[]
  onPick: (signal: Signal) => void
  /** Currently focused signal key (`asset:tf:entry_start`). */
  focusedKey?: string | null
  /** Exact outer height to match (e.g. Indicators panel). */
  matchHeight?: number
  /** symbol → catalog display name (same as Assets table). */
  nameBySymbol?: Record<string, string>
  timeframe: number
  onTimeframeChange: (tf: number) => void
  marketLabel?: string
  emptyText?: string
}

function fmtClock(sec: number): string {
  const s = Math.max(0, Math.floor(sec))
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

export function ActiveSignalsPanel({
  signals,
  onPick,
  focusedKey,
  matchHeight,
  nameBySymbol,
  timeframe,
  onTimeframeChange,
  marketLabel,
  emptyText,
}: Props) {
  const { t } = useI18n()
  const [now, setNow] = useState(() => Date.now() / 1000)

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now() / 1000), 200)
    return () => window.clearInterval(id)
  }, [])

  const live = signals.filter((s) => isLiveSignal(s, now))
  const locked = matchHeight != null && matchHeight > 0
  const names = useMemo(() => nameBySymbol ?? {}, [nameBySymbol])

  return (
    <section
      className={`panel active-signals-panel dash-card${locked ? ' height-locked' : ''}`}
      /* Test: hide panel without deleting — TF toggle moved to Trade Signal. */
      style={{
        display: 'none',
        ...(locked ? { height: matchHeight, maxHeight: matchHeight } : {}),
      }}
    >
      <div className="panel-head">
        <h2>{t('active_signals')}</h2>
        <div className="history-meta">
          {marketLabel && <span className="tf-chip">{marketLabel}</span>}
          <div className="tf-toggle compact" role="tablist" aria-label={t('active_signals')}>
            {TIMEFRAMES.map((item) => (
              <button
                key={item.tf}
                type="button"
                className={item.tf === timeframe ? 'on' : ''}
                onClick={() => onTimeframeChange(item.tf)}
              >
                {item.label}
              </button>
            ))}
          </div>
          <span className="tf-chip">{live.length}</span>
        </div>
      </div>
      {live.length === 0 ? (
        <p className="active-signals-empty muted">{emptyText || t('active_signals_empty')}</p>
      ) : (
        <div className="active-signal-rows">
          {live.map((s) => {
            const key = signalFocusKey(s)
            const remain = Math.max(
              0,
              Math.ceil(Number(s.entry_start) + Number(s.timeframe) - now),
            )
            const untilEntry = Number(s.entry_start) - now
            const label = formatAssetLabel(s.asset, names)
            const focused = focusedKey === key
            return (
              <button
                key={key}
                type="button"
                className={`active-signal-row ${s.direction === 'CALL' ? 'call' : 'put'}${
                  focused ? ' focused' : ''
                }`}
                onClick={() => onPick(s)}
                title={s.asset}
                aria-current={focused ? 'true' : undefined}
              >
                <AssetIcon symbol={s.asset} name={label} size="sm" />
                <span className="as-name">{label}</span>
                <span className="as-tf">{tfShort(s.timeframe)}</span>
                <span className={`as-dir ${s.direction === 'CALL' ? 'call' : 'put'}`}>
                  {s.direction}
                </span>
                <span className="as-conf">{s.confidence}%</span>
                <span className="as-time">
                  {untilEntry > 0 ? fmtClock(untilEntry) : fmtClock(remain)}
                </span>
              </button>
            )
          })}
        </div>
      )}
    </section>
  )
}
