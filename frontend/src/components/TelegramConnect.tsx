import { useCallback, useEffect, useState } from 'react'
import { api, type TelegramStatus } from '../api'
import { useAuth } from '../auth'
import { useI18n } from '../i18n'

function errDetail(e: unknown): string {
  if (e && typeof e === 'object' && 'detail' in e) {
    const d = (e as { detail?: unknown }).detail
    if (typeof d === 'string') return d
    if (d && typeof d === 'object' && 'code' in (d as object)) {
      const code = (d as { code?: string }).code
      if (code === 'email_not_verified') return 'email_not_verified'
    }
    if (d && typeof d === 'object' && 'detail' in (d as object)) {
      const inner = (d as { detail?: unknown }).detail
      if (typeof inner === 'string') return inner
    }
  }
  return e instanceof Error ? e.message : 'Request failed'
}

type Props = {
  /** Compact control for the header vs full block in profile. */
  variant?: 'header' | 'profile'
}

export function TelegramConnect({ variant = 'header' }: Props) {
  const { user } = useAuth()
  const { t } = useI18n()
  const [status, setStatus] = useState<TelegramStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const refresh = useCallback(async () => {
    if (!user?.email_verified) {
      setStatus(null)
      return
    }
    try {
      const st = await api.telegramStatus()
      setStatus(st)
      setError('')
    } catch (e) {
      const detail = errDetail(e)
      if (detail === 'email_not_verified') setError(t('tg_need_verified'))
      else setStatus(null)
    }
  }, [user?.email_verified, t])

  useEffect(() => {
    void refresh()
  }, [refresh])

  if (!user) return null

  async function onConnect() {
    setBusy(true)
    setError('')
    try {
      const res = await api.telegramLink()
      window.open(res.deep_link, '_blank', 'noopener,noreferrer')
      // Poll briefly so UI flips to linked after user finishes in Telegram.
      for (let i = 0; i < 15; i++) {
        await new Promise((r) => setTimeout(r, 2000))
        const st = await api.telegramStatus()
        setStatus(st)
        if (st.linked) break
      }
    } catch (e) {
      const detail = errDetail(e)
      setError(detail === 'email_not_verified' ? t('tg_need_verified') : detail || t('tg_connect_failed'))
    } finally {
      setBusy(false)
    }
  }

  async function onUnlink() {
    setBusy(true)
    setError('')
    try {
      await api.telegramUnlink()
      await refresh()
    } catch (e) {
      setError(errDetail(e) || t('tg_connect_failed'))
    } finally {
      setBusy(false)
    }
  }

  if (!user.email_verified) {
    if (variant === 'header') return null
    return (
      <div className="tg-connect tg-connect-profile">
        <div className="tg-connect-profile-top">
          <span className="tg-connect-badge" aria-hidden>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <path d="M9.6 16.8l-.4 4.2c.6 0 .8-.2 1.1-.5l2.6-2.5 5.4 4c1 .5 1.7.2 2-.9L22.8 4c.4-1.6-.6-2.2-1.6-1.8L2.3 9.6C.8 10.2.8 11 1.9 11.4l5.3 1.7L19.4 6c.6-.4 1.2-.2.7.2L9.6 16.8z" />
            </svg>
          </span>
          <div className="tg-connect-profile-copy">
            <div className="tg-connect-profile-title-row">
              <h4>{t('tg_title')}</h4>
              <span className="tg-status-pill off">
                <i />
                {t('tg_need_verified')}
              </span>
            </div>
            <p className="tg-connect-desc">{t('tg_need_verified')}</p>
          </div>
        </div>
      </div>
    )
  }

  const linked = !!status?.linked
  const configured = status?.configured !== false

  if (variant === 'header') {
    return (
      <button
        type="button"
        className={`tg-toggle ${linked ? 'on' : 'off'}`}
        disabled={busy || (!linked && !configured)}
        title={linked ? t('tg_connected') : t('tg_connect')}
        aria-label={linked ? t('tg_connected') : t('tg_connect')}
        onClick={() => {
          if (linked) return
          void onConnect()
        }}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
          <path d="M9.6 16.8l-.4 4.2c.6 0 .8-.2 1.1-.5l2.6-2.5 5.4 4c1 .5 1.7.2 2-.9L22.8 4c.4-1.6-.6-2.2-1.6-1.8L2.3 9.6C.8 10.2.8 11 1.9 11.4l5.3 1.7L19.4 6c.6-.4 1.2-.2.7.2L9.6 16.8z" />
        </svg>
      </button>
    )
  }

  return (
    <div className="tg-connect tg-connect-profile">
      <div className="tg-connect-profile-top">
        <span className="tg-connect-badge" aria-hidden>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
            <path d="M9.6 16.8l-.4 4.2c.6 0 .8-.2 1.1-.5l2.6-2.5 5.4 4c1 .5 1.7.2 2-.9L22.8 4c.4-1.6-.6-2.2-1.6-1.8L2.3 9.6C.8 10.2.8 11 1.9 11.4l5.3 1.7L19.4 6c.6-.4 1.2-.2.7.2L9.6 16.8z" />
          </svg>
        </span>
        <div className="tg-connect-profile-copy">
          <div className="tg-connect-profile-title-row">
            <h4>{t('tg_title')}</h4>
            <span className={`tg-status-pill ${linked ? 'on' : 'off'}`}>
              <i />
              {linked ? t('tg_connected') : t('tg_not_connected')}
            </span>
          </div>
          <p className="tg-connect-desc">{linked ? t('tg_profile_linked') : t('tg_profile_desc')}</p>
          {status?.telegram_username && <p className="tg-connect-meta">@{status.telegram_username}</p>}
        </div>
      </div>
      {error && <div className="auth-error">{error}</div>}
      <div className="tg-connect-actions">
        {linked ? (
          <button type="button" className="ghost danger" disabled={busy} onClick={() => void onUnlink()}>
            {busy ? t('tg_working') : t('tg_unlink')}
          </button>
        ) : (
          <button type="button" className="tg-connect-primary" disabled={busy || !configured} onClick={() => void onConnect()}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <path d="M9.6 16.8l-.4 4.2c.6 0 .8-.2 1.1-.5l2.6-2.5 5.4 4c1 .5 1.7.2 2-.9L22.8 4c.4-1.6-.6-2.2-1.6-1.8L2.3 9.6C.8 10.2.8 11 1.9 11.4l5.3 1.7L19.4 6c.6-.4 1.2-.2.7.2L9.6 16.8z" />
            </svg>
            {busy ? t('tg_working') : t('tg_connect')}
          </button>
        )}
      </div>
    </div>
  )
}
