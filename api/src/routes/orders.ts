import Big from 'big.js'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { Ctx } from '../app.js'
import { approvalPinFrom, approverForPin, requireUser } from '../auth.js'
import { one, withTx } from '../db.js'
import type { Queryable } from '../db.js'
import { ApiError, approvalRequired, conflict, invalid, notFound } from '../errors.js'
import { paginated } from '../serialize.js'
import type { CustomerRow } from '../serialize.js'
import {
  amountDue,
  createOrder,
  currentShift,
  customerBalance,
  listOrders,
  loadOrder,
  loadOrderByToken,
  loadProductsForSale,
  orderOut,
  paymentsSum,
  recompute,
  saveTotals,
  snapshotItem,
  validateItems,
} from '../services/orders.js'
import type { LoadedOrder } from '../services/orders.js'

/**
 * The order lifecycle: ring it up, settle it, discount it with approval,
 * void or refund it with approval, print it. Every state change runs in a
 * transaction with the order row locked, so two tills settling the same tab
 * cannot both complete it.
 */

const MONEY = z.string().regex(/^\d+(\.\d{1,2})?$/, 'must look like "4.50"')
const QTY = z.string().regex(/^\d+(\.\d{1,3})?$/, 'must be a quantity like "2" or "1.500"')
const ORDER_TYPES = ['counter', 'dine_in', 'takeaway', 'delivery'] as const
const METHODS = ['cash', 'card', 'online', 'credit'] as const

export const itemInput = z.object({
  product_id: z.string(),
  quantity: QTY,
  discount: MONEY.optional(),
  option_ids: z.array(z.string()).optional(),
})

export async function mustLoad(db: Queryable, id: string, businessId: string, forUpdate = false): Promise<LoadedOrder> {
  const order = await loadOrder(db, id, businessId, { forUpdate })
  if (!order) throw notFound('order')
  return order
}

export function mustBeOpen(order: LoadedOrder, message = 'Only open orders can change.'): void {
  if (order.status !== 'open') throw conflict('ORDER_NOT_OPEN', message)
}

async function receiptPayload(db: Queryable, order: LoadedOrder) {
  const biz = await one<{ name: string; receipt_footer: string; store_name: string; address: string | null; phone: string | null }>(
    `select b.name, b.receipt_footer, s.name as store_name, s.address, s.phone
       from stores s join businesses b on b.id = s.business_id where s.id = $1`,
    [order.store_id],
    db,
  )
  const creditPayment = order.payments.find((p) => p.method === 'credit')
  return {
    business: { name: biz?.name ?? '', footer: biz?.receipt_footer ?? '' },
    store: { name: biz?.store_name ?? '', address: biz?.address ?? '', phone: biz?.phone ?? null },
    order: orderOut(order),
    credit:
      creditPayment && order.customer_id
        ? { customer_name: order.customer_name ?? '', balance: await customerBalance(db, order.customer_id) }
        : null,
  }
}

