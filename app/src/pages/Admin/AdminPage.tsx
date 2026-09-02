import { useState } from 'react'
import type { FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  changeAdminPassword,
  createBranch,
  createBusiness,
  createOwner,
  deleteBranch,
  deleteBusiness,
  listBusinesses,
  setBusinessActive,
  updateBranch,
  updateBusinessLogin,
} from '../../api/admin'
import type { AdminBusiness } from '../../api/admin'
import type { Store } from '../../api/types'
import { ApiError } from '../../api/client'
import { useAuth } from '../../auth/AuthContext'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { Logomark } from '../../components/Logomark'
import { shortBranch } from '../../lib/branch'
import './admin.css'

/**
 * The Agricope console — platform staff only. Every business running the POS,
 * its branches and owners; onboarding happens here: create the business, add
 * its branches, hand the first owner login over.
 */

/** Tenant monograms — a stable colour per business so cards are tellable apart. */
const MONOGRAM_TONES = ['green', 'orange', 'gold'] as const

function monogram(name: string): string {
  const words = name.split(/\s+/).filter(Boolean)
  const letters = words.length > 1 ? words[0][0] + words[1][0] : name.slice(0, 2)
  return letters.toUpperCase()
}

type Modal =
  | { kind: 'business' }
  | { kind: 'branch'; business: AdminBusiness }
  | { kind: 'owner'; business: AdminBusiness }
  | { kind: 'login'; business: AdminBusiness }
  | { kind: 'password' }
  | null

/** Destructive steps always pass through a confirm that names the consequence. */
type Confirming =
  | { kind: 'delete-business'; business: AdminBusiness }
  | { kind: 'delete-branch'; business: AdminBusiness; store: Store }
  | null

