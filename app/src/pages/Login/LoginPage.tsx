import { useState } from 'react'
import type { FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation } from '@tanstack/react-query'
import { useAuth } from '../../auth/AuthContext'
import { ApiError } from '../../api/client'
import { Logomark } from '../../components/Logomark'
import './login.css'

export function LoginPage() {
  const { signIn } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  const login = useMutation({
    mutationFn: () => signIn(email, password),
    onSuccess: () => navigate('/', { replace: true }),
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
    <div className="login">
      <aside className="login-brand">
        <div className="login-brand-lockup">
          <Logomark size={44} />
          <div>
            <div className="login-brand-name">AGRICOPE</div>
            <div className="login-brand-sub">POINT OF SALE</div>
          </div>
        </div>
        <div>
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
        <div className="login-footer">© 2026 Agricope · Doha, Qatar</div>
      </aside>

      <main className="login-side">
        <form className="login-card" onSubmit={onSubmit}>
          <div>
            <h2>Welcome back</h2>
            <p className="login-card-sub">Sign in to open your store</p>
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

          <button className="btn-primary" type="submit" disabled={login.isPending}>
            {login.isPending ? 'Signing in…' : 'Sign in'}
          </button>

          <div className="login-hint">
            Demo: sara@alrayyan-market.qa · owner@agricope.qa — password demo123
          </div>
        </form>
        <div className="login-version">Agricope POS v0.1 · Phase 0</div>
      </main>
    </div>
  )
}
