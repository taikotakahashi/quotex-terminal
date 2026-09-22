import { FormEvent, useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { api } from '../api'
import { useAuth } from '../auth'
import type { AuthUser } from '../authTypes'
import { useI18n } from '../i18n'
import { TelegramConnect } from './TelegramConnect'

function initialsFrom(user: AuthUser): string {
  const source = user.full_name || user.username || user.email
  const local = source.includes('@') ? source.split('@')[0] : source
  const parts = local.replace(/[^a-zA-Z0-9]+/g, ' ').trim().split(/\s+/).filter(Boolean)
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
  return (local || '?').slice(0, 2).toUpperCase()
}

function errDetail(e: unknown): string {
  if (e && typeof e === 'object' && 'detail' in e) {
    const d = (e as { detail?: unknown }).detail
    if (typeof d === 'string') return d
    if (d && typeof d === 'object' && 'detail' in (d as object)) {
      const inner = (d as { detail?: unknown }).detail
      if (typeof inner === 'string') return inner
    }
  }
  return e instanceof Error ? e.message : 'Request failed'
}

function avatarSrc(url: string | null | undefined): string | null {
  if (!url) return null
  if (url.startsWith('http') || url.startsWith('blob:')) return url
  return url
}

function IconPerson() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="8" r="3.5" stroke="currentColor" strokeWidth="1.8" />
      <path d="M5.5 19.5c1.6-3.2 4-4.8 6.5-4.8s4.9 1.6 6.5 4.8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  )
}

function IconAt() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="7.5" stroke="currentColor" strokeWidth="1.8" />
      <path d="M16 12a4 4 0 1 1-1.2-2.9V14.5a2 2 0 0 0 3.5 1.3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  )
}

function IconMail() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="3.5" y="5.5" width="17" height="13" rx="2.5" stroke="currentColor" strokeWidth="1.8" />
      <path d="M4.5 8l7.5 5.2L19.5 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function IconLock() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="5" y="10" width="14" height="10" rx="2.5" stroke="currentColor" strokeWidth="1.8" />
      <path d="M8 10V7.5a4 4 0 0 1 8 0V10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  )
}

function IconEye({ off }: { off?: boolean }) {
  if (off) {
    return (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
        <path d="M3 3l18 18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        <path d="M10.6 10.7a2.5 2.5 0 0 0 3.5 3.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        <path d="M9.9 5.4A10.5 10.5 0 0 1 12 5c5 0 9.3 3.5 10.5 7-.4 1.2-1.1 2.4-2 3.4M6.1 6.2C4.3 7.5 2.9 9.2 2 12c1.2 3.5 5.5 7 10.5 7 1.3 0 2.5-.2 3.6-.6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    )
  }
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="12" cy="12" r="2.8" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  )
}

function IconCamera() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M4 8.5h3l1.4-2h7.2l1.4 2H20a1.5 1.5 0 0 1 1.5 1.5v8A1.5 1.5 0 0 1 20 19.5H4A1.5 1.5 0 0 1 2.5 18v-8A1.5 1.5 0 0 1 4 8.5z" stroke="currentColor" strokeWidth="1.7" />
      <circle cx="12" cy="13.5" r="3.2" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  )
}

function IconUpload() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M12 16V5M8 9l4-4 4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4 18v1.5A1.5 1.5 0 0 0 5.5 21h13a1.5 1.5 0 0 0 1.5-1.5V18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  )
}

function IconArrow() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M5 12h12M13 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function Field({
  label,
  icon,
  children,
  trailing,
}: {
  label: string
  icon: ReactNode
  children: ReactNode
  trailing?: ReactNode
}) {
  return (
    <label className="profile-field">
      <span className="profile-field-label">{label}</span>
      <span className="profile-field-control">
        <span className="profile-field-icon" aria-hidden>
          {icon}
        </span>
        {children}
        {trailing}
      </span>
    </label>
  )
}

type Props = {
  open: boolean
  onClose: () => void
}

