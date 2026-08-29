import { Outlet, useLocation, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { listStores } from '../api/org'
import { getOrder } from '../api/orders'
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
  // The open tab names its table in the topbar, so the page never repeats it.
  // Same query key as TabPage — this reads the cache rather than re-fetching.
  const tabId = pathname.startsWith('/tab/') ? params.id : undefined
  const tabOrder = useQuery({
    queryKey: ['order', tabId],
    queryFn: () => getOrder(tabId!),
    enabled: !!tabId,
  })
  if (!session) return null

  const store = storesQuery.data?.data.find((s) => s.id === activeStore?.id)
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
    const o = tabOrder.data
    chrome = {
      title: o ? `${o.table_name ?? 'Dine-in'} — open tab` : 'Open tab',
      subtitle: o
        ? `${o.guest_count ?? '—'} guests · ${o.order_number} · ${o.cashier_name}${
            o.order_type === 'dine_in' && !o.table_id ? ' · no table yet' : ''
          }`
        : "One table's bill",
      backTo: '/floor',
    }
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
