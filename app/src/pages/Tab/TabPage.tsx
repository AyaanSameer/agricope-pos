import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import Big from 'big.js'
import { listCategories, listProducts } from '../../api/catalog'
import {
  addOrderItems,
  getOrder,
  listOrders,
  mergeOrder,
  removeOrderItem,
  sendToKitchen,
  splitOrder,
  updateOrderItem,
} from '../../api/orders'
import type { Order } from '../../api/orders'
import { ApiError } from '../../api/client'
import { ApprovalPinModal } from '../../components/ApprovalPinModal'
import { fmt, fmtQAR } from '../../lib/money'
import './tab.css'

/** One table's open tab: rounds accumulate, fire to the kitchen, split, merge, pay. */
export function TabPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [addingItems, setAddingItems] = useState(false)
  const [splitting, setSplitting] = useState(false)
  const [merging, setMerging] = useState(false)
  const [pullingItem, setPullingItem] = useState<string | null>(null)
  const [pinError, setPinError] = useState<string | null>(null)

  const orderQuery = useQuery({ queryKey: ['order', id], queryFn: () => getOrder(id!), enabled: !!id })
  const order = orderQuery.data

  const refresh = (updated: Order) => {
    queryClient.setQueryData(['order', id], updated)
    queryClient.invalidateQueries({ queryKey: ['floor'] })
    queryClient.invalidateQueries({ queryKey: ['orders'] })
  }

  const send = useMutation({
    mutationFn: () => sendToKitchen(order!.id),
    onSuccess: refresh,
  })
  const changeQty = useMutation({
    mutationFn: ({ itemId, quantity }: { itemId: string; quantity: string }) =>
      updateOrderItem(order!.id, itemId, { quantity }),
    onSuccess: refresh,
  })
  const removeItem = useMutation({
    mutationFn: ({ itemId, pin }: { itemId: string; pin?: string }) =>
      removeOrderItem(order!.id, itemId, pin),
    onSuccess: (updated) => {
      refresh(updated)
      setPullingItem(null)
      setPinError(null)
    },
    onError: (err, vars) => {
      if (err instanceof ApiError && err.code === 'APPROVAL_REQUIRED' && !vars.pin) {
        setPullingItem(vars.itemId)
        setPinError(null)
      } else if (vars.pin) {
        setPinError(err instanceof ApiError ? err.message : 'Could not remove.')
      }
    },
  })

  if (orderQuery.isPending) return <div className="tab-note">Loading tab…</div>
  if (!order) return <div className="tab-note">Tab not found.</div>

  const unsent = order.items.filter((i) => !i.sent_to_kitchen_at)
  const perGuest =
    order.guest_count && order.guest_count > 0
      ? new Big(order.total).div(order.guest_count).toFixed(2)
      : null

  return (
    <div className="tab-page">
      <div className="tab-main">
        <div className="tab-head">
          <button type="button" className="btn-secondary tab-back" onClick={() => navigate('/floor')}>
            ← Floor
          </button>
          <div className="tab-title">
            <h2>{order.table_name ?? order.order_type} — open tab</h2>
            <p className="page-sub">
              {order.guest_count ?? '—'} guests · {order.order_number} · {order.cashier_name}
            </p>
          </div>
          <button type="button" className="btn-secondary" onClick={() => setSplitting(true)} disabled={order.items.length === 0}>
            Split bill
          </button>
          <button type="button" className="btn-secondary" onClick={() => setMerging(true)}>
            Merge
          </button>
        </div>

        <div className="card tab-items">
          <div className="tab-items-head">
            <span>Items</span>
            <span className="muted small">
              {unsent.length > 0 ? `${unsent.length} not yet fired` : 'all fired'}
            </span>
          </div>
          {order.items.length === 0 && <div className="tab-empty">No items yet — add the first round.</div>}
          {order.items.map((i) => (
            <div key={i.id} className="tab-item">
              <span className={i.sent_to_kitchen_at ? 'tab-badge sent' : 'tab-badge new'}>
                {i.sent_to_kitchen_at ? 'SENT' : 'NEW'}
              </span>
              <div className="tab-item-info">
                <span className={i.sent_to_kitchen_at ? 'muted' : ''}>{i.quantity} × {i.product_name}</span>
                {i.sent_to_kitchen_at && <span className="tiny muted">locked — manager PIN to remove</span>}
              </div>
              {!i.sent_to_kitchen_at && (
                <div className="stepper">
                  <button
                    type="button"
                    onClick={() =>
                      Number(i.quantity) <= 1
                        ? removeItem.mutate({ itemId: i.id })
                        : changeQty.mutate({ itemId: i.id, quantity: new Big(i.quantity).minus(1).toString() })
                    }
                  >
                    −
                  </button>
                  <span>{i.quantity}</span>
                  <button type="button" onClick={() => changeQty.mutate({ itemId: i.id, quantity: new Big(i.quantity).plus(1).toString() })}>
                    +
                  </button>
                </div>
              )}
              {i.sent_to_kitchen_at && (
                <button type="button" className="tab-pull" onClick={() => removeItem.mutate({ itemId: i.id })}>
                  Pull…
                </button>
              )}
              <span className="tab-item-total">{fmt(i.line_total)}</span>
            </div>
          ))}
          <button type="button" className="tab-add" onClick={() => setAddingItems(true)}>
            + Add items from menu
          </button>
        </div>
      </div>

      <aside className="card tab-side">
        <h3>Bill so far</h3>
        <div className="trow"><span>Subtotal</span><span>{fmt(order.subtotal)}</span></div>
        {Number(order.discount_total) > 0 && (
          <div className="trow"><span>Discount</span><span>−{fmt(order.discount_total)}</span></div>
        )}
        <div className="trow"><span>Service charge</span><span>{fmt(order.service_charge_total)}</span></div>
        <div className="trow"><span>Tax</span><span>{fmt(order.tax_total)}</span></div>
        <div className="trow total"><span>Total</span><span>{fmtQAR(order.total)}</span></div>
        {perGuest && <div className="tab-perguest">≈ {fmt(perGuest)} per guest ({order.guest_count})</div>}
        <div className="tab-side-grow" />
        <button
          type="button"
          className="tab-send"
          disabled={unsent.length === 0 || send.isPending}
          onClick={() => send.mutate()}
        >
          {send.isPending
            ? 'Firing…'
            : unsent.length > 0
              ? `Send ${unsent.length} item${unsent.length === 1 ? '' : 's'} to kitchen`
              : 'Kitchen is up to date'}
        </button>
        <Link to={`/charge/${order.id}`} className="btn-primary tab-charge">
          Charge · {fmtQAR(order.total)}
        </Link>
      </aside>

      {addingItems && (
        <AddItemsModal
          onAdd={async (items) => {
            const updated = await addOrderItems(order.id, items)
            refresh(updated)
            setAddingItems(false)
          }}
          onClose={() => setAddingItems(false)}
        />
      )}
      {splitting && (
        <SplitModal
          order={order}
          onDone={(splitId) => {
            setSplitting(false)
            queryClient.invalidateQueries({ queryKey: ['order', id] })
            queryClient.invalidateQueries({ queryKey: ['floor'] })
            navigate(`/charge/${splitId}`)
          }}
          onClose={() => setSplitting(false)}
        />
      )}
      {merging && (
        <MergeModal
          order={order}
          onDone={(updated) => {
            refresh(updated)
            setMerging(false)
          }}
          onClose={() => setMerging(false)}
        />
      )}
      {pullingItem && (
        <ApprovalPinModal
          title="Pull a fired item"
          message="The kitchen already has this — a manager PIN removes it and flags the ticket."
          busy={removeItem.isPending}
          error={pinError}
          onSubmit={(pin) => removeItem.mutate({ itemId: pullingItem, pin })}
          onClose={() => setPullingItem(null)}
        />
      )}
    </div>
  )
}

