import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth'
import type { AuthUser } from '../authTypes'
import { useI18n } from '../i18n'
import { ProfileModal } from './ProfileModal'

export function userInitials(user: AuthUser | string): string {
  const source = typeof user === 'string' ? user : user.full_name || user.username || user.email
  const local = source.includes('@') ? source.split('@')[0] || '?' : source
  const parts = local.replace(/[^a-zA-Z0-9]+/g, ' ').trim().split(/\s+/).filter(Boolean)
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
  return local.slice(0, 2).toUpperCase()
}

export function userDisplayName(user: AuthUser | string): string {
  if (typeof user !== 'string') {
    if (user.full_name?.trim()) return user.full_name.trim()
    if (user.username?.trim()) return user.username.trim()
  }
  const email = typeof user === 'string' ? user : user.email
  const local = email.split('@')[0] || email
  const parts = local.split(/[._+-]+/).filter((p) => p && !/^\d+$/.test(p))
  const named = parts
    .slice(0, 2)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase())
  return named.length ? named.join(' ') : local
}

function IconChevronDown() {
  return (
    <svg className="user-menu-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function IconChevronRight() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function IconProfile() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="8" r="3.5" stroke="currentColor" strokeWidth="1.8" />
      <path d="M5.5 19.5c1.6-3.2 4-4.8 6.5-4.8s4.9 1.6 6.5 4.8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  )
}

function IconAdmin() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 3l7 3v5c0 4.5-3 8.2-7 9.5C8 19.2 5 15.5 5 11V6l7-3z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function IconSignals() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M4 18V10M10 18V6M16 18v-7M22 18V8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  )
}

function IconSignOut() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M10 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M14 8l4 4-4 4M18 12H9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function MenuRow({
  icon,
  label,
  danger,
  onClick,
  to,
}: {
  icon: ReactNode
  label: string
  danger?: boolean
  onClick?: () => void
  to?: string
}) {
  const className = `user-menu-item${danger ? ' danger' : ''}`
  const body = (
    <>
      <span className="user-menu-item-icon" aria-hidden>
        {icon}
      </span>
      <span className="user-menu-item-label">{label}</span>
      <span className="user-menu-item-arrow" aria-hidden>
        <IconChevronRight />
      </span>
    </>
  )
  if (to) {
    return (
      <Link to={to} className={className} role="menuitem" onClick={onClick}>
        {body}
      </Link>
    )
  }
  return (
    <button type="button" className={className} role="menuitem" onClick={onClick}>
      {body}
    </button>
  )
}

type Props = {
  /** Avatar-only (signals header) or avatar + name/role chip (admin header). */
  variant?: 'avatar' | 'chip'
}

export function UserMenu({ variant = 'avatar' }: Props) {
  const { user, logout } = useAuth()
  const { t } = useI18n()
  const nav = useNavigate()
  const [open, setOpen] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  function placeMenu() {
    const el = triggerRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const width = Math.min(280, window.innerWidth - 24)
    let left = r.right - width
    left = Math.max(12, Math.min(left, window.innerWidth - width - 12))
    const top = r.bottom + 10
    setMenuPos({ top, left })
  }

  useLayoutEffect(() => {
    if (!open) {
      setMenuPos(null)
      return
    }
    placeMenu()
  }, [open])

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      const target = e.target as Node
      if (rootRef.current?.contains(target)) return
      if (menuRef.current?.contains(target)) return
      setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    const onReposition = () => placeMenu()
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    window.addEventListener('resize', onReposition)
    window.addEventListener('scroll', onReposition, true)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', onReposition)
      window.removeEventListener('scroll', onReposition, true)
    }
  }, [open])

  if (!user) return null

  const isAdmin = user.role === 'admin'
  const name = userDisplayName(user)
  const initials = userInitials(user)
  const avatarUrl = user.avatar_url || null

  async function onLogout() {
    setOpen(false)
    await logout()
    nav('/login')
  }

  const avatarFace = avatarUrl ? (
    <img className="user-avatar-img" src={avatarUrl} alt="" />
  ) : (
    <span className="user-avatar-initials" aria-hidden>
      {initials}
    </span>
  )

  const dropdown = open && menuPos && (
    <div
      ref={menuRef}
      className="user-menu-dropdown user-menu-dropdown-fixed"
      role="menu"
      style={{ top: menuPos.top, left: menuPos.left }}
    >
      <div className="user-menu-head">
        <span className="user-avatar user-avatar-lg" aria-hidden>
          {avatarFace}
        </span>
        <div className="user-menu-head-meta">
          <span className="user-menu-name">{name}</span>
          <span className="user-menu-email">{user.email}</span>
        </div>
      </div>
      <div className="user-menu-list">
        <MenuRow
          icon={<IconProfile />}
          label={t('menu_profile')}
          onClick={() => {
            setOpen(false)
            setProfileOpen(true)
          }}
        />
        {isAdmin && (
          <MenuRow
            icon={<IconAdmin />}
            label={t('menu_admin_dash')}
            to="/admin"
            onClick={() => setOpen(false)}
          />
        )}
        <MenuRow
          icon={<IconSignals />}
          label={t('menu_signals_dash')}
          to="/"
          onClick={() => setOpen(false)}
        />
        <MenuRow
          icon={<IconSignOut />}
          label={t('menu_sign_out')}
          danger
          onClick={() => void onLogout()}
        />
      </div>
    </div>
  )

  return (
    <>
      <div className={`user-menu ${variant} ${open ? 'open' : ''}`} ref={rootRef}>
        <button
          ref={triggerRef}
          type="button"
          className={variant === 'chip' ? 'user-chip' : 'user-menu-trigger'}
          aria-haspopup="menu"
          aria-expanded={open}
          title={name}
          onClick={() => setOpen((v) => !v)}
        >
          {variant === 'chip' ? (
            <>
              <span className="user-avatar user-avatar-inline" aria-hidden>
                {avatarFace}
              </span>
              <span className="user-chip-meta">
                <span className="user-chip-name">{name}</span>
                <span className="user-chip-role">{isAdmin ? t('menu_administrator') : t('menu_user')}</span>
              </span>
              <IconChevronDown />
            </>
          ) : (
            <>
              <span className="user-avatar" aria-hidden>
                {avatarFace}
              </span>
              <IconChevronDown />
            </>
          )}
        </button>
      </div>
      {dropdown ? createPortal(dropdown, document.body) : null}
      <ProfileModal open={profileOpen} onClose={() => setProfileOpen(false)} />
    </>
  )
}
