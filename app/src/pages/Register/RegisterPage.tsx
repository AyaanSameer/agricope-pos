import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useMutation, useQuery } from '@tanstack/react-query'
import { listCategories, listProducts } from '../../api/catalog'
import { createOrder } from '../../api/orders'
import { useAuth } from '../../auth/AuthContext'
import { useCart } from '../../cart/CartContext'
import { Logomark } from '../../components/Logomark'
import { CustomerPicker } from '../../components/CustomerPicker'
import { fmt, fmtQAR } from '../../lib/money'
import { useBarcodeScanner } from '../../lib/useBarcodeScanner'
import './register.css'

const DOT_COLORS = ['#16a34a', '#f59e0b', '#3b82f6', '#d97706', '#06b6d4', '#d94720', '#8b5cf6']

export function RegisterPage() {
  const { session, activeStore } = useAuth()
  const cart = useCart()
  const navigate = useNavigate()
  const [search, setSearch] = useState('')
  const [categoryId, setCategoryId] = useState<string | null>(null)
  const [pickingCustomer, setPickingCustomer] = useState(false)
  const [chargeError, setChargeError] = useState<string | null>(null)

  const categoriesQuery = useQuery({ queryKey: ['categories'], queryFn: listCategories, enabled: !!activeStore })
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
        items: cart.lines.map((l) => ({ product_id: l.product_id, quantity: l.quantity })),
      }),
    onSuccess: (order) => {
      cart.clear()
      navigate(`/charge/${order.id}`)
    },
    onError: () => setChargeError('Could not start the order — try again.'),
  })

  // USB scanners type fast and hit Enter — resolve the code and drop it in the cart.
  useBarcodeScanner(async (code) => {
    const res = await listProducts({ barcode: code })
    const product = res.data[0]
    if (product) cart.add(product)
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
        <Logomark size={56} variant="two-tone" />
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
          <input
            className="register-search"
            placeholder="Scan barcode or search products…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="register-seg">
            {(['counter', 'takeaway'] as const).map((t) => (
              <button
                key={t}
                type="button"
                className={cart.orderType === t ? 'seg-btn active' : 'seg-btn'}
                onClick={() => cart.setOrderType(t)}
              >
                {t === 'counter' ? 'Counter' : 'Takeaway'}
              </button>
            ))}
          </div>
        </div>

        <div className="register-tabs">
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
        </div>

        <div className="register-grid">
          {productsQuery.isPending && <div className="register-note">Loading products…</div>}
          {productsQuery.data?.data.map((p) => (
            <button key={p.id} type="button" className="tile" onClick={() => cart.add(p)}>
              <span className="tile-cat">
                <span className="tile-dot" style={{ background: dotFor(p.category_id) }} />
                {p.category_name ?? 'Uncategorised'}
              </span>
              <span className="tile-name">{p.name}</span>
              <span className="tile-price">QAR {fmt(p.price)}</span>
            </button>
          ))}
          {productsQuery.data && productsQuery.data.data.length === 0 && (
            <div className="register-note">No products match — add them in Catalog.</div>
          )}
        </div>
      </div>

      <aside className="cart card">
        <div className="cart-head">
          <h3>Current sale</h3>
          <span className="cart-store">{activeStore.name}</span>
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
            <div className="cart-empty">Tap products to start the sale.</div>
          )}
          {cart.lines.map((l, i) => (
            <div key={l.product_id} className="cart-line">
              <div className="cart-line-info">
                <span className="cart-line-name">{l.name}</span>
                <span className="cart-line-unit">QAR {fmt(l.unit_price)} each</span>
              </div>
              <div className="stepper">
                <button type="button" onClick={() => cart.decrement(l.product_id)}>−</button>
                <span>{l.quantity}</span>
                <button type="button" onClick={() => cart.increment(l.product_id)}>+</button>
              </div>
              <span className="cart-line-total">{fmt(cart.totals.line_totals[i])}</span>
            </div>
          ))}
        </div>

        <div className="cart-totals">
          <div className="trow"><span>Subtotal</span><span>{fmt(cart.totals.subtotal)}</span></div>
          <div className="trow"><span>Tax</span><span>{fmt(cart.totals.tax_total)}</span></div>
          <div className="trow total"><span>Total</span><span>{fmtQAR(cart.totals.total)}</span></div>
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
          {charge.isPending ? 'Starting…' : `Charge · ${fmtQAR(cart.totals.total)}`}
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