function AddItemsModal({
  onAdd,
  onClose,
}: {
  onAdd: (items: { product_id: string; quantity: string }[]) => Promise<void>
  onClose: () => void
}) {
  const [categoryId, setCategoryId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [picked, setPicked] = useState<Map<string, { name: string; qty: number }>>(new Map())
  const [busy, setBusy] = useState(false)

  const categoriesQuery = useQuery({ queryKey: ['categories'], queryFn: listCategories })
  const productsQuery = useQuery({
    queryKey: ['products', { search, categoryId, showInactive: false }],
    queryFn: () => listProducts({ search: search || undefined, category_id: categoryId ?? undefined }),
  })

  const count = useMemo(() => [...picked.values()].reduce((a, p) => a + p.qty, 0), [picked])

  return (
    <div className="tab-additems" role="dialog" aria-modal="true">
      <div className="card tab-additems-card">
        <div className="tab-additems-head">
          <h3>Add round</h3>
          <input placeholder="Search…" value={search} onChange={(e) => setSearch(e.target.value)} />
          <button type="button" className="btn-secondary" onClick={onClose}>✕</button>
        </div>
        <div className="register-tabs">
          <button type="button" className={categoryId === null ? 'chip active' : 'chip'} onClick={() => setCategoryId(null)}>All</button>
          {categoriesQuery.data?.data.map((c) => (
            <button key={c.id} type="button" className={categoryId === c.id ? 'chip active' : 'chip'} onClick={() => setCategoryId(c.id)}>
              {c.name}
            </button>
          ))}
        </div>
        <div className="tab-additems-grid">
          {productsQuery.data?.data.map((p) => {
            const qty = picked.get(p.id)?.qty ?? 0
            return (
              <button
                key={p.id}
                type="button"
                className={qty > 0 ? 'tile picked' : 'tile'}
                onClick={() => {
                  const next = new Map(picked)
                  next.set(p.id, { name: p.name, qty: qty + 1 })
                  setPicked(next)
                }}
              >
                <span className="tile-name">{p.name}</span>
                <span className="tile-price">QAR {fmt(p.price)}</span>
                {qty > 0 && <span className="tile-qty">×{qty}</span>}
              </button>
            )
          })}
        </div>
        <button
          type="button"
          className="btn-primary"
          disabled={count === 0 || busy}
          onClick={async () => {
            setBusy(true)
            await onAdd([...picked.entries()].map(([product_id, p]) => ({ product_id, quantity: String(p.qty) })))
            setBusy(false)
          }}
        >
          {busy ? 'Adding…' : `Add ${count} item${count === 1 ? '' : 's'} to tab`}
        </button>
      </div>
    </div>
  )
}

function SplitModal({
  order,
  onDone,
  onClose,
}: {
  order: Order
  onDone: (splitOrderId: string) => void
  onClose: () => void
}) {
  const [moving, setMoving] = useState<Map<string, number>>(new Map())
  const [error, setError] = useState<string | null>(null)

  const split = useMutation({
    mutationFn: () =>
      splitOrder(
        order.id,
        [...moving.entries()]
          .filter(([, q]) => q > 0)
          .map(([order_item_id, q]) => ({ order_item_id, quantity: String(q) })),
      ),
    onSuccess: (res) => onDone(res.split.id),
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Could not split.'),
  })

  const anything = [...moving.values()].some((q) => q > 0)

  return (
    <div className="cust-modal" role="dialog" aria-modal="true">
      <div className="card tab-split">
        <h3>Split bill — who's paying separately?</h3>
        <p className="muted small">Move lines (or part of a quantity) to a new bill on the same table. It pays with the normal charge screen — split payments included.</p>
        {order.items.map((i) => {
          const max = Number(i.quantity)
          const q = moving.get(i.id) ?? 0
          return (
            <div key={i.id} className="tab-split-row">
              <span className="tab-split-name">{i.quantity} × {i.product_name}</span>
              <div className="stepper">
                <button type="button" onClick={() => setMoving(new Map(moving).set(i.id, Math.max(0, q - 1)))}>−</button>
                <span>{q}</span>
                <button type="button" onClick={() => setMoving(new Map(moving).set(i.id, Math.min(max, q + 1)))}>+</button>
              </div>
            </div>
          )
        })}
        {error && <div className="cust-error">{error}</div>}
        <div className="cust-new-actions">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button type="button" className="btn-primary" disabled={!anything || split.isPending} onClick={() => split.mutate()}>
            {split.isPending ? 'Splitting…' : 'Split & take payment'}
          </button>
        </div>
      </div>
    </div>
  )
}

function MergeModal({
  order,
  onDone,
  onClose,
}: {
  order: Order
  onDone: (updated: Order) => void
  onClose: () => void
}) {
  const [error, setError] = useState<string | null>(null)
  const openQuery = useQuery({
    queryKey: ['orders', { store: order.store_id, status: 'open' }],
    queryFn: () => listOrders({ store_id: order.store_id, status: 'open' }),
  })
  const merge = useMutation({
    mutationFn: (sourceId: string) => mergeOrder(order.id, sourceId),
    onSuccess: onDone,
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Could not merge.'),
  })
  const candidates = openQuery.data?.data.filter((o) => o.id !== order.id) ?? []
  return (
    <div className="cust-modal" role="dialog" aria-modal="true">
      <div className="card tab-split">
        <h3>Merge another tab into {order.table_name ?? order.order_number}</h3>
        <p className="muted small">The other tab's lines move here; it closes as “merged” — nothing is ever deleted.</p>
        {candidates.length === 0 && <p className="muted">No other open tabs.</p>}
        {candidates.map((o) => (
          <button key={o.id} type="button" className="tab-merge-row" disabled={merge.isPending} onClick={() => merge.mutate(o.id)}>
            <span>{o.table_name ?? o.order_type} · {o.order_number}</span>
            <span className="strong">{fmtQAR(o.total)}</span>
          </button>
        ))}
        {error && <div className="cust-error">{error}</div>}
        <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
      </div>
    </div>
  )
}
