import Big from 'big.js'
import { computeTotals } from '../lib/totals'
import type { OrderDiscount } from '../lib/totals'
import { products, stores, users, storeName } from './db'
import type { DbUser } from './db'

/** Business settings — the tenant row's JSONB in the real schema. */
export const businessSettings = {
  discount_approval_percent: '10',
  receipt_footer: 'Thank you — see you tomorrow!',
  business_name: 'Agricope Demo Trading Co.',
}

export const serviceChargeRates: Record<string, string> = {
  's-alrayyan': '0',
  's-karak': '10',
}

// ---------- entities ----------

export interface DbOrderItem {
  id: string
  product_id: string
  product_name: string
  unit_price: string
  quantity: string
  discount: string
  tax_rate: string
  line_total: string
  sent_to_kitchen_at: string | null
}

export interface DbPayment {
  id: string
  method: 'cash' | 'card' | 'online' | 'credit'
  amount: string
  tendered: string | null
  change_given: string | null
  reference: string | null
  received_by: string
  created_at: string
}

export interface DbOrder {
  id: string
  order_number: string
  store_id: string
  cashier_id: string
  customer_id: string | null
  status: 'open' | 'completed' | 'void' | 'refunded'
  order_type: 'counter' | 'dine_in' | 'takeaway' | 'delivery'
  table_id: string | null
  guest_count: number | null
  discount_type: 'percent' | 'fixed' | null
  discount_value: string | null
  discount_reason: string | null
  discount_approved_by: string | null
  subtotal: string
  discount_total: string
  service_charge_total: string
  tax_total: string
  total: string
  note: string | null
  receipt_token: string
  shift_id: string | null
  created_at: string
  completed_at: string | null
  items: DbOrderItem[]
  payments: DbPayment[]
}

export interface DbCustomer {
  id: string
  name: string
  phone: string | null
  email: string | null
  credit_limit: string | null
  notes: string | null
  is_active: boolean
}

export interface DbLedgerEntry {
  id: string
  customer_id: string
  entry_type: 'charge' | 'repayment' | 'adjustment'
  amount: string // charge +, repayment −
  order_id: string | null
  method: 'cash' | 'card' | 'online' | null
  note: string | null
  created_by: string
  created_at: string
  shift_id: string | null
}

export interface DbShift {
  id: string
  store_id: string
  status: 'open' | 'closed'
  opened_by: string
  closed_by: string | null
  opening_float: string
  expected_cash: string | null
  counted_cash: string | null
  over_short: string | null
  opened_at: string
  closed_at: string | null
}

export interface DbCashMovement {
  id: string
  shift_id: string
  type: 'paid_in' | 'paid_out'
  amount: string
  reason: string
  created_by: string
  created_at: string
}

export interface DbTable {
  id: string
  store_id: string
  name: string
  zone: string
  seats: number
  is_active: boolean
}

export interface DbTicketItem {
  id: string
  order_item_id: string
  product_name: string
  quantity: string
  note: string | null
  cancelled: boolean
}

export interface DbTicket {
  id: string
  order_id: string
  order_number: string
  table_name: string | null
  station_id: string
  status: 'new' | 'in_progress' | 'done' | 'cancelled'
  created_at: string
  done_at: string | null
  items: DbTicketItem[]
}

// ---------- state ----------

export const orders: DbOrder[] = []
export const customers: DbCustomer[] = []
export const ledger: DbLedgerEntry[] = []
export const shifts: DbShift[] = []
export const cashMovements: DbCashMovement[] = []
export const tables: DbTable[] = []
export const tickets: DbTicket[] = []

const seqByStoreDay = new Map<string, number>()

