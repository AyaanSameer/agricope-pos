import { useState } from 'react'
import type { FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation } from '@tanstack/react-query'
import { useAuth } from '../../auth/AuthContext'
import { ApiError } from '../../api/client'
import { Logomark } from '../../components/Logomark'
import './login.css'

/**
 * Presentation only — the server still decides who is a platform admin. This
 * just lets the form say so before you press the button, so nobody types a
 * console password into what looks like a shop's till login.
 */
function looksLikePlatformAdmin(email: string) {
  const local = email.trim().toLowerCase().split('@')[0] ?? ''
  return local === 'admin' || local.startsWith('admin.') || local.startsWith('admin+')
}

export function LoginPage() {
  const { signIn, businessSession } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const isAdmin = looksLikePlatformAdmin(email)

  const login = useMutation({
    mutationFn: () => signIn(email, password),
    onSuccess: (kind) => {
      // Admins land on the console; a business picks its branch, then a PIN.
      navigate(kind === 'admin' ? '/admin' : '/pick-store', { replace: true })
    },
  })

  const errorMessage =
    login.error instanceof ApiError
      ? login.error.message
      : login.error
        ? 'Something went wrong. Check your connection and try again.'
        : null

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    login.mutate()
  }

  return (
    <div className={isAdmin ? 'login login-admin' : 'login'}>
      <aside className="login-brand">
        <div className="login-brand-lockup">
          <Logomark size={44} />
          <div>
            <div className="login-brand-name">AGRICOPE</div>
            <div className="login-brand-sub">{isAdmin ? 'PLATFORM CONSOLE' : 'POINT OF SALE'}</div>
          </div>
        </div>
        <div>
          {isAdmin ? (
            <>
              <h1 className="login-headline">
                Every business.
                <br />
                One console.
              </h1>
              <p className="login-blurb">
                Add businesses, open their branches, and hand each owner the login that runs their
                tills.
              </p>
            </>
          ) : (
            <>
              <h1 className="login-headline">
                Sell fast.
                <br />
                Track every riyal.
              </h1>
              <p className="login-blurb">
                One system for your shops and restaurants — sales, credit ledgers, shifts, kitchen
                and reports.
              </p>
            </>
          )}
        </div>
        <div className="login-footer">© 2026 Agricope · Doha, Qatar</div>
      </aside>

      <main className="login-side">
        <form className="login-card" onSubmit={onSubmit}>
          {isAdmin && <div className="login-badge">Platform administrator</div>}

          <div>
            <h2>{isAdmin ? 'Agricope Console' : 'Welcome back'}</h2>
            <p className="login-card-sub">
              {isAdmin
                ? 'This account manages every business on the platform — not a single till.'
                : 'Sign in with your business account — the till asks for a PIN next'}
            </p>
          </div>

          <label className={isAdmin ? 'field field-recognised' : 'field'}>
            <span>Email</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              required
            />
          </label>

          <label className="field">
            <span>Password</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </label>

          {errorMessage && <div className="login-error">{errorMessage}</div>}

          <button className="btn-primary login-submit" type="submit" disabled={login.isPending}>
            {login.isPending ? 'Signing in…' : isAdmin ? 'Open the console' : 'Sign in'}
          </button>

          {/* The till is already signed in as a business — skip straight to the PIN. */}
          {!isAdmin && businessSession && (
            <button
              type="button"
              className="login-switch"
              onClick={() => navigate('/pick-store')}
            >
              Switch cashier with PIN
            </button>
          )}

          {isAdmin ? (
            <div className="login-staff-warning">
              Staff access · actions here affect every tenant
            </div>
          ) : (
            <>
              <div className="login-demo">
                <span className="login-demo-tag">Demo</span>
                <code>demo@agricope.qa · drumsticks@agricope.qa · demo123</code>
              </div>
              <p className="login-note">
                Login is per business, not per person. The PIN identifies who is on the till.
              </p>
              <button
                type="button"
                className="login-admin-link"
                onClick={() => setEmail('admin@agricope.qa')}
              >
                Use platform administrator credentials →
              </button>
            </>
          )}
        </form>
      </main>
    </div>
  )
}
