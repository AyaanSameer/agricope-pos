import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import Big from 'big.js'
import { addPayment, attachCustomer, getOrder } from '../../api/orders'
import type { OrderType, PaymentMethod } from '../../api/orders'
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

const TYPE_LABEL: Record<OrderType, string> = {
  counter: 'Counter',
  dine_in: 'Dine-in',
  takeaway: 'Takeaway',
  delivery: 'Online',
}

export function ChargePage() {
  const { id } = useParams<{ id: string }>()
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

  const paidSum = order.payments.reduce((a, p) => a.plus(p.amount), new Big(0))
  const paid = order.status === 'completed'
  // Once money is on the order the discount is settled — it may not move.
  const discountLocked = order.payments.length > 0
  const lastCash = [...order.payments].reverse().find((p) => p.method === 'cash' && p.change_given)
  const changeGiven =
    lastCash?.change_given && Number(lastCash.change_given) > 0 ? lastCash.change_given : null

  return (
    <div className="charge">
      {/* Left: what is owed, what it is for, what has been taken. */}
      <div className="charge-side">
        <div className="charge-due">
          <span className="charge-due-eyebrow">Remaining due</span>
          <span className="charge-due-amount">{fmtQAR(order.amount_due)}</span>
          <span className="charge-due-paid">
            {order.payments.length > 0
              ? `${fmtQAR(paidSum.toFixed(2))} of ${fmtQAR(order.total)} taken`
              : `Nothing paid yet · ${TYPE_LABEL[order.order_type]}`}
          </span>
        </div>

        <div className="charge-order">
          <div className="charge-order-head">
            <span className="charge-order-num">Order {order.order_number}</span>
            <span className="charge-order-type">{TYPE_LABEL[order.order_type]}</span>
          </div>
          <div className="charge-order-lines">
            {order.items.map((i) => (
              <div key={i.id} className="charge-order-line">
                <span className="charge-order-qty">×{Number(i.quantity)}</span>
                <span className="charge-order-name">
                  {i.product_name}
                  {i.options.length > 0 && (
                    <span className="charge-order-opts"> — {i.options.join(' · ')}</span>
                  )}
                </span>
                <span className="charge-order-total">{fmt(i.line_total)}</span>
              </div>
            ))}
          </div>
          <div className="charge-order-sep" />
          <div className="charge-order-totals">
            <div className="charge-trow"><span>Subtotal</span><span>{fmt(order.subtotal)}</span></div>
            {Number(order.discount_total) > 0 && (
              <div className="charge-trow"><span>Discount</span><span>−{fmt(order.discount_total)}</span></div>
            )}
            {Number(order.service_charge_total) > 0 && (
              <div className="charge-trow"><span>Service charge</span><span>{fmt(order.service_charge_total)}</span></div>
            )}
            <div className="charge-trow"><span>Incl. tax</span><span>{fmt(order.tax_total)}</span></div>
            <div className="charge-trow charge-trow-total"><span>Total</span><span>{fmtQAR(order.total)}</span></div>
          </div>
        </div>

        <div className="charge-acts">
          <button type="button" className="charge-dashed" onClick={() => setPickingCustomer(true)}>
            {order.customer_name ? `${order.customer_name} · tap to change` : '+ Attach a customer'}
          </button>
          <button
            type="button"
            className="charge-dashed charge-dashed-plain"
            disabled={discountLocked}
            onClick={() => setDiscounting(true)}
          >
            {discountLocked
              ? '% Order discount — locked once paid'
              : order.discount_type
                ? `Discount: ${order.discount_type === 'percent' ? `${Number(order.discount_value)}%` : `QAR ${order.discount_value}`} — tap to change`
                : '% Order discount'}
          </button>
        </div>

        {order.payments.length > 0 && (
          <div className="charge-taken">
            <span className="charge-taken-eyebrow">Payments taken</span>
            {order.payments.map((p) => (
              <div key={p.id} className="charge-taken-row">
                <span>
                  {p.method}
                  {p.reference ? ` · ${p.reference}` : ''}
                </span>
                <span>{fmt(p.amount)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Right: paid, or the way to take the money. */}
      {paid ? (
        <div className="charge-paid-col">
          <div className="charge-done">
            <div className="charge-done-check" aria-hidden="true">✓</div>
            <span className="charge-done-head">Paid — {fmtQAR(order.total)}</span>
            <span className="charge-done-meta">
              Order {order.order_number} ·{' '}
              {order.payments.map((p) => `${p.method} ${fmt(p.amount)}`).join(' · ')}
            </span>
            {changeGiven && (
              <span className="charge-done-change">Change due {fmtQAR(changeGiven)}</span>
            )}
            <div className="charge-done-actions">
              <Link className="btn-primary charge-newsale" to="/register">New sale</Link>
              <Link className="btn-secondary charge-receipt" to={`/receipt/${order.id}`}>
                Receipt
              </Link>
            </div>
          </div>
        </div>
      ) : (
        <div className="charge-pay">
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
            <span className="charge-amount-eyebrow">
              {method === 'cash' ? 'Tendered' : `${METHODS.find((m) => m.key === method)!.label} amount`}
            </span>
            <span className="charge-amount-value">
              {entry ? `QAR ${entry}` : fmtQAR(order.amount_due)}
            </span>
          </div>

          {change && (
            <div className="charge-changerow">Change {fmtQAR(change)}</div>
          )}

          {(method === 'card' || method === 'online') && (
            <label className="charge-ref-field">
              <span>{method === 'card' ? 'Card reference (last 4)' : 'Transfer / gateway reference'}</span>
              <input
                className="charge-ref"
                placeholder={method === 'card' ? '•••• 4417' : 'TRF-99213-QA'}
                value={reference}
                onChange={(e) => setReference(e.target.value)}
              />
            </label>
          )}

          <div className="charge-chips">
            <button type="button" className="charge-quick" onClick={() => setEntry('')}>
              Exact · {fmt(order.amount_due)}
            </button>
            {['50', '100', '200', '500'].map((v) => (
              <button key={v} type="button" className="charge-quick" onClick={() => setEntry(v)}>
                {fmt(v)}
              </button>
            ))}
          </div>

          <MoneyPad onKey={onKey} disabled={pay.isPending} size="fill" />

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
              : entered && entered.gt(0)
                ? `Record ${method} payment · ${fmtQAR(
                    entered.lt(due) ? entered.toFixed(2) : due.toFixed(2),
                  )}`
                : `Record ${method} payment`}
          </button>
          <p className="charge-note-sub">
            Order completes automatically when payments cover the total — split freely.
          </p>
        </div>
      )}

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