export function AdminPage() {
  const { adminSession, signOut } = useAuth()
  const queryClient = useQueryClient()
  const [modal, setModal] = useState<Modal>(null)
  const [confirmingLogout, setConfirmingLogout] = useState(false)
  const [confirming, setConfirming] = useState<Confirming>(null)
  const [eraseTyped, setEraseTyped] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

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
  const editLogin = useMutation({
    mutationFn: (b: AdminBusiness) =>
      updateBusinessLogin(b.id, { email: f2, ...(f3 ? { password: f3 } : {}) }),
    onSuccess: done,
    onError: fail,
  })
  const ownPassword = useMutation({
    mutationFn: () => changeAdminPassword(f2, f3),
    onSuccess: () => {
      done()
      setNotice('Your console password has been changed.')
    },
    onError: fail,
  })

  /* ---- lifecycle: suspend is reversible, delete is not ------------------- */

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['admin-businesses'] })
    setConfirming(null)
    setError(null)
  }
  const lifecycleFail = (err: unknown) => {
    setConfirming(null)
    setError(err instanceof ApiError ? err.message : 'Could not do that — try again.')
  }

  const suspendBusiness = useMutation({
    mutationFn: ({ b, active }: { b: AdminBusiness; active: boolean }) =>
      setBusinessActive(b.id, active),
    onSuccess: refresh,
    onError: lifecycleFail,
  })
  const removeBusiness = useMutation({
    mutationFn: (b: AdminBusiness) => deleteBusiness(b.id),
    onSuccess: () => {
      refresh()
      setNotice('Business deleted.')
    },
    onError: lifecycleFail,
  })
  const suspendBranch = useMutation({
    mutationFn: ({ b, s, active }: { b: AdminBusiness; s: Store; active: boolean }) =>
      updateBranch(b.id, s.id, { is_active: active }),
    onSuccess: refresh,
    onError: lifecycleFail,
  })
  const removeBranch = useMutation({
    mutationFn: ({ b, s }: { b: AdminBusiness; s: Store }) => deleteBranch(b.id, s.id),
    onSuccess: () => {
      refresh()
      setNotice('Branch deleted.')
    },
    onError: lifecycleFail,
  })

  function open(next: Exclude<Modal, null>) {
    setF1('')
    // Editing a login starts from the current email; everything else starts blank.
    setF2(next.kind === 'login' ? next.business.email : '')
    setF3('')
    setNotice(null)
    setBranchType('restaurant')
    setError(null)
    setModal(next)
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (!modal) return
    if (modal.kind === 'business') addBusiness.mutate()
    else if (modal.kind === 'branch') addBranch.mutate(modal.business)
    else if (modal.kind === 'login') editLogin.mutate(modal.business)
    else if (modal.kind === 'password') ownPassword.mutate()
    else addOwner.mutate(modal.business)
  }

  const busy =
    addBusiness.isPending ||
    addBranch.isPending ||
    addOwner.isPending ||
    editLogin.isPending ||
    ownPassword.isPending
  const businesses = businessesQuery.data?.data ?? []
  const awaitingOwner = businesses.filter((b) => b.owners.length === 0).length

  if (!adminSession) return null

  return (
    <div className="admin">
      <header className="admin-bar">
        <div className="admin-brand">
          <Logomark size={28} />
          <span>Agricope Console</span>
          <span className="admin-tag">Platform admin</span>
        </div>
        <div className="admin-bar-right">
          <span className="admin-who">{adminSession.admin.name}</span>
          <button type="button" className="btn-secondary" onClick={() => open({ kind: 'password' })}>
            Change password
          </button>
          <button type="button" className="btn-secondary" onClick={() => setConfirmingLogout(true)}>
            Log out
          </button>
        </div>
      </header>

      <main className="admin-main">
        {/* No topbar up here, so the console states its own subject. */}
        <div className="admin-head">
          <div className="admin-head-say">
            <h1>Businesses on the platform</h1>
            <p>Every tenant running the POS, their branches and their owner logins</p>
          </div>
          <button type="button" className="btn-primary" onClick={() => open({ kind: 'business' })}>
            + Add business
          </button>
        </div>

        {/* Platform health at a glance — the one number that blocks a tenant is
            orange, card border and all. */}
        <div className="admin-stats">
          <div className="admin-stat">
            <span>Businesses</span>
            <strong>{businesses.length}</strong>
          </div>
          <div className="admin-stat">
            <span>Branches live</span>
            <strong>{businesses.reduce((a, b) => a + b.stores.length, 0)}</strong>
          </div>
          <div className="admin-stat">
            <span>Till logins</span>
            <strong>{businesses.reduce((a, b) => a + b.user_count, 0)}</strong>
          </div>
          <div className="admin-stat">
            <span>Products catalogued</span>
            <strong>{businesses.reduce((a, b) => a + b.product_count, 0)}</strong>
          </div>
          <div className={awaitingOwner > 0 ? 'admin-stat blocked' : 'admin-stat'}>
            <span>Awaiting an owner</span>
            <strong>{awaitingOwner}</strong>
          </div>
        </div>

        {notice && <div className="admin-notice">{notice}</div>}
        {error && !modal && <div className="admin-error admin-error-page">{error}</div>}

        {businessesQuery.isPending && <div className="admin-loading">Loading…</div>}

        <div className="admin-grid">
          {businesses.map((b, i) => (
            <div key={b.id} className={b.is_active ? 'admin-biz' : 'admin-biz suspended'}>
              <div className="admin-biz-head">
                <span className={`admin-mono ${MONOGRAM_TONES[i % MONOGRAM_TONES.length]}`}>
                  {monogram(b.name)}
                </span>
                <div className="admin-biz-id">
                  <div className="admin-biz-name">
                    {b.name}
                    {!b.is_active && <span className="admin-suspended-tag">Suspended</span>}
                  </div>
                  <div className="admin-biz-login">
                    Login · {b.email}
                    <button
                      type="button"
                      className="admin-action"
                      onClick={() => open({ kind: 'login', business: b })}
                    >
                      Edit
                    </button>
                  </div>
                </div>
              </div>

              <div className="admin-counts">
                <span className="admin-count">
                  {b.user_count} user{b.user_count === 1 ? '' : 's'}
                </span>
                <span className="admin-count">
                  {b.product_count} product{b.product_count === 1 ? '' : 's'}
                </span>
                <span className="admin-count">
                  {b.stores.length} branch{b.stores.length === 1 ? '' : 'es'}
                </span>
              </div>

              <div className="admin-section">
                <div className="admin-section-head">
                  <span className="admin-section-label">Branches</span>
                  <span className="admin-rule" />
                  <button
                    type="button"
                    className="admin-action"
                    onClick={() => open({ kind: 'branch', business: b })}
                  >
                    + Add branch
                  </button>
                </div>
                {b.stores.length === 0 && (
                  <div className="admin-empty">No branches yet — add the first one.</div>
                )}
                {b.stores.map((s) => (
                  <div key={s.id} className={s.is_active ? 'admin-row' : 'admin-row off'}>
                    <span className={`admin-type ${s.type}`}>
                      {s.type === 'retail' ? 'Retail' : 'Restaurant'}
                    </span>
                    {/* The business name is on the card already — drop its prefix. */}
                    <span className="admin-row-name">{shortBranch(s.name)}</span>
                    <span className="admin-row-sub">
                      {s.is_active ? (s.address ?? '—') : 'Deactivated'}
                    </span>
                    <span className="admin-row-actions">
                      <button
                        type="button"
                        className="admin-action"
                        disabled={suspendBranch.isPending}
                        onClick={() =>
                          suspendBranch.mutate({ b, s, active: !s.is_active })
                        }
                      >
                        {s.is_active ? 'Deactivate' : 'Restore'}
                      </button>
                      {/* Deletion only becomes offerable once the branch is off. */}
                      {!s.is_active && (
                        <button
                          type="button"
                          className="admin-action danger"
                          onClick={() => setConfirming({ kind: 'delete-branch', business: b, store: s })}
                        >
                          Delete
                        </button>
                      )}
                    </span>
                  </div>
                ))}
              </div>

              <div className="admin-section">
                <div className="admin-section-head">
                  <span className="admin-section-label">Owner logins</span>
                  <span className="admin-rule" />
                  <button
                    type="button"
                    className="admin-action"
                    onClick={() => open({ kind: 'owner', business: b })}
                  >
                    + Create owner
                  </button>
                </div>
                {b.owners.map((o) => (
                  <div key={o.id} className="admin-row">
                    <span className="admin-avatar">{monogram(o.name)}</span>
                    <div className="admin-row-id">
                      <span className="admin-row-name">{o.name}</span>
                      <span className="admin-row-sub">{o.email}</span>
                    </div>
                    <span className={o.has_pin ? 'admin-pin set' : 'admin-pin'}>
                      {o.has_pin ? 'PIN set' : 'No PIN yet'}
                    </span>
                  </div>
                ))}
                {/* Say what is blocked, not just what is missing. */}
                {b.owners.length === 0 && (
                  <div className="admin-blocked">
                    No owner yet — this business cannot sign in until you create one.
                  </div>
                )}
              </div>

              {/* Suspend is the reversible step and always available; delete only
                  appears once suspended, so it can never be a single mis-click. */}
              <div className="admin-biz-foot">
                <button
                  type="button"
                  className="admin-action"
                  disabled={suspendBusiness.isPending}
                  onClick={() => suspendBusiness.mutate({ b, active: !b.is_active })}
                >
                  {b.is_active ? 'Suspend business' : 'Restore business'}
                </button>
                {!b.is_active && (
                  <button
                    type="button"
                    className="admin-action danger"
                    onClick={() => {
                      setEraseTyped('')
                      setConfirming({ kind: 'delete-business', business: b })
                    }}
                  >
                    Delete permanently
                  </button>
                )}
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
            {modal.kind === 'password' && (
              <>
                <h3>Change your console password</h3>
                <p className="admin-note">
                  This is the platform administrator sign-in — it is not tied to any business.
                </p>
                <label className="field">
                  <span>Current password</span>
                  <input
                    type="password"
                    autoComplete="current-password"
                    value={f2}
                    onChange={(e) => setF2(e.target.value)}
                    required
                    autoFocus
                  />
                </label>
                <label className="field">
                  <span>New password (at least 8 characters)</span>
                  <input
                    type="password"
                    autoComplete="new-password"
                    minLength={8}
                    value={f3}
                    onChange={(e) => setF3(e.target.value)}
                    required
                  />
                </label>
              </>
            )}
            {modal.kind === 'login' && (
              <>
                <h3>Sign-in — {modal.business.name}</h3>
                <label className="field">
                  <span>Login email (one login for all branches)</span>
                  <input type="email" value={f2} onChange={(e) => setF2(e.target.value)} required autoFocus />
                </label>
                <label className="field">
                  <span>New password</span>
                  <input
                    type="text"
                    value={f3}
                    onChange={(e) => setF3(e.target.value)}
                    placeholder="Leave blank to keep the current password"
                    minLength={8}
                  />
                </label>
                <p className="admin-note">
                  Takes effect on this business's next sign-in — every till uses this one login.
                </p>
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

      {confirming?.kind === 'delete-business' && (
        <div className="admin-modal" role="dialog" aria-modal="true">
          <form
            className="admin-form card"
            onSubmit={(e) => {
              e.preventDefault()
              if (eraseTyped.trim() === confirming.business.name) removeBusiness.mutate(confirming.business)
            }}
          >
            <h3>Delete {confirming.business.name}?</h3>
            <p className="admin-note">
              Everything this business owns is erased, permanently and immediately. There is no
              undo and no backup on this side of the deletion.
            </p>
            {/* Say what goes, item by item — a count is harder to wave away than a warning. */}
            <ul className="admin-erase-list">
              <li>
                <strong>{confirming.business.order_count}</strong> order
                {confirming.business.order_count === 1 ? '' : 's'} — every receipt, payment and
                refund on record
              </li>
              <li>
                <strong>{confirming.business.stores.length}</strong> branch
                {confirming.business.stores.length === 1 ? '' : 'es'}, with their tables, kitchen
                stations and shift history
              </li>
              <li>
                <strong>{confirming.business.product_count}</strong> product
                {confirming.business.product_count === 1 ? '' : 's'} and every category
              </li>
              <li>
                <strong>{confirming.business.user_count}</strong> login
                {confirming.business.user_count === 1 ? '' : 's'}, plus all staff and attendance
              </li>
              <li>Every customer, their credit limits and the whole ledger of what they owe</li>
            </ul>
            <label className="field">
              <span>
                Type <strong>{confirming.business.name}</strong> to confirm
              </span>
              <input
                value={eraseTyped}
                autoFocus
                autoComplete="off"
                onChange={(e) => setEraseTyped(e.target.value)}
              />
            </label>
            {error && <div className="admin-error">{error}</div>}
            <div className="admin-form-actions">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => {
                  setConfirming(null)
                  setEraseTyped('')
                }}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="btn-primary admin-erase-go"
                disabled={removeBusiness.isPending || eraseTyped.trim() !== confirming.business.name}
              >
                {removeBusiness.isPending ? 'Deleting…' : 'Delete everything'}
              </button>
            </div>
          </form>
        </div>
      )}

      {confirming?.kind === 'delete-branch' && (
        <ConfirmDialog
          title={`Delete ${shortBranch(confirming.store.name)}?`}
          message="Removes the branch, its tables and its kitchen stations. A branch that has taken orders keeps its history and will refuse to be deleted."
          confirmLabel={removeBranch.isPending ? 'Deleting…' : 'Delete branch'}
          danger
          onConfirm={() =>
            removeBranch.mutate({ b: confirming.business, s: confirming.store })
          }
          onCancel={() => setConfirming(null)}
        />
      )}

      {confirmingLogout && (
        <ConfirmDialog
          title="Log out?"
          message="This signs the Agricope console out on this device."
          confirmLabel="Log out"
          danger
          onConfirm={signOut}
          onCancel={() => setConfirmingLogout(false)}
        />
      )}
    </div>
  )
}
