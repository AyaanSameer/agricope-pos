import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { addOrderItems, listOrders, refundOrder, voidOrder } from '../../api/orders'
import type { OrderStatus } from '../../api/orders'
import { ApiError } from '../../api/client'
import { useAuth } from '../../auth/AuthContext'
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
    <div className="page orders-page">
      <div className="page-head">
        <div>
          <h2>Orders{activeStore ? ` — ${activeStore.name}` : ''}</h2>
          <p className="page-sub">Today's history · reprint, void or refund</p>
        </div>
      </div>

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
      </div>

      <div className="orders-body">
        <div className="card orders-table">
          <div className="orders-row orders-head-row">
            <span>Order</span><span>Time</span><span>Cashier</span><span>Type</span>
            <span className="num">Total</span><span>Status</span>
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
              <span className="muted">{new Date(o.created_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</span>
              <span className="muted">{o.cashier_name.split(' ')[0]}</span>
              <span className="muted">{o.order_type.replace('_', '-')}</span>
              <span className="num strong">{fmt(o.total)}</span>
              <span><span className={`st ${STATUS_STYLE[o.status]}`}>{o.status.toUpperCase()}</span></span>
            </button>
          ))}
          {ordersQuery.data?.data.length === 0 && (
            <div className="orders-loading">No orders yet today.</div>
          )}
        </div>

        {selected && (
          <aside className="card orders-detail">
            <div className="orders-detail-head">
              <h3>{selected.order_number}</h3>
              <span className={`st ${STATUS_STYLE[selected.status]}`}>{selected.status.toUpperCase()}</span>
            </div>
            <p className="muted small">
              {selected.cashier_name} · {new Date(selected.created_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })} · {selected.order_type.replace('_', '-')}
              {selected.table_name
                ? ` · ${selected.table_name}`
                : selected.order_type === 'dine_in'
                  ? ' · no table yet'
                  : ''}
              {selected.customer_name ? ` · ${selected.customer_name}` : ''}
            </p>
            <div className="orders-sep" />
            {selected.items.map((i) => (
              <div key={i.id} className="orders-line">
                <span>
                {i.quantity} × {i.product_name}
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
            {Number(selected.service_charge_total) > 0 && (
              <div className="orders-line muted"><span>Service 10%</span><span>{fmt(selected.service_charge_total)}</span></div>
            )}
            <div className="orders-line total"><span>Total</span><span>{fmtQAR(selected.total)}</span></div>
            {selected.payments.length > 0 && <div className="orders-sep" />}
            {selected.payments.map((p) => (
              <div key={p.id} className="orders-line muted">
                <span className="cap">{p.method}{p.reference ? ` · ${p.reference}` : ''}{p.tendered && Number(p.change_given) > 0 ? ` · tendered ${fmt(p.tendered)}` : ''}</span>
                <span>{fmt(p.amount)}</span>
              </div>
            ))}
            {selected.note && <p className="orders-note">“{selected.note}”</p>}
            <div className="orders-actions">
              {selected.status === 'open' && (
                <>
                  {selected.order_type === 'dine_in' && !selected.table_id && (
                    <button
                      type="button"
                      className="btn-secondary orders-act"
                      onClick={() => setAddingItems(true)}
                    >
                      + Add items
                    </button>
                  )}
                  <Link to={`/charge/${selected.id}`} className="btn-primary orders-act">Take payment</Link>
                  <button type="button" className="btn-secondary orders-act danger" onClick={() => { setPinError(null); setPinAction('void') }}>
                    Void…
                  </button>
                </>
              )}
              {selected.status === 'completed' && (
                <>
                  <Link to={`/receipt/${selected.id}`} className="btn-primary orders-act">Receipt</Link>
                  <button type="button" className="btn-secondary orders-act danger" onClick={() => { setPinError(null); setPinAction('refund') }}>
                    Refund…
                  </button>
                </>
              )}
              {(selected.status === 'void' || selected.status === 'refunded') && (
                <Link to={`/receipt/${selected.id}`} className="btn-secondary orders-act">View receipt</Link>
              )}
            </div>
          </aside>
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
