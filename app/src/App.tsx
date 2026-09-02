import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom'
import type { ReactNode } from 'react'
import { useAuth } from './auth/AuthContext'
import { AppShell } from './components/AppShell'
import { HubPage } from './pages/Hub/HubPage'
import { TooSmallPage } from './pages/TooSmall/TooSmallPage'
import { useDevice } from './lib/useDevice'
import { useDocumentTitle } from './lib/useDocumentTitle'
import { LoginPage } from './pages/Login/LoginPage'
import { RegisterPage } from './pages/Register/RegisterPage'
import { PickStorePage } from './pages/PickStore/PickStorePage'
import { UsersPage } from './pages/Users/UsersPage'
import { CatalogPage } from './pages/Catalog/CatalogPage'
import { ChargePage } from './pages/Charge/ChargePage'
import { OrdersPage } from './pages/Orders/OrdersPage'
import { ReceiptPage, PublicReceiptPage } from './pages/Receipt/ReceiptPage'
import { CustomersPage } from './pages/Customers/CustomersPage'
import { ShiftsPage } from './pages/Shifts/ShiftsPage'
import { FloorPage } from './pages/Floor/FloorPage'
import { TabPage } from './pages/Tab/TabPage'
import { KdsPage } from './pages/Kds/KdsPage'
import { ReportsPage } from './pages/Reports/ReportsPage'
import { StaffPage } from './pages/Staff/StaffPage'
import { SettingsPage } from './pages/Settings/SettingsPage'
import { AdminPage } from './pages/Admin/AdminPage'
import type { Role } from './api/types'

function RequireAuth() {
  const { adminSession, businessSession, session } = useAuth()
  if (!session) {
    // Admins have no till — they belong on the console.
    if (adminSession) return <Navigate to="/admin" replace />
    // Business signed in but nobody identified yet → the branch/PIN screen.
    return <Navigate to={businessSession ? '/pick-store' : '/login'} replace />
  }
  return <Outlet />
}

/** The branch/PIN screen needs a business, not a person. */
function RequireBusiness() {
  const { businessSession } = useAuth()
  if (!businessSession) return <Navigate to="/login" replace />
  return <Outlet />
}

/** The platform console — Agricope staff only. */
function RequireAdmin() {
  const { adminSession } = useAuth()
  if (!adminSession) return <Navigate to="/login" replace />
  return <Outlet />
}


/**
 * A till screen belongs to one branch. Reached without one — from the back
 * office, say — it sends the person to the branch picker and comes back here
 * once they have picked and identified themselves.
 */
function RequireBranch({ children }: { children: ReactNode }) {
  const { activeStore } = useAuth()
  const { pathname, search } = useLocation()
  if (!activeStore) {
    return (
      <Navigate
        to={`/pick-store?change=1&next=${encodeURIComponent(pathname + search)}`}
        replace
      />
    )
  }
  return children
}

/** Kitchen and Catalog need a canvas — a phone gets told so instead. */
function RequireCanvas({ screen, children }: { screen: string; children: ReactNode }) {
  const { phone } = useDevice()
  if (phone) return <TooSmallPage screen={screen} />
  return children
}

/** Server-side checks are the real security — this only keeps screens out of the wrong hands. */
function RequireRole({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const { session } = useAuth()
  if (!session || !roles.includes(session.user.role)) return <Navigate to="/" replace />
  return children
}

export default function App() {
  useDocumentTitle()
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/r/:token" element={<PublicReceiptPage />} />
      <Route element={<RequireBusiness />}>
        <Route path="/pick-store" element={<PickStorePage />} />
      </Route>
      <Route element={<RequireAdmin />}>
        <Route path="/admin" element={<AdminPage />} />
      </Route>
      <Route element={<RequireAuth />}>
        <Route element={<AppShell />}>
          <Route path="/" element={<HubPage />} />
          <Route path="/register" element={<RequireBranch><RegisterPage /></RequireBranch>} />
          <Route path="/charge/:id" element={<RequireBranch><ChargePage /></RequireBranch>} />
          <Route path="/orders" element={<OrdersPage />} />
          <Route path="/receipt/:id" element={<ReceiptPage />} />
          <Route path="/customers" element={<CustomersPage />} />
          <Route path="/shifts" element={<RequireBranch><ShiftsPage /></RequireBranch>} />
          <Route path="/floor" element={<RequireBranch><FloorPage /></RequireBranch>} />
          <Route path="/tab/:id" element={<RequireBranch><TabPage /></RequireBranch>} />
          <Route
            path="/kds"
            element={
              <RequireBranch>
                <RequireCanvas screen="Kitchen">
                  <KdsPage />
                </RequireCanvas>
              </RequireBranch>
            }
          />
          <Route
            path="/reports"
            element={
              <RequireRole roles={['owner', 'manager']}>
                <ReportsPage />
              </RequireRole>
            }
          />
          <Route
            path="/catalog"
            element={
              <RequireRole roles={['owner', 'manager']}>
                <RequireCanvas screen="Catalog">
                  <CatalogPage />
                </RequireCanvas>
              </RequireRole>
            }
          />
          <Route
            path="/users"
            element={
              <RequireRole roles={['owner']}>
                <UsersPage />
              </RequireRole>
            }
          />
          <Route
            path="/staff"
            element={
              <RequireRole roles={['owner', 'manager']}>
                <StaffPage />
              </RequireRole>
            }
          />
          <Route
            path="/settings"
            element={
              <RequireRole roles={['owner']}>
                <SettingsPage />
              </RequireRole>
            }
          />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