export function uid(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`
}

export function iso(minutesAgo = 0): string {
  return new Date(Date.now() - minutesAgo * 60_000).toISOString()
}

export function nextOrderNumber(storeId: string): string {
  const idx = stores.findIndex((s) => s.id === storeId) + 1
  const day = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  const key = `${storeId}:${day}`
  const seq = (seqByStoreDay.get(key) ?? 0) + 1
  seqByStoreDay.set(key, seq)
  return `S${idx}-${day}-${String(seq).padStart(4, '0')}`
}

// ---------- money helpers ----------

export function paymentsSum(order: DbOrder): Big {
  return order.payments.reduce((a, p) => a.plus(p.amount), new Big(0))
}

export function amountDue(order: DbOrder): string {
  const due = new Big(order.total).minus(paymentsSum(order))
  return (due.lt(0) ? new Big(0) : due).toFixed(2)
}

export function customerBalance(customerId: string): string {
  return ledger
    .filter((e) => e.customer_id === customerId)
    .reduce((a, e) => a.plus(e.amount), new Big(0))
    .toFixed(2)
}

export function currentShift(storeId: string): DbShift | undefined {
  return shifts.find((s) => s.store_id === storeId && s.status === 'open')
}

/** expected_cash = float + cash payments (refunds are negative rows) + cash repayments + paid_in − paid_out */
export function expectedCash(shift: DbShift): string {
  let sum = new Big(shift.opening_float)
  for (const o of orders) {
    if (o.shift_id !== shift.id) continue
    for (const p of o.payments) if (p.method === 'cash') sum = sum.plus(p.amount)
  }
  for (const e of ledger) {
    if (e.shift_id === shift.id && e.entry_type === 'repayment' && e.method === 'cash') {
      sum = sum.plus(new Big(e.amount).abs())
    }
  }
  for (const m of cashMovements) {
    if (m.shift_id !== shift.id) continue
    sum = m.type === 'paid_in' ? sum.plus(m.amount) : sum.minus(m.amount)
  }
  return sum.toFixed(2)
}

// ---------- order engine ----------

export function recomputeOrder(order: DbOrder): void {
  const totals = computeTotals({
    lines: order.items.map((i) => ({
      unit_price: i.unit_price,
      quantity: i.quantity,
      discount: i.discount,
      tax_rate: i.tax_rate,
    })),
    discount:
      order.discount_type && order.discount_value
        ? ({ type: order.discount_type, value: order.discount_value } as OrderDiscount)
        : null,
    order_type: order.order_type,
    service_charge_rate: serviceChargeRates[order.store_id] ?? '0',
  })
  order.items.forEach((item, i) => {
    item.line_total = totals.line_totals[i]
  })
  order.subtotal = totals.subtotal
  order.discount_total = totals.discount_total
  order.service_charge_total = totals.service_charge_total
  order.tax_total = totals.tax_total
  order.total = totals.total
}

export function snapshotItem(productId: string, quantity: string, discount = '0'): DbOrderItem {
  const p = products.find((x) => x.id === productId)
  if (!p) throw new Error('NO_SUCH_PRODUCT')
  return {
    id: uid('oi'),
    product_id: p.id,
    product_name: p.name, // snapshot — renames never touch old receipts
    unit_price: p.price, // snapshot
    quantity,
    discount,
    tax_rate: p.tax_rate, // snapshot
    line_total: '0',
    sent_to_kitchen_at: null,
  }
}

export function makeOrder(input: {
  store_id: string
  cashier: DbUser
  order_type: DbOrder['order_type']
  customer_id?: string | null
  table_id?: string | null
  guest_count?: number | null
  items: { product_id: string; quantity: string; discount?: string }[]
  created_at?: string
}): DbOrder {
  const order: DbOrder = {
    id: uid('o'),
    order_number: nextOrderNumber(input.store_id),
    store_id: input.store_id,
    cashier_id: input.cashier.id,
    customer_id: input.customer_id ?? null,
    status: 'open',
    order_type: input.order_type,
    table_id: input.table_id ?? null,
    guest_count: input.guest_count ?? null,
    discount_type: null,
    discount_value: null,
    discount_reason: null,
    discount_approved_by: null,
    subtotal: '0',
    discount_total: '0',
    service_charge_total: '0',
    tax_total: '0',
    total: '0',
    note: null,
    receipt_token: crypto.randomUUID(),
    shift_id: currentShift(input.store_id)?.id ?? null,
    created_at: input.created_at ?? iso(),
    completed_at: null,
    items: input.items.map((i) => snapshotItem(i.product_id, i.quantity, i.discount ?? '0')),
    payments: [],
  }
  recomputeOrder(order)
  orders.push(order)
  return order
}

export function userName(id: string): string {
  return users.find((u) => u.id === id)?.name ?? 'Unknown'
}

export function tableName(id: string | null): string | null {
  return id ? (tables.find((t) => t.id === id)?.name ?? null) : null
}

export function toPublicOrder(o: DbOrder) {
  return {
    id: o.id,
    order_number: o.order_number,
    store_id: o.store_id,
    status: o.status,
    order_type: o.order_type,
    cashier_name: userName(o.cashier_id),
    customer_id: o.customer_id,
    customer_name: o.customer_id ? (customers.find((c) => c.id === o.customer_id)?.name ?? null) : null,
    table_id: o.table_id,
    table_name: tableName(o.table_id),
    guest_count: o.guest_count,
    subtotal: o.subtotal,
    discount_total: o.discount_total,
    discount_type: o.discount_type,
    discount_value: o.discount_value,
    discount_reason: o.discount_reason,
    service_charge_total: o.service_charge_total,
    tax_total: o.tax_total,
    total: o.total,
    amount_due: amountDue(o),
    receipt_token: o.receipt_token,
    note: o.note,
    created_at: o.created_at,
    completed_at: o.completed_at,
    items: o.items.map((i) => ({ ...i })),
    payments: o.payments.map((p) => ({
      id: p.id,
      method: p.method,
      amount: p.amount,
      tendered: p.tendered,
      change_given: p.change_given,
      reference: p.reference,
      received_by_name: userName(p.received_by),
      created_at: p.created_at,
    })),
  }
}

/** Managers and owners approve sensitive actions with their PIN. */
export function approverForPin(pin: string | null): DbUser | null {
  if (!pin) return null
  return (
    users.find(
      (u) => u.is_active && u.pin === pin && (u.role === 'manager' || u.role === 'owner'),
    ) ?? null
  )
}

export { storeName }
