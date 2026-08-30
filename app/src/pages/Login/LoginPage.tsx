import { useState } from 'react'
import type { FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation } from '@tanstack/react-query'
import { useAuth } from '../../auth/AuthContext'
import { ApiError } from '../../api/client'
import { Lockup, StackedLockup } from '../../components/Logomark'
import { useDevice } from '../../lib/useDevice'
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
  const { dense } = useDevice()
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

  const brandSub = isAdmin ? 'PLATFORM CONSOLE' : 'POINT OF SALE'
  const footer = '© 2026 Agricope · Doha, Qatar'

  return (
    <div className={isAdmin ? 'login login-admin' : 'login'}>
      {/* Roomy: the brand panel. Dense: the lockup stacks over the card instead. */}
      {!dense && (
        <aside className="login-brand">
          <span className="login-orb login-orb-1" aria-hidden="true" />
          <span className="login-orb login-orb-2" aria-hidden="true" />
          <div className="login-brand-lockup">
            <Lockup height="var(--login-lockup)" />
            <span className="login-brand-sub">{brandSub}</span>
          </div>
          <div className="login-brand-say">
            <h1 className="login-headline">
              Sell fast.
              <br />
              Track every riyal.
            </h1>
            <p className="login-blurb">
              One system for your shops and restaurants — sales, credit ledgers, shifts, kitchen and
              reports.
            </p>
          </div>
          <div className="login-footer">{footer}</div>
        </aside>
      )}

      <main className="login-side">
        {dense && (
          <div className="login-stack">
            <span className="login-orb login-orb-1" aria-hidden="true" />
            <StackedLockup height="var(--login-lockup)" />
            <span className="login-brand-sub">{brandSub}</span>
          </div>
        )}

        <form className="login-card" onSubmit={onSubmit}>
          <div className="login-card-head">
            {isAdmin && <span className="login-badge">Platform administrator</span>}
            <h2>{isAdmin ? 'Agricope Console' : 'Welcome back'}</h2>
            <p className="login-card-sub">
              {isAdmin ? 'Platform administration — not a till' : 'Sign in to your business'}
            </p>
          </div>

          <label className="field">
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
            {login.isPending ? 'Signing in…' : 'Sign in'}
          </button>

          {/* The till is already signed in as a business — skip straight to the PIN. */}
          {businessSession && (
            <button type="button" className="login-switch" onClick={() => navigate('/pick-store')}>
              Switch cashier with PIN
            </button>
          )}

          <p className="login-note">
            Login is per business, not per person. The PIN identifies who is on the till.
          </p>
        </form>

        {dense && <div className="login-stack-footer">{footer}</div>}
      </main>
    </div>
  )
}
