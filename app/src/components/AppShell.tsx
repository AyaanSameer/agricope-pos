import { useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { Logomark } from './Logomark'
import { PinSwitchOverlay } from './PinSwitchOverlay'
import type { Role } from '../api/types'
import './shell.css'

interface NavEntry {
  label: string
  to: string | null // null = not built yet
  phase?: string
  roles: Role[]
}

/** Role-lean navigation: each role sees only what it needs. */
const NAV: NavEntry[] = [
  { label: 'Register', to: '/', roles: ['cashier', 'manager', 'owner'] },
  { label: 'Orders', to: '/orders', roles: ['cashier', 'manager', 'owner'] },
  { label: 'Customers', to: null, phase: 'P5', roles: ['cashier', 'manager', 'owner'] },
  { label: 'Catalog', to: '/catalog', roles: ['manager', 'owner'] },
  { label: 'Shifts', to: null, phase: 'P6', roles: ['cashier', 'manager', 'owner'] },
  { label: 'Reports', to: null, phase: 'P10', roles: ['manager', 'owner'] },
  { label: 'Users', to: '/users', roles: ['manager', 'owner'] },
]

export function AppShell() {
  const { session, activeStore, signOut } = useAuth()
  const [pinOpen, setPinOpen] = useState(false)
  if (!session) return null
  const { user } = session
  const nav = NAV.filter((n) => n.roles.includes(user.role))

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <Logomark size={30} />
          <span>Agricope</span>
        </div>
        <div className="sidebar-store">
          <span className="dot" />
          {activeStore ? activeStore.name : 'All stores · Owner view'}
        </div>
        <nav className="sidebar-nav">
          {nav.map((item) =>
            item.to ? (
              <NavLink
                key={item.label}
                to={item.to}
                end={item.to === '/'}
                className={({ isActive }) => (isActive ? 'nav-item active' : 'nav-item')}
              >
                <span className="nav-icon" />
                {item.label}
              </NavLink>
            ) : (
              <span key={item.label} className="nav-item disabled" title={`Coming in ${item.phase}`}>
                <span className="nav-icon" />
                {item.label}
                <span className="nav-phase">{item.phase}</span>
              </span>
            ),
          )}
        </nav>
        {activeStore && (
          <button type="button" className="sidebar-switch" onClick={() => setPinOpen(true)}>
            Switch cashier · PIN
          </button>
        )}
        <div className="sidebar-user">
          <div className="avatar">
            {user.name
              .split(' ')
              .map((w) => w[0])
              .slice(0, 2)
              .join('')}
          </div>
          <div className="sidebar-user-info">
            <div className="sidebar-user-name">{user.name}</div>
            <div className="sidebar-user-role">{user.role}</div>
          </div>
          <button type="button" className="sidebar-signout" onClick={signOut} title="Sign out">
            ⎋
          </button>
        </div>
      </aside>

      <main className="content">
        <Outlet />
      </main>

      {pinOpen && <PinSwitchOverlay onClose={() => setPinOpen(false)} />}
    </div>
  )
}
