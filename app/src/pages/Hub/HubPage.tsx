import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { api } from '../../api/client'
import { listStores } from '../../api/org'
import { useAuth } from '../../auth/AuthContext'
import { NavIcon } from '../../components/NavIcon'
import type { NavIconName } from '../../components/NavIcon'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { fmt } from '../../lib/money'
import type { Role } from '../../api/types'
import './hub.css'

/** The plate tint says what kind of work a tile is. */
type Plate = 'green' | 'gold' | 'alert' | 'warm'

interface Tile {
  key: string
  label: string
  icon: NavIconName
  to: string
  plate: Plate
  roles: Role[]
  restaurantOnly?: boolean
  kdsOnly?: boolean
  /** phone shows "too small" for these instead of the screen */
  denseBlocked?: boolean
}

/** Order matters — this is the order the design puts them in. */
const TILES: Tile[] = [
  { key: 'register', label: 'Register', icon: 'register', to: '/register', plate: 'green', roles: ['owner', 'manager', 'cashier', 'waiter'] },
  { key: 'tables', label: 'Tables', icon: 'tables', to: '/floor', plate: 'gold', roles: ['owner', 'manager', 'cashier', 'waiter'], restaurantOnly: true },
  { key: 'orders', label: 'Orders', icon: 'orders', to: '/orders', plate: 'gold', roles: ['owner', 'manager', 'cashier', 'waiter'] },
  { key: 'customers', label: 'Customers', icon: 'customers', to: '/customers', plate: 'green', roles: ['owner', 'manager', 'cashier'] },
  { key: 'kitchen', label: 'Kitchen', icon: 'kitchen', to: '/kds', plate: 'alert', roles: ['owner', 'manager', 'cashier', 'waiter'], restaurantOnly: true, kdsOnly: true, denseBlocked: true },
  { key: 'catalog', label: 'Catalog', icon: 'catalog', to: '/catalog', plate: 'warm', roles: ['owner', 'manager'], denseBlocked: true },
  { key: 'shifts', label: 'Shifts', icon: 'shifts', to: '/shifts', plate: 'green', roles: ['owner', 'manager', 'cashier'] },
  { key: 'reports', label: 'Reports', icon: 'reports', to: '/reports', plate: 'warm', roles: ['owner', 'manager'] },
  { key: 'staff', label: 'Staff', icon: 'staff', to: '/staff', plate: 'green', roles: ['owner', 'manager'] },
  { key: 'users', label: 'Users', icon: 'users', to: '/users', plate: 'warm', roles: ['owner', 'manager'] },
  { key: 'settings', label: 'Settings', icon: 'settings', to: '/settings', plate: 'warm', roles: ['owner', 'manager'] },
]

interface FloorTable {
  id: string
  order: { minutes_open: number } | null
}

/**
 * The hub is home on every device. It answers "how is today going" in one card
 * and "what can I do" in one grid — and it is the only screen with no back
 * button, because everything else comes back here.
 */
