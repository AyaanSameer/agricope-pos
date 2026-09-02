import Big from 'big.js'
import type { PoolClient } from 'pg'
import { many, one } from '../db.js'
import type { Queryable } from '../db.js'
import { invalid } from '../errors.js'
import { computeTotals } from '../lib/totals.js'
import type { OrderDiscount } from '../lib/totals.js'
import { channelForOrderType, resolveUnitPrice, withOptionDeltas } from '../lib/pricing.js'
import type { ProductOffer } from '../lib/pricing.js'
import { money, moneyOrNull, qty, rate } from '../serialize.js'

/**
 * The order engine. Everything that decides what an order costs lives here,
 * and it is the same arithmetic the register previews with (lib/totals,
 * lib/pricing — pinned to the frontend's copies by test). Routes validate,
 * authorise and call in; they never compute a price themselves.
 */

export type OrderStatus = 'open' | 'completed' | 'void' | 'refunded'
export type OrderType = 'counter' | 'dine_in' | 'takeaway' | 'delivery'
export type PaymentMethod = 'cash' | 'card' | 'online' | 'credit'

export interface OrderItemRow {
  id: string
  order_id: string
  product_id: string | null
  product_name: string
  options: string[]
  unit_price: string
  quantity: string
  discount: string
  tax_rate: string
  line_total: string
  sent_to_kitchen_at: string | null
  position: number
}

export interface PaymentRow {
  id: string
  order_id: string
  method: PaymentMethod
  amount: string
  tendered: string | null
  change_given: string | null
  reference: string | null
  received_by: string | null
  received_by_name: string
  created_at: string
}

export interface OrderRow {
  id: string
  store_id: string
  order_number: string
  cashier_id: string | null
  cashier_name: string
  customer_id: string | null
  status: OrderStatus
  order_type: OrderType
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
  // joined
  business_id: string
  service_charge_rate: string
  customer_name: string | null
  customer_credit_limit: string | null
  customer_balance: string | null
  table_name: string | null
  table_zone: string | null
}

export interface LoadedOrder extends OrderRow {
  items: OrderItemRow[]
  payments: PaymentRow[]
}

const ORDER_SELECT = `
  select o.*, s.business_id, s.service_charge_rate,
         c.name as customer_name, c.credit_limit as customer_credit_limit,
         case when o.customer_id is null then null
              else (select coalesce(sum(l.amount), 0) from credit_ledger l where l.customer_id = o.customer_id)
         end as customer_balance,
         t.name as table_name, t.zone as table_zone
    from orders o
    join stores s on s.id = o.store_id
    left join customers c on c.id = o.customer_id
    left join dining_tables t on t.id = o.table_id`

async function attach(db: Queryable, rows: OrderRow[]): Promise<LoadedOrder[]> {
  if (rows.length === 0) return []
  const ids = rows.map((r) => r.id)
  const items = await many<OrderItemRow>(
    'select * from order_items where order_id = any($1) order by position, id',
    [ids],
    db,
  )
  const payments = await many<PaymentRow>(
    'select * from payments where order_id = any($1) order by created_at, id',
    [ids],
    db,
  )
  const byOrder = new Map<string, LoadedOrder>(rows.map((r) => [r.id, { ...r, items: [], payments: [] }]))
  for (const i of items) byOrder.get(i.order_id)!.items.push(i)
  for (const p of payments) byOrder.get(p.order_id)!.payments.push(p)
  return rows.map((r) => byOrder.get(r.id)!)
}

/** An order is invisible outside its business — RLS by query. */
export async function loadOrder(
  db: Queryable,
  id: string,
  businessId?: string,
  opts: { forUpdate?: boolean } = {},
): Promise<LoadedOrder | null> {
  const row = await one<OrderRow>(
    `${ORDER_SELECT} where o.id = $1 ${businessId ? 'and s.business_id = $2' : ''} ${opts.forUpdate ? 'for update of o' : ''}`,
    businessId ? [id, businessId] : [id],
    db,
  )
  if (!row) return null
  return (await attach(db, [row]))[0]
}

