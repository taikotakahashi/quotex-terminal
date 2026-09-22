import { useEffect, useState, type ReactNode } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import App from './App'
import { useAuth } from './auth'
import { LoadingScreen } from './components/LoadingScreen'
import { AdminPage } from './pages/AdminPage'
import { LoginPage, RegisterPage, VerifyEmailPage, VerifyPendingPage, ForgotPasswordPage, ResetPasswordPage } from './pages/AuthPages'

const DASHBOARD_BOOT_MS = 2000

/** Show the boot loading page whenever we enter the main dashboard. */
function DashboardEntry({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const id = window.setTimeout(() => setReady(true), DASHBOARD_BOOT_MS)
    return () => window.clearTimeout(id)
  }, [])

  if (!ready) return <LoadingScreen />
  return <>{children}</>
}

function RequireVerified({ children }: { children: React.ReactNode }) {
  const { loading, authRequired, user } = useAuth()
  if (loading) return <LoadingScreen />
  if (!authRequired) return <>{children}</>
  if (!user) return <Navigate to="/login" replace />
  if (!user.email_verified) return <Navigate to="/verify-pending" replace />
  return <>{children}</>
}

function RequireAdmin({ children }: { children: React.ReactNode }) {
  const { loading, user } = useAuth()
  if (loading) return <LoadingScreen />
  if (!user || user.role !== 'admin') return <Navigate to="/" replace />
  return <>{children}</>
}

function RedirectIfAuthed({ children }: { children: React.ReactNode }) {
  const { loading, user } = useAuth()
  if (loading) return <LoadingScreen />
  if (user?.email_verified) return <Navigate to="/" replace />
  if (user && !user.email_verified) return <Navigate to="/verify-pending" replace />
  return <>{children}</>
}

export function AppRouter() {
  return (
    <Routes>
      <Route
        path="/login"
        element={
          <RedirectIfAuthed>
            <LoginPage />
          </RedirectIfAuthed>
        }
      />
      <Route
        path="/register"
        element={
          <RedirectIfAuthed>
            <RegisterPage />
          </RedirectIfAuthed>
        }
      />
      <Route
        path="/forgot-password"
        element={
          <RedirectIfAuthed>
            <ForgotPasswordPage />
          </RedirectIfAuthed>
        }
      />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route path="/verify-email" element={<VerifyEmailPage />} />
      <Route path="/verify-pending" element={<VerifyPendingPage />} />
      <Route
        path="/admin"
        element={
          <RequireVerified>
            <RequireAdmin>
              <AdminPage />
            </RequireAdmin>
          </RequireVerified>
        }
      />
      <Route
        path="/*"
        element={
          <RequireVerified>
            <DashboardEntry>
              <App />
            </DashboardEntry>
          </RequireVerified>
        }
      />
    </Routes>
  )
}
