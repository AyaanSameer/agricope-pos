import { useState } from 'react'
import type { FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createUser, listUsers, listStores, updateUser } from '../../api/org'
import type { UserInput } from '../../api/org'
import type { Role, UserRecord } from '../../api/types'
import { ApiError } from '../../api/client'
import './users.css'

type Draft = UserInput & { id?: string }

const EMPTY: Draft = { name: '', email: '', role: 'cashier', store_id: null, pin: '', is_active: true }

export function UsersPage() {
  const queryClient = useQueryClient()
  const usersQuery = useQuery({ queryKey: ['users'], queryFn: listUsers })
  const storesQuery = useQuery({ queryKey: ['stores'], queryFn: listStores })
  const [draft, setDraft] = useState<Draft | null>(null)
  const [error, setError] = useState<string | null>(null)

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
    <div className="page">
      <div className="page-head">
        <div>
          <h2>Users</h2>
          <p className="page-sub">Staff logins, roles and till PINs · owner &amp; manager only</p>
        </div>
        <button type="button" className="btn-primary users-add" onClick={() => { setError(null); setDraft({ ...EMPTY }) }}>
          + Add user
        </button>
      </div>

      <div className="card users-table">
        <div className="users-row users-head-row">
          <span>Name</span><span>Email</span><span>Role</span><span>Store</span><span>PIN</span><span>Status</span><span />
        </div>
        {usersQuery.isPending && <div className="users-loading">Loading…</div>}
        {usersQuery.data?.data.map((u) => (
          <div key={u.id} className={u.is_active ? 'users-row' : 'users-row inactive'}>
            <span className="users-name">{u.name}</span>
            <span className="users-email">{u.email}</span>
            <span className="users-role">{u.role}</span>
            <span>{u.store_name ?? 'All stores'}</span>
            <span>{u.has_pin ? '••••' : '—'}</span>
            <span>
              <span className={u.is_active ? 'badge on' : 'badge off'}>
                {u.is_active ? 'Active' : 'Inactive'}
              </span>
            </span>
            <span>
              <button type="button" className="btn-secondary users-edit" onClick={() => edit(u)}>
                Edit
              </button>
            </span>
          </div>
        ))}
      </div>

      {draft && (
        <div className="users-modal" role="dialog" aria-modal="true">
          <form className="users-form card" onSubmit={onSubmit}>
            <h3>{draft.id ? 'Edit user' : 'New user'}</h3>
            <label className="field">
              <span>Name</span>
              <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} required />
            </label>
            <label className="field">
              <span>Email</span>
              <input type="email" value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} required />
            </label>
            <div className="users-form-row">
              <label className="field">
                <span>Role</span>
                <select value={draft.role} onChange={(e) => setDraft({ ...draft, role: e.target.value as Role })}>
                  <option value="cashier">Cashier</option>
                  <option value="manager">Manager</option>
                  <option value="owner">Owner</option>
                </select>
              </label>
              <label className="field">
                <span>Store</span>
                <select
                  value={draft.store_id ?? ''}
                  onChange={(e) => setDraft({ ...draft, store_id: e.target.value || null })}
                >
                  <option value="">All stores</option>
                  {stores.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </label>
            </div>
            <div className="users-form-row">
              <label className="field">
                <span>Till PIN (4 digits{draft.id ? ' — blank keeps current' : ''})</span>
                <input
                  inputMode="numeric"
                  pattern="\d{4}"
                  maxLength={4}
                  placeholder="••••"
                  value={draft.pin}
                  onChange={(e) => setDraft({ ...draft, pin: e.target.value.replace(/\D/g, '') })}
                />
              </label>
              <label className="field users-active">
                <span>Status</span>
                <label className="users-check">
                  <input
                    type="checkbox"
                    checked={draft.is_active}
                    onChange={(e) => setDraft({ ...draft, is_active: e.target.checked })}
                  />
                  Active — can sign in
                </label>
              </label>
            </div>
            {error && <div className="users-error">{error}</div>}
            <div className="users-form-actions">
              <button type="button" className="btn-secondary" onClick={() => setDraft(null)}>
                Cancel
              </button>
              <button type="submit" className="btn-primary" disabled={save.isPending}>
                {save.isPending ? 'Saving…' : 'Save user'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
