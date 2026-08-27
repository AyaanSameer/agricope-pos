import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import Big from 'big.js'
import { addPayment, attachCustomer, getOrder } from '../../api/orders'
import type { PaymentMethod } from '../../api/orders'
import { ApiError } from '../../api/client'
import { MoneyPad } from '../../components/MoneyPad'
import { CustomerPicker } from '../../components/CustomerPicker'
import { DiscountModal } from '../../components/DiscountModal'
import { CreditLimitModal } from '../../components/CreditLimitModal'
import { fmt, fmtQAR } from '../../lib/money'
import './charge.css'

const METHODS: { key: PaymentMethod; label: string }[] = [
  { key: 'cash', label: 'Cash' },
  { key: 'card', label: 'Card' },
  { key: 'online', label: 'Online' },
  { key: 'credit', label: 'Credit' },
]

export function ChargePage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [method, setMethod] = useState<PaymentMethod>('cash')
  const [entry, setEntry] = useState('') // cash: tendered · others: amount
  const [reference, setReference] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pickingCustomer, setPickingCustomer] = useState(false)
  const [discounting, setDiscounting] = useState(false)
  const [settingLimit, setSettingLimit] = useState(false)

  const orderQuery = useQuery({
    queryKey: ['order', id],
    queryFn: () => getOrder(id!),
    enabled: !!id,
  })
  const order = orderQuery.data

  useEffect(() => {
    setEntry('')
    setError(null)
  }, [method])

  const pay = useMutation({
    mutationFn: () => {
      const due = new Big(order!.amount_due)
      if (method === 'cash') {
        const tendered = entry ? new Big(entry) : due
        const amount = tendered.gte(due) ? due : tendered
        return addPayment(order!.id, {
          method,
          amount: amount.toFixed(2),
          tendered: tendered.toFixed(2),
        })
      }
      const amount = entry ? new Big(entry) : due
      return addPayment(order!.id, {
        method,
        amount: amount.toFixed(2),
        reference: reference || undefined,
      })
    },
    onSuccess: (updated) => {
      queryClient.setQueryData(['order', id], updated)
      queryClient.invalidateQueries({ queryKey: ['orders'] })
      setEntry('')
      setReference('')
      setError(null)
    },
    onError: (err) =>
      setError(err instanceof ApiError ? err.message : 'Payment failed — try again.'),
  })

  const attach = useMutation({
    mutationFn: (customerId: string | null) => attachCustomer(order!.id, customerId),
    onSuccess: (updated) => queryClient.setQueryData(['order', id], updated),
  })

  function onKey(k: string) {
    setEntry((prev) => {
      if (k === '⌫') return prev.slice(0, -1)
      if (k === '.') return prev.includes('.') ? prev : (prev || '0') + '.'
      const next = prev + k
      const [, dec] = next.split('.')
      if (dec && dec.length > 2) return prev
      return next
    })
  }

  if (orderQuery.isPending) return <div className="charge-note">Loading order…</div>
  if (!order) return <div className="charge-note">Order not found.</div>

  const due = new Big(order.amount_due)
  const entered = entry ? new Big(entry || '0') : null
  const change =
    method === 'cash' && entered && entered.gt(due) ? entered.minus(due).toFixed(2) : null

  if (order.status === 'completed') {
    const lastCash = [...order.payments].reverse().find((p) => p.method === 'cash' && p.change_given)
    return (
      <div className="charge-done card">
        <div className="charge-done-check">✓</div>
        <h2>Paid — {fmtQAR(order.total)}</h2>
        <p className="charge-done-num">{order.order_number}</p>
        {lastCash?.change_given && Number(lastCash.change_given) > 0 && (
          <div className="charge-change">
            Change due <strong>{fmtQAR(lastCash.change_given)}</strong>
          </div>
        )}
        <div className="charge-done-actions">
          <Link className="btn-primary charge-newsale" to="/">New sale</Link>
          <Link className="btn-secondary charge-receipt" to={`/receipt/${order.id}`}>
            Receipt
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="charge">
      <aside className="charge-summary card">
        <div className="charge-sum-head">
          <h3>{order.order_number}</h3>
          <span className="badge-open">{order.status.toUpperCase()}</span>
        </div>
        {order.items.map((i) => (
          <div key={i.id} className="charge-sum-line">
            <span>
                {i.quantity} × {i.product_name}
                {i.options.length > 0 && (
                  <span className="muted small"> — {i.options.join(' · ')}</span>
                )}
              </span>
            <span>{fmt(i.line_total)}</span>
          </div>
        ))}
        <div className="charge-sum-sep" />
        <div className="charge-sum-line muted"><span>Subtotal</span><span>{fmt(order.subtotal)}</span></div>
        {Number(order.discount_total) > 0 && (
          <div className="charge-sum-line muted"><span>Discount</span><span>−{fmt(order.discount_total)}</span></div>
        )}
        {Number(order.service_charge_total) > 0 && (
          <div className="charge-sum-line muted"><span>Service charge</span><span>{fmt(order.service_charge_total)}</span></div>
        )}
        <div className="charge-sum-line muted"><span>Incl. tax</span><span>{fmt(order.tax_total)}</span></div>
        <div className="charge-sum-total"><span>Total</span><span>{fmtQAR(order.total)}</span></div>
        {order.payments.length > 0 && (
          <>
            <div className="charge-sum-sep" />
            <div className="charge-paid-label">PAYMENTS</div>
            {order.payments.map((p) => (
              <div key={p.id} className="charge-paid">
                <span>{p.method}{p.reference ? ` · ${p.reference}` : ''}</span>
                <span>{fmt(p.amount)}</span>
              </div>
            ))}
          </>
        )}
        <div className="charge-due">
          <span>Remaining due</span>
          <span>{fmtQAR(order.amount_due)}</span>
        </div>
        <button type="button" className="charge-cust" onClick={() => setPickingCustomer(true)}>
          {order.customer_name ? `Customer: ${order.customer_name}` : '+ Attach customer'}
        </button>
        <button
          type="button"
          className="charge-cust"
          disabled={order.payments.length > 0}
          onClick={() => setDiscounting(true)}
        >
          {order.discount_type
            ? `Discount: ${order.discount_type === 'percent' ? `${Number(order.discount_value)}%` : `QAR ${order.discount_value}`} — tap to change`
            : '% Order discount'}
        </button>
      </aside>

      <div className="charge-pay card">
        <div className="charge-pay-head">
          <h3>Take payment</h3>
          <button type="button" className="charge-back" onClick={() => navigate('/')}>✕</button>
        </div>
        <div className="charge-methods">
          {METHODS.map((m) => (
            <button
              key={m.key}
              type="button"
              className={method === m.key ? 'method active' : 'method'}
              onClick={() => setMethod(m.key)}
            >
              {m.label}
            </button>
          ))}
        </div>

        {method === 'credit' && (
          <div className="charge-credit">
            {!order.customer_id ? (
              <>
                <span>Credit needs a customer on the order.</span>
                <button type="button" className="charge-credit-act" onClick={() => setPickingCustomer(true)}>
                  Attach customer
                </button>
              </>
            ) : order.customer_credit_limit === null ? (
              <>
                <span>{order.customer_name} has no credit facility.</span>
                <button type="button" className="charge-credit-act" onClick={() => setSettingLimit(true)}>
                  Give credit…
                </button>
              </>
            ) : (
              <>
                <span>
                  Limit {fmtQAR(order.customer_credit_limit)} · owes{' '}
                  {fmtQAR(order.customer_balance ?? '0')} · available{' '}
                  {fmtQAR(
                    new Big(order.customer_credit_limit)
                      .minus(order.customer_balance ?? '0')
                      .toFixed(2),
                  )}
                </span>
                <button type="button" className="charge-credit-act" onClick={() => setSettingLimit(true)}>
                  Raise limit…
                </button>
              </>
            )}
          </div>
        )}

        <div className="charge-amount">
          <span>{method === 'cash' ? 'Tendered' : 'Amount'}</span>
          <strong>{entry ? `QAR ${entry}` : fmtQAR(order.amount_due)}</strong>
        </div>
        {change && (
          <div className="charge-changerow">
            <span>Change due</span>
            <strong>{fmtQAR(change)}</strong>
          </div>
        )}

        {(method === 'card' || method === 'online') && (
          <input
            className="charge-ref"
            placeholder={method === 'card' ? 'Card reference (last 4)' : 'Transfer / gateway reference'}
            value={reference}
            onChange={(e) => setReference(e.target.value)}
          />
        )}

        <div className="charge-chips">
          <button type="button" className="chip" onClick={() => setEntry('')}>
            Exact · {fmt(order.amount_due)}
          </button>
          {['50', '100', '200', '500'].map((v) => (
            <button key={v} type="button" className="chip" onClick={() => setEntry(v)}>
              {v}
            </button>
          ))}
        </div>

        <MoneyPad onKey={onKey} disabled={pay.isPending} />

        {error && (
          <div className="charge-error">
            {error}
            {method === 'credit' && order.customer_id && (
              <button
                type="button"
                className="charge-credit-act"
                onClick={() => setSettingLimit(true)}
              >
                Raise the limit…
              </button>
            )}
          </div>
        )}

        <button
          type="button"
          className="btn-primary charge-record"
          disabled={pay.isPending || (entered !== null && entered.lte(0))}
          onClick={() => pay.mutate()}
        >
          {pay.isPending
            ? 'Recording…'
            : `Record ${method} payment · ${fmtQAR(
                method === 'cash'
                  ? (entered && entered.lt(due) ? entered.toFixed(2) : due.toFixed(2))
                  : (entered ?? due).toFixed(2),
              )}`}
        </button>
        <p className="charge-note-sub">
          Order completes automatically when payments cover the total — split freely.
        </p>
      </div>

      {discounting && <DiscountModal order={order} onClose={() => setDiscounting(false)} />}

      {settingLimit && order.customer_id && (
        <CreditLimitModal
          customerId={order.customer_id}
          customerName={order.customer_name ?? 'this customer'}
          currentLimit={order.customer_credit_limit}
          balance={order.customer_balance ?? '0.00'}
          suggested={order.amount_due}
          onDone={() => {
            setSettingLimit(false)
            setError(null)
            queryClient.invalidateQueries({ queryKey: ['order', id] })
            queryClient.invalidateQueries({ queryKey: ['customers'] })
          }}
          onClose={() => setSettingLimit(false)}
        />
      )}
      {pickingCustomer && (
        <CustomerPicker
          onPick={(c) => {
            attach.mutate(c?.id ?? null)
            setPickingCustomer(false)
          }}
          onClose={() => setPickingCustomer(false)}
        />
      )}
    </div>
  )
}