export async function loadOrderByToken(db: Queryable, token: string): Promise<LoadedOrder | null> {
  const row = await one<OrderRow>(`${ORDER_SELECT} where o.receipt_token = $1`, [token], db)
  if (!row) return null
  return (await attach(db, [row]))[0]
}

export async function listOrders(
  db: Queryable,
  businessId: string,
  filter: { store_id?: string; status?: string; search?: string },
): Promise<LoadedOrder[]> {
  const where = ['s.business_id = $1']
  const params: unknown[] = [businessId]
  if (filter.store_id) {
    params.push(filter.store_id)
    where.push(`o.store_id = $${params.length}`)
  }
  if (filter.status) {
    params.push(filter.status)
    where.push(`o.status = $${params.length}`)
  }
  if (filter.search) {
    params.push(`%${filter.search.toLowerCase()}%`)
    where.push(`lower(o.order_number) like $${params.length}`)
  }
  const rows = await many<OrderRow>(
    `${ORDER_SELECT} where ${where.join(' and ')} order by o.created_at desc limit 500`,
    params,
    db,
  )
  return attach(db, rows)
}

/* ---------- time: the business's day, not the server's ---------- */

/** 'YYYY-MM-DD' in the business's timezone. */
export function businessDay(at: Date, tz: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at)
}

/**
 * S{branch}-{YYYYMMDD}-{NNNN}. The per-branch-per-day counter is bumped
 * inside the caller's transaction, so two tills never mint the same number.
 */
export async function nextOrderNumber(tx: PoolClient, storeId: string, tz: string, at = new Date()): Promise<string> {
  const day = businessDay(at, tz)
  const seq = await one<{ last: number }>(
    `insert into order_sequences (store_id, day, last) values ($1, $2, 1)
       on conflict (store_id, day) do update set last = order_sequences.last + 1
     returning last`,
    [storeId, day],
    tx,
  )
  const store = await one<{ store_number: number }>('select store_number from stores where id = $1', [storeId], tx)
  return `S${store!.store_number}-${day.replace(/-/g, '')}-${String(seq!.last).padStart(4, '0')}`
}

/* ---------- money ---------- */

export function paymentsSum(order: { payments: { amount: string }[] }): Big {
  return order.payments.reduce((a, p) => a.plus(p.amount), new Big(0))
}

export function amountDue(order: { total: string; payments: { amount: string }[] }): string {
  const due = new Big(order.total).minus(paymentsSum(order))
  return (due.lt(0) ? new Big(0) : due).toFixed(2)
}

export async function customerBalance(db: Queryable, customerId: string): Promise<string> {
  const row = await one<{ balance: string }>(
    'select coalesce(sum(amount), 0) as balance from credit_ledger where customer_id = $1',
    [customerId],
    db,
  )
  return money(row?.balance ?? 0)
}

export async function currentShift(db: Queryable, storeId: string): Promise<{ id: string } | null> {
  return one<{ id: string }>("select id from shifts where store_id = $1 and status = 'open'", [storeId], db)
}

/** float + cash payments (refunds are negative rows) + cash repayments + paid_in − paid_out */
export async function expectedCash(db: Queryable, shiftId: string): Promise<string> {
  const row = await one<{ expected: string }>(
    `select s.opening_float
          + coalesce((select sum(p.amount) from payments p join orders o on o.id = p.order_id
                       where o.shift_id = s.id and p.method = 'cash'), 0)
          + coalesce((select sum(abs(l.amount)) from credit_ledger l
                       where l.shift_id = s.id and l.entry_type = 'repayment' and l.method = 'cash'), 0)
          + coalesce((select sum(case when m.type = 'paid_in' then m.amount else -m.amount end)
                        from cash_movements m where m.shift_id = s.id), 0) as expected
       from shifts s where s.id = $1`,
    [shiftId],
    db,
  )
  return money(row?.expected ?? 0)
}

/* ---------- products → lines ---------- */

export interface OptionChoice {
  id: string
  name: string
  price_delta: string
}
export interface OptionGroup {
  id: string
  name: string
  required: boolean
  choices: OptionChoice[]
}

