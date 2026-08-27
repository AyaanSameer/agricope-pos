import { useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { listStores } from '../api/org'
import { useAuth } from '../auth/AuthContext'
import { Logomark } from './Logomark'
import { NavIcon } from './NavIcon'
import type { NavIconName } from './NavIcon'
import { PinSwitchOverlay } from './PinSwitchOverlay'
import { ConfirmDialog } from './ConfirmDialog'
import type { Role } from '../api/types'
import './shell.css'

interface NavEntry {
  label: string
  icon: NavIconName
  to: string
  roles: Role[]
  restaurantOnly?: boolean
  /** hidden when the branch prints kitchen tickets instead of running a KDS */
  kdsOnly?: boolean
}

interface NavGroup {
  /** quiet label above the group — SELL / MANAGE / ADMIN */
  label: string
  items: NavEntry[]
}

/** Role-lean navigation, grouped by what the item is *for* rather than one flat list. */
const NAV: NavGroup[] = [
  {
    label: 'Sell',
    items: [
      { label: 'Register', icon: 'register', to: '/', roles: ['cashier', 'manager', 'owner'] },
      { label: 'Tables', icon: 'tables', to: '/floor', roles: ['cashier', 'manager', 'owner'], restaurantOnly: true },
      { label: 'Orders', icon: 'orders', to: '/orders', roles: ['cashier', 'manager', 'owner'] },
      { label: 'Customers', icon: 'customers', to: '/customers', roles: ['cashier', 'manager', 'owner'] },
      { label: 'Kitchen', icon: 'kitchen', to: '/kds', roles: ['cashier', 'manager', 'owner'], restaurantOnly: true, kdsOnly: true },
    ],
  },
  {
    label: 'Manage',
    items: [
      { label: 'Catalog', icon: 'catalog', to: '/catalog', roles: ['manager', 'owner'] },
      { label: 'Shifts', icon: 'shifts', to: '/shifts', roles: ['cashier', 'manager', 'owner'] },
      { label: 'Reports', icon: 'reports', to: '/reports', roles: ['manager', 'owner'] },
      { label: 'Staff', icon: 'staff', to: '/staff', roles: ['manager', 'owner'] },
    ],
  },
  {
    label: 'Admin',
    items: [
      { label: 'Users', icon: 'users', to: '/users', roles: ['manager', 'owner'] },
      { label: 'Settings', icon: 'settings', to: '/settings', roles: ['manager', 'owner'] },
    ],
  },
]

export function AppShell() {
  const { session, activeStore, signOut } = useAuth()
  const [pinOpen, setPinOpen] = useState(false)
  const [confirmingLogout, setConfirmingLogout] = useState(false)
  const storesQuery = useQuery({ queryKey: ['stores'], queryFn: listStores, enabled: !!session })
  if (!session) return null
  const { user } = session
  const store = storesQuery.data?.data.find((s) => s.id === activeStore?.id)
  const isRestaurant = store?.type === 'restaurant'
  const printsTickets = store?.kitchen_mode === 'printer'
  const groups = NAV.map((group) => ({
    ...group,
    items: group.items.filter(
      (n) =>
        n.roles.includes(user.role) &&
        (!n.restaurantOnly || isRestaurant) &&
        (!n.kdsOnly || !printsTickets),
    ),
  })).filter((group) => group.items.length > 0)

  const initials = user.name
    .split(' ')
    .map((w) => w[0])
    .slice(0, 2)
    .join('')

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <Logomark size={30} />
          <span>Agricope</span>
        </div>
        <div className="sidebar-store">
          <span className="dot" />
          {activeStore ? activeStore.name : 'All stores · Back office'}
        </div>
        <nav className="sidebar-nav">
          {groups.map((group) => (
            <div key={group.label} className="nav-group">
              <div className="nav-group-label">{group.label}</div>
              {group.items.map((item) => (
                <NavLink
                  key={item.label}
                  to={item.to}
                  end={item.to === '/'}
                  className={({ isActive }) => (isActive ? 'nav-item active' : 'nav-item')}
                >
                  <NavIcon name={item.icon} />
                  {item.label}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
        {activeStore && (
          <button type="button" className="sidebar-switch" onClick={() => setPinOpen(true)}>
            Switch user · PIN
          </button>
        )}
        <div className="sidebar-user">
          <div className="avatar">{initials}</div>
          <div className="sidebar-user-info">
            <div className="sidebar-user-name">{user.name}</div>
            <div className="sidebar-user-role">{user.role}</div>
          </div>
          <button
            type="button"
            className="sidebar-signout"
            onClick={() => setConfirmingLogout(true)}
            title="Log out"
          >
            ⎋
          </button>
        </div>
      </aside>

      <main className="content">
        <Outlet />
      </main>

      {pinOpen && <PinSwitchOverlay onClose={() => setPinOpen(false)} />}

      {confirmingLogout && (
        <ConfirmDialog
          title="Log out?"
          message={`This signs ${activeStore ? `the till at ${activeStore.name}` : 'this till'} out of the business. The next person signs the business in again and enters their PIN.`}
          confirmLabel="Log out"
          onConfirm={signOut}
          onCancel={() => setConfirmingLogout(false)}
        />
      )}
    </div>
  )
}
