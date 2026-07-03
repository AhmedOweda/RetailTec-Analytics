import React, { createContext, useContext, useState, useCallback, ReactNode } from 'react'
import api from '../api/client'

export interface AuthUser {
  id:        number
  username:  string
  role:      'admin' | 'manager' | 'viewer'
  full_name: string
  stores:    string | null   // null = all stores
  pages?:    string | null   // CSV of allowed page keys; null = all pages
}

interface AuthContextValue {
  user:    AuthUser | null
  token:   string | null
  login:   (username: string, password: string) => Promise<void>
  logout:  () => void
  isAdmin: boolean
  isMgr:   boolean
}

const AuthContext = createContext<AuthContextValue | null>(null)

function _loadStored(): { user: AuthUser | null; token: string | null } {
  try {
    const token = localStorage.getItem('rt_token')
    const raw   = localStorage.getItem('rt_user')
    if (token && raw) return { token, user: JSON.parse(raw) }
  } catch { /* ignore */ }
  return { user: null, token: null }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const stored = _loadStored()
  const [user,  setUser]  = useState<AuthUser | null>(stored.user)
  const [token, setToken] = useState<string | null>(stored.token)

  const login = useCallback(async (username: string, password: string) => {
    const { data } = await api.post('/api/auth/login', { username, password })
    localStorage.setItem('rt_token', data.access_token)
    localStorage.setItem('rt_user',  JSON.stringify(data.user))
    setToken(data.access_token)
    setUser(data.user)
    // Fire the on-open incremental sync now that we have a token
    api.get('/api/sync/trigger').catch(() => {})
    if (data.must_change_password) {
      // Backend flags accounts still on the seeded default password
      alert('You are using the default password — please change it from the Users screen.')
    }
  }, [])

  const logout = useCallback(() => {
    localStorage.removeItem('rt_token')
    localStorage.removeItem('rt_user')
    setToken(null)
    setUser(null)
  }, [])

  const value: AuthContextValue = {
    user,
    token,
    login,
    logout,
    isAdmin: user?.role === 'admin',
    isMgr:   user?.role === 'admin' || user?.role === 'manager',
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}
