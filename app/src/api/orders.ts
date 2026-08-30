import { api } from './client'
import type { Paginated } from './types'

export type OrderStatus = 'open' | 'completed' | 'void' | 'refunded'
export type OrderType = 'counter' | 'dine_in' | 'takeaway' | 'delivery'
export type PaymentMethod = 'cash' | 'card' | 'online' | 'credit'

export interface OrderItem {
  id: string
  product_id: string
  product_name: string
  /** selected option labels, e.g. ["Spicy"] — printed on tickets and receipts */
  options: string[]
  unit_price: string
  quantity: string
  discount: string
  tax_rate: string
  line_total: string
  sent_to_kitchen_at: string | null
}

export interface Payment {
  id: string
  method: PaymentMethod
  amount: string
  tendered: string | null
  change_given: string | null
  reference: string | null
  received_by_name: string
  created_at: string
}

export interface Order {
  id: string
  order_number: string
  store_id: string
  status: OrderStatus
  order_type: OrderType
  cashier_name: string
  customer_id: string | null
  customer_name: string | null
  /** null = this customer has no credit facility yet */
  customer_credit_limit: string | null
  customer_balance: string | null
  table_id: string | null
  table_name: string | null
  /** the table's zone — "Main hall" — so a tab can say where it is */
  table_zone: string | null
  guest_count: number | null
  subtotal: string
  discount_total: string
  discount_type: 'percent' | 'fixed' | null
  discount_value: string | null
  discount_reason: string | null
  service_charge_total: string
  tax_total: string
  total: string
  amount_due: string
  receipt_token: string
  note: string | null
  created_at: string
  completed_at: string | null
  items: OrderItem[]
  payments: Payment[]
}

export interface NewOrderInput {
  store_id: string
  order_type: OrderType
  customer_id?: string | null
  table_id?: string | null
  guest_count?: number | null
  /** option_ids: selected option-choice ids — the server resolves labels & deltas */
  items: { product_id: string; quantity: string; discount?: string; option_ids?: string[] }[]
}

export function createOrder(input: NewOrderInput): Promise<Order> {
  return api<Order>('/orders', { method: 'POST', body: JSON.stringify(input) })
}

export function getOrder(id: string): Promise<Order> {
  return api<Order>(`/orders/${id}`)
}

export interface OrderFilters {
  store_id?: string
  status?: OrderStatus
  search?: string
}

export function listOrders(filters: OrderFilters = {}): Promise<Paginated<Order>> {
  const q = new URLSearchParams()
  if (filters.store_id) q.set('store_id', filters.store_id)
  if (filters.status) q.set('status', filters.status)
  if (filters.search) q.set('search', filters.search)
  const qs = q.toString()
  return api<Paginated<Order>>(`/orders${qs ? `?${qs}` : ''}`)
}

export interface PaymentInput {
  method: PaymentMethod
  amount: string
  tendered?: string
  reference?: string
}

export function addPayment(orderId: string, input: PaymentInput): Promise<Order> {
  return api<Order>(`/orders/${orderId}/payments`, { method: 'POST', body: JSON.stringify(input) })
}

export function attachCustomer(orderId: string, customer_id: string | null): Promise<Order> {
  return api<Order>(`/orders/${orderId}`, { method: 'PATCH', body: JSON.stringify({ customer_id }) })
}

/** Dine-in orders can start without a table; assigning one later is optional. */
export function assignTable(orderId: string, table_id: string | null): Promise<Order> {
  return api<Order>(`/orders/${orderId}`, { method: 'PATCH', body: JSON.stringify({ table_id }) })
}

export function applyDiscount(
  orderId: string,
  input: { type: 'percent' | 'fixed'; value: string; reason: string },
  approvalPin?: string,
): Promise<Order> {
  return api<Order>(`/orders/${orderId}/discount`, {
    method: 'POST',
    body: JSON.stringify(input),
    headers: approvalPin ? { 'X-Approval-Pin': approvalPin } : undefined,
  })
}

export function removeDiscount(orderId: string): Promise<Order> {
  return api<Order>(`/orders/${orderId}/discount`, { method: 'DELETE' })
}

export function voidOrder(orderId: string, approvalPin?: string): Promise<Order> {
  return api<Order>(`/orders/${orderId}/void`, {
    method: 'POST',
    body: JSON.stringify({}),
    headers: approvalPin ? { 'X-Approval-Pin': approvalPin } : undefined,
  })
}

export function refundOrder(orderId: string, approvalPin?: string): Promise<Order> {
  return api<Order>(`/orders/${orderId}/refund`, {
    method: 'POST',
    body: JSON.stringify({}),
    headers: approvalPin ? { 'X-Approval-Pin': approvalPin } : undefined,
  })
}

export function addOrderItems(
  orderId: string,
  items: { product_id: string; quantity: string; option_ids?: string[] }[],
): Promise<Order> {
  return api<Order>(`/orders/${orderId}/items`, { method: 'POST', body: JSON.stringify({ items }) })
}

export function updateOrderItem(
  orderId: string,
  itemId: string,
  input: { quantity: string },
): Promise<Order> {
  return api<Order>(`/orders/${orderId}/items/${itemId}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  })
}

export function removeOrderItem(orderId: string, itemId: string, approvalPin?: string): Promise<Order> {
  return api<Order>(`/orders/${orderId}/items/${itemId}`, {
    method: 'DELETE',
    headers: approvalPin ? { 'X-Approval-Pin': approvalPin } : undefined,
  })
}

export function splitOrder(
  orderId: string,
  items: { order_item_id: string; quantity: string }[],
): Promise<{ original: Order; split: Order }> {
  return api<{ original: Order; split: Order }>(`/orders/${orderId}/split`, {
    method: 'POST',
    body: JSON.stringify({ items }),
  })
}

export function mergeOrder(orderId: string, source_order_id: string): Promise<Order> {
  return api<Order>(`/orders/${orderId}/merge`, {
    method: 'POST',
    body: JSON.stringify({ source_order_id }),
  })
}

export function sendToKitchen(orderId: string): Promise<Order> {
  return api<Order>(`/orders/${orderId}/send`, { method: 'POST', body: JSON.stringify({}) })
}
