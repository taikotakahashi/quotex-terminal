import type { AssetsResponse, Candle, Indicators, Signal, SignalResult, Status, WsEvent } from './types'
import type { AdminUser, AdminUsersResponse, AuthUser, MeResponse } from './authTypes'

export type TelegramStatus = {
  configured: boolean
  bot_username: string | null
  linked: boolean
  enabled: boolean
  telegram_username?: string | null
  prefs?: Record<string, unknown> | null
}

// Empty base → same-origin /api and /ws (Vite proxy in dev, Caddy/nginx in prod).
// Optional override: VITE_API_BASE=https://your.domain (only when API is on another host).
const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? ''

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: 'include',
    ...init,
    headers: {
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init?.headers || {}),
    },
  })
  if (!res.ok) {
    let detail: unknown = res.statusText
    try {
      detail = await res.json()
    } catch {
      /* ignore */
    }
    // Session revoked / account disabled → force client logout.
    if (res.status === 401 && !path.startsWith('/api/auth/login') && !path.startsWith('/api/auth/register')) {
      window.dispatchEvent(new CustomEvent('qx:auth-expired'))
    }
    const err = new Error(`${path} -> ${res.status}`) as Error & { status?: number; detail?: unknown }
    err.status = res.status
    err.detail = detail
    throw err
  }
  if (res.status === 204) return undefined as T
  return res.json()
}

async function getJson<T>(path: string): Promise<T> {
  return request<T>(path)
}

export const api = {
  status: () => getJson<Status>('/api/status'),
  assets: () => getJson<AssetsResponse>('/api/assets'),
  candles: (asset: string, tf: number, limit = 120) =>
    getJson<{ asset: string; timeframe: number; candles: Candle[] }>(
      `/api/candles/${encodeURIComponent(asset)}/${tf}?limit=${limit}`,
    ),
  signal: (asset: string, tf: number) =>
    getJson<{
      asset: string
      timeframe: number
      signal: Signal | null
      history: SignalResult[]
      indicators?: Indicators | null
    }>(`/api/signal/${encodeURIComponent(asset)}/${tf}?history=20`),
  indicators: (asset: string, tf: number) =>
    getJson<{ asset: string; timeframe: number; indicators: Indicators | null }>(
      `/api/indicators/${encodeURIComponent(asset)}/${tf}`,
    ),
  activeSignals: () =>
    getJson<{ count: number; signals: Signal[] }>('/api/signals/active'),
  signalHistory: (tf: number, limit = 20) =>
    getJson<{ timeframe: number; history: SignalResult[] }>(
      `/api/signals/history?timeframe=${tf}&limit=${limit}`,
    ),

  me: () => getJson<MeResponse>('/api/auth/me'),
  register: (email: string, password: string) =>
    request<{
      ok: boolean
      email: string
      email_sent: boolean
      message: string
      verify_url?: string
    }>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),
  login: (email: string, password: string) =>
    request<{ ok: boolean; user: AuthUser; email_verified: boolean }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),
  logout: () => request<{ ok: boolean }>('/api/auth/logout', { method: 'POST' }),
  resendVerification: (email: string) =>
    request<{ ok: boolean; message: string; verify_url?: string; email_sent?: boolean }>(
      '/api/auth/resend-verification',
      {
        method: 'POST',
        body: JSON.stringify({ email }),
      },
    ),
  verifyEmail: (token: string) =>
    request<{ ok: boolean; user: AuthUser }>('/api/auth/verify-email', {
      method: 'POST',
      body: JSON.stringify({ token }),
    }),
  forgotPassword: (email: string) =>
    request<{ ok: boolean; message: string; email_sent?: boolean; reset_url?: string }>(
      '/api/auth/forgot-password',
      {
        method: 'POST',
        body: JSON.stringify({ email }),
      },
    ),
  resetPassword: (token: string, password: string) =>
    request<{ ok: boolean; user: AuthUser; email_verified: boolean }>('/api/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({ token, password }),
    }),

  updateProfile: (body: {
    full_name?: string | null
    username?: string | null
    email?: string
    password?: string
    current_password?: string
  }) =>
    request<AuthUser>('/api/auth/profile', {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  uploadAvatar: async (file: File) => {
    const fd = new FormData()
    fd.append('file', file)
    const res = await fetch(`${API_BASE}/api/auth/avatar`, {
      method: 'POST',
      credentials: 'include',
      body: fd,
    })
    if (!res.ok) {
      let detail: unknown = res.statusText
      try {
        detail = await res.json()
      } catch {
        /* ignore */
      }
      const err = new Error(`/api/auth/avatar -> ${res.status}`) as Error & {
        status?: number
        detail?: unknown
      }
      err.status = res.status
      err.detail = detail
      throw err
    }
    return res.json() as Promise<AuthUser>
  },
  deleteAvatar: () =>
    request<AuthUser>('/api/auth/avatar', {
      method: 'DELETE',
    }),

  telegramStatus: () => getJson<TelegramStatus>('/api/telegram/status'),
  telegramLink: () =>
    request<{
      ok: boolean
      deep_link: string
      bot_username: string
      expires_in_sec: number
    }>('/api/telegram/link', { method: 'POST' }),
  telegramUnlink: () =>
    request<{ ok: boolean; linked: boolean }>('/api/telegram/link', { method: 'DELETE' }),

  adminUsers: () => getJson<AdminUsersResponse>('/api/admin/users'),
  adminCreateUser: (body: {
    email: string
    password: string
    role?: 'user' | 'admin'
    email_verified?: boolean
  }) =>
    request<AdminUser>('/api/admin/users', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  adminPatchUser: (
    id: string,
    body: {
      role?: 'user' | 'admin'
      is_active?: boolean
      email?: string
      password?: string
      email_verified?: boolean
    },
  ) =>
    request<AdminUser>(`/api/admin/users/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  adminDeleteUser: (id: string) =>
    request<{ ok: boolean }>(`/api/admin/users/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),
}

/** Open a resilient WebSocket to the live feed. Auto-reconnects with backoff. */
export function connectFeed(
  onEvent: (e: WsEvent) => void,
  onState: (connected: boolean) => void,
): () => void {
  const wsBase = (API_BASE || `${window.location.protocol}//${window.location.host}`).replace(
    /^http/,
    'ws',
  )
  let ws: WebSocket | null = null
  let closed = false
  let retry = 0
  let timer: number | undefined

  const open = () => {
    ws = new WebSocket(`${wsBase}/ws`)
    ws.onopen = () => {
      retry = 0
      onState(true)
    }
    ws.onmessage = (ev) => {
      try {
        onEvent(JSON.parse(ev.data) as WsEvent)
      } catch {
        /* ignore malformed frame */
      }
    }
    ws.onclose = () => {
      onState(false)
      if (closed) return
      retry += 1
      const delay = Math.min(1000 * 2 ** retry, 15000)
      timer = window.setTimeout(open, delay)
    }
    ws.onerror = () => ws?.close()
  }

  open()
  return () => {
    closed = true
    if (timer) window.clearTimeout(timer)
    ws?.close()
  }
}