export function HubPage() {
  const { session, activeStore, signOut } = useAuth()
  const navigate = useNavigate()
  const [confirmingSignOut, setConfirmingSignOut] = useState(false)

  const storeParam = activeStore ? `?store_id=${activeStore.id}` : ''
  const storesQuery = useQuery({ queryKey: ['stores'], queryFn: listStores })
  const store = storesQuery.data?.data.find((s) => s.id === activeStore?.id)
  const isRestaurant = store?.type === 'restaurant'
  const printsTickets = store?.kitchen_mode === 'printer'

  const summaryQuery = useQuery({
    queryKey: ['summary', activeStore?.id, 'today'],
    queryFn: () =>
      api<{ gross_sales: string; order_count: number }>(
        `/reports/summary${storeParam || '?'}${storeParam ? '&' : ''}range=today`,
      ),
  })
  const openOrdersQuery = useQuery({
    queryKey: ['orders', 'open', activeStore?.id],
    queryFn: () =>
      api<{ total: number }>(`/orders?status=open${activeStore ? `&store_id=${activeStore.id}` : ''}`),
  })
  const floorQuery = useQuery({
    queryKey: ['floor', activeStore?.id],
    queryFn: () => api<{ data: FloorTable[] }>(`/tables/floor${storeParam}`),
    enabled: !!activeStore && isRestaurant,
  })
  const ticketsQuery = useQuery({
    queryKey: ['tickets', 'hub'],
    queryFn: () => api<{ total: number }>('/kitchen/tickets?status=new,in_progress'),
    enabled: !!activeStore && isRestaurant && !printsTickets,
  })
  const shiftQuery = useQuery({
    queryKey: ['shift-current', activeStore?.id],
    queryFn: () =>
      api<{ shift: { opening_float: string } | null }>(
        `/shifts/current?store_id=${activeStore!.id}`,
      ),
    enabled: !!activeStore,
  })

  if (!session) return null
  const { user } = session

  const occupied = floorQuery.data?.data.filter((t) => t.order).length ?? 0
  const overAnHour = floorQuery.data?.data.filter((t) => (t.order?.minutes_open ?? 0) >= 60).length ?? 0
  const openOrders = openOrdersQuery.data?.total ?? 0
  const doneToday = Math.max(0, (summaryQuery.data?.order_count ?? 0))
  const waiting = ticketsQuery.data?.total ?? 0
  const shift = shiftQuery.data?.shift ?? null

  const SUBS: Record<string, string> = {
    register: 'Ring up a sale, take money',
    tables: occupied ? `${occupied} occupied · ${overAnHour} over an hour` : 'Seat guests, open tabs',
    orders: `${openOrders} open · ${doneToday} done today`,
    customers: 'Accounts, statements, credit',
    kitchen: waiting ? `${waiting} ticket${waiting === 1 ? '' : 's'} waiting` : 'Nothing waiting',
    catalog: 'Products, prices, offers',
    shifts: shift ? `Drawer open · float ${fmt(shift.opening_float)}` : 'Drawer closed',
    reports: "Today's numbers",
    staff: 'Waiters, cashiers, PINs',
    users: 'Logins and permissions',
    settings: 'Branch, tax, printing',
  }
  const COUNTS: Record<string, number> = { tables: occupied, orders: openOrders, kitchen: waiting }

  const tiles = TILES.filter(
    (t) =>
      t.roles.includes(user.role) &&
      (!t.restaurantOnly || isRestaurant) &&
      (!t.kdsOnly || !printsTickets),
  )

  const gross = summaryQuery.data ? fmt(summaryQuery.data.gross_sales) : '—'
  const orders = summaryQuery.data ? String(summaryQuery.data.order_count) : '—'

  return (
    <div className="hub">
      <div className="hub-content">
        <section className="hub-today">
          <div className="hub-today-head">
            <span className="hub-eyebrow">Today · so far</span>
            <span className="hub-shift-note">{shift ? 'Shift open' : 'No shift open'}</span>
          </div>
          <div className="hub-stats">
            <div className="hub-stat">
              <strong>{gross}</strong>
              <span>Gross sales · QAR</span>
            </div>
            <div className="hub-stat">
              <strong>{orders}</strong>
              <span>Orders</span>
            </div>
            {isRestaurant && (
              <div className="hub-stat">
                <strong>{occupied}</strong>
                <span>Tables open</span>
              </div>
            )}
          </div>
        </section>

        <div className="hub-tiles">
          {tiles.map((t) => {
            const count = COUNTS[t.key] ?? 0
            return (
              <button
                key={t.key}
                type="button"
                className={`hub-tile${t.denseBlocked ? ' dense-blocked' : ''}`}
                onClick={() => navigate(t.to)}
              >
                <span className={`hub-plate plate-${t.plate}`}>
                  <NavIcon name={t.icon} />
                </span>
                <span className="hub-tile-label">{t.label}</span>
                <span className="hub-tile-sub">{SUBS[t.key]}</span>
                {count > 0 && <span className="hub-count">{count}</span>}
              </button>
            )
          })}
        </div>

        <div className="hub-footer">
          <button type="button" className="hub-foot-btn" onClick={() => navigate('/pick-store?change=1')}>
            Change branch
          </button>
          <button
            type="button"
            className="hub-foot-btn danger"
            onClick={() => setConfirmingSignOut(true)}
          >
            Sign out
          </button>
        </div>
      </div>

      {confirmingSignOut && (
        <ConfirmDialog
          title="Sign out?"
          message={`This signs ${activeStore ? `the till at ${activeStore.name}` : 'this till'} out of the business. The next person signs the business in again and enters their PIN.`}
          confirmLabel="Sign out"
          danger
          onConfirm={signOut}
          onCancel={() => setConfirmingSignOut(false)}
        />
      )}
    </div>
  )
}