export async function orderRoutes(app: FastifyInstance, ctx: Ctx) {
  const approver = (req: Parameters<typeof approvalPinFrom>[0], businessId: string, db: Queryable = ctx.db) =>
    approverForPin(db, ctx.config.PIN_PEPPER, businessId, approvalPinFrom(req))

  app.post('/orders', async (req, reply) => {
    const caller = await requireUser(ctx, req)
    const body = z
      .object({
        store_id: z.string(),
        order_type: z.enum(ORDER_TYPES).default('counter'),
        customer_id: z.string().nullable().optional(),
        table_id: z.string().nullable().optional(),
        guest_count: z.number().int().positive().nullable().optional(),
        items: z.array(itemInput).default([]),
      })
      .parse(req.body)

    const store = await one<{ id: string; is_active: boolean }>(
      'select id, is_active from stores where id = $1 and business_id = $2',
      [body.store_id, caller.business_id],
    )
    if (!store) throw invalid('A valid store_id is required.')
    if (!store.is_active) throw invalid('That branch is deactivated.')

    const products = await loadProductsForSale(ctx.db, caller.business_id, body.items.map((i) => i.product_id))
    validateItems(products, body.items)

    if (body.customer_id) {
      const c = await one('select 1 from customers where id = $1 and business_id = $2 and is_active', [body.customer_id, caller.business_id])
      if (!c) throw invalid('No such customer.')
    }

    const order = await withTx(async (tx) => {
      if (body.table_id) {
        const table = await one('select 1 from dining_tables where id = $1 and store_id = $2 and is_active', [body.table_id, body.store_id], tx)
        if (!table) throw invalid('No such table on this branch.')
        const occupied = await one("select 1 from orders where status = 'open' and table_id = $1", [body.table_id], tx)
        if (occupied) throw conflict('TABLE_OCCUPIED', 'That table already has an open tab.')
      }
      return createOrder(tx, {
        store_id: body.store_id,
        cashier: caller,
        order_type: body.order_type,
        customer_id: body.customer_id ?? null,
        table_id: body.table_id ?? null,
        guest_count: body.guest_count ?? null,
        items: body.items.map((i) =>
          snapshotItem(products.get(i.product_id)!, i.quantity, i.discount ?? '0', body.order_type, i.option_ids),
        ),
        tz: ctx.config.BUSINESS_TZ,
      })
    })
    return reply.status(201).send(orderOut(order))
  })

  app.get('/orders', async (req) => {
    const caller = await requireUser(ctx, req)
    const q = z
      .object({ store_id: z.string().optional(), status: z.string().optional(), search: z.string().optional() })
      .parse(req.query)
    const orders = await listOrders(ctx.db, caller.business_id, q)
    return paginated(orders.map(orderOut), 200)
  })

  app.get('/orders/:id', async (req) => {
    const caller = await requireUser(ctx, req)
    const { id } = req.params as { id: string }
    return orderOut(await mustLoad(ctx.db, id, caller.business_id))
  })

  app.patch('/orders/:id', async (req) => {
    const caller = await requireUser(ctx, req)
    const { id } = req.params as { id: string }
    const body = z
      .object({
        customer_id: z.string().nullable().optional(),
        guest_count: z.number().int().positive().nullable().optional(),
        table_id: z.string().nullable().optional(),
      })
      .parse(req.body)
    const order = await withTx(async (tx) => {
      const order = await mustLoad(tx, id, caller.business_id, true)
      mustBeOpen(order)
      if (body.table_id !== undefined) {
        if (body.table_id) {
          const table = await one('select 1 from dining_tables where id = $1 and store_id = $2 and is_active', [body.table_id, order.store_id], tx)
          if (!table) throw invalid('No such table on this branch.')
          const occupied = await one("select 1 from orders where status = 'open' and table_id = $1 and id <> $2", [body.table_id, order.id], tx)
          if (occupied) throw conflict('TABLE_OCCUPIED', 'That table already has an open tab.')
        }
        await tx.query('update orders set table_id = $2 where id = $1', [order.id, body.table_id])
      }
      if (body.customer_id !== undefined) {
        if (body.customer_id) {
          const c = await one('select 1 from customers where id = $1 and business_id = $2 and is_active', [body.customer_id, caller.business_id], tx)
          if (!c) throw invalid('No such customer.')
        }
        await tx.query('update orders set customer_id = $2 where id = $1', [order.id, body.customer_id])
      }
      if (body.guest_count !== undefined) {
        await tx.query('update orders set guest_count = $2 where id = $1', [order.id, body.guest_count])
      }
      return mustLoad(tx, id, caller.business_id)
    })
    return orderOut(order)
  })

  app.post('/orders/:id/payments', async (req) => {
    const caller = await requireUser(ctx, req)
    const { id } = req.params as { id: string }
    const body = z
      .object({
        method: z.enum(METHODS),
        amount: MONEY,
        tendered: MONEY.optional(),
        reference: z.string().optional(),
      })
      .parse(req.body)
    const amount = new Big(body.amount)
    if (!amount.gt(0)) throw invalid('Payment amount must be positive.')

    const order = await withTx(async (tx) => {
      const order = await mustLoad(tx, id, caller.business_id, true)
      mustBeOpen(order, 'This order is already settled.')
      const due = new Big(amountDue(order))
      if (amount.gt(due)) throw invalid(`Amount exceeds the QAR ${due.toFixed(2)} due.`)

      let shiftId = order.shift_id
      if (body.method === 'cash') {
        const shift = await currentShift(tx, order.store_id)
        if (!shift) {
          throw conflict('NO_OPEN_SHIFT', 'Open a shift before taking cash — the drawer must know where money lives.')
        }
        shiftId = shift.id
        await tx.query('update orders set shift_id = $2 where id = $1', [order.id, shift.id])
      }

      if (body.method === 'credit') {
        if (!order.customer_id) {
          throw invalid('Attach a customer before selling on credit.')
        }
        const customer = await one<CustomerRow>('select * from customers where id = $1', [order.customer_id], tx)
        if (!customer) throw invalid('No such customer.')
        if (customer.credit_limit === null) {
          throw new ApiError(403, 'CREDIT_LIMIT_EXCEEDED', `${customer.name} has no credit facility.`)
        }
        const newBalance = new Big(await customerBalance(tx, customer.id)).plus(amount)
        if (newBalance.gt(customer.credit_limit)) {
          throw new ApiError(
            403,
            'CREDIT_LIMIT_EXCEEDED',
            `This would put ${customer.name} at QAR ${newBalance.toFixed(2)}, over their QAR ${new Big(customer.credit_limit).toFixed(2)} limit.`,
          )
        }
      }

      let change: string | null = null
      if (body.method === 'cash' && body.tendered) {
        const tendered = new Big(body.tendered)
        if (tendered.lt(amount)) throw invalid('Tendered cash is less than the amount.')
        change = tendered.minus(amount).toFixed(2)
      }

      await tx.query(
        `insert into payments (order_id, method, amount, tendered, change_given, reference, received_by, received_by_name)
         values ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          order.id,
          body.method,
          amount.toFixed(2),
          body.method === 'cash' ? (body.tendered ?? amount.toFixed(2)) : null,
          change,
          body.reference ?? null,
          caller.id,
          caller.name,
        ],
      )

      if (body.method === 'credit') {
        await tx.query(
          `insert into credit_ledger (customer_id, entry_type, amount, order_id, method, note, created_by, created_by_name, shift_id)
           values ($1, 'charge', $2, $3, null, $4, $5, $6, $7)`,
          [order.customer_id, amount.toFixed(2), order.id, `Order ${order.order_number}`, caller.id, caller.name, shiftId],
        )
      }

      // completed ⇔ SUM(payments) = total — decided here, inside the lock.
      const settled = await mustLoad(tx, id, caller.business_id)
      if (paymentsSum(settled).gte(settled.total)) {
        await tx.query("update orders set status = 'completed', completed_at = now() where id = $1", [order.id])
      }
      return mustLoad(tx, id, caller.business_id)
    })
    return orderOut(order)
  })

  app.post('/orders/:id/discount', async (req) => {
    const caller = await requireUser(ctx, req)
    const { id } = req.params as { id: string }
    const body = z
      .object({ type: z.enum(['percent', 'fixed']), value: MONEY, reason: z.string().optional() })
      .parse(req.body)
    if (!new Big(body.value).gt(0)) throw invalid('Discount type and a positive value are required.')
    if (body.type === 'percent' && new Big(body.value).gt(100)) throw invalid('A percent discount cannot exceed 100.')

    const order = await withTx(async (tx) => {
      const order = await mustLoad(tx, id, caller.business_id, true)
      mustBeOpen(order, 'Only open orders can be discounted.')
      if (order.payments.length) throw conflict('PAYMENTS_STARTED', 'Remove payments before changing the discount.')
      const settings = await one<{ discount_approval_percent: string }>(
        'select discount_approval_percent from businesses where id = $1',
        [caller.business_id],
        tx,
      )
      const threshold = new Big(settings?.discount_approval_percent ?? 0)
      const pctEquivalent =
        body.type === 'percent'
          ? new Big(body.value)
          : new Big(order.subtotal).gt(0)
            ? new Big(body.value).times(100).div(order.subtotal)
            : new Big(0)
      let approvedBy: string | null = null
      if (pctEquivalent.gt(threshold)) {
        const who = await approver(req, caller.business_id, tx)
        if (!who) throw approvalRequired()
        approvedBy = who.id
      }
      order.discount_type = body.type
      order.discount_value = new Big(body.value).toFixed(2)
      order.discount_reason = body.reason ?? null
      order.discount_approved_by = approvedBy
      await tx.query(
        'update orders set discount_type = $2, discount_value = $3, discount_reason = $4, discount_approved_by = $5 where id = $1',
        [order.id, order.discount_type, order.discount_value, order.discount_reason, approvedBy],
      )
      recompute(order)
      await saveTotals(tx, order)
      return mustLoad(tx, id, caller.business_id)
    })
    return orderOut(order)
  })

  app.delete('/orders/:id/discount', async (req) => {
    const caller = await requireUser(ctx, req)
    const { id } = req.params as { id: string }
    const order = await withTx(async (tx) => {
      const order = await mustLoad(tx, id, caller.business_id, true)
      mustBeOpen(order)
      order.discount_type = null
      order.discount_value = null
      order.discount_reason = null
      order.discount_approved_by = null
      await tx.query(
        'update orders set discount_type = null, discount_value = null, discount_reason = null, discount_approved_by = null where id = $1',
        [order.id],
      )
      recompute(order)
      await saveTotals(tx, order)
      return mustLoad(tx, id, caller.business_id)
    })
    return orderOut(order)
  })

  app.post('/orders/:id/void', async (req) => {
    const caller = await requireUser(ctx, req)
    const { id } = req.params as { id: string }
    const order = await withTx(async (tx) => {
      const order = await mustLoad(tx, id, caller.business_id, true)
      mustBeOpen(order, 'Only open orders can be voided.')
      const who = await approver(req, caller.business_id, tx)
      if (!who) throw approvalRequired()
      await tx.query("update orders set status = 'void', note = coalesce(note, $2) where id = $1", [
        order.id,
        `Voided — approved by ${who.name}`,
      ])
      await tx.query("update kitchen_tickets set status = 'cancelled' where order_id = $1 and status <> 'done'", [order.id])
      return mustLoad(tx, id, caller.business_id)
    })
    return orderOut(order)
  })

  app.post('/orders/:id/refund', async (req) => {
    const caller = await requireUser(ctx, req)
    const { id } = req.params as { id: string }
    const order = await withTx(async (tx) => {
      const order = await mustLoad(tx, id, caller.business_id, true)
      if (order.status !== 'completed') throw conflict('ORDER_NOT_COMPLETED', 'Only completed orders can be refunded.')
      const who = await approver(req, caller.business_id, tx)
      if (!who) throw approvalRequired()
      const hasCash = order.payments.some((p) => p.method === 'cash' && new Big(p.amount).gt(0))
      const shift = await currentShift(tx, order.store_id)
      if (hasCash && !shift) throw conflict('NO_OPEN_SHIFT', 'Open a shift first — cash refunds come out of the drawer.')
      for (const p of order.payments) {
        if (new Big(p.amount).lte(0)) continue
        await tx.query(
          `insert into payments (order_id, method, amount, tendered, change_given, reference, received_by, received_by_name)
           values ($1, $2, $3, null, null, $4, $5, $6)`,
          [order.id, p.method, new Big(p.amount).times(-1).toFixed(2), p.method === 'card' ? p.reference : null, caller.id, caller.name],
        )
        if (p.method === 'credit' && order.customer_id) {
          await tx.query(
            `insert into credit_ledger (customer_id, entry_type, amount, order_id, method, note, created_by, created_by_name, shift_id)
             values ($1, 'adjustment', $2, $3, null, $4, $5, $6, $7)`,
            [order.customer_id, new Big(p.amount).times(-1).toFixed(2), order.id, `Refund of ${order.order_number} — approved by ${who.name}`, caller.id, caller.name, shift?.id ?? null],
          )
        }
      }
      await tx.query("update orders set status = 'refunded' where id = $1", [order.id])
      return mustLoad(tx, id, caller.business_id)
    })
    return orderOut(order)
  })

  // ---------- receipt: authenticated, and public by token ----------

  app.get('/orders/:id/receipt', async (req) => {
    const caller = await requireUser(ctx, req)
    const { id } = req.params as { id: string }
    return receiptPayload(ctx.db, await mustLoad(ctx.db, id, caller.business_id))
  })

  app.get('/r/:token', async (req) => {
    const { token } = req.params as { token: string }
    const order = await loadOrderByToken(ctx.db, token)
    if (!order) throw notFound('receipt — this link is not valid')
    return receiptPayload(ctx.db, order)
  })
}
