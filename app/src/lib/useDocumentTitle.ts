import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'

/**
 * The browser tab names the till: the branch this device is signed into,
 * or the business while it is still picking one. Only the console and the
 * screens before a business signs in fall back to the product name.
 */
export function titleFor(
  pathname: string,
  who: { admin: boolean; business: string | null; store: string | null },
): string {
  if (pathname.startsWith('/admin') && who.admin) return 'Agricope Console'
  if (pathname === '/login' || pathname.startsWith('/r/')) return 'Agricope POS'
  return who.store ?? who.business ?? 'Agricope POS'
}

export function useDocumentTitle() {
  const { adminSession, businessSession, activeStore } = useAuth()
  const { pathname } = useLocation()
  useEffect(() => {
    document.title = titleFor(pathname, {
      admin: !!adminSession,
      business: businessSession?.business.name ?? null,
      store: activeStore?.name ?? null,
    })
  }, [pathname, adminSession, businessSession, activeStore])
}
