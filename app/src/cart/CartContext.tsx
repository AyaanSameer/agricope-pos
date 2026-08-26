import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import Big from 'big.js'
import type { Product } from '../api/catalog'
import { resolveUnitPrice, withOptionDeltas } from '../lib/pricing'
import { computeTotals } from '../lib/totals'
import type { Totals } from '../lib/totals'

/**
 * The register cart is plain local state — nothing touches the API until
 * Charge is pressed. Server totals are authoritative; this preview uses the
 * same computeTotals + pricing helpers the mock server runs, so they agree.
 */

export interface CartSelection {
  choice_id: string
  label: string
  price_delta: string
}

export interface CartLine {
  /** product + chosen options — "Spicy" and "Normal" are different lines */
  key: string
  product_id: string
  name: string
  options: CartSelection[]
  quantity: string
  /** per-channel unit prices with any live offer and option deltas applied */
  unit_store: string
  unit_online: string
  /** pre-offer in-store price — the strikethrough figure */
  original_store: string
  offer_applied: boolean
}

export type CartOrderType = 'counter' | 'dine_in' | 'takeaway' | 'delivery'

interface CartValue {
  lines: CartLine[]
  orderType: CartOrderType
  customerId: string | null
  customerName: string | null
  totals: Totals
  itemCount: number
  add: (p: Product, selections?: CartSelection[]) => void
  increment: (key: string) => void
  decrement: (key: string) => void
  remove: (key: string) => void
  clear: () => void
  setOrderType: (t: CartOrderType) => void
  setCustomer: (id: string | null, name: string | null) => void
  /** dine-in service charge %, from the active store — keeps the preview honest */
  setServiceChargeRate: (rate: string) => void
  /** the unit price a line sells at under the current order type */
  unitPrice: (l: CartLine) => string
}

const CartContext = createContext<CartValue | null>(null)

function lineFor(p: Product, selections: CartSelection[]): CartLine {
  const deltas = selections.map((s) => s.price_delta).filter((d) => new Big(d).gt(0))
  const store = resolveUnitPrice(p, 'store')
  const online = resolveUnitPrice(p, 'online')
  const key = [p.id, ...selections.map((s) => s.choice_id).sort()].join('|')
  return {
    key,
    product_id: p.id,
    name: p.name,
    options: selections,
    quantity: '1',
    unit_store: withOptionDeltas(store.price, deltas),
    unit_online: withOptionDeltas(online.price, deltas),
    original_store: withOptionDeltas(store.original, deltas),
    offer_applied: store.offer_applied,
  }
}

export function CartProvider({ children }: { children: ReactNode }) {
  const [lines, setLines] = useState<CartLine[]>([])
  const [orderType, setOrderType] = useState<CartOrderType>('counter')
  const [customerId, setCustomerId] = useState<string | null>(null)
  const [customerName, setCustomerName] = useState<string | null>(null)
  const [serviceChargeRate, setServiceChargeRate] = useState('0')

  const unitPrice = useCallback(
    (l: CartLine) => (orderType === 'delivery' ? l.unit_online : l.unit_store),
    [orderType],
  )

  const add = useCallback((p: Product, selections: CartSelection[] = []) => {
    const fresh = lineFor(p, selections)
    setLines((prev) => {
      const existing = prev.find((l) => l.key === fresh.key)
      if (existing) {
        return prev.map((l) =>
          l.key === fresh.key ? { ...l, quantity: new Big(l.quantity).plus(1).toString() } : l,
        )
      }
      return [...prev, fresh]
    })
  }, [])

  const increment = useCallback((key: string) => {
    setLines((prev) =>
      prev.map((l) =>
        l.key === key ? { ...l, quantity: new Big(l.quantity).plus(1).toString() } : l,
      ),
    )
  }, [])

  const decrement = useCallback((key: string) => {
    setLines((prev) =>
      prev.flatMap((l) => {
        if (l.key !== key) return [l]
        const next = new Big(l.quantity).minus(1)
        return next.lte(0) ? [] : [{ ...l, quantity: next.toString() }]
      }),
    )
  }, [])

  const remove = useCallback((key: string) => {
    setLines((prev) => prev.filter((l) => l.key !== key))
  }, [])

  const clear = useCallback(() => {
    setLines([])
    setCustomerId(null)
    setCustomerName(null)
    setOrderType('counter')
  }, [])

  const setCustomer = useCallback((id: string | null, name: string | null) => {
    setCustomerId(id)
    setCustomerName(name)
  }, [])

  const totals = useMemo(
    () =>
      computeTotals({
        lines: lines.map((l) => ({ unit_price: unitPrice(l), quantity: l.quantity })),
        order_type: orderType,
        service_charge_rate: serviceChargeRate,
      }),
    [lines, orderType, serviceChargeRate, unitPrice],
  )

  const itemCount = useMemo(
    () => lines.reduce((a, l) => a + Number(l.quantity), 0),
    [lines],
  )

  return (
    <CartContext.Provider
      value={{
        lines,
        orderType,
        customerId,
        customerName,
        totals,
        itemCount,
        add,
        increment,
        decrement,
        remove,
        clear,
        setOrderType,
        setCustomer,
        setServiceChargeRate,
        unitPrice,
      }}
    >
      {children}
    </CartContext.Provider>
  )
}

export function useCart(): CartValue {
  const ctx = useContext(CartContext)
  if (!ctx) throw new Error('useCart must be used inside <CartProvider>')
  return ctx
}
