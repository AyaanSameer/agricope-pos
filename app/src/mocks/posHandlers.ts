import { http, HttpResponse, delay } from 'msw'
import Big from 'big.js'
import { products, requester, stores } from './db'
import {
  amountDue,
  approverForPin,
  businessSettings,
  cashMovements,
  currentShift,
  customerBalance,
  customers,
  expectedCash,
  iso,
  ledger,
  makeOrder,
  orders,
  paymentsSum,
  recomputeOrder,
  shifts,
  snapshotItem,
  tables,
  tickets,
  toPublicOrder,
  uid,
  userName,
} from './posdb'
import type { DbOrder, DbShift } from './posdb'
import { seedWorld } from './seed'

seedWorld()

function apiError(status: number, code: string, message: string) {
  return HttpResponse.json({ error: { code, message } }, { status })
}

function auth(request: Request) {
  return requester(request)
}

function findOrder(id: string | readonly string[]): DbOrder | undefined {
  return orders.find((o) => o.id === id)
}

/** Sensitive actions need a manager/owner PIN in X-Approval-Pin. */
function approval(request: Request) {
  return approverForPin(request.headers.get('X-Approval-Pin'))
}

const APPROVAL_REQUIRED = () =>
  apiError(403, 'APPROVAL_REQUIRED', 'A manager PIN is needed to approve this.')

