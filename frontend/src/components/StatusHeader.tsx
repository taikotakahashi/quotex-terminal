import type { Status } from '../types'
import { useI18n } from '../i18n'
import { useTheme } from '../theme'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  alertsEnabled,
  ensureNotifyPermission,
  setAlertsEnabled,
  unlockAudio,
} from '../signalNotify'
import { LangSwitch } from './LangSwitch'
import { TelegramConnect } from './TelegramConnect'
import { UserMenu } from './UserMenu'

interface Props {
  status: Status | null
  wsConnected: boolean
  /** When set, the wordmark links here (e.g. "/" from admin). */
  logoHref?: string
  /** Feed status strip (time / online / connected). Default true. */
  showStatus?: boolean
  /** Signal sound/push mute toggle. Default true. */
  showAlerts?: boolean
}

function ThemeToggle() {
  const { theme, toggle } = useTheme()
  return (
    <button
      className="theme-toggle"
      onClick={toggle}
      title={theme === 'dark' ? 'Light mode' : 'Dark mode'}
      aria-label="Toggle theme"
    >
      {theme === 'dark' ? (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
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

function AlertsToggle() {
  const { t } = useI18n()
  const [on, setOn] = useState(() => alertsEnabled())

  async function toggle() {
    const next = !on
    setAlertsEnabled(next)
    setOn(next)
    if (next) {
      await unlockAudio()
      await ensureNotifyPermission()
    }
  }

  return (
    <button
      className={`alerts-toggle ${on ? 'on' : 'off'}`}
      onClick={() => {
        void toggle()
      }}
      title={on ? t('alerts_on') : t('alerts_off')}
      aria-label={on ? t('alerts_on') : t('alerts_off')}
      aria-pressed={on}
    >
      {on ? (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M15 17h5l-1.4-1.4A2 2 0 0 1 18 14.2V11a6 6 0 1 0-12 0v3.2a2 2 0 0 1-.6 1.4L4 17h5" />
          <path d="M9 17a3 3 0 0 0 6 0" />
        </svg>
      ) : (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M15 17h5l-1.4-1.4A2 2 0 0 1 18 14.2V11a6 6 0 0 0-1.2-3.6" />
          <path d="M6.7 6.7A6 6 0 0 0 6 11v3.2a2 2 0 0 1-.6 1.4L4 17h11" />
          <path d="M9 17a3 3 0 0 0 4.9 2.3" />
          <path d="M3 3l18 18" />
        </svg>
      )}
    </button>
  )
}

export function StatusHeader({
  status,
  wsConnected,
  logoHref,
  showStatus = true,
  showAlerts = true,
}: Props) {
  const { t } = useI18n()
  const [clock, setClock] = useState(() =>
    new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
  )
  useEffect(() => {
    const id = window.setInterval(() => {
      setClock(
        new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      )
    }, 250)
    return () => window.clearInterval(id)
  }, [])
  const live = !!status?.connected && status.feed_status === 'ok'
  const connected = !!wsConnected && live

  const logo = <img className="wordmark" src="/quotex_logo.svg" alt="Quotex" />

  return (
    <header className="header dash-header">
      <div className="header-left">
        {logoHref ? (
          <Link to={logoHref} className="header-logo-link" title="Signals dashboard">
            {logo}
          </Link>
        ) : (
          logo
        )}
      </div>

      <div className="header-right">
        {showStatus && (
          <div className="header-status">
            <span>
              {t('local_time')} <strong>{clock}</strong>
            </span>
            <span className={connected ? 'on' : 'off'}>
              <i className="header-status-pip" aria-hidden />
              {connected ? t('system_online') : t('system_offline')}
            </span>
            <span className={connected ? 'on' : 'off'}>
              <i className="header-status-pip" aria-hidden />
              {connected ? t('system_connected') : t('system_disconnected')}
            </span>
          </div>
        )}
        <div className="controls">
          <LangSwitch />
          {showAlerts && <AlertsToggle />}
          <TelegramConnect variant="header" />
          <ThemeToggle />
          <UserMenu />
        </div>
      </div>
    </header>
  )
}
