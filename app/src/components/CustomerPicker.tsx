import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { listCustomers } from '../api/customers'
import type { Customer } from '../api/customers'
import { fmt } from '../lib/money'
import './customerpicker.css'

export function CustomerPicker({
  onPick,
  onClose,
}: {
  onPick: (c: Customer | null) => void
  onClose: () => void
}) {
  const [search, setSearch] = useState('')
  const customersQuery = useQuery({
    queryKey: ['customers', search],
    queryFn: () => listCustomers(search || undefined),
  })

  return (
    <div className="cpick" role="dialog" aria-modal="true">
      <div className="cpick-card card">
        <h3>Attach customer</h3>
        <input
          autoFocus
          placeholder="Search name or phone…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="cpick-list">
          {customersQuery.data?.data.map((c) => (
            <button key={c.id} type="button" className="cpick-row" onClick={() => onPick(c)}>
              <span className="cpick-name">{c.name}</span>
              <span className="cpick-meta">
                {c.phone ?? '—'} ·{' '}
                {Number(c.balance) > 0 ? `owes ${fmt(c.balance)}` : 'settled'}
                {c.credit_limit === null ? ' · no credit' : ''}
              </span>
            </button>
          ))}
          {customersQuery.data?.data.length === 0 && (
            <div className="cpick-empty">Nobody matches — add customers on the Customers page.</div>
          )}
        </div>
        <div className="cpick-actions">
          <button type="button" className="btn-secondary" onClick={() => onPick(null)}>
            No customer
          </button>
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
