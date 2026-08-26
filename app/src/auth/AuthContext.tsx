import { createContext, useCallback, useContext, useState } from 'react'
import type { ReactNode } from 'react'
import { setAccessToken } from '../api/client'
import { login as apiLogin, switchCashier as apiSwitchCashier } from '../api/auth'
import type { Store, User } from '../api/types'

/**
 * Three kinds of sign-in share one form:
 *  - platform ADMIN (Agricope staff) → the /admin console, above every business
 *  - a BUSINESS (one login for all its branches) → branch picker, then
 *  - a PERSON, identified by the PIN they type on the till
 */

interface AdminSession {
  token: string
  admin: { id: string; name: string }
}

interface BusinessSession {
  token: string
  business: { id: string; name: string }
  stores: Store[]
}

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
  adminSession: AdminSession | null
  businessSession: BusinessSession | null
  session: Session | null
  /** The store this till/session is acting in. Fixed for store staff, chosen by owners. */
  activeStore: StoreRef | null
  /** Returns which kind of account signed in, so the login page can route. */
  signIn: (email: string, password: string) => Promise<'admin' | 'business'>
  /** PIN → person. Uses the active store as the till context (null = back office). */
  identify: (pin: string, storeId: string | null) => Promise<User>
  /** Fast user hand-over on the till — keeps the active store, swaps the person. */
  switchByPin: (pin: string) => Promise<User>
  signOut: () => void
  setActiveStore: (store: StoreRef | null) => void
}

const ADMIN_KEY = 'agricope.admin'
const BUSINESS_KEY = 'agricope.business'
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

function initialBusiness(): BusinessSession | null {
  const business = loadJson<BusinessSession>(BUSINESS_KEY)
  // A user session's token wins; the business token only carries the PIN stage.
  if (business && !localStorage.getItem(SESSION_KEY)) setAccessToken(business.token)
  return business
}

function initialAdmin(): AdminSession | null {
  const admin = loadJson<AdminSession>(ADMIN_KEY)
  if (admin) setAccessToken(admin.token)
  return admin
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [adminSession, setAdminSession] = useState<AdminSession | null>(initialAdmin)
  const [businessSession, setBusinessSession] = useState<BusinessSession | null>(initialBusiness)
  const [session, setSession] = useState<Session | null>(initialSession)
  const [activeStore, setActiveStoreState] = useState<StoreRef | null>(() =>
    loadJson<StoreRef>(STORE_KEY),
  )

  const persistStore = useCallback((store: StoreRef | null) => {
    if (store) localStorage.setItem(STORE_KEY, JSON.stringify(store))
    else localStorage.removeItem(STORE_KEY)
    setActiveStoreState(store)
  }, [])

  const adoptSession = useCallback((token: string, refreshToken: string, user: User) => {
    const next: Session = { token, refreshToken, user }
    setAccessToken(token)
    localStorage.setItem(SESSION_KEY, JSON.stringify(next))
    setSession(next)
    return user
  }, [])

  const clearAll = useCallback(() => {
    localStorage.removeItem(ADMIN_KEY)
    localStorage.removeItem(BUSINESS_KEY)
    localStorage.removeItem(SESSION_KEY)
    localStorage.removeItem(STORE_KEY)
    setAdminSession(null)
    setBusinessSession(null)
    setSession(null)
    setActiveStoreState(null)
  }, [])

  const signIn = useCallback(
    async (email: string, password: string) => {
      const res = await apiLogin(email, password)
      clearAll()
      if ('admin_token' in res) {
        const next: AdminSession = { token: res.admin_token, admin: res.admin }
        setAccessToken(next.token)
        localStorage.setItem(ADMIN_KEY, JSON.stringify(next))
        setAdminSession(next)
        return 'admin' as const
      }
      const next: BusinessSession = {
        token: res.business_token,
        business: res.business,
        stores: res.stores,
      }
      setAccessToken(next.token)
      localStorage.setItem(BUSINESS_KEY, JSON.stringify(next))
      setBusinessSession(next)
      return 'business' as const
    },
    [clearAll],
  )

  const identify = useCallback(
    async (pin: string, storeId: string | null) => {
      const res = await apiSwitchCashier(storeId, pin)
      return adoptSession(res.access_token, res.refresh_token, res.user)
    },
    [adoptSession],
  )

  const switchByPin = useCallback(
    async (pin: string) => {
      if (!activeStore) throw new Error('No active store on this till')
      const res = await apiSwitchCashier(activeStore.id, pin)
      // Same till, same store — only the person changes.
      return adoptSession(res.access_token, res.refresh_token, res.user)
    },
    [activeStore, adoptSession],
  )

  const signOut = useCallback(() => {
    setAccessToken(null)
    clearAll()
  }, [clearAll])

  return (
    <AuthContext.Provider
      value={{
        adminSession,
        businessSession,
        session,
        activeStore,
        signIn,
        identify,
        switchByPin,
        signOut,
        setActiveStore: persistStore,
      }}
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
