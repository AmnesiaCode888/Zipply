import { useCallback, useEffect, useRef, useState } from 'react'
import type { AuthState } from '../../../shared/auth'

const INITIAL_AUTH_STATE: AuthState = {
  status: 'anonymous',
  subscriptionReady: false,
  profile: null,
  avatarDataUrl: null,
  usage: null,
  history: null,
  error: null,
  scope: null
}

export function useAuth() {
  const [auth, setAuth] = useState<AuthState>(INITIAL_AUTH_STATE)
  const latestAuthRef = useRef<AuthState>(INITIAL_AUTH_STATE)
  const [ready, setReady] = useState<boolean>(() => !window.api?.auth)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const api = window.api?.auth
    if (!api) {
      setReady(true)
      return
    }
    let active = true
    const applyState = (state: AuthState): void => {
      const current = latestAuthRef.current
      if (current.status === 'authenticated' && current.subscriptionReady && state.status === 'authenticated' && !state.subscriptionReady) return
      latestAuthRef.current = state
      setAuth(state)
      if (state.status !== 'authenticated' || state.subscriptionReady) setReady(true)
    }
    void api.getState().then(state => {
      if (active) applyState(state)
    }).catch(() => {
      if (active) setReady(true)
    })
    const unsubscribe = api.onStateChanged(state => {
      if (active) applyState(state)
    })
    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  const login = useCallback(async () => {
    const api = window.api?.auth
    if (!api) return
    setBusy(true)
    try {
      const next = await api.login()
      latestAuthRef.current = next
      setAuth(next)
    } finally {
      setBusy(false)
    }
  }, [])

  const cancelLogin = useCallback(async () => {
    const api = window.api?.auth
    if (!api) return
    const next = await api.cancelLogin()
    latestAuthRef.current = next
    setAuth(next)
  }, [])

  const refresh = useCallback(async () => {
    const api = window.api?.auth
    if (!api) return
    setBusy(true)
    try {
      const next = await api.refresh()
      latestAuthRef.current = next
      setAuth(next)
    } finally {
      setBusy(false)
    }
  }, [])

  const logout = useCallback(async () => {
    const api = window.api?.auth
    if (!api) return
    setBusy(true)
    try {
      const next = await api.logout()
      latestAuthRef.current = next
      setAuth(next)
    } finally {
      setBusy(false)
    }
  }, [])

  return { auth, ready, busy, login, cancelLogin, refresh, logout }
}
