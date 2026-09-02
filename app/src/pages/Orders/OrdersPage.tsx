import { useState } from 'react'
import Big from 'big.js'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { addOrderItems, listOrders, refundOrder, voidOrder } from '../../api/orders'
import type { OrderStatus } from '../../api/orders'
import { ApiError } from '../../api/client'
import { useAuth } from '../../auth/AuthContext'
import { useDevice } from '../../lib/useDevice'
import { AddItemsModal } from '../../components/AddItemsModal'
import { ApprovalPinModal } from '../../components/ApprovalPinModal'
import { fmt, fmtQAR } from '../../lib/money'
import './orders.css'

const STATUS_STYLE: Record<OrderStatus, string> = {
  open: 'st-open',
  completed: 'st-done',
  void: 'st-void',
  refunded: 'st-refund',
}

export function OrdersPage() {
  const { activeStore } = useAuth()
  const { dense } = useDevice()
  const queryClient = useQueryClient()
  const [status, setStatus] = useState<OrderStatus | null>('open')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [pinAction, setPinAction] = useState<'void' | 'refund' | null>(null)
  const [pinError, setPinError] = useState<string | null>(null)
  const [addingItems, setAddingItems] = useState(false)

  const ordersQuery = useQuery({
    queryKey: ['orders', { store: activeStore?.id, status }],
    queryFn: () => listOrders({ store_id: activeStore?.id, status: status ?? undefined }),
  })
  const selected = ordersQuery.data?.data.find((o) => o.id === selectedId) ?? null
  // What is still owed on the selected order — the design calls it out in gold.
  const paidSoFar = selected
    ? selected.payments.reduce((a, p) => a.plus(p.amount), new Big(0))
    : new Big(0)
  const dueNow = selected ? new Big(selected.total).minus(paidSoFar) : new Big(0)

  const act = useMutation({
    mutationFn: ({ action, pin }: { action: 'void' | 'refund'; pin: string }) =>
      action === 'void' ? voidOrder(selected!.id, pin) : refundOrder(selected!.id, pin),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['orders'] })
      setPinAction(null)
      setPinError(null)
    },
    onError: (err) =>
      setPinError(err instanceof ApiError ? err.message : 'Could not complete — try again.'),
  })

  return (
    <div className={selected ? 'page orders-page with-drawer' : 'page orders-page'}>

      <div className="orders-filters">
        {(['open', 'completed', 'void', 'refunded', null] as (OrderStatus | null)[]).map((s) => (
          <button
            key={s ?? 'all'}
            type="button"
            className={status === s ? 'chip active' : 'chip'}
            onClick={() => setStatus(s)}
          >
            {s ? s[0].toUpperCase() + s.slice(1) : 'All'}
          </button>
        ))}
        <Link to="/register" className="jump-btn">
          Register
        </Link>
      </div>

      <div className="orders-body">
        {dense ? (
          /* Dense: the design stacks cards — number and status up top, meta and
             money below — in place of a table squeezed to fit. */
          <div className="orders-cards">
            {ordersQuery.isPending && <div className="orders-loading">Loading…</div>}
            {ordersQuery.data?.data.map((o) => (
              <button
                key={o.id}
                type="button"
                className={selectedId === o.id ? 'orders-card selected' : 'orders-card'}
                onClick={() => setSelectedId(o.id)}
              >
                <span className="orders-card-top">
                  <span className="orders-num">{o.order_number}</span>
                  <span className={`st ${STATUS_STYLE[o.status]}`}>{o.status.toUpperCase()}</span>
                </span>
                <span className="orders-card-foot">
                  <span className="orders-card-meta">
                    {new Date(o.created_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })} ·{' '}
                    {o.cashier_name.split(' ')[0]} · {o.order_type.replace('_', '-')}
                  </span>
                  <span className="orders-card-total">{fmt(o.total)}</span>
                </span>
              </button>
            ))}
            {ordersQuery.data?.data.length === 0 && (
              <div className="orders-loading">No orders yet today.</div>
            )}
          </div>
        ) : (
        <div className="card orders-table">
          <div className="orders-row orders-head-row">
            <span>Order</span><span>Time · cashier</span><span>Type</span>
            <span>Total</span><span>Status</span>
          </div>
          {ordersQuery.isPending && <div className="orders-loading">Loading…</div>}
          {ordersQuery.data?.data.map((o) => (
            <button
              key={o.id}
              type="button"
              className={selectedId === o.id ? 'orders-row selected' : 'orders-row'}
              onClick={() => setSelectedId(o.id)}
            >
              <span className="orders-num">{o.order_number}</span>
              <span className="muted">
                {new Date(o.created_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })} ·{' '}
                {o.cashier_name.split(' ')[0]}
              </span>
              <span className="muted">{o.order_type.replace('_', '-')}</span>
              <span className="strong">{fmt(o.total)}</span>
              <span><span className={`st ${STATUS_STYLE[o.status]}`}>{o.status.toUpperCase()}</span></span>
            </button>
          ))}
          {ordersQuery.data?.data.length === 0 && (
            <div className="orders-loading">No orders yet today.</div>
          )}
        </div>
        )}

        {selected && (
          <>
            <div
              className="orders-scrim"
              onClick={() => setSelectedId(null)}
              aria-hidden="true"
            />
            <aside className="orders-detail">
            <div className="orders-detail-head">
              <h3>{selected.order_number}</h3>
              <span className={`st ${STATUS_STYLE[selected.status]}`}>{selected.status.toUpperCase()}</span>
              <button
                type="button"
                className="orders-close"
                aria-label="Close"
                onClick={() => setSelectedId(null)}
              >
                ✕
              </button>
            </div>
            <p className="muted small">
              {new Date(selected.created_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })} · {selected.order_type.replace('_', '-')} · {selected.cashier_name}
              {selected.table_name
                ? ` · table ${selected.table_name}`
                : selected.order_type === 'dine_in'
                  ? ' · no table yet'
                  : ''}
              {selected.customer_name ? ` · ${selected.customer_name}` : ''}
            </p>
            <div className="orders-sep" />
            {selected.items.map((i) => (
              <div key={i.id} className="orders-line">
                <span className="orders-line-qty">×{Number(i.quantity)}</span>
                <span className="orders-line-name">
                  {i.product_name}
                  {i.options.length > 0 && (
                    <span className="muted small"> — {i.options.join(' · ')}</span>
                  )}
                </span>
                <span>{fmt(i.line_total)}</span>
              </div>
            ))}
            <div className="orders-sep" />
            <div className="orders-line muted"><span>Subtotal</span><span>{fmt(selected.subtotal)}</span></div>
            {Number(selected.discount_total) > 0 && (
              <div className="orders-line muted"><span>Discount</span><span>−{fmt(selected.discount_total)}</span></div>
            )}
            <div className="orders-line muted"><span>Incl. tax</span><span>{fmt(selected.tax_total)}</span></div>
            <div className="orders-line muted"><span>Service charge</span><span>{fmt(selected.service_charge_total)}</span></div>
            <div className="orders-line total"><span>Total</span><span>{fmtQAR(selected.total)}</span></div>
            {selected.payments.length > 0 && <div className="orders-sep" />}
            {selected.payments.map((p) => (
              <div key={p.id} className="orders-line muted">
                <span className="cap">{p.method}{p.reference ? ` · ${p.reference}` : ''}{p.tendered && Number(p.change_given) > 0 ? ` · tendered ${fmt(p.tendered)}` : ''}</span>
                <span>{fmt(p.amount)}</span>
              </div>
            ))}
            {selected.note && <p className="orders-note">“{selected.note}”</p>}
            {(selected.status === 'void' || selected.status === 'refunded') && (
              <div className="orders-readonly">
                This order was {selected.status === 'void' ? 'voided' : 'refunded'}. It is
                read-only and still printable.
              </div>
            )}
            {paidSoFar.gt(0) && dueNow.gt(0) && (
              <div className="orders-due">
                {fmt(paidSoFar.toFixed(2))} paid · {fmt(dueNow.toFixed(2))} due
              </div>
            )}
            {selected.status === 'completed' && (
              <div className="orders-due paid">{fmt(selected.total)} paid in full</div>
            )}
            <div className="orders-actions">
              {selected.status === 'open' &&
                selected.order_type === 'dine_in' &&
                !selected.table_id && (
                  <button
                    type="button"
                    className="orders-act orders-act-add"
                    onClick={() => setAddingItems(true)}
                  >
                    + Add items
                  </button>
                )}
              {selected.status === 'open' && (
                <Link to={`/charge/${selected.id}`} className="btn-primary orders-act">
                  Take payment
                </Link>
              )}
              <Link to={`/receipt/${selected.id}`} className="btn-secondary orders-act">
                View receipt
              </Link>
              {(selected.status === 'open' || selected.status === 'completed') && (
                <button
                  type="button"
                  className="btn-secondary orders-act danger"
                  onClick={() => {
                    setPinError(null)
                    setPinAction(selected.status === 'open' ? 'void' : 'refund')
                  }}
                >
                  Void or refund · PIN
                </button>
              )}
            </div>
          </aside>
          </>
        )}
      </div>

      {addingItems && selected && (
        <AddItemsModal
          title={`Add items — ${selected.order_number}`}
          submitLabel="to order"
          onAdd={async (items) => {
            await addOrderItems(selected.id, items)
            queryClient.invalidateQueries({ queryKey: ['orders'] })
            setAddingItems(false)
          }}
          onClose={() => setAddingItems(false)}
        />
      )}

      {pinAction && selected && (
        <ApprovalPinModal
          title={pinAction === 'void' ? `Void ${selected.order_number}` : `Refund ${selected.order_number}`}
          message="Manager PIN required — this is permanent and audit-logged."
          busy={act.isPending}
          error={pinError}
          onSubmit={(pin) => act.mutate({ action: pinAction, pin })}
          onClose={() => setPinAction(null)}
        />
      )}
    </div>
  )
}
