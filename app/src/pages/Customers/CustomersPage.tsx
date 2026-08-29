import { useState } from 'react'
import type { FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import Big from 'big.js'
import {
  addRepayment,
  createCustomer,
  getStatement,
  listCustomers,
} from '../../api/customers'
import type { Customer } from '../../api/customers'
import { ApiError } from '../../api/client'
import { CreditLimitModal } from '../../components/CreditLimitModal'
import { useAuth } from '../../auth/AuthContext'
import { MoneyPad } from '../../components/MoneyPad'
import { fmt, fmtQAR } from '../../lib/money'
import './customers.css'

export function CustomersPage() {
  const { activeStore } = useAuth()
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [repaying, setRepaying] = useState(false)
  const [adding, setAdding] = useState(false)
  const [grantingCredit, setGrantingCredit] = useState(false)

  const customersQuery = useQuery({
    queryKey: ['customers', search],
    queryFn: () => listCustomers(search || undefined),
  })
  const statementQuery = useQuery({
    queryKey: ['statement', selectedId],
    queryFn: () => getStatement(selectedId!),
    enabled: !!selectedId,
  })

  const selected = statementQuery.data?.customer
  const limit = selected?.credit_limit ? new Big(selected.credit_limit) : null
  const balance = selected ? new Big(selected.balance) : null
  const available = limit && balance ? limit.minus(balance) : null

  return (
    <div className="page cust-page">
      <div className="page-head">
        <div>
          <h2>Customers</h2>
          <p className="page-sub">Credit ledgers — the statement explains every balance</p>
        </div>
        <button type="button" className="btn-primary cust-add" onClick={() => setAdding(true)}>
          + New customer
        </button>
      </div>

      <div className="cust-body">
        <div className="cust-list">
          <input
            placeholder="Search name or phone…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {customersQuery.data?.data.map((c) => (
            <button
              key={c.id}
              type="button"
              className={selectedId === c.id ? 'cust-row selected' : 'cust-row'}
              onClick={() => setSelectedId(c.id)}
            >
              <span className="cust-name">{c.name}</span>
              <span className="cust-phone">{c.phone ?? 'no phone'}</span>
              <span className="cust-row-foot">
                <span className={c.credit_limit === null ? 'cust-credit none' : 'cust-credit'}>
                  <em>{c.credit_limit === null ? 'No credit' : 'Credit'}</em>
                  {c.credit_limit !== null && <b>{fmt(c.credit_limit)}</b>}
                </span>
                <span className={Number(c.balance) > 0 ? 'cust-bal owes' : 'cust-bal'}>
                  {Number(c.balance) > 0 ? fmt(c.balance) : '—'}
                </span>
              </span>
            </button>
          ))}
          {customersQuery.data?.data.length === 0 && (
            <div className="cust-list-empty">
              <span>{search ? 'No customer matches that.' : 'No customers yet'}</span>
              <button type="button" className="cust-list-empty-add" onClick={() => setAdding(true)}>
                + New customer
              </button>
            </div>
          )}
        </div>

        {selected ? (
          <div className="cust-profile">
            <div className="cust-profile-head">
              <span className="cust-avatar">
                {selected.name
                  .split(' ')
                  .map((w) => w[0])
                  .slice(0, 2)
                  .join('')
                  .toUpperCase()}
              </span>
              <div>
                <h3>{selected.name}</h3>
                <p className="muted small">
                  {selected.phone ?? 'no phone'} {selected.email ? `· ${selected.email}` : ''}
                </p>
              </div>
            </div>

            <div className="cust-stats">
              <div className="stat">
                <span>Credit limit</span>
                <strong>{limit ? fmt(limit.toFixed(2)) : 'No credit'}</strong>
              </div>
              <div className={balance && balance.gt(0) ? 'stat owing' : 'stat'}>
                <span>Outstanding</span>
                <strong>{fmt(selected.balance)}</strong>
              </div>
              <div className={available ? 'stat available' : 'stat'}>
                <span>Available</span>
                <strong>{available ? fmt(available.toFixed(2)) : '—'}</strong>
              </div>
            </div>

            <div className="cust-actions">
              <button
                type="button"
                className="btn-primary cust-receive"
                disabled={!balance || balance.lte(0)}
                onClick={() => setRepaying(true)}
              >
                Receive payment
              </button>
              <button type="button" className="cust-limit" onClick={() => setGrantingCredit(true)}>
                {limit ? 'Change limit · PIN' : 'Give credit · PIN'}
              </button>
            </div>

            <div className="card cust-statement">
              <div className="cust-st-head">
                <span>Statement</span>
                <em>Append-only · nothing is edited in place</em>
              </div>
              {statementQuery.data?.entries.map((e) => (
                <div key={e.id} className="cust-st-row">
                  <span className="muted small">
                    {new Date(e.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}
                  </span>
                  <span className={`st-type ${e.entry_type}`}>{e.entry_type.toUpperCase()}</span>
                  <span className="cust-st-note">{e.note ?? (e.method ? `${e.method} received` : '—')}</span>
                  <span className={`num ${Number(e.amount) > 0 ? 'owes' : 'ok'}`}>
                    {Number(e.amount) > 0 ? '+' : ''}{fmt(e.amount)}
                  </span>
                  <span className="num strong">{fmt(e.balance)}</span>
                </div>
              ))}
              {statementQuery.data?.entries.length === 0 && (
                <div className="cust-st-empty">No credit history yet.</div>
              )}
            </div>
          </div>
        ) : (
          <div className="card cust-empty">Select a customer to see their statement.</div>
        )}
      </div>

      {grantingCredit && selected && (
        <CreditLimitModal
          customerId={selected.id}
          customerName={selected.name}
          currentLimit={selected.credit_limit}
          balance={selected.balance}
          suggested="0.00"
          onDone={() => {
            setGrantingCredit(false)
            queryClient.invalidateQueries({ queryKey: ['statement'] })
            queryClient.invalidateQueries({ queryKey: ['customers'] })
          }}
          onClose={() => setGrantingCredit(false)}
        />
      )}

      {repaying && selected && (
        <RepaymentModal
          customer={selected}
          storeId={activeStore?.id}
          onDone={() => {
            setRepaying(false)
            queryClient.invalidateQueries({ queryKey: ['statement'] })
            queryClient.invalidateQueries({ queryKey: ['customers'] })
          }}
          onClose={() => setRepaying(false)}
        />
      )}
      {adding && (
        <NewCustomerModal
          onDone={() => {
            setAdding(false)
            queryClient.invalidateQueries({ queryKey: ['customers'] })
          }}
          onClose={() => setAdding(false)}
        />
      )}
    </div>
  )
}

