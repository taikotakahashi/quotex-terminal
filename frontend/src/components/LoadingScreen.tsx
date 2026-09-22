import { useEffect, useState } from 'react'
import { useI18n } from '../i18n'
import { SignalRadar } from './SignalRadar'

const INDICATORS = [
  { key: 'ema', name: 'EMA', sub: 'Exponential MA', icon: 'wave' as const },
  { key: 'rsi', name: 'RSI', sub: 'Relative Strength', icon: 'wave' as const },
  { key: 'macd', name: 'MACD', sub: 'Trend Convergence', icon: 'bars' as const },
  { key: 'mom', name: 'MOMENTUM', sub: 'Price Momentum', icon: 'bars' as const },
]

function MiniSpark({ kind }: { kind: 'wave' | 'bars' }) {
  if (kind === 'bars') {
    return (
      <svg className="boot-ind-spark" viewBox="0 0 40 16" aria-hidden>
        <rect x="2" y="8" width="5" height="8" rx="1" fill="currentColor" opacity="0.45" />
        <rect x="10" y="4" width="5" height="12" rx="1" fill="currentColor" opacity="0.7" />
        <rect x="18" y="6" width="5" height="10" rx="1" fill="currentColor" opacity="0.55" />
        <rect x="26" y="2" width="5" height="14" rx="1" fill="currentColor" opacity="0.85" />
        <rect x="34" y="7" width="4" height="9" rx="1" fill="currentColor" opacity="0.5" />
      </svg>
    )
  }
  return (
    <svg className="boot-ind-spark" viewBox="0 0 40 16" aria-hidden>
      <path
        d="M1 12 C8 12, 10 4, 16 6 S26 14, 32 8 38 3, 39 5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  )
}

function BootBg() {
  return (
    <div className="auth-bg" aria-hidden>
      <div className="auth-bg-photo" />
      <div className="auth-bg-photo-veil" />
      <div className="auth-bg-glow" />
      <svg className="auth-bg-waves" viewBox="0 0 1440 900" preserveAspectRatio="none">
        <defs>
          <linearGradient id="bootWaveMain" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#22d3ee" stopOpacity="0" />
            <stop offset="12%" stopColor="#22d3ee" stopOpacity="0.45" />
            <stop offset="50%" stopColor="#a5f3fc" stopOpacity="1" />
            <stop offset="88%" stopColor="#2dd4bf" stopOpacity="0.5" />
            <stop offset="100%" stopColor="#22d3ee" stopOpacity="0" />
          </linearGradient>
          <filter id="bootWaveGlow" x="-5%" y="-120%" width="110%" height="340%">
            <feGaussianBlur stdDeviation="4" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        <path
          className="auth-bg-wave"
          d="M-20 470 C180 390, 280 560, 460 470 S720 350, 900 455 1120 580, 1300 460 1480 390, 1520 430"
          fill="none"
          stroke="url(#bootWaveMain)"
          strokeWidth="3"
          strokeLinecap="round"
          filter="url(#bootWaveGlow)"
        />
      </svg>
    </div>
  )
}

/** Full-screen boot loader shown while auth/session resolves. */
export function LoadingScreen() {
  const { t } = useI18n()
  const [progress, setProgress] = useState(8)

  useEffect(() => {
    const started = Date.now()
    const id = window.setInterval(() => {
      const elapsed = Date.now() - started
      // Reach 100% over 2s so the bar matches the boot hold time.
      const target = Math.min(100, 8 + (elapsed / 2000) * 92)
      setProgress((p) => Math.max(p, target))
      if (elapsed >= 2000) window.clearInterval(id)
    }, 80)
    return () => window.clearInterval(id)
  }, [])

  const pct = Math.round(progress)

  return (
    <div className="boot-screen auth-shell" role="status" aria-live="polite" aria-busy="true">
      <BootBg />
      <header className="boot-top">
        <img className="boot-logo" src="/quotex_logo.svg" alt="Quotex" />
        <p className="boot-brand-line">{t('boot_brand_line')}</p>
      </header>

      <div className="boot-center">
        <div className="boot-radar">
          <SignalRadar tone="call" />
        </div>
        <h1 className="boot-title">{t('boot_title')}</h1>
        <p className="boot-sub">{t('boot_sub')}</p>
        <div className="boot-progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
          <div className="boot-progress-track">
            <div className="boot-progress-fill" style={{ width: `${pct}%` }} />
          </div>
          <span className="boot-progress-pct">{pct}%</span>
        </div>
      </div>

      <div className="boot-indicators">
        {INDICATORS.map((ind, i) => {
          const connected = pct > 28 + i * 16
          return (
            <div key={ind.key} className={`boot-ind ${connected ? 'on' : ''}`}>
              <div className="boot-ind-top">
                <strong>{ind.name}</strong>
                <span>{ind.sub}</span>
              </div>
              <MiniSpark kind={ind.icon} />
              <p className="boot-ind-status">
                <i />
                {connected ? t('boot_connected') : t('boot_analyzing')}
              </p>
            </div>
          )
        })}
      </div>

      <p className="boot-footer">{t('boot_footer')}</p>
    </div>
  )
}
