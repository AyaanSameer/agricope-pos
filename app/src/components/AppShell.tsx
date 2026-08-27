import { Outlet, useLocation, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { listStores } from '../api/org'
import { useAuth } from '../auth/AuthContext'
import { Topbar } from './Topbar'
import './shell.css'

interface Chrome {
  title: string
  subtitle?: string
  /** null = this is the hub; a path = the one screen that is nested under another */
  backTo?: string | null
}

/**
 * Chrome for every signed-in screen: one topbar, one outlet. The sidebar is
 * gone — the hub is home, and back always returns there. Receipt (under
 * Orders) and Open tab (under Tables) are the only two nested cases.
 */
export function AppShell() {
  const { session, activeStore } = useAuth()
  const { pathname } = useLocation()
  const params = useParams()
  const storesQuery = useQuery({ queryKey: ['stores'], queryFn: listStores, enabled: !!session })
  if (!session) return null

  const store = storesQuery.data?.data.find((s) => s.id === activeStore?.id)
  const till = activeStore?.name ?? 'Back office · all branches'
  const { user } = session

  const CHROME: Record<string, Chrome> = {
    '/': { title: till, subtitle: `${user.name} · ${user.role}`, backTo: null },
    '/register': { title: 'Register', subtitle: 'Ring up a sale' },
    '/floor': { title: 'Tables', subtitle: store?.name ?? till },
    '/orders': { title: 'Orders', subtitle: "Today's queue" },
    '/customers': { title: 'Customers', subtitle: 'Accounts and credit' },
    '/kds': { title: 'Kitchen', subtitle: store?.name ?? till },
    '/catalog': { title: 'Catalog', subtitle: 'Products, prices, offers' },
    '/shifts': { title: 'Shifts', subtitle: 'Drawer and cash moves' },
    '/reports': { title: 'Reports', subtitle: till },
    '/staff': { title: 'Staff', subtitle: 'Attendance' },
    '/users': { title: 'Users', subtitle: 'Logins and PINs' },
    '/settings': { title: 'Settings', subtitle: 'Branch settings' },
  }

  let chrome: Chrome = CHROME[pathname] ?? { title: 'Agricope', subtitle: till }
  if (pathname.startsWith('/charge/')) chrome = { title: 'Charge', subtitle: 'Take payment' }
  if (pathname.startsWith('/receipt/')) chrome = { title: 'Receipt', subtitle: till, backTo: '/orders' }
  if (pathname.startsWith('/tab/')) chrome = { title: 'Open tab', subtitle: store?.name ?? till, backTo: '/floor' }
  void params

  return (
    <div className="shell">
      <Topbar title={chrome.title} subtitle={chrome.subtitle} backTo={chrome.backTo} />
      <main className="content">
        <Outlet />
      </main>
    </div>
  )
}