export interface ProductForSale {
  id: string
  business_id: string
  name: string
  description: string | null
  price: string
  price_online: string | null
  tax_rate: string
  offer: ProductOffer | null
  offer_online: ProductOffer | null
  option_groups: OptionGroup[]
  kitchen_station_id: string | null
  is_active: boolean
}

export async function loadProductsForSale(db: Queryable, businessId: string, ids: string[]): Promise<Map<string, ProductForSale>> {
  const rows = await many<ProductForSale>(
    `select id, business_id, name, description, price, price_online, tax_rate, offer, offer_online,
            option_groups, kitchen_station_id, is_active
       from products where business_id = $1 and id = any($2)`,
    [businessId, [...new Set(ids)]],
    db,
  )
  return new Map(rows.map((r) => [r.id, r]))
}

export interface ItemInput {
  product_id: string
  quantity: string
  discount?: string
  option_ids?: string[]
}

/** Every rule the till relies on before a line is accepted. */
export function validateItems(products: Map<string, ProductForSale>, items: ItemInput[], requireChoices = true): void {
  for (const i of items) {
    const p = products.get(i.product_id)
    if (!p || !p.is_active) throw invalid('Order contains an unknown or inactive product.')
    if (!(Number(i.quantity) > 0)) throw invalid('Quantities must be positive.')
    const validChoices = new Set(p.option_groups.flatMap((g) => g.choices.map((c) => c.id)))
    if ((i.option_ids ?? []).some((id) => !validChoices.has(id))) {
      throw invalid(`Unknown option for ${p.name}.`)
    }
    if (requireChoices) {
      for (const g of p.option_groups.filter((g) => g.required)) {
        if (!(i.option_ids ?? []).some((id) => g.choices.some((c) => c.id === id))) {
          throw invalid(`${p.name} needs a ${g.name} choice.`)
        }
      }
    }
  }
}

export type NewItem = Omit<OrderItemRow, 'id' | 'order_id' | 'position'>

/**
 * The server resolves the price — channel base, any live offer, then the
 * option deltas — and freezes name, price and tax onto the line. Client-sent
 * prices are ignored, always.
 */
export function snapshotItem(
  p: ProductForSale,
  quantity: string,
  discount = '0',
  orderType: OrderType = 'counter',
  optionIds: string[] = [],
): NewItem {
  const labels: string[] = []
  const deltas: string[] = []
  for (const id of optionIds) {
    const choice = p.option_groups.flatMap((g) => g.choices).find((c) => c.id === id)
    if (!choice) throw invalid(`Unknown option for ${p.name}.`)
    labels.push(choice.name)
    if (new Big(choice.price_delta).gt(0)) deltas.push(choice.price_delta)
  }
  const resolved = resolveUnitPrice(p, channelForOrderType(orderType))
  return {
    product_id: p.id,
    product_name: p.name,
    options: labels,
    unit_price: withOptionDeltas(resolved.price, deltas),
    quantity: new Big(quantity).toString(),
    discount: money(discount),
    tax_rate: p.tax_rate,
    line_total: '0.00',
    sent_to_kitchen_at: null,
  }
}

/* ---------- totals ---------- */

