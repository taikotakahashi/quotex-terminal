import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { api, connectFeed } from '../api'
import type { AdminUser, AdminUsersResponse } from '../authTypes'
import type { Status } from '../types'
import { useAuth } from '../auth'
import { StatusHeader } from '../components/StatusHeader'
import { useI18n } from '../i18n'

const PAGE_SIZE = 10

type FilterKey = 'all' | 'admin' | 'user' | 'active' | 'disabled' | 'unverified'
type SortKey = 'created_at' | 'last_login_at' | 'email'
type RegRange = 7 | 14 | 30

function dateLocale(lang: string): string {
  return lang === 'pt' ? 'pt-BR' : lang === 'es' ? 'es' : 'en'
}

function fmtDate(iso: string | null | undefined, lang: string): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString(dateLocale(lang), {
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return iso
  }
}

function fmtDateParts(iso: string | null | undefined, lang: string): { date: string; time: string } | null {
  if (!iso) return null
  try {
    const d = new Date(iso)
    const loc = dateLocale(lang)
    return {
      date: d.toLocaleDateString(loc, { year: 'numeric', month: 'numeric', day: 'numeric' }),
      time: d.toLocaleTimeString(loc, { hour: '2-digit', minute: '2-digit' }),
    }
  } catch {
    return null
  }
}

function StatDateValue({ iso, lang }: { iso: string | null | undefined; lang: string }) {
  const parts = fmtDateParts(iso, lang)
  if (!parts) return <span className="adm-stat-value">{fmtDate(iso, lang)}</span>
  return (
    <span className="adm-stat-value">
      <span className="adm-stat-date">{parts.date}</span>
      <span className="adm-stat-time">{parts.time}</span>
    </span>
  )
}

function relativeTime(iso: string, t: (k: string) => string): string {
  const ts = new Date(iso).getTime()
  if (Number.isNaN(ts)) return ''
  const sec = Math.max(0, Math.floor((Date.now() - ts) / 1000))
  if (sec < 60) return t('adm_rel_s').replace('{n}', String(sec))
  const min = Math.floor(sec / 60)
  if (min < 60) return t(min === 1 ? 'adm_rel_min' : 'adm_rel_mins').replace('{n}', String(min))
  const hr = Math.floor(min / 60)
  if (hr < 48) return t(hr === 1 ? 'adm_rel_hour' : 'adm_rel_hours').replace('{n}', String(hr))
  const day = Math.floor(hr / 24)
  return t(day === 1 ? 'adm_rel_day' : 'adm_rel_days').replace('{n}', String(day))
}

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function pctChange(current: number, previous: number): number {
  if (previous <= 0) return current > 0 ? 100 : 0
  return Math.round(((current - previous) / previous) * 100)
}

function Sparkline({ values, color }: { values: number[]; color: string }) {
  const w = 96
  const h = 36
  const max = Math.max(...values, 1)
  const coords = values.map((v, i) => {
    const x = values.length <= 1 ? 0 : (i / (values.length - 1)) * w
    const y = h - (v / max) * (h - 6) - 3
    return [x, y] as const
  })
  const pts = coords.map(([x, y]) => `${x},${y}`).join(' ')
  const area = `0,${h} ${pts} ${w},${h}`
  const gid = `adm-sg-${color.replace('#', '')}`
  return (
    <svg className="adm-spark" viewBox={`0 0 ${w} ${h}`} width={w} height={h} aria-hidden>
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.35" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
        <filter id={`${gid}-glow`} x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="1.4" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <polygon fill={`url(#${gid})`} points={area} />
      <polyline
        fill="none"
        stroke={color}
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        points={pts}
        filter={`url(#${gid}-glow)`}
      />
    </svg>
  )
}

function MetricIcon({ tone }: { tone: 'blue' | 'green' | 'purple' | 'orange' }) {
  if (tone === 'blue') {
    return (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
        <circle cx="9" cy="8" r="3" stroke="currentColor" strokeWidth="1.8" />
        <circle cx="16.5" cy="9" r="2.4" stroke="currentColor" strokeWidth="1.8" />
        <path d="M3.5 19c1.2-3 3.4-4.5 5.5-4.5S13.3 16 14.5 19" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        <path d="M15 14.2c1.5-.3 2.9.2 4 1.8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    )
  }
  if (tone === 'green') {
    return (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
        <path d="M12 3l7 3v5c0 4.4-3 8-7 9.4C8 19 5 15.4 5 11V6l7-3z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
        <path d="M9.2 12.2l1.9 1.9 3.8-3.9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    )
  }
  if (tone === 'purple') {
    return (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
        <circle cx="12" cy="12" r="7.5" stroke="currentColor" strokeWidth="1.8" />
        <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.8" />
        <circle cx="12" cy="12" r="1" fill="currentColor" />
      </svg>
    )
  }
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 3l1.6 4.2L18 9l-3.6 2.8L15.6 16 12 13.8 8.4 16l1.2-4.2L6 9l4.4-1.8L12 3z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function userRowInitials(u: AdminUser): string {
  const source = u.full_name || u.username || u.email
  const local = source.includes('@') ? source.split('@')[0] || '?' : source
  const parts = local.replace(/[^a-zA-Z0-9]+/g, ' ').trim().split(/\s+/).filter(Boolean)
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
  return local.slice(0, 2).toUpperCase()
}

function IconMail() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M4 6h16v12H4V6z" stroke="currentColor" strokeWidth="1.8" />
      <path d="M4 7l8 6 8-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function IconUserBadge() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="8" r="3.2" stroke="currentColor" strokeWidth="1.8" />
      <path d="M5.5 19c1.5-3 4-4.5 6.5-4.5S17 16 18.5 19" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  )
}

function IconShieldCheck() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M12 3l7 3v5c0 4.2-2.8 7.8-7 9-4.2-1.2-7-4.8-7-9V6l7-3z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <path d="M9 12l2.1 2.1L15.5 10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function IconStatus() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="7" stroke="currentColor" strokeWidth="1.7" />
      <circle cx="12" cy="12" r="3" fill="currentColor" />
    </svg>
  )
}

