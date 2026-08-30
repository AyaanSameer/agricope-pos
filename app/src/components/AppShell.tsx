import { Outlet, useLocation } from 'react-router-dom'
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
  if (!session) return null

  const till = activeStore?.name ?? 'Back office · all branches'
  const { user } = session

  const CHROME: Record<string, Chrome> = {
    '/': { title: till, subtitle: `${user.name} · ${user.role}`, backTo: null },
    '/register': { title: 'Register', subtitle: 'Ring up a sale' },
    '/floor': { title: 'Tables', subtitle: 'The floor right now' },
    '/orders': { title: 'Orders', subtitle: "Today's queue" },
    '/customers': { title: 'Customers', subtitle: 'Accounts and credit' },
    '/kds': { title: 'Kitchen', subtitle: 'Tickets by station' },
    '/catalog': { title: 'Catalog', subtitle: 'Products and prices' },
    '/shifts': { title: 'Shifts', subtitle: 'The cash drawer' },
    '/reports': { title: 'Reports', subtitle: 'The day, so far' },
    '/staff': { title: 'Staff', subtitle: 'Who is on the floor' },
    '/users': { title: 'Users', subtitle: 'Till logins for this business' },
    '/settings': { title: 'Settings', subtitle: 'Branch settings' },
  }

  let chrome: Chrome = CHROME[pathname] ?? { title: 'Agricope', subtitle: till }
  if (pathname.startsWith('/charge/')) chrome = { title: 'Charge', subtitle: 'Take payment' }
  if (pathname.startsWith('/receipt/')) chrome = { title: 'Receipt', subtitle: 'Share or print', backTo: '/orders' }
  if (pathname.startsWith('/tab/')) {
    chrome = { title: 'Open tab', subtitle: "One table's bill", backTo: '/floor' }
  }

  return (
    <div className="shell">
      <Topbar title={chrome.title} subtitle={chrome.subtitle} backTo={chrome.backTo} />
      <main className="content">
        <Outlet />
      </main>
    </div>
  )
}
