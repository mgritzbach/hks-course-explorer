// Hook to manage authentication state
// Calls /api/auth/status on mount to check for existing session

import { useCallback, useEffect, useState } from 'react'

export function useAuth() {
  const [authState, setAuthState] = useState({
    loading: true,
    authenticated: false,
    email: null,
  })

  const checkStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/status', { credentials: 'include' })
      const data = await res.json()
      setAuthState({
        loading: false,
        authenticated: data.authenticated,
        email: data.email || null,
      })
    } catch {
      setAuthState({ loading: false, authenticated: false, email: null })
    }
  }, [])

  useEffect(() => {
    checkStatus()
  }, [checkStatus])

  const onAuthSuccess = useCallback((email) => {
    setAuthState({ loading: false, authenticated: true, email })
  }, [])

  const logout = useCallback(async () => {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' })
    setAuthState({ loading: false, authenticated: false, email: null })
  }, [])

  return { ...authState, onAuthSuccess, logout, recheckAuth: checkStatus }
}
