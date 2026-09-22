import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { api } from './api'
import type { AuthUser } from './authTypes'

type AuthState = {
  loading: boolean
  authRequired: boolean
  user: AuthUser | null
  refresh: () => Promise<void>
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true)
  const [authRequired, setAuthRequired] = useState(true)
  const [user, setUser] = useState<AuthUser | null>(null)

  const refresh = useCallback(async () => {
    try {
      const me = await api.me()
      setAuthRequired(me.auth_required)
      setUser(me.user)
    } catch {
      setUser(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // Admin disabled/deleted this account (or session revoked) → clear local auth.
  useEffect(() => {
    const onExpired = () => {
      setUser(null)
    }
    window.addEventListener('qx:auth-expired', onExpired)
    return () => window.removeEventListener('qx:auth-expired', onExpired)
  }, [])

  // Keep last_seen_at fresh so admins can see Online/Offline presence.
  // Also detects revoked sessions within ~20s even if no other API calls fail.
  useEffect(() => {
    if (!user) return
    const id = window.setInterval(() => {
      void refresh()
    }, 20_000)
    return () => window.clearInterval(id)
  }, [user, refresh])

  const logout = useCallback(async () => {
    try {
      await api.logout()
    } finally {
      setUser(null)
    }
  }, [])

  const value = useMemo(
    () => ({ loading, authRequired, user, refresh, logout }),
    [loading, authRequired, user, refresh, logout],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth requires AuthProvider')
  return ctx
}
