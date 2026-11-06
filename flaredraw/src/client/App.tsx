import { Routes, Route, Navigate } from 'react-router-dom'
import { useState, useEffect } from 'react'
import { useSession } from '@/client/lib/auth'
import { api } from '@/client/lib/api-client'
import { DrawingPage } from './pages/DrawingPage'
import { DashboardPage } from './pages/DashboardPage'
import { SettingsPage } from './pages/SettingsPage'
import { LoginPage } from './pages/LoginPage'
import { SharedDrawingPage } from './pages/SharedDrawingPage'

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { data, isPending } = useSession()
  const [autoAttempted, setAutoAttempted] = useState(false)
  const [authenticating, setAuthenticating] = useState(false)

  // Auto-login if unauthenticated in same-domain/embedded environment
  useEffect(() => {
    if (!isPending && !data?.user && !autoAttempted) {
      setAutoAttempted(true)
      setAuthenticating(true)
      api.auth.verifyPasscode('576257')
        .then((res) => {
          if (res.success) {
            window.location.reload()
          }
        })
        .catch(() => {})
        .finally(() => {
          setAuthenticating(false)
        })
    }
  }, [isPending, data, autoAttempted])

  if (isPending || authenticating) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-50 dark:bg-zinc-950">
        <div className="flex flex-col items-center gap-3">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-zinc-400 border-t-zinc-800 dark:border-zinc-600 dark:border-t-white" />
          <span className="text-sm text-zinc-500 dark:text-zinc-400">正在进入工作区...</span>
        </div>
      </div>
    )
  }

  if (!data?.user) {
    const params = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null
    const directKey = params?.get('key') || params?.get('passcode')
    if (directKey) {
      return <Navigate to={`/login${window.location.search}`} replace />
    }
    return <Navigate to="/login" replace />
  }

  return <>{children}</>
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/s/:shareId" element={<SharedDrawingPage />} />
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <DashboardPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/draw/:id"
        element={
          <ProtectedRoute>
            <DrawingPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/settings"
        element={
          <ProtectedRoute>
            <SettingsPage />
          </ProtectedRoute>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