export const posHandlers = [
  // ---------- orders ----------

  http.post('/api/v1/orders', async ({ request }) => {
    await delay(300)
    const caller = auth(request)
    if (!caller) return apiError(401, 'UNAUTHENTICATED', 'Sign in to continue.')
    const body = (await request.json()) as {
      store_id?: string
      order_type?: DbOrder['order_type']
      customer_id?: string | null
      table_id?: string | null
      guest_count?: number | null
      items?: { product_id: string; quantity: string; discount?: string }[]
    }
    if (!body.store_id || !stores.some((s) => s.id === body.store_id)) {
      return apiError(400, 'VALIDATION_ERROR', 'A valid store_id is required.')
    }
    const items = body.items ?? []
    for (const i of items) {
      const p = products.find((x) => x.id === i.product_id && x.is_active)
      if (!p) return apiError(400, 'VALIDATION_ERROR', 'Order contains an unknown or inactive product.')
      if (!(Number(i.quantity) > 0)) return apiError(400, 'VALIDATION_ERROR', 'Quantities must be positive.')
    }
    if (body.table_id) {
      const occupied = orders.some((o) => o.status === 'open' && o.table_id === body.table_id)
      if (occupied) return apiError(409, 'TABLE_OCCUPIED', 'That table already has an open tab.')
    }
    const order = makeOrder({
      store_id: body.store_id,
      cashier: caller,
      order_type: body.order_type ?? 'counter',
      customer_id: body.customer_id ?? null,
      table_id: body.table_id ?? null,
      guest_count: body.guest_count ?? null,
      items,
    })
    return HttpResponse.json(toPublicOrder(order), { status: 201 })
  }),

  http.get('/api/v1/orders', async ({ request }) => {
    await delay(250)
    if (!auth(request)) return apiError(401, 'UNAUTHENTICATED', 'Sign in to continue.')
    const url = new URL(request.url)
    const storeId = url.searchParams.get('store_id')
    const status = url.searchParams.get('status')
    const search = url.searchParams.get('search')?.toLowerCase()
    let data = [...orders]
    if (storeId) data = data.filter((o) => o.store_id === storeId)
    if (status) data = data.filter((o) => o.status === status)
    if (search) data = data.filter((o) => o.order_number.toLowerCase().includes(search))
    data.sort((a, b) => b.created_at.localeCompare(a.created_at))
    return HttpResponse.json({ data: data.map(toPublicOrder), total: data.length, page: 1, limit: 200 })
  }),

  http.get('/api/v1/orders/:id', async ({ request, params }) => {
    await delay(150)
    if (!auth(request)) return apiError(401, 'UNAUTHENTICATED', 'Sign in to continue.')
    const order = findOrder(params.id as string)
    if (!order) return apiError(404, 'NOT_FOUND', 'No such order.')
    return HttpResponse.json(toPublicOrder(order))
  }),

  http.patch('/api/v1/orders/:id', async ({ request, params }) => {
    await delay(200)
    if (!auth(request)) return apiError(401, 'UNAUTHENTICATED', 'Sign in to continue.')
    const order = findOrder(params.id as string)
    if (!order) return apiError(404, 'NOT_FOUND', 'No such order.')
    if (order.status !== 'open') return apiError(409, 'ORDER_NOT_OPEN', 'Only open orders can change.')
    const body = (await request.json()) as { customer_id?: string | null; guest_count?: number }
    if (body.customer_id !== undefined) {
      if (body.customer_id && !customers.some((c) => c.id === body.customer_id && c.is_active)) {
        return apiError(400, 'VALIDATION_ERROR', 'No such customer.')
      }
      order.customer_id = body.customer_id
    }
    if (body.guest_count !== undefined) order.guest_count = body.guest_count
    return HttpResponse.json(toPublicOrder(order))
  }),

  http.post('/api/v1/orders/:id/payments', async ({ request, params }) => {
    await delay(350)
    const caller = auth(request)
    if (!caller) return apiError(401, 'UNAUTHENTICATED', 'Sign in to continue.')
    const order = findOrder(params.id as string)
    if (!order) return apiError(404, 'NOT_FOUND', 'No such order.')
    if (order.status !== 'open') return apiError(409, 'ORDER_NOT_OPEN', 'This order is already settled.')
    const body = (await request.json()) as {
      method?: 'cash' | 'card' | 'online' | 'credit'
      amount?: string
      tendered?: string
      reference?: string
    }
    const method = body.method
    if (!method || !['cash', 'card', 'online', 'credit'].includes(method)) {
      return apiError(400, 'VALIDATION_ERROR', 'Unknown payment method.')
    }
    if (!body.amount || !new Big(body.amount).gt(0)) {
      return apiError(400, 'VALIDATION_ERROR', 'Payment amount must be positive.')
    }
    const due = new Big(amountDue(order))
    const amount = new Big(body.amount)
    if (amount.gt(due)) {
      return apiError(400, 'VALIDATION_ERROR', `Amount exceeds the QAR ${due.toFixed(2)} due.`)
    }

    let shiftId = order.shift_id
    if (method === 'cash') {
      const shift = currentShift(order.store_id)
      if (!shift) {
        return apiError(409, 'NO_OPEN_SHIFT', 'Open a shift before taking cash — the drawer must know where money lives.')
      }
      shiftId = shift.id
      order.shift_id = shift.id
    }

    if (method === 'credit') {
      if (!order.customer_id) {
        return apiError(400, 'CUSTOMER_REQUIRED', 'Attach a customer before selling on credit.')
      }
      const customer = customers.find((c) => c.id === order.customer_id)!
      if (customer.credit_limit === null) {
        return apiError(403, 'CREDIT_LIMIT_EXCEEDED', `${customer.name} has no credit facility.`)
      }
      const newBalance = new Big(customerBalance(customer.id)).plus(amount)
      if (newBalance.gt(customer.credit_limit)) {
        return apiError(
          403,
          'CREDIT_LIMIT_EXCEEDED',
          `This would put ${customer.name} at QAR ${newBalance.toFixed(2)}, over their QAR ${customer.credit_limit} limit.`,
        )
      }
    }

    let change: string | null = null
    if (method === 'cash' && body.tendered) {
      const tendered = new Big(body.tendered)
      if (tendered.lt(amount)) return apiError(400, 'VALIDATION_ERROR', 'Tendered cash is less than the amount.')
      change = tendered.minus(amount).toFixed(2)
    }

    order.payments.push({
      id: uid('pay'),
      method,
      amount: amount.toFixed(2),
      tendered: method === 'cash' ? (body.tendered ?? amount.toFixed(2)) : null,
      change_given: change,
      reference: body.reference ?? null,
      received_by: caller.id,
      created_at: iso(),
    })

    if (method === 'credit') {
      ledger.push({
        id: uid('lg'),
        customer_id: order.customer_id!,
        entry_type: 'charge',
        amount: amount.toFixed(2),
        order_id: order.id,
        method: null,
        note: `Order ${order.order_number}`,
        created_by: caller.id,
        created_at: iso(),
        shift_id: shiftId,
      })
    }

    // completed ⇔ SUM(payments) = total — the rule the backend enforces in a transaction
    if (paymentsSum(order).gte(order.total)) {
      order.status = 'completed'
      order.completed_at = iso()
    }
    return HttpResponse.json(toPublicOrder(order))
  }),

  http.post('/api/v1/orders/:id/discount', async ({ request, params }) => {
    await delay(250)
    const caller = auth(request)
    if (!caller) return apiError(401, 'UNAUTHENTICATED', 'Sign in to continue.')
    const order = findOrder(params.id as string)
    if (!order) return apiError(404, 'NOT_FOUND', 'No such order.')
    if (order.status !== 'open') return apiError(409, 'ORDER_NOT_OPEN', 'Only open orders can be discounted.')
    if (order.payments.length) return apiError(409, 'PAYMENTS_STARTED', 'Remove payments before changing the discount.')
    const body = (await request.json()) as { type?: 'percent' | 'fixed'; value?: string; reason?: string }
    if (!body.type || !body.value || !new Big(body.value).gt(0)) {
      return apiError(400, 'VALIDATION_ERROR', 'Discount type and a positive value are required.')
    }
    if (body.type === 'percent' && new Big(body.value).gt(100)) {
      return apiError(400, 'VALIDATION_ERROR', 'A percent discount cannot exceed 100.')
    }
    const threshold = new Big(businessSettings.discount_approval_percent)
    const pctEquivalent =
      body.type === 'percent'
        ? new Big(body.value)
        : new Big(order.subtotal).gt(0)
          ? new Big(body.value).times(100).div(order.subtotal)
          : new Big(0)
    let approvedBy: string | null = null
    if (pctEquivalent.gt(threshold)) {
      const approver = approval(request)
      if (!approver) return APPROVAL_REQUIRED()
      approvedBy = approver.id
    }
    order.discount_type = body.type
    order.discount_value = new Big(body.value).toFixed(2)
    order.discount_reason = body.reason ?? null
    order.discount_approved_by = approvedBy
    recomputeOrder(order)
    return HttpResponse.json(toPublicOrder(order))
  }),

  http.delete('/api/v1/orders/:id/discount', async ({ request, params }) => {
    await delay(200)
    if (!auth(request)) return apiError(401, 'UNAUTHENTICATED', 'Sign in to continue.')
    const order = findOrder(params.id as string)
    if (!order) return apiError(404, 'NOT_FOUND', 'No such order.')
    if (order.status !== 'open') return apiError(409, 'ORDER_NOT_OPEN', 'Only open orders can change.')
    order.discount_type = null
    order.discount_value = null
    order.discount_reason = null
    order.discount_approved_by = null
    recomputeOrder(order)
    return HttpResponse.json(toPublicOrder(order))
  }),

  http.post('/api/v1/orders/:id/void', async ({ request, params }) => {
    await delay(250)
    if (!auth(request)) return apiError(401, 'UNAUTHENTICATED', 'Sign in to continue.')
    const order = findOrder(params.id as string)
    if (!order) return apiError(404, 'NOT_FOUND', 'No such order.')
    if (order.status !== 'open') return apiError(409, 'ORDER_NOT_OPEN', 'Only open orders can be voided.')
    const approver = approval(request)
    if (!approver) return APPROVAL_REQUIRED()
    order.status = 'void'
    order.note = order.note ?? `Voided — approved by ${approver.name}`
    for (const t of tickets) if (t.order_id === order.id && t.status !== 'done') t.status = 'cancelled'
    return HttpResponse.json(toPublicOrder(order))
  }),

  http.post('/api/v1/orders/:id/refund', async ({ request, params }) => {
    await delay(300)
    const caller = auth(request)
    if (!caller) return apiError(401, 'UNAUTHENTICATED', 'Sign in to continue.')
    const order = findOrder(params.id as string)
    if (!order) return apiError(404, 'NOT_FOUND', 'No such order.')
    if (order.status !== 'completed') return apiError(409, 'ORDER_NOT_COMPLETED', 'Only completed orders can be refunded.')
    const approver = approval(request)
    if (!approver) return APPROVAL_REQUIRED()
    const hasCash = order.payments.some((p) => p.method === 'cash' && new Big(p.amount).gt(0))
    if (hasCash && !currentShift(order.store_id)) {
      return apiError(409, 'NO_OPEN_SHIFT', 'Open a shift first — cash refunds come out of the drawer.')
    }
    const originals = [...order.payments]
    for (const p of originals) {
      if (new Big(p.amount).lte(0)) continue
      order.payments.push({
        id: uid('pay'),
        method: p.method,
        amount: new Big(p.amount).times(-1).toFixed(2),
        tendered: null,
        change_given: null,
        reference: p.method === 'card' ? p.reference : null,
        received_by: caller.id,
        created_at: iso(),
      })
      if (p.method === 'credit' && order.customer_id) {
        ledger.push({
          id: uid('lg'),
          customer_id: order.customer_id,
          entry_type: 'adjustment',
          amount: new Big(p.amount).times(-1).toFixed(2),
          order_id: order.id,
          method: null,
          note: `Refund of ${order.order_number} — approved by ${approver.name}`,
          created_by: caller.id,
          created_at: iso(),
          shift_id: currentShift(order.store_id)?.id ?? null,
        })
      }
    }
    order.status = 'refunded'
    return HttpResponse.json(toPublicOrder(order))
  }),

  // ---------- receipt (authenticated + public-by-token) ----------

  http.get('/api/v1/orders/:id/receipt', async ({ request, params }) => {
    await delay(150)
    if (!auth(request)) return apiError(401, 'UNAUTHENTICATED', 'Sign in to continue.')
    const order = findOrder(params.id as string)
    if (!order) return apiError(404, 'NOT_FOUND', 'No such order.')
    return HttpResponse.json(receiptPayload(order))
  }),

  http.get('/api/v1/r/:token', async ({ params }) => {
    await delay(200)
    const order = orders.find((o) => o.receipt_token === params.token)
    if (!order) return apiError(404, 'NOT_FOUND', 'This receipt link is not valid.')
    return HttpResponse.json(receiptPayload(order))
  }),
]

export function receiptPayload(order: DbOrder) {
  const store = stores.find((s) => s.id === order.store_id)
  const creditPayment = order.payments.find((p) => p.method === 'credit')
  return {
    business: { name: businessSettings.business_name, footer: businessSettings.receipt_footer },
    store: { name: store?.name ?? '', address: store?.address ?? '' },
    order: toPublicOrder(order),
    credit:
      creditPayment && order.customer_id
        ? {
            customer_name: customers.find((c) => c.id === order.customer_id)?.name ?? '',
            balance: customerBalance(order.customer_id),
          }
        : null,
  }
}

export { apiError, auth, findOrder, approval, APPROVAL_REQUIRED }
export type { DbShift }
