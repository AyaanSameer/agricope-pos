import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import Big from 'big.js'
import type { Product } from '../api/catalog'
import { computeTotals } from '../lib/totals'
import type { Totals } from '../lib/totals'

/**
 * The register cart is plain local state — nothing touches the API until
 * Charge is pressed. Server totals are authoritative; this preview uses the
 * same computeTotals the mock server runs, so they always agree.
 */
export interface CartLine {
  product_id: string
  name: string
  unit_price: string
  quantity: string
}

interface CartValue {
  lines: CartLine[]
  orderType: 'counter' | 'takeaway'
  customerId: string | null
  customerName: string | null
  totals: Totals
  itemCount: number
  add: (p: Product) => void
  increment: (productId: string) => void
  decrement: (productId: string) => void
  remove: (productId: string) => void
  clear: () => void
  setOrderType: (t: 'counter' | 'takeaway') => void
  setCustomer: (id: string | null, name: string | null) => void
}

const CartContext = createContext<CartValue | null>(null)

export function CartProvider({ children }: { children: ReactNode }) {
  const [lines, setLines] = useState<CartLine[]>([])
  const [orderType, setOrderType] = useState<'counter' | 'takeaway'>('counter')
  const [customerId, setCustomerId] = useState<string | null>(null)
  const [customerName, setCustomerName] = useState<string | null>(null)

  const add = useCallback((p: Product) => {
    setLines((prev) => {
      const existing = prev.find((l) => l.product_id === p.id)
      if (existing) {
        return prev.map((l) =>
          l.product_id === p.id ? { ...l, quantity: new Big(l.quantity).plus(1).toString() } : l,
        )
      }
      return [...prev, { product_id: p.id, name: p.name, unit_price: p.price, quantity: '1' }]
    })
  }, [])

  const increment = useCallback((productId: string) => {
    setLines((prev) =>
      prev.map((l) =>
        l.product_id === productId ? { ...l, quantity: new Big(l.quantity).plus(1).toString() } : l,
      ),
    )
  }, [])

  const decrement = useCallback((productId: string) => {
    setLines((prev) =>
      prev.flatMap((l) => {
        if (l.product_id !== productId) return [l]
        const next = new Big(l.quantity).minus(1)
        return next.lte(0) ? [] : [{ ...l, quantity: next.toString() }]
      }),
    )
  }, [])

  const remove = useCallback((productId: string) => {
    setLines((prev) => prev.filter((l) => l.product_id !== productId))
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
        lines: lines.map((l) => ({ unit_price: l.unit_price, quantity: l.quantity })),
        order_type: orderType,
      }),
    [lines, orderType],
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
