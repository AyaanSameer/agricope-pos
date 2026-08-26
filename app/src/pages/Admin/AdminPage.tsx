import { useState } from 'react'
import type { FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createBranch, createBusiness, createOwner, listBusinesses } from '../../api/admin'
import type { AdminBusiness } from '../../api/admin'
import { ApiError } from '../../api/client'
import { useAuth } from '../../auth/AuthContext'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { Logomark } from '../../components/Logomark'
import './admin.css'

/**
 * The Agricope console — platform staff only. Every business running the POS,
 * its branches and owners; onboarding happens here: create the business, add
 * its branches, hand the first owner login over.
 */

type Modal =
  | { kind: 'business' }
  | { kind: 'branch'; business: AdminBusiness }
  | { kind: 'owner'; business: AdminBusiness }
  | null

export function AdminPage() {
  const { adminSession, signOut } = useAuth()
  const queryClient = useQueryClient()
  const [modal, setModal] = useState<Modal>(null)
  const [confirmingLogout, setConfirmingLogout] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // shared form fields — reset whenever a modal opens
  const [f1, setF1] = useState('') // name
  const [f2, setF2] = useState('') // email / address
  const [f3, setF3] = useState('') // password / pin
  const [branchType, setBranchType] = useState<'retail' | 'restaurant'>('restaurant')

  const businessesQuery = useQuery({ queryKey: ['admin-businesses'], queryFn: listBusinesses })

  const done = () => {
    queryClient.invalidateQueries({ queryKey: ['admin-businesses'] })
    setModal(null)
    setError(null)
  }
  const fail = (err: unknown) =>
    setError(err instanceof ApiError ? err.message : 'Could not save — try again.')

  const addBusiness = useMutation({
    mutationFn: () => createBusiness({ name: f1, email: f2, password: f3 }),
    onSuccess: done,
    onError: fail,
  })
  const addBranch = useMutation({
    mutationFn: (b: AdminBusiness) =>
      createBranch(b.id, { name: f1, type: branchType, address: f2 || undefined }),
    onSuccess: done,
    onError: fail,
  })
  const addOwner = useMutation({
    mutationFn: (b: AdminBusiness) =>
      createOwner(b.id, { name: f1, email: f2, ...(f3 ? { pin: f3 } : {}) }),
    onSuccess: done,
    onError: fail,
  })

  function open(next: Exclude<Modal, null>) {
    setF1('')
    setF2('')
    setF3('')
    setBranchType('restaurant')
    setError(null)
    setModal(next)
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (!modal) return
    if (modal.kind === 'business') addBusiness.mutate()
    else if (modal.kind === 'branch') addBranch.mutate(modal.business)
    else addOwner.mutate(modal.business)
  }

  const busy = addBusiness.isPending || addBranch.isPending || addOwner.isPending
  const businesses = businessesQuery.data?.data ?? []

  if (!adminSession) return null

  return (
    <div className="admin">
      <header className="admin-bar">
        <div className="admin-brand">
          <Logomark size={28} />
          <span>Agricope Console</span>
          <span className="admin-tag">platform admin</span>
        </div>
        <div className="admin-bar-right">
          <span className="admin-who">{adminSession.admin.name}</span>
          <button type="button" className="btn-secondary" onClick={() => setConfirmingLogout(true)}>
            Log out
          </button>
        </div>
      </header>

      <main className="admin-main">
        <div className="page-head">
          <div>
            <h2>Businesses on the platform</h2>
            <p className="page-sub">
              {businesses.length} business{businesses.length === 1 ? '' : 'es'} ·{' '}
              {businesses.reduce((a, b) => a + b.stores.length, 0)} branches running the POS
            </p>
          </div>
          <button type="button" className="btn-primary" onClick={() => open({ kind: 'business' })}>
            + Add business
          </button>
        </div>

        {businessesQuery.isPending && <div className="admin-loading">Loading…</div>}

        <div className="admin-grid">
          {businesses.map((b) => (
            <div key={b.id} className="card admin-biz">
              <div className="admin-biz-head">
                <div>
                  <div className="admin-biz-name">{b.name}</div>
                  <div className="admin-biz-login">Login: {b.email}</div>
                </div>
                <div className="admin-biz-stats">
                  {b.user_count} users · {b.product_count} products
                </div>
              </div>

              <div className="admin-section">
                <div className="admin-section-head">
                  <span>Branches</span>
                  <button type="button" className="chip dashed" onClick={() => open({ kind: 'branch', business: b })}>
                    + Add branch
                  </button>
                </div>
                {b.stores.length === 0 && <div className="admin-empty">No branches yet.</div>}
                {b.stores.map((s) => (
                  <div key={s.id} className="admin-row">
                    <span className={`pickstore-type ${s.type}`}>
                      {s.type === 'retail' ? 'Retail' : 'Restaurant'}
                    </span>
                    <span className="admin-row-name">{s.name}</span>
                    <span className="admin-row-sub">{s.address ?? '—'}</span>
                  </div>
                ))}
              </div>

              <div className="admin-section">
                <div className="admin-section-head">
                  <span>Owner logins</span>
                  <button type="button" className="chip dashed" onClick={() => open({ kind: 'owner', business: b })}>
                    + Create owner
                  </button>
                </div>
                {b.owners.length === 0 && (
                  <div className="admin-empty">No owner yet — create one so they can sign in.</div>
                )}
                {b.owners.map((o) => (
                  <div key={o.id} className="admin-row">
                    <span className="admin-row-name">{o.name}</span>
                    <span className="admin-row-sub">{o.email}</span>
                    <span className="admin-row-pin">{o.has_pin ? 'PIN set' : 'no PIN yet'}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </main>

      {modal && (
        <div className="admin-modal" role="dialog" aria-modal="true">
          <form className="admin-form card" onSubmit={onSubmit}>
            {modal.kind === 'business' && (
              <>
                <h3>New business</h3>
                <label className="field">
                  <span>Business name</span>
                  <input value={f1} onChange={(e) => setF1(e.target.value)} required autoFocus />
                </label>
                <label className="field">
                  <span>Login email (one login for all branches)</span>
                  <input type="email" value={f2} onChange={(e) => setF2(e.target.value)} required />
                </label>
                <label className="field">
                  <span>Password</span>
                  <input type="text" value={f3} onChange={(e) => setF3(e.target.value)} required />
                </label>
                <p className="admin-note">
                  Next: add its branches and create an owner login so they can run their tills.
                </p>
              </>
            )}
            {modal.kind === 'branch' && (
              <>
                <h3>New branch — {modal.business.name}</h3>
                <label className="field">
                  <span>Branch name</span>
                  <input value={f1} onChange={(e) => setF1(e.target.value)} required autoFocus />
                </label>
                <div className="admin-form-row">
                  <label className="field">
                    <span>Type</span>
                    <select value={branchType} onChange={(e) => setBranchType(e.target.value as 'retail' | 'restaurant')}>
                      <option value="restaurant">Restaurant</option>
                      <option value="retail">Retail</option>
                    </select>
                  </label>
                  <label className="field">
                    <span>Address (optional)</span>
                    <input value={f2} onChange={(e) => setF2(e.target.value)} />
                  </label>
                </div>
              </>
            )}
            {modal.kind === 'owner' && (
              <>
                <h3>Owner login — {modal.business.name}</h3>
                <label className="field">
                  <span>Name</span>
                  <input value={f1} onChange={(e) => setF1(e.target.value)} required autoFocus />
                </label>
                <label className="field">
                  <span>Contact email</span>
                  <input type="email" value={f2} onChange={(e) => setF2(e.target.value)} required />
                </label>
                <label className="field">
                  <span>Till PIN (4 digits — how they sign in on the till)</span>
                  <input
                    inputMode="numeric"
                    pattern="\d{4}"
                    maxLength={4}
                    placeholder="••••"
                    value={f3}
                    onChange={(e) => setF3(e.target.value.replace(/\D/g, ''))}
                  />
                </label>
              </>
            )}
            {error && <div className="admin-error">{error}</div>}
            <div className="admin-form-actions">
              <button type="button" className="btn-secondary" onClick={() => setModal(null)}>
                Cancel
              </button>
              <button type="submit" className="btn-primary" disabled={busy}>
                {busy ? 'Saving…' : 'Save'}
              </button>
            </div>
          </form>
        </div>
      )}

      {confirmingLogout && (
        <ConfirmDialog
          title="Log out?"
          message="This signs the Agricope console out on this device."
          confirmLabel="Log out"
          onConfirm={signOut}
          onCancel={() => setConfirmingLogout(false)}
        />
      )}
    </div>
  )
}
