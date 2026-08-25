import { Navigate, Outlet, Route, Routes } from 'react-router-dom'
import type { ReactNode } from 'react'
import { useAuth } from './auth/AuthContext'
import { AppShell } from './components/AppShell'
import { LoginPage } from './pages/Login/LoginPage'
import { RegisterPage } from './pages/Register/RegisterPage'
import { PickStorePage } from './pages/PickStore/PickStorePage'
import { UsersPage } from './pages/Users/UsersPage'
import { CatalogPage } from './pages/Catalog/CatalogPage'
import { ChargePage } from './pages/Charge/ChargePage'
import { OrdersPage } from './pages/Orders/OrdersPage'
import { ReceiptPage, PublicReceiptPage } from './pages/Receipt/ReceiptPage'
import type { Role } from './api/types'

function RequireAuth() {
  const { session } = useAuth()
  if (!session) return <Navigate to="/login" replace />
  return <Outlet />
}

/** Server-side checks are the real security — this only keeps screens out of the wrong hands. */
function RequireRole({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const { session } = useAuth()
  if (!session || !roles.includes(session.user.role)) return <Navigate to="/" replace />
  return children
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/r/:token" element={<PublicReceiptPage />} />
      <Route element={<RequireAuth />}>
        <Route path="/pick-store" element={<PickStorePage />} />
        <Route element={<AppShell />}>
          <Route path="/" element={<RegisterPage />} />
          <Route path="/charge/:id" element={<ChargePage />} />
          <Route path="/orders" element={<OrdersPage />} />
          <Route path="/receipt/:id" element={<ReceiptPage />} />
          <Route
            path="/catalog"
            element={
              <RequireRole roles={['owner', 'manager']}>
                <CatalogPage />
              </RequireRole>
            }
          />
          <Route
            path="/users"
            element={
              <RequireRole roles={['owner', 'manager']}>
                <UsersPage />
              </RequireRole>
            }
          />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
