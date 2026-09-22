import { type ReactNode, useEffect, useState } from 'react'
import type { Signal, SignalResult } from '../types'
import { useI18n, useReason } from '../i18n'
import { AssetIcon } from './AssetIcon'
import { SignalRadar } from './SignalRadar'
import { isLiveSignal, TIMEFRAMES, tfShort } from '../util'

const ANALYZE_INDICATORS = [
  {
    key: 'EMA',
    full: 'Exponential Moving Average',
    spark: 'M2 18 C6 16 8 10 12 12 S18 6 22 8',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
        <path d="M4 16c3-1 4-6 7-6s4 5 7 4 3-5 5-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    key: 'RSI',
    full: 'Relative Strength Index',
    spark: 'M2 14 C5 8 8 18 12 12 S18 6 22 10',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
        <path d="M4 12h16M8 7v10M16 5v14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    key: 'MACD',
    full: 'Moving Average Convergence',
    spark: 'M3 16 V10 M7 16 V7 M11 16 V12 M15 16 V5 M19 16 V9',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
        <path d="M5 18V10M10 18V6M15 18v-5M20 18V8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    key: 'MOMENTUM',
    full: 'Price Momentum Oscillator',
    spark: 'M2 16 C6 16 7 8 12 8 S18 16 22 12',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
        <path d="M4 15l5-5 4 3 7-7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M15 6h5v5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
] as const

export interface SignalOutcome {
  result: SignalResult
  reasons: string[]
  name: string
}

interface Props {
  signal: Signal | null
  closing?: Signal | null
  outcome?: SignalOutcome | null
  assetName: string
  assetSymbol?: string
  timeframe: number
  timeframeLabel: string
  connected: boolean
  onTimeframeChange: (tf: number) => void
  onOutcomeDone?: () => void
}

const OUTCOME_HOLD_MS = 10_000

function fmtClock(sec: number): string {
  const s = Math.max(0, Math.floor(sec))
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

function fmtEntryTime(unixSec: number): string {
  if (!Number.isFinite(unixSec) || unixSec <= 0) return '--:--:--'
  return new Date(unixSec * 1000).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

function fmtHm(unixSec: number): string {
  if (!Number.isFinite(unixSec) || unixSec <= 0) return '--:--'
  return new Date(unixSec * 1000).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  })
}

function fmtPrice(v: number | null | undefined): string {
  if (v == null || Number.isNaN(Number(v))) return '—'
  return String(v)
}

function phaseOf(signal: Signal, now: number): { before: boolean; remain: number } {
  const period = Math.max(1, Number(signal.timeframe) || 60)
  const entryStart = Number(signal.entry_start)
  if (now < entryStart) return { before: true, remain: entryStart - now }
  return { before: false, remain: Math.max(0, entryStart + period - now) }
}

function findReason(reasons: string[], ...needles: string[]): string | null {
  const hit = reasons.find((r) => needles.some((n) => r.toLowerCase().includes(n)))
  return hit ?? null
}

function ConfirmationGrid({ reasons }: { reasons: string[] }) {
  const { t } = useI18n()
  const translate = useReason()
  const rows = [
    { key: 'ma', label: t('conf_ma'), raw: findReason(reasons, 'ema') },
    { key: 'rsi', label: t('conf_rsi'), raw: findReason(reasons, 'rsi') },
    { key: 'force', label: t('conf_force'), raw: findReason(reasons, 'macd') },
    { key: 'mom', label: t('conf_momentum'), raw: findReason(reasons, 'momentum') },
  ]
  return (
    <div className="sig-confirm-box">
      <div className="sig-timing-label">{t('tech_confirm')}</div>
      <div className="sig-confirm-grid">
        {rows.map((row) => (
          <div key={row.key} className={`sig-confirm-row ${row.raw ? 'ok' : ''}`}>
            <span>{row.label}</span>
            <strong>{row.raw ? translate(row.raw) : t('analyzing_status')}</strong>
          </div>
        ))}
      </div>
    </div>
  )
}

function SignalShell({
  children,
  timeframe,
  onTimeframeChange,
}: {
  children: ReactNode
  timeframe: number
  timeframeLabel: string
  onTimeframeChange: (tf: number) => void
}) {
  const { t } = useI18n()
  return (
    <section className="panel signal-card dash-card sig-flow">
      <div className="sig-card-head">
        <h2>{t('trade_signal')}</h2>
        <div className="sig-head-meta">
          <div className="tf-toggle compact" role="tablist" aria-label={t('choose_op_time')}>
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
        </div>
      </div>
      <div className="sig-flow-body">{children}</div>
    </section>
  )
}

export function SignalCard({
  signal,
  closing,
  outcome,
  assetName,
  assetSymbol,
  timeframe,
  timeframeLabel,
  connected: _connected,
  onTimeframeChange,
  onOutcomeDone,
}: Props) {
  const { t } = useI18n()
  const [now, setNow] = useState(() => Date.now() / 1000)

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now() / 1000), 200)
    return () => window.clearInterval(id)
  }, [])

  useEffect(() => {
    if (!outcome || !onOutcomeDone) return
    const id = window.setTimeout(() => onOutcomeDone(), OUTCOME_HOLD_MS)
    return () => window.clearTimeout(id)
  }, [outcome, onOutcomeDone])

  const shell = {
    timeframe,
    timeframeLabel,
    onTimeframeChange,
  }

  if (signal && isLiveSignal(signal, now)) {
    const { before, remain } = phaseOf(signal, now)
    const period = Math.max(1, Number(signal.timeframe) || 60)
    const entryStart = Number(signal.entry_start)
    const closeAt = entryStart + period
    const dirClass = signal.direction === 'CALL' ? 'call' : 'put'
    const remainDisplay = Math.max(0, Math.ceil(remain - 0.001))
    const urgent = remainDisplay <= 10
    const tf = tfShort(Number(signal.timeframe) || 60)
    const windowSec = before
      ? Math.max(
          1,
          entryStart -
            (Number(signal.notify_at) || Number(signal.generated_at) || entryStart - period),
        )
      : period
    const elapsed = before ? windowSec - remain : period - remain
    const progress = Math.min(1, Math.max(0, elapsed / windowSec))

    if (before) {
      return (
        <SignalShell {...shell}>
          <div className="sig-arrived-hero">
            <SignalRadar />
            <div className="sig-alert">
              <strong>{t('signal_alert')}</strong>
              <span>{t('signal_alert_desc')}</span>
            </div>
          </div>
          <div className="sig-asset-meta">
            <AssetIcon
              key={assetSymbol || signal.asset}
              symbol={assetSymbol || signal.asset}
              name={assetName}
              size="md"
              className="sig-asset-icon"
            />
            <span className="sig-asset">{assetName}</span>
            <span className="tf-chip">{tf}</span>
            <span className="conf-chip">{signal.confidence}%</span>
          </div>
          <div className={`sig-dir-btn ${dirClass}`}>
            <span className="sig-dir-arrow">{signal.direction === 'CALL' ? '↗' : '↘'}</span>
            {signal.direction}
          </div>
          <div className={`sig-hero-count ${urgent ? 'urgent' : ''}`}>
            <div className="sig-timing-label">{t('grab_signal_in')}</div>
            <div className="sig-hero-clock">{fmtClock(remainDisplay)}</div>
            <div className="sig-exact-entry">
              {t('exact_entry')} <strong>{fmtEntryTime(entryStart)}</strong>
            </div>
          </div>
          <p className="sig-timing-hint">
            {t('entry_action_hint')
              .replace('{dir}', signal.direction)
              .replace('{time}', fmtEntryTime(entryStart))}
          </p>
          <div className="sig-progress">
            <div className="sig-progress-bar" style={{ width: `${progress * 100}%` }} />
          </div>
        </SignalShell>
      )
    }

    return (
      <SignalShell {...shell}>
        <div className="sig-flow-kicker">{t('trade_in_progress')}</div>
        <div className="sig-flow-title">
          <AssetIcon
            key={assetSymbol || signal.asset}
            symbol={assetSymbol || signal.asset}
            name={assetName}
            size="md"
            className="sig-asset-icon"
          />
          <div>
            <div className="sig-asset">
              {assetName} <span className={`sig-inline-dir ${dirClass}`}>· {signal.direction}</span>
            </div>
            <div className="sig-sym">
              {tf} · {signal.confidence}%
            </div>
          </div>
        </div>
        <p className="sig-timing-hint">{t('trade_started')}</p>
        <div className={`sig-hero-count ${urgent ? 'urgent' : ''}`}>
          <div className="sig-timing-label">{t('time_to_close')}</div>
          <div className="sig-hero-clock">{fmtClock(remainDisplay)}</div>
          <div className="sig-exact-entry">{t('waiting_candle')}</div>
        </div>
        <div className="sig-meta-row">
          <div>
            <span className="sig-timing-label">{t('entry_short')}</span>
            <strong>{fmtEntryTime(entryStart)}</strong>
          </div>
          <div>
            <span className="sig-timing-label">{t('close_short')}</span>
            <strong>{fmtEntryTime(closeAt)}</strong>
          </div>
        </div>
        <div className="sig-progress">
          <div className="sig-progress-bar" style={{ width: `${progress * 100}%` }} />
        </div>
      </SignalShell>
    )
  }

  if (outcome) {
    const rec = outcome.result
    const dirClass = rec.direction === 'CALL' ? 'call' : 'put'
    const resClass = rec.result.toLowerCase()
    const tf = tfShort(Number(rec.timeframe) || 60)
    // Backend `time` is candle open (entry); close is entry + timeframe.
    const entryAt = Number(rec.time) || 0
    const closeAt = entryAt ? entryAt + Math.max(1, Number(rec.timeframe) || 60) : 0
    return (
      <SignalShell {...shell}>
        <div className={`sig-result-banner ${resClass}`}>{rec.result}</div>
        <p className="sig-timing-hint">{t('result_confirmed')}</p>
        <div className="sig-flow-title">
          <AssetIcon
            key={rec.asset}
            symbol={rec.asset}
            name={outcome.name}
            size="md"
            className="sig-asset-icon"
          />
          <div>
            <div className="sig-asset">{outcome.name}</div>
            <div className={`sig-flow-dir ${dirClass}`}>
              {rec.direction} · {tf}
            </div>
          </div>
        </div>
        <div className="sig-meta-row">
          <div>
            <span className="sig-timing-label">{t('asset_label')}</span>
            <strong>{outcome.name}</strong>
          </div>
          <div>
            <span className="sig-timing-label">{t('entry_short')}</span>
            <strong>
              {fmtHm(entryAt)} · {fmtPrice(rec.entry_price)}
            </strong>
          </div>
          <div>
            <span className="sig-timing-label">{t('close_short')}</span>
            <strong>
              {fmtHm(closeAt)} · {fmtPrice(rec.closure_price)}
            </strong>
          </div>
        </div>
        <ConfirmationGrid reasons={outcome.reasons} />
        <span className="sig-confirm-conf">
          {t('analysis_confidence').replace('{conf}', String(rec.confidence))}
        </span>
        <span className="sig-realtime">{t('realtime_data')}</span>
      </SignalShell>
    )
  }

  if (closing) {
    const dirClass = closing.direction === 'CALL' ? 'call' : 'put'
    const tf = tfShort(Number(closing.timeframe) || 60)
    const entryStart = Number(closing.entry_start)
    const closeAt = entryStart + Math.max(1, Number(closing.timeframe) || 60)
    return (
      <SignalShell {...shell}>
        <div className="sig-flow-kicker">{t('trade_in_progress')}</div>
        <div className="sig-flow-title">
          <AssetIcon
            key={assetSymbol || closing.asset}
            symbol={assetSymbol || closing.asset}
            name={assetName}
            size="md"
            className="sig-asset-icon"
          />
          <div>
            <div className="sig-asset">{assetName}</div>
            <div className={`sig-flow-dir ${dirClass}`}>
              {closing.direction} · {tf}
            </div>
          </div>
        </div>
        <p className="sig-timing-hint">{t('awaiting_result')}</p>
        <div className="sig-meta-row">
          <div>
            <span className="sig-timing-label">{t('entry_short')}</span>
            <strong>{fmtEntryTime(entryStart)}</strong>
          </div>
          <div>
            <span className="sig-timing-label">{t('close_short')}</span>
            <strong>{fmtEntryTime(closeAt)}</strong>
          </div>
        </div>
      </SignalShell>
    )
  }

  return (
    <SignalShell {...shell}>
      <div className="sig-analyze-body">
        <div className="sig-analyze-top">
          <div className="sig-analyze-live">
            <i aria-hidden />
            {t('realtime_scanning')}
          </div>
        </div>

        <div className="sig-analyze-stage">
          <div className="sig-analyze-center">
            <SignalRadar />
            <div className="sig-wait">{t('analyzing_title')}</div>
            <p className="muted sig-wait-desc">
              {t('analyzing_desc').replace('{tf}', timeframeLabel)}
            </p>
          </div>
        </div>

        <div className="sig-analyze-grid">
          {ANALYZE_INDICATORS.map((ind) => (
            <div key={ind.key} className={`sig-analyze-chip theme-${ind.key.toLowerCase()}`}>
              <div className="sig-analyze-chip-top">
                <span className="sig-analyze-ico" aria-hidden>
                  {ind.icon}
                </span>
                <div className="sig-analyze-copy">
                  <span className="sig-analyze-name">{ind.key}</span>
                  <span className="sig-analyze-full">{ind.full}</span>
                </div>
                <svg className="sig-analyze-spark" viewBox="0 0 24 24" preserveAspectRatio="none" aria-hidden>
                  <path
                    d={ind.spark}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </div>
              <span className="sig-analyze-state">
                <i className="sig-analyze-pip" aria-hidden />
                {t('analyzing_status')}
              </span>
            </div>
          ))}
        </div>
      </div>
    </SignalShell>
  )
}
