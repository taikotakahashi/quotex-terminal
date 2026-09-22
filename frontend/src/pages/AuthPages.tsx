import { FormEvent, useEffect, useState, type ReactNode } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { api } from '../api'
import { useAuth } from '../auth'
import { LangSwitch } from '../components/LangSwitch'
import { useI18n } from '../i18n'

function errMessage(e: unknown): string {
  if (e && typeof e === 'object' && 'detail' in e) {
    const d = (e as { detail?: unknown }).detail
    if (typeof d === 'string') return d
    if (d && typeof d === 'object') {
      const obj = d as { detail?: unknown }
      if (typeof obj.detail === 'string') return obj.detail
    }
  }
  if (e instanceof Error) return e.message
  return 'Request failed'
}

function IconMail() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="3.5" y="5.5" width="17" height="13" rx="2.5" stroke="currentColor" strokeWidth="1.7" />
      <path d="M4.5 8l7.5 5.2L19.5 8" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function IconLock() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="5" y="10" width="14" height="10" rx="2.5" stroke="currentColor" strokeWidth="1.7" />
      <path d="M8 10V7.5a4 4 0 0 1 8 0V10" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  )
}

function IconEye({ off }: { off?: boolean }) {
  if (off) {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
        <path d="M3 3l18 18" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
        <path
          d="M10.6 10.7a2.5 2.5 0 0 0 3.5 3.5M9.9 5.4A10.5 10.5 0 0 1 12 5c5 0 9.3 3.5 10.5 7-.4 1.2-1.1 2.4-2 3.4M6.1 6.2C4.3 7.5 2.9 9.2 2 12c1.2 3.5 5.5 7 10.5 7 1.3 0 2.5-.2 3.6-.6"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
        />
      </svg>
    )
  }
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" stroke="currentColor" strokeWidth="1.7" />
      <circle cx="12" cy="12" r="2.8" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  )
}

function IconArrow() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M5 12h12M13 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function AuthBgArt() {
  return (
    <div className="auth-bg" aria-hidden>
      <div className="auth-bg-photo" />
      <div className="auth-bg-photo-veil" />
      <div className="auth-bg-glow" />

      <svg className="auth-bg-waves" viewBox="0 0 1440 900" preserveAspectRatio="none">
        <defs>
          <linearGradient id="authWaveMain" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#22d3ee" stopOpacity="0" />
            <stop offset="12%" stopColor="#22d3ee" stopOpacity="0.45" />
            <stop offset="50%" stopColor="#a5f3fc" stopOpacity="1" />
            <stop offset="88%" stopColor="#2dd4bf" stopOpacity="0.5" />
            <stop offset="100%" stopColor="#22d3ee" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="authWaveSoft" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#67e8f9" stopOpacity="0" />
            <stop offset="25%" stopColor="#22d3ee" stopOpacity="0.35" />
            <stop offset="75%" stopColor="#5eead4" stopOpacity="0.4" />
            <stop offset="100%" stopColor="#22d3ee" stopOpacity="0" />
          </linearGradient>
          <filter id="authWaveGlow" x="-5%" y="-120%" width="110%" height="340%">
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
          stroke="url(#authWaveMain)"
          strokeWidth="3"
          strokeLinecap="round"
          filter="url(#authWaveGlow)"
        />
        <path
          d="M-20 510 C200 440, 320 590, 500 510 S760 400, 940 500 1160 610, 1340 500 1500 430, 1520 470"
          fill="none"
          stroke="url(#authWaveSoft)"
          strokeWidth="1.8"
          strokeLinecap="round"
          opacity="0.75"
        />
        <path
          d="M40 430 C220 380, 340 470, 520 410 S780 330, 960 400 1180 490, 1380 400"
          fill="none"
          stroke="#67e8f9"
          strokeOpacity="0.28"
          strokeWidth="1.2"
          strokeDasharray="2 7"
        />
      </svg>
    </div>
  )
}

function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="auth-shell">
      <AuthBgArt />
      <div className="auth-stage">{children}</div>
    </div>
  )
}

function AuthCardTop() {
  return (
    <div className="auth-card-top">
      <img className="auth-logo" src="/quotex_logo.svg" alt="Quotex" />
      <LangSwitch />
    </div>
  )
}

function AuthField({
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
    <label className="auth-field">
      <span className="auth-field-label">{label}</span>
      <span className="auth-field-control">
        <span className="auth-field-icon" aria-hidden>
          {icon}
        </span>
        {children}
        {trailing}
      </span>
    </label>
  )
}

function AuthSubmit({ busy, label, busyLabel }: { busy: boolean; label: string; busyLabel: string }) {
  return (
    <button type="submit" className="auth-submit" disabled={busy}>
      <span>{busy ? busyLabel : label}</span>
      {!busy && <IconArrow />}
    </button>
  )
}

function AuthFoot({ children }: { children: ReactNode }) {
  return <p className="auth-foot">{children}</p>
}

function AuthTagline() {
  const { t } = useI18n()
  return <p className="auth-tagline">{t('auth_tagline')}</p>
}

