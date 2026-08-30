import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import Big from 'big.js'
import {
  addOrderItems,
  assignTable,
  getOrder,
  listOrders,
  mergeOrder,
  removeOrderItem,
  sendToKitchen,
  splitOrder,
  updateOrderItem,
} from '../../api/orders'
import type { Order, OrderItem } from '../../api/orders'
import { listStores } from '../../api/org'
import { api, ApiError } from '../../api/client'
import { AddItemsModal } from '../../components/AddItemsModal'
import { ApprovalPinModal } from '../../components/ApprovalPinModal'
import { KitchenTicketPrint } from '../../components/KitchenTicketPrint'
import { fmt, fmtQAR } from '../../lib/money'
import { useNow } from '../../lib/useNow'
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
  const [printItems, setPrintItems] = useState<OrderItem[] | null>(null)
  const [assigningTable, setAssigningTable] = useState(false)
  const now = useNow()

  const orderQuery = useQuery({ queryKey: ['order', id], queryFn: () => getOrder(id!), enabled: !!id })
  const order = orderQuery.data
  const storesQuery = useQuery({ queryKey: ['stores'], queryFn: listStores })
  // Branch setting: kitchens without a display print a ticket on send instead.
  const printsTickets =
    storesQuery.data?.data.find((s) => s.id === order?.store_id)?.kitchen_mode === 'printer'

  const refresh = (updated: Order) => {
    queryClient.setQueryData(['order', id], updated)
    queryClient.invalidateQueries({ queryKey: ['floor'] })
    queryClient.invalidateQueries({ queryKey: ['orders'] })
  }

  const send = useMutation({
    mutationFn: () => {
      // Remember which lines this send fires — they make up the printed ticket.
      const firing = new Set(
        order!.items.filter((i) => !i.sent_to_kitchen_at).map((i) => i.id),
      )
      return sendToKitchen(order!.id).then((updated) => ({ updated, firing }))
    },
    onSuccess: ({ updated, firing }) => {
      refresh(updated)
      if (printsTickets) setPrintItems(updated.items.filter((i) => firing.has(i.id)))
    },
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
  const svcRate = storesQuery.data?.data.find((s) => s.id === order.store_id)?.service_charge_rate ?? '0'
  const minutesOpen = Math.max(0, Math.round((now - new Date(order.created_at).getTime()) / 60000))
  const where = order.table_name
    ? `${order.table_name}${order.table_zone ? ` · ${order.table_zone}` : ''}`
    : order.order_number
  const perGuest =
    order.guest_count && order.guest_count > 0
      ? new Big(order.total).div(order.guest_count).toFixed(2)
      : null

  return (
    <div className="tab-page">
      <div className="tab-cols">
      <div className="tab-main">
        {/* The topbar names the screen; this names the table the screen is
            about — an object header, not a second nav bar. */}
        <header className="tab-obj">
          <span className="tab-plate" aria-hidden="true">
            {order.table_name ?? '—'}
          </span>
          <div className="tab-obj-id">
            <h2>{where}</h2>
            <p>
              {order.guest_count ?? '—'} guests · open {minutesOpen} min · waiter{' '}
              {order.cashier_name.split(' ')[0]}
              {order.order_type === 'dine_in' && !order.table_id ? ' · no table yet' : ''}
            </p>
          </div>
          {unsent.length > 0 && (
            <button
              type="button"
              className="btn-primary tab-fire"
              disabled={send.isPending}
              onClick={() => send.mutate()}
            >
              {send.isPending ? 'Firing…' : `Send ${unsent.length} to kitchen`}
            </button>
          )}
        </header>

        <div className="tab-lines">
          {order.items.length === 0 && (
            <div className="tab-empty">No items yet — add the first round.</div>
          )}
          {order.items.map((i) => {
            const sent = !!i.sent_to_kitchen_at
            const each = new Big(i.unit_price).toFixed(2)
            return (
              <div key={i.id} className={sent ? 'tab-line sent' : 'tab-line'}>
                <div className="tab-line-main">
                  <div className="tab-line-head">
                    <span className={sent ? 'tab-badge sent' : 'tab-badge new'}>
                      {sent ? 'SENT' : 'NEW'}
                    </span>
                    <span className="tab-line-name">{i.product_name}</span>
                  </div>
                  <span className="tab-line-sub">
                    {i.options.length > 0 && `${i.options.join(' · ')} · `}
                    QAR {fmt(each)} each
                  </span>
                </div>
                {sent ? (
                  <button
                    type="button"
                    className="tab-pull"
                    onClick={() => removeItem.mutate({ itemId: i.id })}
                  >
                    Pull · PIN
                  </button>
                ) : (
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
                    <span>{Number(i.quantity)}</span>
                    <button
                      type="button"
                      onClick={() => changeQty.mutate({ itemId: i.id, quantity: new Big(i.quantity).plus(1).toString() })}
                    >
                      +
                    </button>
                  </div>
                )}
                <span className="tab-line-total">{fmt(i.line_total)}</span>
              </div>
            )
          })}
        </div>

        <div className="tab-acts">
          <button type="button" className="tab-act" onClick={() => setAddingItems(true)}>
            + Add a round
          </button>
          <button
            type="button"
            className="tab-act"
            onClick={() => setSplitting(true)}
            disabled={order.items.length === 0}
          >
            Split bill
          </button>
          <button type="button" className="tab-act" onClick={() => setMerging(true)}>
            Merge a tab
          </button>
          {order.order_type === 'dine_in' && !order.table_id && order.status === 'open' && (
            <button type="button" className="tab-act" onClick={() => setAssigningTable(true)}>
              Assign table
            </button>
          )}
        </div>
      </div>

      <aside className="card tab-side">
        <h3>Running bill</h3>
        <div className="trow"><span>Subtotal</span><span>{fmt(order.subtotal)}</span></div>
        {Number(order.discount_total) > 0 && (
          <div className="trow"><span>Discount</span><span>−{fmt(order.discount_total)}</span></div>
        )}
        <div className="trow"><span>Incl. tax</span><span>{fmt(order.tax_total)}</span></div>
        <div className="trow">
          <span>Service charge {Number(svcRate)}%</span>
          <span>{fmt(order.service_charge_total)}</span>
        </div>
        <div className="trow total"><span>Total</span><span>{fmtQAR(order.total)}</span></div>
        {perGuest && (
          <div className="tab-perguest">
            <span>Per guest</span>
            <strong>{fmt(perGuest)}</strong>
          </div>
        )}
        <div className="tab-side-grow" />
        <Link to={`/charge/${order.id}`} className="btn-primary tab-charge">
          Charge · {fmtQAR(order.total)}
        </Link>
      </aside>
      </div>

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
      {assigningTable && (
        <AssignTableModal
          order={order}
          onDone={(updated) => {
            refresh(updated)
            setAssigningTable(false)
          }}
          onClose={() => setAssigningTable(false)}
        />
      )}
      {printItems && order && (
        <KitchenTicketPrint
          orderNumber={order.order_number}
          tableName={order.table_name}
          items={printItems}
          onClose={() => setPrintItems(null)}
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


/** Dine-in without a table: the order came first, the table is optional. */
function AssignTableModal({
  order,
  onDone,
  onClose,
}: {
  order: Order
  onDone: (updated: Order) => void
  onClose: () => void
}) {
  const [error, setError] = useState<string | null>(null)
  const floorQuery = useQuery({
    queryKey: ['floor', order.store_id],
    queryFn: () =>
      api<{ data: { id: string; name: string; zone: string; seats: number; order: unknown | null }[] }>(
        `/tables/floor?store_id=${order.store_id}`,
      ),
  })
  const assign = useMutation({
    mutationFn: (tableId: string) => assignTable(order.id, tableId),
    onSuccess: onDone,
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Could not assign — try again.'),
  })
  const free = (floorQuery.data?.data ?? []).filter((t) => !t.order)

  return (
    <div className="cust-modal" role="dialog" aria-modal="true">
      <div className="card tab-split">
        <h3>Assign a table</h3>
        <p className="muted small">
          The order is already open — pick where the guests are sitting. Skipping is fine.
        </p>
        <div className="tab-assign-grid">
          {floorQuery.isPending && <span className="muted small">Loading tables…</span>}
          {free.map((t) => (
            <button
              key={t.id}
              type="button"
              className="tile"
              disabled={assign.isPending}
              onClick={() => assign.mutate(t.id)}
            >
              <span className="tile-name">{t.name}</span>
              <span className="tile-price">{t.zone} · seats {t.seats}</span>
            </button>
          ))}
          {floorQuery.data && free.length === 0 && (
            <span className="muted small">Every table is occupied right now.</span>
          )}
        </div>
        {error && <div className="cust-error">{error}</div>}
        <div className="cust-new-actions">
          <button type="button" className="btn-secondary" onClick={onClose}>
            Keep without a table
          </button>
        </div>
      </div>
    </div>
  )
}
