import { useAuth } from '../../auth/AuthContext'
import { Logomark } from '../../components/Logomark'
import './home.css'

/**
 * Role-lean navigation: each role sees only what it needs. Placeholders until
 * their phases land — the list itself is the Phase 0 contract with the design.
 */
const NAV_BY_ROLE: Record<string, string[]> = {
  cashier: ['Register', 'Orders', 'Customers', 'Shifts'],
  manager: ['Register', 'Orders', 'Customers', 'Catalog', 'Shifts', 'Reports'],
  owner: ['Register', 'Orders', 'Customers', 'Catalog', 'Shifts', 'Reports', 'Settings'],
}

export function HomePage() {
  const { session, signOut } = useAuth()
  if (!session) return null
  const { user } = session
  const nav = NAV_BY_ROLE[user.role] ?? NAV_BY_ROLE.cashier

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <Logomark size={30} />
          <span>Agricope</span>
        </div>
        <div className="sidebar-store">
          <span className="dot" />
          {user.store_name ?? 'All stores · Owner view'}
        </div>
        <nav className="sidebar-nav">
          {nav.map((item, i) => (
            <button key={item} className={i === 0 ? 'nav-item active' : 'nav-item'} type="button">
              <span className="nav-icon" />
              {item}
            </button>
          ))}
        </nav>
        <div className="sidebar-user">
          <div className="avatar">
            {user.name
              .split(' ')
              .map((w) => w[0])
              .slice(0, 2)
              .join('')}
          </div>
          <div>
            <div className="sidebar-user-name">{user.name}</div>
            <div className="sidebar-user-role">{user.role}</div>
          </div>
        </div>
      </aside>

      <main className="content">
        <div className="empty-card">
          <Logomark size={56} variant="two-tone" />
          <h2>Phase 0 complete</h2>
          <p>
            You are signed in against the mock API. The register arrives in Phase 3 — until then,
            this shell proves auth, routing, theming and the API contract all work.
          </p>
          <button className="btn-secondary" type="button" onClick={signOut}>
            Sign out
          </button>
        </div>
      </main>
    </div>
  )
}