function RepaymentModal({
  customer,
  storeId,
  onDone,
  onClose,
}: {
  customer: Customer
  storeId?: string
  onDone: () => void
  onClose: () => void
}) {
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState<'cash' | 'card' | 'online'>('cash')
  const [error, setError] = useState<string | null>(null)

  const repay = useMutation({
    mutationFn: () =>
      addRepayment(customer.id, {
        amount,
        method,
        store_id: storeId,
        note: `${method} received`,
      }),
    onSuccess: onDone,
    onError: (err) =>
      setError(err instanceof ApiError ? err.message : 'Could not record — try again.'),
  })

  function onKey(k: string) {
    setAmount((prev) => {
      if (k === '⌫') return prev.slice(0, -1)
      if (k === '.') return prev.includes('.') ? prev : (prev || '0') + '.'
      const next = prev + k
      const [, dec] = next.split('.')
      if (dec && dec.length > 2) return prev
      return next
    })
  }

  return (
    <div className="cust-modal" role="dialog" aria-modal="true">
      <div className="card cust-repay">
        <h3>Receive payment</h3>
        <p className="muted small">
          {customer.name} · balance {fmtQAR(customer.balance)}
        </p>
        <div className="cust-repay-amount">
          <span>Amount</span>
          <strong>{amount ? `QAR ${amount}` : 'QAR 0.00'}</strong>
        </div>
        <div className="cust-repay-chips">
          <button type="button" className="chip" onClick={() => setAmount(customer.balance)}>
            Full · {fmt(customer.balance)}
          </button>
          {['100', '250', '500'].map((v) => (
            <button key={v} type="button" className="chip" onClick={() => setAmount(v)}>{v}</button>
          ))}
        </div>
        <div className="cust-repay-methods">
          {(['cash', 'card', 'online'] as const).map((m) => (
            <button
              key={m}
              type="button"
              className={method === m ? 'method active' : 'method'}
              onClick={() => setMethod(m)}
            >
              {m[0].toUpperCase() + m.slice(1)}
            </button>
          ))}
        </div>
        <MoneyPad onKey={onKey} disabled={repay.isPending} />
        {error && <div className="cust-error">{error}</div>}
        <button
          type="button"
          className="btn-primary"
          disabled={!amount || Number(amount) <= 0 || repay.isPending}
          onClick={() => repay.mutate()}
        >
          {repay.isPending ? 'Recording…' : `Record repayment${amount ? ` · QAR ${amount}` : ''}`}
        </button>
        <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
        <p className="muted tiny">Cash repayments go into the drawer — they need an open shift. A receipt prints for every repayment.</p>
      </div>
    </div>
  )
}

function NewCustomerModal({ onDone, onClose }: { onDone: () => void; onClose: () => void }) {
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(null)

  // A customer is a CRM record first. Credit is granted afterwards from the
  // profile, because it needs a manager's PIN.
  const create = useMutation({
    mutationFn: () =>
      createCustomer({ name, phone: phone || null, email: email || null }),
    onSuccess: onDone,
    onError: (err) =>
      setError(err instanceof ApiError ? err.message : 'Could not save — try again.'),
  })

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    create.mutate()
  }

  return (
    <div className="cust-modal" role="dialog" aria-modal="true">
      <form className="card cust-new" onSubmit={onSubmit}>
        <h3>New customer</h3>
        <label className="field"><span>Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
        </label>
        <label className="field"><span>Phone</span>
          <input value={phone} onChange={(e) => setPhone(e.target.value)} />
        </label>
        <label className="field"><span>Email</span>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <p className="muted tiny">
          Credit is granted from the customer's profile — it needs a manager PIN.
        </p>
        {error && <div className="cust-error">{error}</div>}
        <div className="cust-new-actions">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={create.isPending}>Save</button>
        </div>
      </form>
    </div>
  )
}
