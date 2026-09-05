import { useEffect, useState } from 'react'
import type { Signal } from '../types'
import { useI18n, useReason } from '../i18n'

interface Props {
  signal: Signal | null
  assetName: string
  livePrice?: number
  timeframeLabel: string
}

const TF_SECONDS: Record<number, number> = { 60: 60, 300: 300, 900: 900 }

function fmtClock(sec: number): string {
  const s = Math.max(0, Math.floor(sec))
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

export function SignalCard({ signal, assetName, livePrice, timeframeLabel }: Props) {
  const { t } = useI18n()
  const reason = useReason()
  const [now, setNow] = useState(() => Date.now() / 1000)
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now() / 1000), 250)
    return () => clearInterval(id)
  }, [])

  if (!signal) {
    return (
      <section className="panel signal-card empty-signal">
        <div className="sig-wait">{t('waiting_signal')}</div>
        <p className="muted">{t('waiting_desc')}</p>
      </section>
    )
  }

  const period = TF_SECONDS[signal.timeframe] ?? 60
  // The signal is for the candle currently forming (it opened at entry_start).
  // Count down to when it CLOSES / the trade resolves.
  const expiresAt = signal.entry_start + period
  const remaining = expiresAt - now
  const progress = Math.min(1, Math.max(0, 1 - remaining / period))
  const price = livePrice ?? signal.current_price
  const dirClass = signal.direction === 'CALL' ? 'call' : 'put'
  const expiresClock = new Date(expiresAt * 1000)
    .toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

  return (
    <section className="panel signal-card">
      <div className="sig-head">
        <div>
          <div className="sig-label">{t('active')}</div>
          <div className="sig-asset">{assetName}</div>
        </div>
        <span className="sig-badge">{t('live_quotex')}</span>
      </div>

      <div className="sig-price-block">
        <div className="sig-label">{t('current_price')}</div>
        <div className="sig-price">{price}</div>
      </div>

      <div className="sig-next">{t('next_signal')}</div>
      <div className="sig-schedule">
        {expiresClock} · {t('expires_in')} <strong>{fmtClock(remaining)}</strong>
      </div>
      <div className="sig-pair">{assetName} · {timeframeLabel}</div>

      <div className={`sig-direction ${dirClass}`}>{signal.direction}</div>
      <div className="sig-confidence">
        {t('confidence')}: <strong>{signal.confidence}%</strong>
      </div>
      <div className="sig-reasons">{signal.reasons.map(reason).join(' · ')}</div>

      <div className="sig-progress">
        <div className={`sig-progress-bar ${dirClass}`} style={{ width: `${progress * 100}%` }} />
      </div>
    </section>
  )
}