export function ProfileModal({ open, onClose }: Props) {
  const { user, refresh, logout } = useAuth()
  const { t } = useI18n()
  const fileRef = useRef<HTMLInputElement>(null)
  const [fullName, setFullName] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [currentPassword, setCurrentPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [showCurrent, setShowCurrent] = useState(false)
  const [preview, setPreview] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [avatarBusy, setAvatarBusy] = useState(false)
  const [error, setError] = useState('')
  const [ok, setOk] = useState('')

  useEffect(() => {
    if (!open || !user) return
    setFullName(user.full_name?.trim() || '')
    setUsername(user.username?.trim() || '')
    setPassword('')
    setCurrentPassword('')
    setShowPassword(false)
    setShowCurrent(false)
    setPreview(avatarSrc(user.avatar_url))
    setError('')
    setOk('')
  }, [open, user])

  if (!open || !user) return null

  const current = user
  const initials = initialsFrom(current)
  const passwordDirty = password.trim().length > 0
  const needCurrent = passwordDirty

  async function applyUser(next: AuthUser) {
    await refresh()
    setPreview(avatarSrc(next.avatar_url))
  }

  async function onSave(ev: FormEvent) {
    ev.preventDefault()
    setError('')
    setOk('')
    const body: {
      full_name?: string | null
      username?: string | null
      password?: string
      current_password?: string
    } = {}
    const nextName = fullName.trim()
    const nextUser = username.trim()
    if (nextName && nextName !== (current.full_name || '')) body.full_name = nextName
    if (nextUser && nextUser !== (current.username || '')) body.username = nextUser
    if (password.trim()) body.password = password.trim()
    if (body.password) {
      if (!currentPassword.trim()) {
        setError(t('profile_need_current'))
        return
      }
      body.current_password = currentPassword.trim()
    }
    if (
      body.full_name === undefined &&
      body.username === undefined &&
      body.password === undefined
    ) {
      onClose()
      return
    }
    setBusy(true)
    try {
      const next = await api.updateProfile(body)
      setOk(t('profile_saved'))
      setFullName(next.full_name?.trim() || '')
      setUsername(next.username?.trim() || '')
      setPassword('')
      setCurrentPassword('')
      if (body.password) {
        await logout()
        onClose()
        window.location.assign('/login')
        return
      }
      await applyUser(next)
    } catch (e) {
      setError(errDetail(e))
    } finally {
      setBusy(false)
    }
  }

  async function onPickAvatar(file: File | null) {
    if (!file) return
    setAvatarBusy(true)
    setError('')
    setOk('')
    try {
      const next = await api.uploadAvatar(file)
      setOk(t('profile_avatar_updated'))
      await applyUser(next)
    } catch (e) {
      setError(errDetail(e))
    } finally {
      setAvatarBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  async function onDeleteAvatar() {
    setAvatarBusy(true)
    setError('')
    setOk('')
    try {
      const next = await api.deleteAvatar()
      setOk(t('profile_avatar_removed'))
      await applyUser(next)
    } catch (e) {
      setError(errDetail(e))
    } finally {
      setAvatarBusy(false)
    }
  }

  return createPortal(
    <div className="profile-modal-backdrop" onClick={() => !busy && !avatarBusy && onClose()}>
      <form
        className="profile-modal"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => void onSave(e)}
      >
        <div className="profile-modal-head">
          <div>
            <h3>{t('profile_title')}</h3>
            <p>{t('profile_desc')}</p>
          </div>
        </div>

        <div className="profile-modal-body">
          <div className="profile-avatar-block">
            <div className="profile-avatar-wrap">
              <div className="profile-avatar-preview" aria-hidden>
                {preview ? <img src={preview} alt="" /> : <span>{initials}</span>}
              </div>
              <button
                type="button"
                className="profile-avatar-cam"
                disabled={avatarBusy}
                title={preview ? t('profile_change_avatar') : t('profile_upload_avatar')}
                onClick={() => fileRef.current?.click()}
              >
                <IconCamera />
              </button>
            </div>
            <div className="profile-avatar-actions">
              <input
                ref={fileRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                hidden
                onChange={(e) => void onPickAvatar(e.target.files?.[0] ?? null)}
              />
              <button
                type="button"
                className="profile-upload-btn"
                disabled={avatarBusy}
                onClick={() => fileRef.current?.click()}
              >
                <IconUpload />
                {preview ? t('profile_change_avatar') : t('profile_upload_avatar')}
              </button>
              <p className="profile-avatar-hint">{t('profile_avatar_hint')}</p>
              {preview && (
                <button
                  type="button"
                  className="profile-remove-link"
                  disabled={avatarBusy}
                  onClick={() => void onDeleteAvatar()}
                >
                  {t('profile_remove_avatar')}
                </button>
              )}
            </div>
          </div>

          <Field label={t('profile_full_name')} icon={<IconPerson />}>
            <input
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              maxLength={120}
              placeholder={t('profile_full_name_ph')}
            />
          </Field>
          <Field label={t('profile_username')} icon={<IconAt />}>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              maxLength={32}
              placeholder={t('profile_username_ph')}
            />
          </Field>
          <Field label={t('profile_email')} icon={<IconMail />}>
            <input
              type="email"
              value={current.email}
              readOnly
              disabled
              tabIndex={-1}
              aria-readonly="true"
              title={t('profile_email_locked')}
            />
          </Field>
          <Field
            label={t('profile_new_password')}
            icon={<IconLock />}
            trailing={
              <button
                type="button"
                className="profile-field-trail"
                tabIndex={-1}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                onClick={() => setShowPassword((v) => !v)}
              >
                <IconEye off={showPassword} />
              </button>
            }
          >
            <input
              type={showPassword ? 'text' : 'password'}
              minLength={8}
              autoComplete="new-password"
              placeholder={t('profile_password_optional')}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
          {needCurrent && (
            <Field
              label={t('profile_current_password')}
              icon={<IconLock />}
              trailing={
                <button
                  type="button"
                  className="profile-field-trail"
                  tabIndex={-1}
                  aria-label={showCurrent ? 'Hide password' : 'Show password'}
                  onClick={() => setShowCurrent((v) => !v)}
                >
                  <IconEye off={showCurrent} />
                </button>
              }
            >
              <input
                type={showCurrent ? 'text' : 'password'}
                autoComplete="current-password"
                required
                placeholder={t('profile_current_password_ph')}
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
              />
            </Field>
          )}

          <TelegramConnect variant="profile" />

          {error && <div className="auth-error">{error}</div>}
          {ok && <div className="profile-ok">{ok}</div>}
        </div>

        <div className="profile-modal-actions">
          <button type="button" className="ghost" disabled={busy || avatarBusy} onClick={onClose}>
            {t('adm_cancel')}
          </button>
          <button type="submit" className="profile-save-btn" disabled={busy || avatarBusy}>
            {busy ? t('adm_saving') : t('profile_save')}
            {!busy && <IconArrow />}
          </button>
        </div>
      </form>
    </div>,
    document.body,
  )
}
