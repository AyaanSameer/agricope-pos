import { Link } from 'react-router-dom'
import { useAuth } from '../../auth/AuthContext'
import { Logomark } from '../../components/Logomark'
import './register.css'

/** Phase 3 builds the real register — this proves the till has the right store & person. */
export function RegisterPage() {
  const { session, activeStore } = useAuth()
  if (!session) return null
  const { user } = session

  if (!activeStore) {
    return (
      <div className="register-empty card">
        <Logomark size={56} variant="two-tone" />
        <h2>Pick a store to open a till</h2>
        <p>You work across all stores — the register always belongs to one.</p>
        <Link to="/pick-store" className="btn-primary register-pick">
          Choose store
        </Link>
      </div>
    )
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h2>Register — {activeStore.name}</h2>
          <p className="page-sub">
            Signed in as {user.name} · {user.role}
          </p>
        </div>
      </div>
      <div className="register-empty card">
        <Logomark size={56} variant="two-tone" />
        <h2>The register arrives in Phase 3</h2>
        <p>
          Phase 1 is done when the right person is on the right till: this screen knows its store
          ({activeStore.name}) and its cashier ({user.name}). Hand the till over any time with
          “Switch cashier · PIN”.
        </p>
      </div>
    </div>
  )
}
