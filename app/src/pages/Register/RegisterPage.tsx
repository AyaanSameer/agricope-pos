import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../../api/client'
import { listCategories, listProducts } from '../../api/catalog'
import type { Product } from '../../api/catalog'
import { createOrder } from '../../api/orders'
import { listStores } from '../../api/org'
import { useAuth } from '../../auth/AuthContext'
import { useCart } from '../../cart/CartContext'
import { Logomark } from '../../components/Logomark'
import { useDevice } from '../../lib/useDevice'
import { ChipRail } from '../../components/ChipRail'
import { CustomerPicker } from '../../components/CustomerPicker'
import { OptionPicker } from '../../components/OptionPicker'
import { fmt, fmtQAR } from '../../lib/money'
import { offerFor, resolveUnitPrice } from '../../lib/pricing'
import { useBarcodeScanner } from '../../lib/useBarcodeScanner'
import './register.css'

const DOT_COLORS = ['#16a34a', '#f59e0b', '#3b82f6', '#d97706', '#06b6d4', '#d94720', '#8b5cf6']

export function RegisterPage() {
  const { session, activeStore } = useAuth()
  const cart = useCart()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [categoryId, setCategoryId] = useState<string | null>(null)
  const [pickingCustomer, setPickingCustomer] = useState(false)
  const { dense } = useDevice()
  const [cartOpen, setCartOpen] = useState(false)
  const [pickingOptions, setPickingOptions] = useState<Product | null>(null)
  const [chargeError, setChargeError] = useState<string | null>(null)

  const categoriesQuery = useQuery({ queryKey: ['categories'], queryFn: listCategories, enabled: !!activeStore })
  const storesQuery = useQuery({ queryKey: ['stores'], queryFn: listStores, enabled: !!activeStore })
  const store = storesQuery.data?.data.find((s) => s.id === activeStore?.id)
  const isRestaurant = store?.type === 'restaurant'

  // Keep the cart preview's service charge in step with this branch.
  const serviceChargeRate = store?.service_charge_rate ?? '0'
  useEffect(() => {
    cart.setServiceChargeRate(serviceChargeRate)
  }, [serviceChargeRate, cart.setServiceChargeRate]) // eslint-disable-line react-hooks/exhaustive-deps

  // A restaurant sells dine-in first, so that is the tab the register opens
  // on; a shop has no dine-in tab and stays on Takeaway.
  useEffect(() => {
    if (!storesQuery.data) return
    cart.setDefaultOrderType(isRestaurant ? 'dine_in' : 'takeaway')
  }, [storesQuery.data, isRestaurant, cart.setDefaultOrderType]) // eslint-disable-line react-hooks/exhaustive-deps
  const openOrdersQuery = useQuery({
    queryKey: ['orders', 'open', activeStore?.id],
    queryFn: () =>
      api<{ total: number }>(`/orders?status=open${activeStore ? `&store_id=${activeStore.id}` : ''}`),
    enabled: !!activeStore,
  })
  const openOrders = openOrdersQuery.data?.total ?? 0

  const productsQuery = useQuery({
    queryKey: ['products', { search, categoryId, showInactive: false }],
    queryFn: () => listProducts({ search: search || undefined, category_id: categoryId ?? undefined }),
    enabled: !!activeStore,
  })

  const charge = useMutation({
    mutationFn: () =>
      createOrder({
        store_id: activeStore!.id,
        order_type: cart.orderType,
        customer_id: cart.customerId,
        items: cart.lines.map((l) => ({
          product_id: l.product_id,
          quantity: l.quantity,
          option_ids: l.options.map((o) => o.choice_id),
        })),
      }),
    onSuccess: (order) => {
      cart.clear()
      // The new order must show up on Orders and the floor straight away.
      queryClient.invalidateQueries({ queryKey: ['orders'] })
      queryClient.invalidateQueries({ queryKey: ['floor'] })
      // Dine-in orders open as a tab: the guest orders first, a table is
      // optional and can be assigned there; counter/takeaway/online pay now.
      navigate(order.order_type === 'dine_in' ? `/tab/${order.id}` : `/charge/${order.id}`)
    },
    onError: () => setChargeError('Could not start the order — try again.'),
  })

  /** Options ask first; everything else lands straight in the cart. */
  function ring(p: Product) {
    if (p.option_groups.length) setPickingOptions(p)
    else cart.add(p)
  }

  // USB scanners type fast and hit Enter — resolve the code and drop it in the cart.
  useBarcodeScanner(async (code) => {
    const res = await listProducts({ barcode: code })
    const product = res.data[0]
    if (product) ring(product)
  })

  const dotFor = useMemo(() => {
    const map = new Map<string, string>()
    categoriesQuery.data?.data.forEach((c, i) => map.set(c.id, DOT_COLORS[i % DOT_COLORS.length]))
    return (id: string | null) => (id ? (map.get(id) ?? '#9c998a') : '#9c998a')
  }, [categoriesQuery.data])

  if (!session) return null

  if (!activeStore) {
    return (
      <div className="register-empty card">
        <Logomark height={56} tone="colour" />
        <h2>Pick a store to open a till</h2>
        <p>You work across all stores — the register always belongs to one.</p>
        <Link to="/pick-store" className="btn-primary register-pick">
          Choose store
        </Link>
      </div>
    )
  }

  return (
    <div className="register-split">
      <div className="register">
        <div className="register-top">
          <div className="register-search-wrap">
            <span className="register-search-glyph" aria-hidden="true">⌕</span>
            <input
            className="register-search-input"
            placeholder="Scan barcode or search products…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          </div>
          <div className="register-seg">
            {(['dine_in', 'takeaway', 'delivery'] as const)
              .filter((t) => t !== 'dine_in' || isRestaurant)
              .map((t) => (
                <button
                  key={t}
                  type="button"
                  className={cart.orderType === t ? 'seg-btn active' : 'seg-btn'}
                  onClick={() => cart.setOrderType(t)}
                >
                  {t === 'dine_in' ? 'Dine-in' : t === 'takeaway' ? 'Takeaway' : 'Online'}
                </button>
              ))}
          </div>
          <div className="register-jump">
            <Link to="/orders" className="jump-btn">
              Orders
              {openOrders > 0 && <span className="register-jump-count">{openOrders}</span>}
            </Link>
          </div>
        </div>

        <ChipRail label="categories">
          <button
            type="button"
            className={categoryId === null ? 'chip active' : 'chip'}
            onClick={() => setCategoryId(null)}
          >
            All
          </button>
          {categoriesQuery.data?.data.map((c) => (
            <button
              key={c.id}
              type="button"
              className={categoryId === c.id ? 'chip active' : 'chip'}
              onClick={() => setCategoryId(c.id)}
            >
              {c.name}
            </button>
          ))}
        </ChipRail>

        <div className="register-grid">
          {productsQuery.isPending && <div className="register-note">Loading products…</div>}
          {productsQuery.data?.data.map((p) => {
            const channel = cart.orderType === 'delivery' ? 'online' : 'store'
            const resolved = resolveUnitPrice(p, channel)
            // Show the percent for THIS channel — store and online can differ.
            const channelOffer = offerFor(p, channel)
            return (
              <button key={p.id} type="button" className="tile" onClick={() => ring(p)}>
                <span className="tile-cat">
                  <span className="tile-dot" style={{ background: dotFor(p.category_id) }} />
                  {p.category_name ?? 'Uncategorised'}
                  {resolved.offer_applied && channelOffer && (
                    <span className="tile-offer">−{channelOffer.percent}%</span>
                  )}
                </span>
                <span className="tile-name">{p.name}</span>
                <span className="tile-price">
                  QAR {fmt(resolved.price)}
                  {resolved.offer_applied && (
                    <s className="tile-was">{fmt(resolved.original)}</s>
                  )}
                </span>
              </button>
            )
          })}
          {productsQuery.data && productsQuery.data.data.length === 0 && (
            <div className="register-note">No products match — add them in Catalog.</div>
          )}
        </div>
      </div>

      {dense && cartOpen && (
        <div className="cart-scrim" onClick={() => setCartOpen(false)} aria-hidden="true" />
      )}

      <aside className={dense ? (cartOpen ? 'cart cart-sheet open' : 'cart cart-sheet') : 'cart'}>
        <div className="cart-head">
          <h3>Current sale</h3>
          <span className="cart-store">
            {cart.orderType === 'dine_in' ? 'Dine-in' : cart.orderType === 'takeaway' ? 'Takeaway' : 'Online'}
          </span>
        </div>

        <button type="button" className="cart-customer" onClick={() => setPickingCustomer(true)}>
          {cart.customerName ? (
            <>
              <span className="cart-customer-name">{cart.customerName}</span>
              <span className="cart-customer-hint">tap to change</span>
            </>
          ) : (
            <span className="cart-customer-hint">+ Add customer (needed for credit)</span>
          )}
        </button>

        <div className="cart-lines">
          {cart.lines.length === 0 && (
            <div className="cart-empty">
              <div className="cart-empty-icon" aria-hidden="true">▤</div>
              <span className="cart-empty-head">Nothing on the sale yet</span>
              <span className="cart-empty-sub">
                Tap a product tile, or scan a barcode into the search field.
              </span>
            </div>
          )}
          {cart.lines.map((l, i) => (
            <div key={l.key} className="cart-line">
              <div className="cart-line-info">
                <span className="cart-line-name">{l.name}</span>
                {l.options.length > 0 && (
                  <span className="cart-line-opts">{l.options.map((o) => o.label).join(' · ')}</span>
                )}
                <span className="cart-line-unit">QAR {fmt(cart.unitPrice(l))} each</span>
              </div>
              <div className="stepper">
                <button type="button" onClick={() => cart.decrement(l.key)}>−</button>
                <span>{l.quantity}</span>
                <button type="button" onClick={() => cart.increment(l.key)}>+</button>
              </div>
              <span className="cart-line-total">{fmt(cart.totals.line_totals[i])}</span>
            </div>
          ))}
        </div>

        <div className="cart-totals">
          <div className="trow"><span>Subtotal</span><span>{fmt(cart.totals.subtotal)}</span></div>
          {Number(cart.totals.service_charge_total) > 0 && (
            <div className="trow"><span>Service charge</span><span>{fmt(cart.totals.service_charge_total)}</span></div>
          )}
          <div className="trow"><span>Incl. tax</span><span>{fmt(cart.totals.tax_total)}</span></div>
          <div className="trow total">
            <span>Total</span>
            <span key={cart.totals.total} className="ag-tick">
              {fmtQAR(cart.totals.total)}
            </span>
          </div>
        </div>

        {chargeError && <div className="cart-error">{chargeError}</div>}

        <button
          type="button"
          className="btn-primary cart-charge"
          disabled={cart.lines.length === 0 || charge.isPending}
          onClick={() => {
            setChargeError(null)
            charge.mutate()
          }}
        >
          {charge.isPending
            ? 'Starting…'
            : cart.lines.length === 0
              ? 'Charge'
              : cart.orderType === 'dine_in'
                ? `Open tab · ${fmtQAR(cart.totals.total)}`
                : `Charge · ${fmtQAR(cart.totals.total)}`}
        </button>
        <button
          type="button"
          className="btn-secondary cart-clear"
          disabled={cart.lines.length === 0}
          onClick={cart.clear}
        >
          Clear sale
        </button>
      </aside>

      {/* Dense: the bill docks at the bottom and opens the cart as a sheet. */}
      {dense && !cartOpen && (
        <div className="bill-bar">
          <div className="bill-bar-total">
            <span>
              {cart.lines.length} item{cart.lines.length === 1 ? '' : 's'} ·{' '}
              {cart.orderType === 'dine_in' ? 'Dine-in' : cart.orderType === 'takeaway' ? 'Takeaway' : 'Online'}
            </span>
            <strong>{fmtQAR(cart.totals.total)}</strong>
          </div>
          <button
            type="button"
            className="btn-primary bill-bar-review"
            disabled={cart.lines.length === 0}
            onClick={() => setCartOpen(true)}
          >
            Review sale ›
          </button>
        </div>
      )}

      {pickingOptions && (
        <OptionPicker
          product={pickingOptions}
          onAdd={(selections) => {
            cart.add(pickingOptions, selections)
            setPickingOptions(null)
          }}
          onClose={() => setPickingOptions(null)}
        />
      )}

      {pickingCustomer && (
        <CustomerPicker
          onPick={(c) => {
            cart.setCustomer(c?.id ?? null, c?.name ?? null)
            setPickingCustomer(false)
          }}
          onClose={() => setPickingCustomer(false)}
        />
      )}
    </div>
  )
}
