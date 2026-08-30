import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import Big from 'big.js'
import { createCustomer, listCustomers } from '../api/customers'
import type { Customer } from '../api/customers'
import { ApiError } from '../api/client'
import { fmt } from '../lib/money'
import './customerpicker.css'

/** What the till needs to know at a glance: can this account carry the sale. */
function creditLine(c: Customer): string {
  if (c.credit_limit === null) return 'no credit facility'
  const available = new Big(c.credit_limit).minus(c.balance)
  return `credit ${fmt((available.lt(0) ? new Big(0) : available).toFixed(2))} available`
}

/** A search that is all digits is a phone being typed, not a name. */
function looksLikePhone(text: string): boolean {
  const trimmed = text.trim()
  return trimmed.length > 0 && /^[\d+][\d\s+-]*$/.test(trimmed)
}

export function CustomerPicker({
  onPick,
  onClose,
}: {
  onPick: (c: Customer | null) => void
  onClose: () => void
}) {
  const [search, setSearch] = useState('')
  const [creating, setCreating] = useState(false)
  const customersQuery = useQuery({
    queryKey: ['customers', search],
    queryFn: () => listCustomers(search || undefined),
  })

  // The design gives this overlay no Cancel — the scrim and Escape are the way
  // back out, and "No customer" is the way to clear one that is attached.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const rows = customersQuery.data?.data ?? []

  return (
    <div
      className="cpick"
      role="dialog"
      aria-modal="true"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      {creating ? (
        <NewCustomerForm
          search={search}
          onCancel={() => setCreating(false)}
          onCreated={onPick}
        />
      ) : (
        <div className="cpick-card card">
          <div className="cpick-head">
            <h3>Customer</h3>
            <button type="button" className="cpick-new" onClick={() => setCreating(true)}>
              + New customer
            </button>
          </div>

          <div className="cpick-search">
            <span aria-hidden="true">⌕</span>
            <input
              autoFocus
              placeholder="Search name or phone…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <div className="cpick-list">
            {rows.map((c) => (
              <button key={c.id} type="button" className="cpick-row" onClick={() => onPick(c)}>
                <span className="cpick-name">{c.name}</span>
                <span className="cpick-meta">
                  {c.phone ?? 'no phone'} · {creditLine(c)}
                </span>
              </button>
            ))}
            {rows.length === 0 && !customersQuery.isPending && (
              <div className="cpick-empty">
                <p>{search ? `Nobody matches “${search}”.` : 'No customers yet.'}</p>
                <button type="button" className="cpick-empty-new" onClick={() => setCreating(true)}>
                  + Add {search ? 'them' : 'the first one'}
                </button>
              </div>
            )}
          </div>

          <button type="button" className="cpick-none" onClick={() => onPick(null)}>
            No customer
          </button>
        </div>
      )}
    </div>
  )
}

/**
 * Adding a customer without leaving the sale. Credit is not granted here —
 * that still needs a manager PIN on the customer's profile — so this is the
 * same three fields the Customers page asks for.
 */
function NewCustomerForm({
  search,
  onCancel,
  onCreated,
}: {
  search: string
  onCancel: () => void
  onCreated: (c: Customer) => void
}) {
  const phoneSearch = looksLikePhone(search)
  const [name, setName] = useState(phoneSearch ? '' : search)
  const [phone, setPhone] = useState(phoneSearch ? search.trim() : '')
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(null)

  // Created from the till means wanted on this sale — attach, don't just save.
  const create = useMutation({
    mutationFn: () => createCustomer({ name, phone: phone || null, email: email || null }),
    onSuccess: onCreated,
    onError: (err) =>
      setError(err instanceof ApiError ? err.message : 'Could not save — try again.'),
  })

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    create.mutate()
  }

  return (
    <form className="cpick-card card" onSubmit={onSubmit}>
      <div className="cpick-head">
        <button type="button" className="cpick-back" onClick={onCancel}>
          ←
        </button>
        <h3>New customer</h3>
      </div>

      <label className="field">
        <span>Name</span>
        <input value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
      </label>
      <label className="field">
        <span>Phone</span>
        <input value={phone} onChange={(e) => setPhone(e.target.value)} />
      </label>
      <label className="field">
        <span>Email</span>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      </label>

      <p className="cpick-note">
        Credit is granted from the customer's profile — it needs a manager PIN.
      </p>
      {error && <div className="cpick-error">{error}</div>}

      <div className="cpick-form-actions">
        <button type="button" className="btn-secondary" onClick={onCancel}>
          Back
        </button>
        <button type="submit" className="btn-primary" disabled={create.isPending}>
          {create.isPending ? 'Saving…' : 'Save and attach'}
        </button>
      </div>
    </form>
  )
}