export function LoginPage() {
  const { t } = useI18n()
  const { refresh } = useAuth()
  const nav = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function onSubmit(ev: FormEvent) {
    ev.preventDefault()
    setBusy(true)
    setError('')
    try {
      const res = await api.login(email.trim(), password)
      await refresh()
      if (!res.email_verified) nav('/verify-pending')
      else nav('/')
    } catch (e) {
      setError(errMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthShell>
      <form className="auth-card" onSubmit={onSubmit}>
        <AuthCardTop />
        <div className="auth-heading">
          <h1>{t('auth_signin_title')}</h1>
          <p className="auth-sub">{t('auth_signin_sub')}</p>
        </div>
        {error && <div className="auth-error">{error}</div>}
        <AuthField label={t('auth_email')} icon={<IconMail />}>
          <input
            type="email"
            autoComplete="email"
            required
            placeholder={t('auth_email_ph')}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </AuthField>
        <AuthField
          label={t('auth_password')}
          icon={<IconLock />}
          trailing={
            <button
              type="button"
              className="auth-field-trail"
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
            autoComplete="current-password"
            required
            placeholder={t('auth_password_ph')}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </AuthField>
        <p className="auth-forgot-row">
          <Link to="/forgot-password">{t('auth_forgot_link')}</Link>
        </p>
        <AuthSubmit busy={busy} label={t('auth_signin_btn')} busyLabel={t('auth_signing_in')} />
        <AuthFoot>
          {t('auth_no_account')} <Link to="/register">{t('auth_create_one')}</Link>
        </AuthFoot>
        <AuthTagline />
      </form>
    </AuthShell>
  )
}

export function RegisterPage() {
  const { t } = useI18n()
  const { refresh } = useAuth()
  const nav = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function onSubmit(ev: FormEvent) {
    ev.preventDefault()
    setBusy(true)
    setError('')
    try {
      const res = await api.register(email.trim(), password)
      await refresh()
      sessionStorage.setItem('qx_email_sent', res.email_sent ? '1' : '0')
      if (res.message) sessionStorage.setItem('qx_verify_msg', res.message)
      sessionStorage.removeItem('qx_verify_url')
      nav('/verify-pending')
    } catch (e) {
      setError(errMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthShell>
      <form className="auth-card" onSubmit={onSubmit}>
        <AuthCardTop />
        <div className="auth-heading">
          <h1>{t('auth_register_title')}</h1>
          <p className="auth-sub">{t('auth_register_sub')}</p>
        </div>
        {error && <div className="auth-error">{error}</div>}
        <AuthField label={t('auth_email')} icon={<IconMail />}>
          <input
            type="email"
            autoComplete="email"
            required
            placeholder={t('auth_email_ph_reg')}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </AuthField>
        <AuthField
          label={t('auth_password')}
          icon={<IconLock />}
          trailing={
            <button
              type="button"
              className="auth-field-trail"
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
            autoComplete="new-password"
            required
            minLength={8}
            placeholder={t('auth_password_ph_reg')}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </AuthField>
        <AuthSubmit busy={busy} label={t('auth_register_btn')} busyLabel={t('auth_creating')} />
        <AuthFoot>
          {t('auth_have_account')} <Link to="/login">{t('auth_signin_link')}</Link>
        </AuthFoot>
        <AuthTagline />
      </form>
    </AuthShell>
  )
}

export function VerifyPendingPage() {
  const { t } = useI18n()
  const { user, logout } = useAuth()
  const [msg, setMsg] = useState(() => sessionStorage.getItem('qx_verify_msg') || '')
  const [emailSent, setEmailSent] = useState(() => sessionStorage.getItem('qx_email_sent') !== '0')
  const [busy, setBusy] = useState(false)

  async function resend() {
    if (!user?.email) return
    setBusy(true)
    setMsg('')
    try {
      const r = await api.resendVerification(user.email)
      setMsg(r.message)
      if (typeof r.email_sent === 'boolean') {
        setEmailSent(r.email_sent)
        sessionStorage.setItem('qx_email_sent', r.email_sent ? '1' : '0')
      }
    } catch (e) {
      setMsg(errMessage(e))
    } finally {
      setBusy(false)
    }
  }

  const emailBit = user?.email ? ` ${user.email}` : ''

  return (
    <AuthShell>
      <div className="auth-card">
        <AuthCardTop />
        <div className="auth-heading">
          <h1>{emailSent ? t('auth_check_email') : t('auth_verify_title')}</h1>
          <p className="auth-sub">
            {emailSent
              ? `${t('auth_sent_link')}${emailBit ? `${t('auth_to_email')}${emailBit}` : ''}. ${t('auth_open_link')}`
              : `${t('auth_send_failed')}${emailBit ? `${t('auth_to_email')}${emailBit}` : ''}. ${t('auth_try_resend')}`}
          </p>
        </div>
        {msg && <div className="auth-info">{msg}</div>}
        <button type="button" className="auth-submit" disabled={busy || !user?.email} onClick={() => void resend()}>
          <span>{busy ? t('auth_sending') : t('auth_resend')}</span>
          {!busy && <IconArrow />}
        </button>
        <AuthFoot>
          <button type="button" className="auth-linkish" onClick={() => void logout()}>
            {t('auth_sign_out')}
          </button>
        </AuthFoot>
        <AuthTagline />
      </div>
    </AuthShell>
  )
}

export function VerifyEmailPage() {
  const { t } = useI18n()
  const { refresh } = useAuth()
  const nav = useNavigate()
  const [params] = useSearchParams()
  const [status, setStatus] = useState('Verifying…')
  const [error, setError] = useState('')
  const [missingToken, setMissingToken] = useState(false)

  useEffect(() => {
    const token = params.get('token') || ''
    if (!token) {
      setMissingToken(true)
      setStatus('')
      return
    }
    let cancelled = false
    setStatus('Verifying…')
    ;(async () => {
      try {
        await api.verifyEmail(token)
        await refresh()
        if (!cancelled) nav('/', { replace: true })
      } catch (e) {
        if (!cancelled) {
          setError(errMessage(e))
          setStatus('')
        }
      }
    })()
    return () => {
      cancelled = true
    }
    // Intentionally only depend on token string, not i18n/lang.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params])

  return (
    <AuthShell>
      <div className="auth-card">
        <AuthCardTop />
        <div className="auth-heading">
          <h1>{t('auth_verify_email_title')}</h1>
          {status && <p className="auth-sub">{t('auth_verifying')}</p>}
        </div>
        {(error || missingToken) && (
          <>
            <div className="auth-error">{missingToken ? t('auth_missing_token') : error}</div>
            <AuthFoot>
              <Link to="/login">{t('auth_back_signin')}</Link>
            </AuthFoot>
          </>
        )}
        <AuthTagline />
      </div>
    </AuthShell>
  )
}

export function ForgotPasswordPage() {
  const { t } = useI18n()
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const [resetUrl, setResetUrl] = useState('')
  const [busy, setBusy] = useState(false)

  async function onSubmit(ev: FormEvent) {
    ev.preventDefault()
    setBusy(true)
    setError('')
    setInfo('')
    setResetUrl('')
    try {
      const res = await api.forgotPassword(email.trim())
      setInfo(res.message || t('auth_forgot_sent'))
      if (res.reset_url) setResetUrl(res.reset_url)
    } catch (e) {
      setError(errMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthShell>
      <form className="auth-card" onSubmit={onSubmit}>
        <AuthCardTop />
        <div className="auth-heading">
          <h1>{t('auth_forgot_title')}</h1>
          <p className="auth-sub">{t('auth_forgot_sub')}</p>
        </div>
        {error && <div className="auth-error">{error}</div>}
        {info && <div className="auth-info">{info}</div>}
        {resetUrl ? (
          <p className="auth-sub">
            <a href={resetUrl}>{t('auth_forgot_open_link')}</a>
          </p>
        ) : (
          <>
            <AuthField label={t('auth_email')} icon={<IconMail />}>
              <input
                type="email"
                autoComplete="email"
                required
                placeholder={t('auth_email_ph')}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </AuthField>
            <AuthSubmit busy={busy} label={t('auth_forgot_btn')} busyLabel={t('auth_sending')} />
          </>
        )}
        <AuthFoot>
          <Link to="/login">{t('auth_signin_link')}</Link>
        </AuthFoot>
        <AuthTagline />
      </form>
    </AuthShell>
  )
}

export function ResetPasswordPage() {
  const { t } = useI18n()
  const nav = useNavigate()
  const [params] = useSearchParams()
  const token = params.get('token') || ''
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function onSubmit(ev: FormEvent) {
    ev.preventDefault()
    setBusy(true)
    setError('')
    try {
      await api.resetPassword(token, password)
      nav('/login')
    } catch (e) {
      setError(errMessage(e))
    } finally {
      setBusy(false)
    }
  }

  if (!token) {
    return (
      <AuthShell>
        <div className="auth-card">
          <AuthCardTop />
          <div className="auth-heading">
            <h1>{t('auth_reset_title')}</h1>
          </div>
          <div className="auth-error">{t('auth_reset_missing_token')}</div>
          <AuthFoot>
            <Link to="/forgot-password">{t('auth_forgot_again')}</Link>
          </AuthFoot>
          <AuthTagline />
        </div>
      </AuthShell>
    )
  }

  return (
    <AuthShell>
      <form className="auth-card" onSubmit={onSubmit}>
        <AuthCardTop />
        <div className="auth-heading">
          <h1>{t('auth_reset_title')}</h1>
          <p className="auth-sub">{t('auth_reset_sub')}</p>
        </div>
        {error && <div className="auth-error">{error}</div>}
        <AuthField
          label={t('auth_password')}
          icon={<IconLock />}
          trailing={
            <button
              type="button"
              className="auth-field-trail"
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
            autoComplete="new-password"
            required
            minLength={8}
            placeholder={t('auth_password_ph_reg')}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </AuthField>
        <AuthSubmit busy={busy} label={t('auth_reset_btn')} busyLabel={t('adm_saving')} />
        <AuthFoot>
          <Link to="/login">{t('auth_signin_link')}</Link>
        </AuthFoot>
        <AuthTagline />
      </form>
    </AuthShell>
  )
}
