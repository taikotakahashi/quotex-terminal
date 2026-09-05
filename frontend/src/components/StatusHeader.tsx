import type { Status } from '../types'
import { fmtUptime } from '../util'
import { useI18n } from '../i18n'
import { useTheme } from '../theme'

interface Props {
  status: Status | null
  wsConnected: boolean
}

function FlagUS() {
  return (
    <svg className="flag" viewBox="0 0 20 14" xmlns="http://www.w3.org/2000/svg">
      <rect width="20" height="14" fill="#b22234" />
      <g fill="#fff">
        {[1, 3, 5, 7, 9, 11].map((i) => (
          <rect key={i} y={i * (14 / 13)} width="20" height={14 / 13} />
        ))}
      </g>
      <rect width="8.4" height={(14 / 13) * 7} fill="#3c3b6e" />
      <g fill="#fff">
        {[1.4, 4.2, 7].flatMap((cy) =>
          [1, 2.9, 4.8, 6.7].map((cx) => <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="0.5" />),
        )}
      </g>
    </svg>
  )
}

function FlagBR() {
  return (
    <svg className="flag" viewBox="0 0 20 14" xmlns="http://www.w3.org/2000/svg">
      <rect width="20" height="14" fill="#009c3b" />
      <polygon points="10,1.6 18,7 10,12.4 2,7" fill="#ffdf00" />
      <circle cx="10" cy="7" r="3.1" fill="#002776" />
      <path d="M7.1 6.35 A3.8 3.8 0 0 1 12.9 7.5" stroke="#fff" strokeWidth="0.7" fill="none" />
    </svg>
  )
}

const FLAGS = { en: FlagUS, pt: FlagBR }
const FLAG_LABEL = { en: 'English', pt: 'Português (Brasil)' }

function ThemeToggle() {
  const { theme, toggle } = useTheme()
  return (
    <button className="theme-toggle" onClick={toggle} title={theme === 'dark' ? 'Light mode' : 'Dark mode'} aria-label="Toggle theme">
      {theme === 'dark' ? (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </svg>
      ) : (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
        </svg>
      )}
    </button>
  )
}

function Logo() {
  return <img className="wordmark" src="/quotex_logo.svg" alt="Quotex" />
}

export function StatusHeader({ status, wsConnected }: Props) {
  const { t, lang, setLang } = useI18n()
  const live = !!status?.connected && status.feed_status === 'ok'
  const badge = !wsConnected
    ? { cls: 'off', text: 'OFFLINE' }
    : live
      ? { cls: 'live', text: 'LIVE' }
      : { cls: 'warn', text: (status?.feed_status || 'offline').toUpperCase() }

  return (
    <header className="header">
      <div className="header-bar">
        <div className="brand">
          <Logo />
          <div className="brand-text">
            <span className={`badge ${badge.cls}`}>
              <span className="pip" />
              {badge.text}
            </span>
            <span className="sub">{t('brand_sub')}</span>
          </div>
        </div>

        <div className="controls">
          <div className="lang-switch">
            {(['en', 'pt'] as const).map((l) => {
              const Flag = FLAGS[l]
              return (
                <button
                  key={l}
                  className={l === lang ? 'on' : ''}
                  onClick={() => setLang(l)}
                  title={FLAG_LABEL[l]}
                  aria-label={FLAG_LABEL[l]}
                >
                  <Flag />
                </button>
              )
            })}
          </div>
          <ThemeToggle />
        </div>
      </div>

      <div className="metrics">
        <Metric label={t('account')} value={status?.account_mode ?? '—'} />
        <Metric label={t('assets_open')} value={status ? `${status.open_count}/${status.asset_count}` : '—'} />
        <Metric label={t('uptime')} value={fmtUptime(status?.uptime_sec)} />
        <Metric
          label={t('catalog_age')}
          value={status?.instruments_age_sec != null ? `${status.instruments_age_sec}s` : '—'}
        />
      </div>
    </header>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric">
      <span className="metric-value">{value}</span>
      <span className="metric-label">{label}</span>
    </div>
  )
}