function IconCalendar() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="4" y="5" width="16" height="15" rx="2" stroke="currentColor" strokeWidth="1.7" />
      <path d="M8 3v4M16 3v4M4 10h16" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  )
}

function IconClock() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="1.7" />
      <path d="M12 8v5l3 2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function IconUserPlus() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="10" cy="8" r="3.2" stroke="currentColor" strokeWidth="1.7" />
      <path d="M4.5 19c1.4-2.8 3.6-4.2 5.5-4.2 1.2 0 2.4.5 3.5 1.4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M17 10v6M14 13h6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  )
}

function IconBan() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="1.7" />
      <path d="M7.2 7.2l9.6 9.6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  )
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

export function AdminPage() {
  const { user } = useAuth()
  const { t, lang } = useI18n()
  const [data, setData] = useState<AdminUsersResponse | null>(null)
  const [status, setStatus] = useState<Status | null>(null)
  const [wsConnected, setWsConnected] = useState(false)
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [tableQ, setTableQ] = useState('')
  const [filter, setFilter] = useState<FilterKey>('all')
  const [filterOpen, setFilterOpen] = useState(false)
  const [regRange, setRegRange] = useState<RegRange>(7)
  const [regRangeOpen, setRegRangeOpen] = useState(false)
  const [activityExpanded, setActivityExpanded] = useState(false)
  const [sortKey, setSortKey] = useState<SortKey>('created_at')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [page, setPage] = useState(1)
  const [menuFor, setMenuFor] = useState<string | null>(null)
  const [menuPos, setMenuPos] = useState<{ top: number; left: number; openUp?: boolean } | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [addEmail, setAddEmail] = useState('')
  const [addPassword, setAddPassword] = useState('')
  const [addRole, setAddRole] = useState<'user' | 'admin'>('user')
  const [addBusy, setAddBusy] = useState(false)
  const [confirm, setConfirm] = useState<{
    title: string
    message: string
    danger?: boolean
    run: () => Promise<void>
  } | null>(null)
  const [confirmBusy, setConfirmBusy] = useState(false)
  const [editUser, setEditUser] = useState<AdminUser | null>(null)
  const [editEmail, setEditEmail] = useState('')
  const [editPassword, setEditPassword] = useState('')
  const [editRole, setEditRole] = useState<'user' | 'admin'>('user')
  const [editVerified, setEditVerified] = useState(true)
  const [editBusy, setEditBusy] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)
  const filterRef = useRef<HTMLDivElement>(null)
  const regRangeRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const load = useCallback(async () => {
    setError('')
    try {
      const [users, st] = await Promise.all([api.adminUsers(), api.status().catch(() => null)])
      setData(users)
      if (st) setStatus(st)
    } catch (e) {
      setError(errDetail(e))
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    const id = window.setInterval(() => {
      void load()
    }, 30_000)
    return () => window.clearInterval(id)
  }, [load])

  useEffect(() => {
    const disconnect = connectFeed((ev) => {
      if (ev.type === 'health') {
        setStatus((s) => ({
          feed_status: String(ev.data.feed_status ?? ev.data.status ?? s?.feed_status ?? 'offline'),
          connected: Boolean(ev.data.connected),
          account_mode: (ev.data.account_mode as string | null) ?? s?.account_mode ?? null,
          uptime_sec: (ev.data.uptime_sec as number | null) ?? s?.uptime_sec ?? null,
          asset_count: Number(ev.data.asset_count ?? s?.asset_count ?? 0),
          open_count: Number(ev.data.open_count ?? s?.open_count ?? 0),
          instruments_age_sec:
            (ev.data.instruments_age_sec as number | null) ?? s?.instruments_age_sec ?? null,
        }))
      }
    }, setWsConnected)
    return disconnect
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        searchRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    if (!filterOpen) return
    const onDoc = (e: MouseEvent) => {
      if (!filterRef.current?.contains(e.target as Node)) setFilterOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [filterOpen])

  useEffect(() => {
    if (!regRangeOpen) return
    const onDoc = (e: MouseEvent) => {
      if (!regRangeRef.current?.contains(e.target as Node)) setRegRangeOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [regRangeOpen])

  useEffect(() => {
    if (!menuFor) return
    const onDoc = (e: MouseEvent) => {
      const target = e.target as Element | null
      if (menuRef.current?.contains(target)) return
      if (target?.closest?.(`[data-adm-more="${menuFor}"]`)) return
      setMenuFor(null)
      setMenuPos(null)
    }
    const onScrollOrResize = () => {
      setMenuFor(null)
      setMenuPos(null)
    }
    document.addEventListener('mousedown', onDoc)
    window.addEventListener('scroll', onScrollOrResize, true)
    window.addEventListener('resize', onScrollOrResize)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      window.removeEventListener('scroll', onScrollOrResize, true)
      window.removeEventListener('resize', onScrollOrResize)
    }
  }, [menuFor])

  function closeMenu() {
    setMenuFor(null)
    setMenuPos(null)
  }

  function toggleMenu(u: AdminUser, btn: HTMLButtonElement) {
    if (menuFor === u.id) {
      closeMenu()
      return
    }
    const rect = btn.getBoundingClientRect()
    const menuWidth = 180
    const approxHeight = 200
    const left = Math.min(
      Math.max(8, rect.right - menuWidth),
      window.innerWidth - menuWidth - 8,
    )
    const openUp = rect.bottom + 4 + approxHeight > window.innerHeight && rect.top > approxHeight
    setMenuFor(u.id)
    setMenuPos({
      top: openUp ? rect.top - 4 : rect.bottom + 4,
      left,
      openUp,
    })
  }

  const users = data?.users ?? []
  const menuUser = menuFor ? users.find((u) => u.id === menuFor) ?? null : null
  const q = tableQ.trim().toLowerCase()

  const filtered = useMemo(() => {
    let list = [...users]
    if (filter === 'admin') list = list.filter((u) => u.role === 'admin')
    if (filter === 'user') list = list.filter((u) => u.role === 'user')
    if (filter === 'active') list = list.filter((u) => u.is_active)
    if (filter === 'disabled') list = list.filter((u) => !u.is_active)
    if (filter === 'unverified') list = list.filter((u) => !u.email_verified)
    if (q) {
      list = list.filter((u) => {
        const hay = [u.email, u.role, u.full_name || '', u.username || '']
          .join(' ')
          .toLowerCase()
        return hay.includes(q)
      })
    }
    list.sort((a, b) => {
      const av = a[sortKey] || ''
      const bv = b[sortKey] || ''
      const cmp = String(av).localeCompare(String(bv))
      return sortDir === 'asc' ? cmp : -cmp
    })
    return list
  }, [users, filter, q, sortKey, sortDir])

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const safePage = Math.min(page, pageCount)
  const pageRows = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)

  useEffect(() => {
    setPage(1)
  }, [filter, q, sortKey, sortDir])

  const analytics = useMemo(() => {
    const now = Date.now()
    const dayMs = 86400000
    const days: { key: string; label: string; shortLabel: string; count: number }[] = []
    for (let i = regRange - 1; i >= 0; i--) {
      const d = new Date(now - i * dayMs)
      const key = dayKey(d)
      const locale = lang === 'pt' ? 'pt-BR' : lang === 'es' ? 'es' : 'en'
      days.push({
        key,
        label: d.toLocaleDateString(locale, { month: 'short', day: 'numeric' }),
        shortLabel:
          regRange <= 7
            ? d.toLocaleDateString(locale, { month: 'short', day: 'numeric' })
            : d.toLocaleDateString(locale, { day: 'numeric' }),
        count: 0,
      })
    }
    const byDay = new Map(days.map((d) => [d.key, d]))
    for (const u of users) {
      if (!u.created_at) continue
      const k = dayKey(new Date(u.created_at))
      const row = byDay.get(k)
      if (row) row.count += 1
    }

    const thisWeek = users.filter((u) => u.created_at && now - new Date(u.created_at).getTime() < 7 * dayMs)
    const prevWeek = users.filter((u) => {
      if (!u.created_at) return false
      const age = now - new Date(u.created_at).getTime()
      return age >= 7 * dayMs && age < 14 * dayMs
    })
    const thisPeriod = users.filter(
      (u) => u.created_at && now - new Date(u.created_at).getTime() < regRange * dayMs,
    )
    const prevPeriod = users.filter((u) => {
      if (!u.created_at) return false
      const age = now - new Date(u.created_at).getTime()
      return age >= regRange * dayMs && age < regRange * 2 * dayMs
    })
    const spark = days.map((d) => d.count)
    const periodTotal = days.reduce((sum, d) => sum + d.count, 0)
    const peakKey = days.reduce((best, d) => (d.count >= best.count ? d : best), days[0]!).key

    const activity: { id: string; kind: string; titleKey: string; email: string; at: string }[] = []
    for (const u of users) {
      if (u.created_at) {
        activity.push({
          id: `${u.id}-reg`,
          kind: 'register',
          titleKey: 'adm_act_register',
          email: u.email,
          at: u.created_at,
        })
      }
      if (u.email_verified && u.created_at) {
        activity.push({
          id: `${u.id}-ver`,
          kind: 'verify',
          titleKey: 'adm_act_verify',
          email: u.email,
          at: u.created_at,
        })
      }
      if (u.last_login_at) {
        activity.push({
          id: `${u.id}-login`,
          kind: 'login',
          titleKey: u.role === 'admin' ? 'adm_act_admin_login' : 'adm_act_login',
          email: u.email,
          at: u.last_login_at,
        })
      }
      if (!u.is_active && u.created_at) {
        activity.push({
          id: `${u.id}-off`,
          kind: 'disable',
          titleKey: 'adm_act_disable',
          email: u.email,
          at: u.last_login_at || u.created_at,
        })
      }
    }
    activity.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())

    return {
      days,
      spark,
      maxBar: Math.max(...days.map((d) => d.count), 1),
      peakKey,
      periodTotal,
      periodDelta: pctChange(thisPeriod.length, prevPeriod.length),
      totalDelta: pctChange(thisWeek.length, prevWeek.length),
      verifiedDelta: pctChange(
        thisWeek.filter((u) => u.email_verified).length,
        prevWeek.filter((u) => u.email_verified).length,
      ),
      onlineDelta: pctChange(
        thisWeek.filter((u) => u.is_online).length,
        prevWeek.filter((u) => u.is_online).length,
      ),
      adminDelta: pctChange(
        thisWeek.filter((u) => u.role === 'admin').length,
        prevWeek.filter((u) => u.role === 'admin').length,
      ),
      activity,
    }
  }, [users, lang, regRange])

  const rangeLabel: Record<RegRange, string> = {
    7: t('adm_last_7_days'),
    14: t('adm_last_14_days'),
    30: t('adm_last_30_days'),
  }

  const visibleActivity = activityExpanded ? analytics.activity : analytics.activity.slice(0, 7)

  async function runAction(u: AdminUser, action: () => Promise<void>) {
    setBusyId(u.id)
    closeMenu()
    setError('')
    try {
      await action()
      await load()
    } catch (e) {
      setError(errDetail(e))
      throw e
    } finally {
      setBusyId(null)
    }
  }

  function askConfirm(opts: {
    title: string
    message: string
    danger?: boolean
    run: () => Promise<void>
  }) {
    closeMenu()
    setConfirm(opts)
  }

  function requestPatch(
    u: AdminUser,
    body: {
      role?: 'user' | 'admin'
      is_active?: boolean
      email?: string
      password?: string
      email_verified?: boolean
    },
    title: string,
    message: string,
    danger = false,
  ) {
    askConfirm({
      title,
      message,
      danger,
      run: () => runAction(u, async () => {
        await api.adminPatchUser(u.id, body)
      }),
    })
  }

  function openEditProfile(u: AdminUser) {
    closeMenu()
    setEditUser(u)
    setEditEmail(u.email)
    setEditPassword('')
    setEditRole(u.role === 'admin' ? 'admin' : 'user')
    setEditVerified(u.email_verified)
  }

  async function onAdd(ev: FormEvent) {
    ev.preventDefault()
    askConfirm({
      title: t('adm_confirm_create_title'),
      message: t('adm_confirm_create_msg').replace('{email}', addEmail.trim()),
      run: async () => {
        setAddBusy(true)
        setError('')
        try {
          await api.adminCreateUser({
            email: addEmail.trim(),
            password: addPassword,
            role: addRole,
            email_verified: true,
          })
          setAddOpen(false)
          setAddEmail('')
          setAddPassword('')
          setAddRole('user')
          await load()
        } catch (e) {
          setError(errDetail(e))
          throw e
        } finally {
          setAddBusy(false)
        }
      },
    })
  }

  async function submitEditProfile(ev: FormEvent) {
    ev.preventDefault()
    if (!editUser) return
    const u = editUser
    const body: {
      email?: string
      password?: string
      role?: 'user' | 'admin'
      email_verified?: boolean
    } = {}
    if (editEmail.trim().toLowerCase() !== u.email) body.email = editEmail.trim()
    if (editPassword.trim()) body.password = editPassword.trim()
    if (editRole !== u.role) body.role = editRole
    if (editVerified !== u.email_verified) body.email_verified = editVerified
    if (!body.email && !body.password && !body.role && body.email_verified === undefined) {
      setEditUser(null)
      return
    }
    askConfirm({
      title: t('adm_confirm_update_title'),
      message: t('adm_confirm_update_msg').replace('{email}', u.email),
      run: async () => {
        setEditBusy(true)
        try {
          await runAction(u, async () => {
            await api.adminPatchUser(u.id, body)
          })
          setEditUser(null)
          setEditPassword('')
        } finally {
          setEditBusy(false)
        }
      },
    })
  }

  async function executeConfirm() {
    if (!confirm) return
    setConfirmBusy(true)
    setError('')
    try {
      await confirm.run()
      setConfirm(null)
    } catch {
      /* error already surfaced */
    } finally {
      setConfirmBusy(false)
    }
  }

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else {
      setSortKey(key)
      setSortDir(key === 'email' ? 'asc' : 'desc')
    }
  }

  const stats = data?.stats

  const filterLabel: Record<FilterKey, string> = {
    all: t('adm_filter_all'),
    admin: t('adm_filter_admin'),
    user: t('adm_filter_user'),
    active: t('adm_filter_active'),
    disabled: t('adm_filter_disabled'),
    unverified: t('adm_filter_unverified'),
  }

  const pctLabel = (n: number) =>
    t('adm_vs_week').replace('{pct}', `${n >= 0 ? '+' : ''}${n}`)

  return (
    <div className="adm">
      <StatusHeader
        status={status}
        wsConnected={wsConnected}
        logoHref="/"
        showStatus={false}
        showAlerts={false}
      />

      <div className="adm-body">
        {error && <div className="auth-error adm-banner">{error}</div>}

        <div className="adm-metrics">
          <div className="adm-metric tone-blue">
            <span className="adm-metric-ico">
              <MetricIcon tone="blue" />
            </span>
            <div className="adm-metric-body">
              <span className="adm-metric-label">{t('adm_total_users')}</span>
              <div className="adm-metric-val">{stats?.total_users ?? '—'}</div>
              <div className={`adm-metric-delta ${analytics.totalDelta >= 0 ? 'up' : 'down'}`}>
                <span aria-hidden>{analytics.totalDelta >= 0 ? '↑' : '↓'}</span>
                {pctLabel(analytics.totalDelta)}
              </div>
            </div>
            <Sparkline values={analytics.spark} color="#3b82f6" />
          </div>
          <div className="adm-metric tone-green">
            <span className="adm-metric-ico">
              <MetricIcon tone="green" />
            </span>
            <div className="adm-metric-body">
              <span className="adm-metric-label">{t('adm_verified_users')}</span>
              <div className="adm-metric-val">{stats?.verified_users ?? '—'}</div>
              <div className={`adm-metric-delta ${analytics.verifiedDelta >= 0 ? 'up' : 'down'}`}>
                <span aria-hidden>{analytics.verifiedDelta >= 0 ? '↑' : '↓'}</span>
                {pctLabel(analytics.verifiedDelta)}
              </div>
            </div>
            <Sparkline values={analytics.spark} color="#22c55e" />
          </div>
          <div className="adm-metric tone-purple">
            <span className="adm-metric-ico">
              <MetricIcon tone="purple" />
            </span>
            <div className="adm-metric-body">
              <span className="adm-metric-label">{t('adm_online_users')}</span>
              <div className="adm-metric-val">{stats?.online_users ?? '—'}</div>
              <div className={`adm-metric-delta ${analytics.onlineDelta >= 0 ? 'up' : 'down'}`}>
                <span aria-hidden>{analytics.onlineDelta >= 0 ? '↑' : '↓'}</span>
                {pctLabel(analytics.onlineDelta)}
              </div>
            </div>
            <Sparkline values={analytics.spark} color="#a855f7" />
          </div>
          <div className="adm-metric tone-orange">
            <span className="adm-metric-ico">
              <MetricIcon tone="orange" />
            </span>
            <div className="adm-metric-body">
              <span className="adm-metric-label">{t('adm_admins')}</span>
              <div className="adm-metric-val">{stats?.admin_users ?? '—'}</div>
              <div className={`adm-metric-delta ${analytics.adminDelta >= 0 ? 'up' : 'down'}`}>
                <span aria-hidden>{analytics.adminDelta >= 0 ? '↑' : '↓'}</span>
                {pctLabel(analytics.adminDelta)}
              </div>
            </div>
            <Sparkline values={analytics.spark.map((v) => (v > 0 ? 1 : 0))} color="#f59e0b" />
          </div>
        </div>

        <div className="adm-grid">
          <section className="adm-card adm-users-card">
            <div className="adm-card-head">
              <div>
                <h2>{t('adm_users')}</h2>
                <p>{t('adm_users_sub')}</p>
              </div>
              <div className="adm-card-tools">
                <div className="adm-table-search">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="11" cy="11" r="7" />
                    <path d="M20 20l-3-3" />
                  </svg>
                  <input
                    ref={searchRef}
                    placeholder={t('adm_search_users')}
                    value={tableQ}
                    onChange={(e) => setTableQ(e.target.value)}
                  />
                </div>
                <div className="adm-filter" ref={filterRef}>
                  <button type="button" className="adm-filter-btn" onClick={() => setFilterOpen((v) => !v)}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M4 6h16M7 12h10M10 18h4" />
                    </svg>
                    {t('adm_filter')}
                  </button>
                  {filterOpen && (
                    <div className="adm-filter-menu">
                      {(Object.keys(filterLabel) as FilterKey[]).map((k) => (
                        <button
                          key={k}
                          type="button"
                          className={filter === k ? 'on' : ''}
                          onClick={() => {
                            setFilter(k)
                            setFilterOpen(false)
                          }}
                        >
                          {filterLabel[k]}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <button type="button" className="adm-filter-btn" onClick={() => void load()} title="Refresh">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M21 12a9 9 0 1 1-2.6-6.4" />
                    <path d="M21 3v6h-6" />
                  </svg>
                  {t('adm_refresh')}
                </button>
                <button type="button" className="adm-add-btn" onClick={() => setAddOpen(true)}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
                    <path d="M12 5v14M5 12h14" strokeLinecap="round" />
                  </svg>
                  {t('adm_add_user').replace(/^\+\s*/, '')}
                </button>
              </div>
            </div>

            <div className="adm-table-wrap">
              <table className="adm-table">
                <thead>
                  <tr>
                    <th className="adm-col-num">#</th>
                    <th>
                      <button type="button" className="adm-sort" onClick={() => toggleSort('email')}>
                        {t('adm_col_user')} {sortKey === 'email' ? (sortDir === 'asc' ? '↑' : '↓') : ''}
                      </button>
                    </th>
                    <th>{t('adm_col_role')}</th>
                    <th>{t('adm_col_verified')}</th>
                    <th>{t('adm_col_status')}</th>
                    <th>
                      <button type="button" className="adm-sort" onClick={() => toggleSort('created_at')}>
                        {t('adm_col_created')} {sortKey === 'created_at' ? (sortDir === 'asc' ? '↑' : '↓') : '↓'}
                      </button>
                    </th>
                    <th>
                      <button type="button" className="adm-sort" onClick={() => toggleSort('last_login_at')}>
                        {t('adm_col_last_login')} {sortKey === 'last_login_at' ? (sortDir === 'asc' ? '↑' : '↓') : ''}
                      </button>
                    </th>
                    <th>{t('adm_col_actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((u, idx) => {
                    const self = u.id === user?.id
                    const busy = busyId === u.id
                    const rowNum = (safePage - 1) * PAGE_SIZE + idx + 1
                    return (
                      <tr key={u.id} className={!u.is_active ? 'dim' : ''}>
                        <td className="adm-col-num" data-label="#">
                          {rowNum}
                        </td>
                        <td className="adm-td-user" data-label={t('adm_col_user')}>
                          <div className="adm-user-card-head">
                            <div className="adm-user-cell">
                              <span className="adm-user-avatar" aria-hidden>
                                {u.avatar_url ? (
                                  <img src={u.avatar_url} alt="" />
                                ) : (
                                  <span>{userRowInitials(u)}</span>
                                )}
                              </span>
                              <div className="adm-user-meta">
                                <div className="adm-user-top">
                                  <span className="adm-user-name">
                                    {u.full_name?.trim() || u.username || u.email.split('@')[0]}
                                  </span>
                                  {self && <span className="adm-you">{t('adm_you')}</span>}
                                </div>
                                <div className="adm-user-sub adm-user-sub-desktop">
                                  {u.username ? <span className="adm-user-handle">@{u.username}</span> : null}
                                  {u.username ? <span className="adm-user-dot">·</span> : null}
                                  <span className="adm-user-email">{u.email}</span>
                                </div>
                                <div className="adm-user-sub adm-user-sub-mobile">
                                  <span className="adm-user-email-line">
                                    <IconMail />
                                    <span className="adm-user-email">{u.email}</span>
                                  </span>
                                  <span className={`adm-pill adm-user-role-pill ${u.role === 'admin' ? 'admin' : ''}`}>
                                    <IconUserBadge />
                                    {u.role === 'admin' ? t('adm_role_admin') : t('adm_role_user')}
                                  </span>
                                </div>
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="adm-td-role" data-label={t('adm_col_role')}>
                          <span className={`adm-pill ${u.role === 'admin' ? 'admin' : ''}`}>{u.role === 'admin' ? t('adm_role_admin') : t('adm_role_user')}</span>
                        </td>
                        <td className="adm-td-stat adm-td-verified" data-label={t('adm_col_verified')}>
                          <span className="adm-stat-ico theme-verified" aria-hidden>
                            <IconShieldCheck />
                          </span>
                          <span className="adm-stat-value">
                            {u.email_verified ? (
                              <span className="adm-yes">{t('adm_yes')}</span>
                            ) : (
                              <span className="adm-no">{t('adm_no')}</span>
                            )}
                          </span>
                        </td>
                        <td className="adm-td-stat adm-td-status" data-label={t('adm_col_status')}>
                          <span className="adm-stat-ico theme-status" aria-hidden>
                            <IconStatus />
                          </span>
                          <span className="adm-stat-value">
                            {!u.is_active ? (
                              <span className="adm-status off">
                                <i />
                                {t('adm_status_disabled')}
                              </span>
                            ) : (
                              <span className={`adm-status ${u.is_online ? 'online' : 'offline'}`}>
                                <i />
                                {u.is_online ? t('adm_status_online') : t('adm_status_offline')}
                              </span>
                            )}
                          </span>
                        </td>
                        <td className="adm-td-stat adm-td-created mono" data-label={t('adm_col_created')}>
                          <span className="adm-stat-ico theme-created" aria-hidden>
                            <IconCalendar />
                          </span>
                          <StatDateValue iso={u.created_at} lang={lang} />
                        </td>
                        <td className="adm-td-stat adm-td-login mono" data-label={t('adm_col_last_login')}>
                          <span className="adm-stat-ico theme-login" aria-hidden>
                            <IconClock />
                          </span>
                          <StatDateValue iso={u.last_login_at} lang={lang} />
                        </td>
                        <td className="adm-td-actions" data-label={t('adm_col_actions')}>
                          <div className="adm-row-actions">
                            {u.role === 'admin' ? (
                              <button
                                type="button"
                                className="adm-act-btn"
                                disabled={busy || self}
                                onClick={() =>
                                  requestPatch(
                                    u,
                                    { role: 'user' },
                                    t('adm_confirm_demote_title'),
                                    t('adm_confirm_demote_msg').replace('{email}', u.email),
                                    true,
                                  )
                                }
                              >
                                <span className="adm-act-ico" aria-hidden>
                                  <IconUserBadge />
                                </span>
                                {t('adm_demote')}
                              </button>
                            ) : (
                              <button
                                type="button"
                                className="adm-act-btn primary"
                                disabled={busy}
                                onClick={() =>
                                  requestPatch(
                                    u,
                                    { role: 'admin' },
                                    t('adm_confirm_promote_title'),
                                    t('adm_confirm_promote_msg').replace('{email}', u.email),
                                  )
                                }
                              >
                                <span className="adm-act-ico" aria-hidden>
                                  <IconUserPlus />
                                </span>
                                {t('adm_make_admin')}
                              </button>
                            )}
                            {u.is_active ? (
                              <button
                                type="button"
                                className="adm-act-btn danger"
                                disabled={busy || self}
                                onClick={() =>
                                  requestPatch(
                                    u,
                                    { is_active: false },
                                    t('adm_confirm_disable_title'),
                                    t('adm_confirm_disable_msg').replace('{email}', u.email),
                                    true,
                                  )
                                }
                              >
                                <span className="adm-act-ico" aria-hidden>
                                  <IconBan />
                                </span>
                                {t('adm_disable')}
                              </button>
                            ) : (
                              <button
                                type="button"
                                className="adm-act-btn"
                                disabled={busy}
                                onClick={() =>
                                  requestPatch(
                                    u,
                                    { is_active: true },
                                    t('adm_confirm_enable_title'),
                                    t('adm_confirm_enable_msg').replace('{email}', u.email),
                                  )
                                }
                              >
                                {t('adm_enable')}
                              </button>
                            )}
                            <div className="adm-more">
                              <button
                                type="button"
                                className="adm-more-btn"
                                data-adm-more={u.id}
                                aria-label={t('adm_more')}
                                aria-expanded={menuFor === u.id}
                                onClick={(e) => {
                                  e.stopPropagation()
                                  toggleMenu(u, e.currentTarget)
                                }}
                              >
                                ⋮
                              </button>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                  {!data && !error && (
                    <tr className="adm-table-empty">
                      <td colSpan={8} data-label="">
                        {t('adm_loading')}
                      </td>
                    </tr>
                  )}
                  {data && filtered.length === 0 && (
                    <tr className="adm-table-empty">
                      <td colSpan={8} data-label="">
                        {t('adm_no_match')}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="adm-pager">
              <span>
                {t('adm_showing')
                  .replace('{from}', String(filtered.length === 0 ? 0 : (safePage - 1) * PAGE_SIZE + 1))
                  .replace('{to}', String(Math.min(safePage * PAGE_SIZE, filtered.length)))
                  .replace('{total}', String(filtered.length))}
              </span>
              <div className="adm-pager-btns">
                <button
                  type="button"
                  className="adm-page-nav"
                  disabled={safePage <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  ‹ Previous
                </button>
                {Array.from({ length: pageCount }, (_, i) => i + 1)
                  .filter((n) => n === 1 || n === pageCount || Math.abs(n - safePage) <= 1)
                  .reduce<(number | '…')[]>((acc, n, idx, arr) => {
                    const prev = arr[idx - 1]
                    if (idx > 0 && typeof prev === 'number' && n - prev > 1) {
                      acc.push('…')
                    }
                    acc.push(n)
                    return acc
                  }, [])
                  .map((n, i) =>
                    n === '…' ? (
                      <span key={`e${i}`} className="adm-page-ellipsis">
                        …
                      </span>
                    ) : (
                      <button
                        key={n}
                        type="button"
                        className={`adm-page-num${n === safePage ? ' on' : ''}`}
                        onClick={() => setPage(n)}
                      >
                        {n}
                      </button>
                    ),
                  )}
                <button
                  type="button"
                  className="adm-page-nav"
                  disabled={safePage >= pageCount}
                  onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
                >
                  Next ›
                </button>
              </div>
            </div>
          </section>

          <aside className="adm-side">
            <section className="adm-card adm-reg-card">
              <div className="adm-card-head compact adm-reg-head">
                <div className="adm-reg-title">
                  <span className="adm-reg-ico" aria-hidden>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="3" y="5" width="18" height="16" rx="2" />
                      <path d="M3 10h18M8 3v4M16 3v4" />
                    </svg>
                  </span>
                  <div>
                    <h2>{t('adm_registration')}</h2>
                    <p>{rangeLabel[regRange]}</p>
                  </div>
                </div>
                <div className="adm-filter adm-range-filter" ref={regRangeRef}>
                  <button
                    type="button"
                    className="adm-range-btn"
                    aria-haspopup="listbox"
                    aria-expanded={regRangeOpen}
                    onClick={() => setRegRangeOpen((v) => !v)}
                  >
                    {rangeLabel[regRange]}
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden>
                      <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                  {regRangeOpen && (
                    <div className="adm-filter-menu" role="listbox">
                      {([7, 14, 30] as RegRange[]).map((n) => (
                        <button
                          key={n}
                          type="button"
                          role="option"
                          aria-selected={regRange === n}
                          className={regRange === n ? 'on' : ''}
                          onClick={() => {
                            setRegRange(n)
                            setRegRangeOpen(false)
                          }}
                        >
                          {rangeLabel[n]}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              <div className="adm-reg-stats">
                <div className="adm-reg-total">
                  <strong>{analytics.periodTotal}</strong>
                  <span className={analytics.periodDelta >= 0 ? 'up' : 'down'}>
                    {analytics.periodDelta >= 0 ? '↑ +' : '↓ '}
                    {Math.abs(analytics.periodDelta)}%
                  </span>
                </div>
              </div>
              <div className={`adm-bars range-${regRange}`}>
                {analytics.days.map((d) => (
                  <div
                    key={d.key}
                    className={`adm-bar-col${d.key === analytics.peakKey && d.count > 0 ? ' peak' : ''}`}
                    title={`${d.label}: ${d.count}`}
                  >
                    <span className="adm-bar-val">{d.count}</span>
                    <div className="adm-bar-track">
                      <div
                        className="adm-bar"
                        style={{ height: `${Math.max(8, (d.count / analytics.maxBar) * 100)}%` }}
                      />
                    </div>
                    <span className="adm-bar-label">{d.shortLabel}</span>
                  </div>
                ))}
              </div>
            </section>

            <section className="adm-card adm-activity-card">
              <div className="adm-card-head compact">
                <div className="adm-reg-title">
                  <span className="adm-activity-ico" aria-hidden>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <circle cx="12" cy="12" r="8" />
                      <path d="M12 8v4l2.5 2.5" />
                    </svg>
                  </span>
                  <div>
                    <h2>{t('adm_recent_activity')}</h2>
                    <p>{t('adm_latest_events')}</p>
                  </div>
                </div>
              </div>
              <ul className="adm-activity">
                {visibleActivity.map((a) => (
                  <li key={a.id} className={`kind-${a.kind}`}>
                    <i className="adm-act-dot" />
                    <div>
                      <strong>{t(a.titleKey)}</strong>
                      <span>{a.email}</span>
                    </div>
                    <em>{relativeTime(a.at, t)}</em>
                  </li>
                ))}
                {analytics.activity.length === 0 && <li className="empty">{t('adm_no_activity')}</li>}
              </ul>
              {analytics.activity.length > 0 && (
                <button
                  type="button"
                  className="adm-activity-more"
                  onClick={() => {
                    if (analytics.activity.length > 7) setActivityExpanded((v) => !v)
                  }}
                >
                  {activityExpanded ? t('adm_show_less_activity') : t('adm_view_all_activity')}
                  <span aria-hidden>{activityExpanded ? '↑' : '→'}</span>
                </button>
              )}
            </section>
          </aside>
        </div>
      </div>

      {menuUser && menuPos &&
        createPortal(
          <div
            ref={menuRef}
            className={`adm-more-menu adm-more-menu-fixed${menuPos.openUp ? ' up' : ''}`}
            style={{ top: menuPos.top, left: menuPos.left }}
            role="menu"
          >
            <button
              type="button"
              role="menuitem"
              onClick={() =>
                askConfirm({
                  title: t('adm_confirm_copy_title'),
                  message: t('adm_confirm_copy_msg').replace('{email}', menuUser.email),
                  run: async () => {
                    await navigator.clipboard.writeText(menuUser.email)
                  },
                })
              }
            >
              {t('adm_copy_email')}
            </button>
            <button type="button" role="menuitem" onClick={() => openEditProfile(menuUser)}>
              {t('adm_update_profile')}
            </button>
            {menuUser.role !== 'admin' && (
              <button
                type="button"
                role="menuitem"
                onClick={() =>
                  requestPatch(
                    menuUser,
                    { role: 'admin' },
                    t('adm_confirm_promote_title'),
                    t('adm_confirm_promote_msg').replace('{email}', menuUser.email),
                  )
                }
              >
                {t('adm_promote')}
              </button>
            )}
            {menuUser.is_active && menuUser.id !== user?.id && (
              <button
                type="button"
                className="danger"
                role="menuitem"
                onClick={() =>
                  requestPatch(
                    menuUser,
                    { is_active: false },
                    t('adm_confirm_disable_title'),
                    t('adm_confirm_disable_msg').replace('{email}', menuUser.email),
                    true,
                  )
                }
              >
                {t('adm_disable_account')}
              </button>
            )}
            {menuUser.id !== user?.id && (
              <button
                type="button"
                className="danger"
                role="menuitem"
                onClick={() =>
                  askConfirm({
                    title: t('adm_confirm_delete_title'),
                    message: t('adm_confirm_delete_msg').replace('{email}', menuUser.email),
                    danger: true,
                    run: () =>
                      runAction(menuUser, async () => {
                        await api.adminDeleteUser(menuUser.id)
                      }),
                  })
                }
              >
                {t('adm_delete_account')}
              </button>
            )}
          </div>,
          document.body,
        )}

      {addOpen && (
        <div className="adm-modal-backdrop" onClick={() => !confirm && setAddOpen(false)}>
          <form
            className="adm-modal"
            onClick={(e) => e.stopPropagation()}
            onSubmit={(e) => void onAdd(e)}
          >
            <h3>{t('adm_add_title')}</h3>
            <p>{t('adm_add_desc')}</p>
            <label>
              {t('adm_email')}
              <input type="email" required value={addEmail} onChange={(e) => setAddEmail(e.target.value)} />
            </label>
            <label>
              {t('adm_temp_password')}
              <input
                type="text"
                required
                minLength={8}
                value={addPassword}
                onChange={(e) => setAddPassword(e.target.value)}
              />
            </label>
            <label>
              {t('adm_role')}
              <select value={addRole} onChange={(e) => setAddRole(e.target.value as 'user' | 'admin')}>
                <option value="user">{t('adm_role_user')}</option>
                <option value="admin">{t('adm_role_admin')}</option>
              </select>
            </label>
            <div className="adm-modal-actions">
              <button type="button" className="ghost" onClick={() => setAddOpen(false)}>
                {t('adm_cancel')}
              </button>
              <button type="submit" disabled={addBusy}>
                {addBusy ? t('adm_creating') : t('adm_create')}
              </button>
            </div>
          </form>
        </div>
      )}

      {editUser && (
        <div className="adm-modal-backdrop" onClick={() => !confirm && setEditUser(null)}>
          <form
            className="adm-modal"
            onClick={(e) => e.stopPropagation()}
            onSubmit={(e) => void submitEditProfile(e)}
          >
            <h3>{t('adm_update_profile')}</h3>
            <p>{t('adm_update_profile_desc').replace('{email}', editUser.email)}</p>
            <label>
              {t('adm_email')}
              <input type="email" required value={editEmail} onChange={(e) => setEditEmail(e.target.value)} />
            </label>
            <label>
              {t('adm_new_password')}
              <input
                type="text"
                minLength={8}
                placeholder={t('adm_password_optional')}
                value={editPassword}
                onChange={(e) => setEditPassword(e.target.value)}
              />
            </label>
            <label>
              {t('adm_role')}
              <select
                value={editRole}
                disabled={editUser.id === user?.id}
                onChange={(e) => setEditRole(e.target.value as 'user' | 'admin')}
              >
                <option value="user">{t('adm_role_user')}</option>
                <option value="admin">{t('adm_role_admin')}</option>
              </select>
            </label>
            <label className="adm-check-row">
              <input
                type="checkbox"
                checked={editVerified}
                onChange={(e) => setEditVerified(e.target.checked)}
              />
              <span>{t('adm_mark_verified')}</span>
            </label>
            <div className="adm-modal-actions">
              <button type="button" className="ghost" onClick={() => setEditUser(null)}>
                {t('adm_cancel')}
              </button>
              <button type="submit" disabled={editBusy}>
                {editBusy ? t('adm_saving') : t('adm_save_profile')}
              </button>
            </div>
          </form>
        </div>
      )}

      {confirm && (
        <div className="adm-modal-backdrop adm-confirm-layer" onClick={() => !confirmBusy && setConfirm(null)}>
          <div className="adm-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <h3>{confirm.title}</h3>
            <p>{confirm.message}</p>
            <div className="adm-modal-actions">
              <button type="button" className="ghost" disabled={confirmBusy} onClick={() => setConfirm(null)}>
                {t('adm_cancel')}
              </button>
              <button
                type="button"
                className={confirm.danger ? 'danger-solid' : undefined}
                disabled={confirmBusy}
                onClick={() => void executeConfirm()}
              >
                {confirmBusy ? t('adm_working') : t('adm_confirm')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
