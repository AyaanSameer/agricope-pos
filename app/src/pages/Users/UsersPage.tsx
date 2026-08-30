import { useState } from 'react'
import type { FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createUser, deleteUser, listUsers, listStores, updateUser } from '../../api/org'
import type { UserInput } from '../../api/org'
import type { Role, UserRecord } from '../../api/types'
import { ApiError } from '../../api/client'
import { useAuth } from '../../auth/AuthContext'
import { shortBranch } from '../../lib/branch'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import './users.css'

type Draft = UserInput & { id?: string }

function initials(name: string): string {
  const words = name.split(/\s+/).filter(Boolean)
  return (words.length > 1 ? words[0][0] + words[1][0] : name.slice(0, 2)).toUpperCase()
}

const EMPTY: Draft = { name: '', email: '', role: 'cashier', store_id: null, pin: '', is_active: true }

export function UsersPage() {
  const queryClient = useQueryClient()
  const { session } = useAuth()
  const isOwner = session?.user.role === 'owner'
  const usersQuery = useQuery({ queryKey: ['users'], queryFn: listUsers })
  const storesQuery = useQuery({ queryKey: ['stores'], queryFn: listStores })
  const [draft, setDraft] = useState<Draft | null>(null)
  const [deleting, setDeleting] = useState<UserRecord | null>(null)
  const [error, setError] = useState<string | null>(null)

  const remove = useMutation({
    mutationFn: (id: string) => deleteUser(id),
    onSuccess: () => {
      setDeleting(null)
      queryClient.invalidateQueries({ queryKey: ['users'] })
    },
    onError: (err) => {
      setDeleting(null)
      window.alert(err instanceof ApiError ? err.message : 'Could not delete — try again.')
    },
  })

  const save = useMutation({
    mutationFn: (d: Draft) => {
      const input: UserInput = {
        name: d.name,
        email: d.email,
        role: d.role,
        store_id: d.store_id,
        is_active: d.is_active,
        ...(d.pin ? { pin: d.pin } : {}),
      }
      return d.id ? updateUser(d.id, input) : createUser(input)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] })
      setDraft(null)
      setError(null)
    },
    onError: (err) =>
      setError(err instanceof ApiError ? err.message : 'Could not save — try again.'),
  })

  function edit(u: UserRecord) {
    setError(null)
    setDraft({ id: u.id, name: u.name, email: u.email, role: u.role, store_id: u.store_id, pin: '', is_active: u.is_active })
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (draft) save.mutate(draft)
  }

  const stores = storesQuery.data?.data ?? []

  return (
    <div className="page page-wide">
      <div className="users-top">
        <button type="button" className="btn-primary users-add" onClick={() => { setError(null); setDraft({ ...EMPTY }) }}>
          + Add user
        </button>
      </div>

      {/* Deleting a login is the owner's call — deactivating keeps them on past receipts. */}
      <div className="users-owner-note">
        <span className="users-owner-tag">Owner only</span>
        Only the owner can delete a login. Managers can deactivate, which keeps the person on past
        receipts.
      </div>

      <div className="users-table">
        <div className="users-row users-head-row">
          <span>Person</span>
          <span>Email</span>
          <span>Role</span>
          <span>Branch</span>
          <span>PIN</span>
          <span />
        </div>
        {usersQuery.isPending && <div className="users-loading">Loading…</div>}
        {usersQuery.data?.data.map((u) => (
          <div key={u.id} className={u.is_active ? 'users-row' : 'users-row inactive'}>
            <span className="users-person">
              <span className="users-avatar">{initials(u.name)}</span>
              <span className="users-name">{u.name}</span>
              {!u.is_active && <span className="users-off">Deactivated</span>}
            </span>
            <span className="users-email">{u.email}</span>
            <span>
              <span className={`users-role ${u.role}`}>{u.role}</span>
            </span>
            <span className="users-branch">{shortBranch(u.store_name) || 'All branches'}</span>
            <span className="users-pin">{u.has_pin ? '••••' : '—'}</span>
            <span className="users-actions">
              <button type="button" className="users-btn" onClick={() => edit(u)}>
                Edit
              </button>
              {isOwner && u.id !== session?.user.id && (
                <button
                  type="button"
                  className="users-btn danger"
                  disabled={remove.isPending}
                  onClick={() => setDeleting(u)}
                >
                  Delete
                </button>
              )}
            </span>
          </div>
        ))}
      </div>

      {draft && (
        <div className="users-modal" role="dialog" aria-modal="true">
          <form className="users-form card" onSubmit={onSubmit}>
            <div className="users-form-head">
              <div className="users-form-title">
                <h3>Till login</h3>
                <p>
                  The PIN is who this person is on the till.
                  {draft.id ? ' Leave it blank to keep the current one.' : ''}
                </p>
              </div>
              <button
                type="button"
                className="users-form-close"
                aria-label="Close"
                onClick={() => setDraft(null)}
              >
                ✕
              </button>
            </div>
            <label className="field">
              <span>Name</span>
              <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} required />
            </label>
            <label className="field">
              <span>Email</span>
              <input type="email" value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} required />
            </label>
            <label className="field">
              <span>Role</span>
              <select value={draft.role} onChange={(e) => setDraft({ ...draft, role: e.target.value as Role })}>
                <option value="cashier">Cashier</option>
                <option value="manager">Manager</option>
                <option value="waiter">Waiter</option>
                <option value="owner">Owner</option>
              </select>
            </label>
            <label className="field">
              <span>Branch</span>
              <select
                value={draft.store_id ?? ''}
                onChange={(e) => setDraft({ ...draft, store_id: e.target.value || null })}
              >
                <option value="">All branches</option>
                {stores.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Till PIN</span>
              <input
                inputMode="numeric"
                pattern="\d{4}"
                maxLength={4}
                placeholder="••••"
                value={draft.pin}
                onChange={(e) => setDraft({ ...draft, pin: e.target.value.replace(/\D/g, '') })}
              />
              <em className="field-hint">
                4 digits{draft.id ? ' — blank keeps the current PIN' : ''}
              </em>
            </label>
            <label className="users-check">
              <input
                type="checkbox"
                checked={draft.is_active}
                onChange={(e) => setDraft({ ...draft, is_active: e.target.checked })}
              />
              Active — can sign in
            </label>
            {error && <div className="users-error">{error}</div>}
            <div className="users-form-actions">
              <button type="button" className="btn-secondary" onClick={() => setDraft(null)}>
                Cancel
              </button>
              <button type="submit" className="btn-primary" disabled={save.isPending}>
                {save.isPending ? 'Saving…' : 'Save login'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Deleting a login is the owner's call, and it asks first. */}
      {deleting && (
        <ConfirmDialog
          title={`Delete ${deleting.name}?`}
          message="Their login and PIN stop working immediately. Past receipts and shifts keep their name — nothing already recorded changes."
          confirmLabel={remove.isPending ? 'Deleting…' : 'Delete login'}
          danger
          busy={remove.isPending}
          onConfirm={() => remove.mutate(deleting.id)}
          onCancel={() => setDeleting(null)}
        />
      )}
    </div>
  )
}
