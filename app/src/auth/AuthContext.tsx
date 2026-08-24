import { createContext, useCallback, useContext, useState } from 'react'
import type { ReactNode } from 'react'
import { setAccessToken } from '../api/client'
import { login as apiLogin } from '../api/auth'
import type { User } from '../api/types'

interface Session {
  token: string
  refreshToken: string
  user: User
}

interface AuthValue {
  session: Session | null
  signIn: (email: string, password: string) => Promise<void>
  signOut: () => void
}

const STORAGE_KEY = 'agricope.session'

const AuthContext = createContext<AuthValue | null>(null)

function loadSession(): Session | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const session = JSON.parse(raw) as Session
    setAccessToken(session.token)
    return session
  } catch {
    return null
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(loadSession)

  const signIn = useCallback(async (email: string, password: string) => {
    const res = await apiLogin(email, password)
    const next: Session = {
      token: res.access_token,
      refreshToken: res.refresh_token,
      user: res.user,
    }
    setAccessToken(next.token)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    setSession(next)
  }, [])

  const signOut = useCallback(() => {
    setAccessToken(null)
    localStorage.removeItem(STORAGE_KEY)
    setSession(null)
  }, [])

  return (
    <AuthContext.Provider value={{ session, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}