/** Recompute every derived figure on the loaded order, in memory. */
export function recompute(order: LoadedOrder): void {
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
    service_charge_rate: order.service_charge_rate,
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

/** Persist what recompute() decided. */
export async function saveTotals(tx: Queryable, order: LoadedOrder): Promise<void> {
  await tx.query(
    `update orders set subtotal = $2, discount_total = $3, service_charge_total = $4, tax_total = $5, total = $6
      where id = $1`,
    [order.id, order.subtotal, order.discount_total, order.service_charge_total, order.tax_total, order.total],
  )
  if (order.items.length) {
    await tx.query(
      `update order_items as oi set line_total = v.line_total
         from (select unnest($1::text[]) as id, unnest($2::numeric[]) as line_total) as v
        where oi.id = v.id`,
      [order.items.map((i) => i.id), order.items.map((i) => i.line_total)],
    )
  }
}

export async function insertItems(tx: Queryable, orderId: string, items: NewItem[], startPosition = 0): Promise<OrderItemRow[]> {
  const out: OrderItemRow[] = []
  let pos = startPosition
  for (const it of items) {
    const row = await one<OrderItemRow>(
      `insert into order_items (order_id, product_id, product_name, options, unit_price, quantity, discount, tax_rate, line_total, sent_to_kitchen_at, position)
       values ($1, $2, $3, $4::jsonb, $5, $6, $7, $8, $9, $10, $11) returning *`,
      [orderId, it.product_id, it.product_name, JSON.stringify(it.options), it.unit_price, it.quantity, it.discount, it.tax_rate, it.line_total, it.sent_to_kitchen_at, pos++],
      tx,
    )
    out.push(row!)
  }
  return out
}

export interface CreateOrderInput {
  store_id: string
  cashier: { id: string; name: string }
  order_type: OrderType
  customer_id?: string | null
  table_id?: string | null
  guest_count?: number | null
  items: NewItem[]
  created_at?: Date
  tz: string
}

export async function createOrder(tx: PoolClient, input: CreateOrderInput): Promise<LoadedOrder> {
  const at = input.created_at ?? new Date()
  const orderNumber = await nextOrderNumber(tx, input.store_id, input.tz, at)
  const shift = await currentShift(tx, input.store_id)
  const inserted = await one<{ id: string }>(
    `insert into orders (store_id, order_number, cashier_id, cashier_name, customer_id, status, order_type,
                         table_id, guest_count, shift_id, created_at)
     values ($1, $2, $3, $4, $5, 'open', $6, $7, $8, $9, $10) returning id`,
    [
      input.store_id,
      orderNumber,
      input.cashier.id,
      input.cashier.name,
      input.customer_id ?? null,
      input.order_type,
      input.table_id ?? null,
      input.guest_count ?? null,
      shift?.id ?? null,
      at.toISOString(),
    ],
    tx,
  )
  await insertItems(tx, inserted!.id, input.items)
  const order = (await loadOrder(tx, inserted!.id))!
  recompute(order)
  await saveTotals(tx, order)
  return order
}

/* ---------- wire ---------- */

export function orderOut(o: LoadedOrder) {
  return {
    id: o.id,
    order_number: o.order_number,
    store_id: o.store_id,
    status: o.status,
    order_type: o.order_type,
    cashier_name: o.cashier_name,
    customer_id: o.customer_id,
    customer_name: o.customer_name,
    customer_credit_limit: moneyOrNull(o.customer_credit_limit),
    customer_balance: o.customer_id ? money(o.customer_balance ?? 0) : null,
    table_id: o.table_id,
    table_name: o.table_name,
    table_zone: o.table_zone,
    guest_count: o.guest_count,
    subtotal: money(o.subtotal),
    discount_total: money(o.discount_total),
    discount_type: o.discount_type,
    discount_value: moneyOrNull(o.discount_value),
    discount_reason: o.discount_reason,
    service_charge_total: money(o.service_charge_total),
    tax_total: money(o.tax_total),
    total: money(o.total),
    amount_due: amountDue(o),
    receipt_token: o.receipt_token,
    note: o.note,
    created_at: o.created_at,
    completed_at: o.completed_at,
    items: o.items.map((i) => ({
      id: i.id,
      product_id: i.product_id,
      product_name: i.product_name,
      options: i.options,
      unit_price: money(i.unit_price),
      quantity: qty(i.quantity),
      discount: money(i.discount),
      tax_rate: rate(i.tax_rate),
      line_total: money(i.line_total),
      sent_to_kitchen_at: i.sent_to_kitchen_at,
    })),
    payments: o.payments.map((p) => ({
      id: p.id,
      method: p.method,
      amount: money(p.amount),
      tendered: moneyOrNull(p.tendered),
      change_given: moneyOrNull(p.change_given),
      reference: p.reference,
      received_by_name: p.received_by_name,
      created_at: p.created_at,
    })),
  }
}
