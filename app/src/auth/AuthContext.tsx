import { createContext, useCallback, useContext, useState } from 'react'
import type { ReactNode } from 'react'
import { setAccessToken } from '../api/client'
import { login as apiLogin, switchCashier as apiSwitchCashier } from '../api/auth'
import type { User } from '../api/types'

interface Session {
  token: string
  refreshToken: string
  user: User
}

export interface StoreRef {
  id: string
  name: string
}

interface AuthValue {
  session: Session | null
  /** The store this till/session is acting in. Fixed for store staff, chosen by owners. */
  activeStore: StoreRef | null
  signIn: (email: string, password: string) => Promise<User>
  signOut: () => void
  /** Fast cashier hand-over on the till — keeps the active store, swaps the person. */
  switchByPin: (pin: string) => Promise<User>
  setActiveStore: (store: StoreRef | null) => void
}

const SESSION_KEY = 'agricope.session'
const STORE_KEY = 'agricope.activeStore'

const AuthContext = createContext<AuthValue | null>(null)

function loadJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

function initialSession(): Session | null {
  const session = loadJson<Session>(SESSION_KEY)
  if (session) setAccessToken(session.token)
  return session
}

function storeForUser(user: User): StoreRef | null {
  return user.store_id ? { id: user.store_id, name: user.store_name ?? '' } : null
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(initialSession)
  const [activeStore, setActiveStoreState] = useState<StoreRef | null>(() =>
    loadJson<StoreRef>(STORE_KEY),
  )

  const persistStore = useCallback((store: StoreRef | null) => {
    if (store) localStorage.setItem(STORE_KEY, JSON.stringify(store))
    else localStorage.removeItem(STORE_KEY)
    setActiveStoreState(store)
  }, [])

  const adoptSession = useCallback(
    (token: string, refreshToken: string, user: User, keepStore: boolean) => {
      const next: Session = { token, refreshToken, user }
      setAccessToken(token)
      localStorage.setItem(SESSION_KEY, JSON.stringify(next))
      setSession(next)
      if (!keepStore) persistStore(storeForUser(user))
      return user
    },
    [persistStore],
  )

  const signIn = useCallback(
    async (email: string, password: string) => {
      const res = await apiLogin(email, password)
      return adoptSession(res.access_token, res.refresh_token, res.user, false)
    },
    [adoptSession],
  )

  const switchByPin = useCallback(
    async (pin: string) => {
      if (!activeStore) throw new Error('No active store on this till')
      const res = await apiSwitchCashier(activeStore.id, pin)
      // Same till, same store — only the person changes.
      return adoptSession(res.access_token, res.refresh_token, res.user, true)
    },
    [activeStore, adoptSession],
  )

  const signOut = useCallback(() => {
    setAccessToken(null)
    localStorage.removeItem(SESSION_KEY)
    localStorage.removeItem(STORE_KEY)
    setSession(null)
    setActiveStoreState(null)
  }, [])

  return (
    <AuthContext.Provider
      value={{ session, activeStore, signIn, signOut, switchByPin, setActiveStore: persistStore }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}
