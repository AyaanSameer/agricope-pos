import Big from 'big.js'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import type { Ctx } from '../app.js'
import { approvalPinFrom, approverForPin, requireRole, requireUser } from '../auth.js'
import { many, one, withTx } from '../db.js'
import type { Queryable } from '../db.js'
import { approvalRequired, conflict, invalid, notFound } from '../errors.js'
import { customerOut, money, paginated, ticketOut } from '../serialize.js'
import type { CustomerRow, TicketRow } from '../serialize.js'
import {
  createOrder,
  currentShift,
  customerBalance,
  insertItems,
  loadOrder,
  loadProductsForSale,
  orderOut,
  recompute,
  saveTotals,
  snapshotItem,
  validateItems,
} from '../services/orders.js'
import type { LoadedOrder } from '../services/orders.js'
import { itemInput, mustBeOpen, mustLoad } from './orders.js'

/**
 * Service: rounds on an open tab, splitting and merging bills, firing to the
 * kitchen and bumping tickets, the floor plan, and the customer book with its
 * credit ledger.
 */

const MONEY = z.string().regex(/^\d+(\.\d{1,2})?$/, 'must look like "4.50"')
const QTY = z.string().regex(/^\d+(\.\d{1,3})?$/, 'must be a quantity')

const TICKET_SELECT = `
  select t.*,
         coalesce((select json_agg(json_build_object('id', i.id, 'product_name', i.product_name, 'description', i.description,
                                                     'quantity', i.quantity, 'note', i.note, 'cancelled', i.cancelled) order by i.id)
                     from kitchen_ticket_items i where i.ticket_id = t.id), '[]'::json) as items
    from kitchen_tickets t
    join kitchen_stations ks on ks.id = t.station_id
    join stores s on s.id = ks.store_id`

async function reloadTotals(tx: Queryable, id: string): Promise<LoadedOrder> {
  const order = (await loadOrder(tx, id))!
  recompute(order)
  await saveTotals(tx, order)
  return order
}

const CUSTOMER_SELECT = `
  select c.*, (select coalesce(sum(l.amount), 0) from credit_ledger l where l.customer_id = c.id) as balance
    from customers c`

interface TableRow {
  id: string
  store_id: string
  name: string
  zone: string
  seats: number
  is_active: boolean
}

export async function serviceRoutes(app: FastifyInstance, ctx: Ctx) {
  const approver = (req: FastifyRequest, businessId: string, db: Queryable = ctx.db) =>
    approverForPin(db, ctx.config.PIN_PEPPER, businessId, approvalPinFrom(req))

  // ---------- incremental items (dine-in tabs) ----------

  app.post('/orders/:id/items', async (req) => {
    const caller = await requireUser(ctx, req)
    const { id } = req.params as { id: string }
    const body = z.object({ items: z.array(itemInput).default([]) }).parse(req.body)
    const order = await withTx(async (tx) => {
      const order = await mustLoad(tx, id, caller.business_id, true)
      mustBeOpen(order, 'This tab is closed.')
      const products = await loadProductsForSale(tx, caller.business_id, body.items.map((i) => i.product_id))
      for (const i of body.items) {
        const p = products.get(i.product_id)
        if (!p || !p.is_active) throw invalid('Unknown or inactive product.')
      }
      validateItems(products, body.items, false)
      await insertItems(
        tx,
        order.id,
        body.items.map((i) => snapshotItem(products.get(i.product_id)!, i.quantity, '0', order.order_type, i.option_ids)),
        order.items.length,
      )
      return reloadTotals(tx, order.id)
    })
    return orderOut(order)
  })

  app.patch('/orders/:id/items/:itemId', async (req) => {
    const caller = await requireUser(ctx, req)
    const { id, itemId } = req.params as { id: string; itemId: string }
    const body = z.object({ quantity: QTY.optional() }).parse(req.body)
    const order = await withTx(async (tx) => {
      const order = await mustLoad(tx, id, caller.business_id, true)
      mustBeOpen(order, 'This tab is closed.')
      const item = order.items.find((i) => i.id === itemId)
      if (!item) throw notFound('line')
      if (item.sent_to_kitchen_at) {
        throw conflict('ITEM_ALREADY_SENT', 'That line is already fired — pull it with a manager PIN instead.')
      }
      if (!body.quantity || !(Number(body.quantity) > 0)) throw invalid('Quantity must be positive.')
      await tx.query('update order_items set quantity = $2 where id = $1', [item.id, body.quantity])
      return reloadTotals(tx, order.id)
    })
    return orderOut(order)
  })

  app.delete('/orders/:id/items/:itemId', async (req) => {
    const caller = await requireUser(ctx, req)
    const { id, itemId } = req.params as { id: string; itemId: string }
    const order = await withTx(async (tx) => {
      const order = await mustLoad(tx, id, caller.business_id, true)
      mustBeOpen(order, 'This tab is closed.')
      const item = order.items.find((i) => i.id === itemId)
      if (!item) throw notFound('line')
      if (item.sent_to_kitchen_at) {
        if (!(await approver(req, caller.business_id, tx))) throw approvalRequired()
        await tx.query('update kitchen_ticket_items set cancelled = true where order_item_id = $1', [item.id])
        await tx.query(
          `update kitchen_tickets t set status = 'cancelled'
            where t.order_id = $1 and t.status <> 'done'
              and not exists (select 1 from kitchen_ticket_items i where i.ticket_id = t.id and not i.cancelled)`,
          [order.id],
        )
      }
      await tx.query('delete from order_items where id = $1', [item.id])
      return reloadTotals(tx, order.id)
    })
    return orderOut(order)
  })

  // ---------- split & merge ----------

  app.post('/orders/:id/split', async (req) => {
    const caller = await requireUser(ctx, req)
    const { id } = req.params as { id: string }
    const body = z.object({ items: z.array(z.object({ order_item_id: z.string(), quantity: QTY })).optional() }).parse(req.body)
    if (!body.items?.length) throw invalid('Pick at least one line to move.')
    const result = await withTx(async (tx) => {
      const order = await mustLoad(tx, id, caller.business_id, true)
      mustBeOpen(order, 'This tab is closed.')
      const split = await createOrder(tx, {
        store_id: order.store_id,
        cashier: caller,
        order_type: order.order_type,
        table_id: order.table_id,
        guest_count: null,
        items: [],
        tz: ctx.config.BUSINESS_TZ,
      })
      let position = 0
      for (const move of body.items!) {
        const item = order.items.find((i) => i.id === move.order_item_id)
        if (!item) throw invalid('Unknown line in split.')
        const moveQty = new Big(move.quantity)
        const haveQty = new Big(item.quantity)
        if (moveQty.lte(0) || moveQty.gt(haveQty)) throw invalid('Split quantity exceeds the line.')
        if (moveQty.eq(haveQty)) {
          await tx.query('update order_items set order_id = $2, position = $3 where id = $1', [item.id, split.id, position++])
        } else {
          const perUnitDiscount = new Big(item.discount).div(haveQty)
          const movedDiscount = perUnitDiscount.times(moveQty).toFixed(2)
          await tx.query('update order_items set quantity = $2, discount = $3 where id = $1', [
            item.id,
            haveQty.minus(moveQty).toString(),
            new Big(item.discount).minus(movedDiscount).toFixed(2),
          ])
          await tx.query(
            `insert into order_items (order_id, product_id, product_name, options, unit_price, quantity, discount, tax_rate, line_total, sent_to_kitchen_at, position)
             values ($1, $2, $3, $4::jsonb, $5, $6, $7, $8, 0, $9, $10)`,
            [split.id, item.product_id, item.product_name, JSON.stringify(item.options), item.unit_price, moveQty.toString(), movedDiscount, item.tax_rate, item.sent_to_kitchen_at, position++],
          )
        }
      }
      const original = await reloadTotals(tx, order.id)
      const moved = await reloadTotals(tx, split.id)
      return { original: orderOut(original), split: orderOut(moved) }
    })
    return result
  })

  app.post('/orders/:id/merge', async (req) => {
    const caller = await requireUser(ctx, req)
    const { id } = req.params as { id: string }
    const body = z.object({ source_order_id: z.string().optional() }).parse(req.body)
    const order = await withTx(async (tx) => {
      const target = await mustLoad(tx, id, caller.business_id, true)
      const source = await loadOrder(tx, body.source_order_id ?? '', caller.business_id, { forUpdate: true })
      if (!source) throw notFound('source order')
      if (target.status !== 'open' || source.status !== 'open') throw conflict('ORDER_NOT_OPEN', 'Both tabs must be open to merge.')
      if (source.payments.length) throw conflict('PAYMENTS_STARTED', 'The source tab already has payments.')
      await tx.query('update order_items set order_id = $2, position = position + $3 where order_id = $1', [source.id, target.id, target.items.length])
      await tx.query('update kitchen_tickets set order_id = $2, order_number = $3 where order_id = $1', [source.id, target.id, target.order_number])
      await tx.query("update orders set status = 'void', note = $2 where id = $1", [source.id, `Merged into ${target.order_number}`])
      await reloadTotals(tx, source.id)
      return reloadTotals(tx, target.id)
    })
    return orderOut(order)
  })

  // ---------- kitchen ----------

  app.post('/orders/:id/send', async (req) => {
    const caller = await requireUser(ctx, req)
    const { id } = req.params as { id: string }
    const order = await withTx(async (tx) => {
      const order = await mustLoad(tx, id, caller.business_id, true)
      mustBeOpen(order, 'This tab is closed.')
      const unsent = order.items.filter((i) => !i.sent_to_kitchen_at)
      if (!unsent.length) throw conflict('NOTHING_TO_SEND', 'Every line is already fired.')
      const now = new Date().toISOString()
      await tx.query('update order_items set sent_to_kitchen_at = $2 where id = any($1)', [unsent.map((i) => i.id), now])
      const products = await loadProductsForSale(tx, caller.business_id, unsent.map((i) => i.product_id).filter((p): p is string => !!p))
      const byStation = new Map<string, typeof unsent>()
      for (const item of unsent) {
        const product = item.product_id ? products.get(item.product_id) : undefined
        if (!product?.kitchen_station_id) continue // retail goods never make kitchen work
        byStation.set(product.kitchen_station_id, [...(byStation.get(product.kitchen_station_id) ?? []), item])
      }
      for (const [stationId, items] of byStation) {
        const ticket = await one<{ id: string }>(
          `insert into kitchen_tickets (order_id, order_number, table_name, station_id, status, created_at)
           values ($1, $2, $3, $4, 'new', $5) returning id`,
          [order.id, order.order_number, order.table_id ? order.table_name : order.order_type, stationId, now],
          tx,
        )
        for (const i of items) {
          await tx.query(
            `insert into kitchen_ticket_items (ticket_id, order_item_id, product_name, description, quantity, note)
             values ($1, $2, $3, $4, $5, $6)`,
            [ticket!.id, i.id, i.product_name, products.get(i.product_id ?? '')?.description ?? null, i.quantity, i.options.length ? i.options.join(' · ') : null],
          )
        }
      }
      return (await loadOrder(tx, order.id))!
    })
    return orderOut(order)
  })

  app.get('/kitchen/tickets', async (req) => {
    const caller = await requireUser(ctx, req)
    const q = z.object({ station_id: z.string().optional(), status: z.string().optional() }).parse(req.query)
    const params: unknown[] = [caller.business_id]
    const where = ['s.business_id = $1']
    if (q.station_id) {
      params.push(q.station_id)
      where.push(`t.station_id = $${params.length}`)
    }
    if (q.status) {
      params.push(q.status.split(','))
      where.push(`t.status = any($${params.length})`)
    }
    const rows = await many<TicketRow>(`${TICKET_SELECT} where ${where.join(' and ')} order by t.created_at, t.id`, params)
    return paginated(rows.map(ticketOut), 100)
  })

  app.patch('/kitchen/tickets/:id', async (req) => {
    const caller = await requireUser(ctx, req)
    const { id } = req.params as { id: string }
    const body = z.object({ status: z.enum(['new', 'in_progress', 'done', 'cancelled']).optional() }).parse(req.body)
    if (!body.status) throw invalid('A status is required.')
    const ticket = await one<{ id: string }>(`select t.id ${TICKET_SELECT.slice(TICKET_SELECT.indexOf('from'))} where t.id = $1 and s.business_id = $2`, [id, caller.business_id])
    if (!ticket) throw notFound('ticket')
    await ctx.db.query(
      `update kitchen_tickets set status = $2, done_at = case when $2 = 'done' then now() else done_at end where id = $1`,
      [ticket.id, body.status],
    )
    const row = await one<TicketRow>(`${TICKET_SELECT} where t.id = $1`, [ticket.id])
    return ticketOut(row!)
  })

  // ---------- tables / floor ----------

  app.get('/tables/floor', async (req) => {
    const caller = await requireUser(ctx, req)
    const q = z.object({ store_id: z.string().optional() }).parse(req.query)
    const params: unknown[] = [caller.business_id]
    const where = ['t.is_active', 's.business_id = $1']
    if (q.store_id) {
      params.push(q.store_id)
      where.push(`t.store_id = $${params.length}`)
    }
    const rows = await many<
      TableRow & {
        order_id: string | null
        order_number: string | null
        total: string | null
        guest_count: number | null
        opened_at: string | null
        unsent_count: number | null
      }
    >(
      `select t.id, t.store_id, t.name, t.zone, t.seats, t.is_active,
              o.id as order_id, o.order_number, o.total, o.guest_count, o.created_at as opened_at,
              (select count(*)::int from order_items i where i.order_id = o.id and i.sent_to_kitchen_at is null) as unsent_count
         from dining_tables t
         join stores s on s.id = t.store_id
         left join lateral (select * from orders o where o.table_id = t.id and o.status = 'open' order by o.created_at limit 1) o on true
        where ${where.join(' and ')}
        order by t.zone, t.name`,
      params,
    )
    const data = rows.map((r) => ({
      id: r.id,
      store_id: r.store_id,
      name: r.name,
      zone: r.zone,
      seats: r.seats,
      is_active: r.is_active,
      order: r.order_id
        ? {
            order_id: r.order_id,
            order_number: r.order_number,
            total: money(r.total),
            guest_count: r.guest_count,
            opened_at: r.opened_at,
            minutes_open: Math.round((Date.now() - new Date(r.opened_at!).getTime()) / 60000),
            unsent_count: r.unsent_count ?? 0,
          }
        : null,
    }))
    return paginated(data, 100)
  })

  // ---------- customers & credit ----------

  // Static before parametric — /customers/balances must never match :id.
  app.get('/customers/balances', async (req) => {
    const caller = await requireUser(ctx, req)
    const rows = await many<CustomerRow>(
      `${CUSTOMER_SELECT} where c.business_id = $1 and c.is_active order by c.name`,
      [caller.business_id],
    )
    const data = rows
      .map(customerOut)
      .filter((c) => new Big(c.balance).gt(0))
      .sort((a, b) => new Big(b.balance).minus(a.balance).toNumber())
    return paginated(data, 100)
  })

  app.get('/customers', async (req) => {
    const caller = await requireUser(ctx, req)
    const q = z.object({ search: z.string().optional() }).parse(req.query)
    const params: unknown[] = [caller.business_id]
    const where = ['c.business_id = $1', 'c.is_active']
    if (q.search) {
      params.push(`%${q.search.toLowerCase()}%`)
      where.push(`(lower(c.name) like $${params.length} or coalesce(c.phone, '') like $${params.length})`)
    }
    const rows = await many<CustomerRow>(`${CUSTOMER_SELECT} where ${where.join(' and ')} order by c.name`, params)
    return paginated(rows.map(customerOut), 100)
  })

  const customerBody = z.object({
    name: z.string().optional(),
    phone: z.string().nullable().optional(),
    email: z.string().nullable().optional(),
    credit_limit: MONEY.nullable().optional(),
    notes: z.string().nullable().optional(),
    is_active: z.boolean().optional(),
  })

  app.post('/customers', async (req, reply) => {
    const caller = await requireUser(ctx, req)
    const body = customerBody.parse(req.body)
    if (!body.name?.trim()) throw invalid('A name is required.')
    if (body.credit_limit && !(await approver(req, caller.business_id))) {
      throw approvalRequired('A manager or owner PIN is needed to set a credit limit.')
    }
    const created = await one<{ id: string }>(
      `insert into customers (business_id, name, phone, email, credit_limit, notes) values ($1, $2, $3, $4, $5, $6) returning id`,
      [caller.business_id, body.name.trim(), body.phone ?? null, body.email ?? null, body.credit_limit ?? null, body.notes ?? null],
    )
    const row = await one<CustomerRow>(`${CUSTOMER_SELECT} where c.id = $1`, [created!.id])
    return reply.status(201).send(customerOut(row!))
  })

  app.patch('/customers/:id', async (req) => {
    const caller = await requireUser(ctx, req)
    const { id } = req.params as { id: string }
    const customer = await one<CustomerRow>(`${CUSTOMER_SELECT} where c.id = $1 and c.business_id = $2`, [id, caller.business_id])
    if (!customer) throw notFound('customer')
    const body = customerBody.parse(req.body)
    if (body.name !== undefined) await ctx.db.query('update customers set name = $2 where id = $1', [customer.id, body.name])
    if (body.phone !== undefined) await ctx.db.query('update customers set phone = $2 where id = $1', [customer.id, body.phone])
    if (body.email !== undefined) await ctx.db.query('update customers set email = $2 where id = $1', [customer.id, body.email])
    if (body.credit_limit !== undefined) {
      const before = customer.credit_limit === null ? null : money(customer.credit_limit)
      const after = body.credit_limit === null ? null : money(body.credit_limit)
      if (before !== after) {
        // Granting or changing credit is a money decision, not a contact edit.
        if (!(await approver(req, caller.business_id))) {
          throw approvalRequired('A manager or owner PIN is needed to set a credit limit.')
        }
        await ctx.db.query('update customers set credit_limit = $2 where id = $1', [customer.id, after])
      }
    }
    if (body.notes !== undefined) await ctx.db.query('update customers set notes = $2 where id = $1', [customer.id, body.notes])
    if (body.is_active !== undefined) await ctx.db.query('update customers set is_active = $2 where id = $1', [customer.id, body.is_active])
    const row = await one<CustomerRow>(`${CUSTOMER_SELECT} where c.id = $1`, [customer.id])
    return customerOut(row!)
  })

  app.get('/customers/:id/statement', async (req) => {
    const caller = await requireUser(ctx, req)
    const { id } = req.params as { id: string }
    const customer = await one<CustomerRow>(`${CUSTOMER_SELECT} where c.id = $1 and c.business_id = $2`, [id, caller.business_id])
    if (!customer) throw notFound('customer')
    const entries = await many<{
      id: string
      entry_type: 'charge' | 'repayment' | 'adjustment'
      amount: string
      method: 'cash' | 'card' | 'online' | null
      note: string | null
      created_by_name: string
      created_at: string
    }>(
      `select id, entry_type, amount, method, note, created_by_name, created_at
         from credit_ledger where customer_id = $1 order by created_at, id`,
      [customer.id],
    )
    let running = new Big(0)
    const statement = entries.map((e) => {
      running = running.plus(e.amount)
      return { ...e, amount: money(e.amount), balance: running.toFixed(2) }
    })
    return { customer: customerOut(customer), entries: statement.reverse() }
  })

  app.post('/customers/:id/repayments', async (req, reply) => {
    const caller = await requireUser(ctx, req)
    const { id } = req.params as { id: string }
    const customer = await one<{ id: string }>('select id from customers where id = $1 and business_id = $2', [id, caller.business_id])
    if (!customer) throw notFound('customer')
    const body = z
      .object({
        amount: z.string().optional(),
        method: z.enum(['cash', 'card', 'online']).optional(),
        note: z.string().optional(),
        store_id: z.string().optional(),
      })
      .parse(req.body)
    if (!body.amount || !/^\d+(\.\d{1,2})?$/.test(body.amount) || !new Big(body.amount).gt(0)) {
      throw invalid('Repayment amount must be positive.')
    }
    if (!body.method) throw invalid('How did they pay?')
    let shiftId: string | null = null
    if (body.method === 'cash') {
      if (!body.store_id) throw invalid('Cash repayments need a store (the drawer).')
      const store = await one('select 1 from stores where id = $1 and business_id = $2', [body.store_id, caller.business_id])
      if (!store) throw invalid('That branch does not belong to this business.')
      const shift = await currentShift(ctx.db, body.store_id)
      if (!shift) throw conflict('NO_OPEN_SHIFT', 'Open a shift before taking cash.')
      shiftId = shift.id
    }
    const entry = await one<{
      id: string
      entry_type: 'repayment'
      amount: string
      method: 'cash' | 'card' | 'online'
      note: string | null
      created_by_name: string
      created_at: string
    }>(
      `insert into credit_ledger (customer_id, entry_type, amount, method, note, created_by, created_by_name, shift_id)
       values ($1, 'repayment', $2, $3, $4, $5, $6, $7)
       returning id, entry_type, amount, method, note, created_by_name, created_at`,
      [customer.id, new Big(body.amount).times(-1).toFixed(2), body.method, body.note ?? null, caller.id, caller.name, shiftId],
    )
    const balance = await customerBalance(ctx.db, customer.id)
    return reply.status(201).send({ entry: { ...entry!, amount: money(entry!.amount), balance }, balance })
  })

  // ---------- table administration — the owner's floor plan ----------

  const ownerOnly = (req: FastifyRequest) => requireRole(ctx, req, ['owner'], 'Only the owner can change table details.')

  const tableBody = z.object({
    store_id: z.string().optional(),
    name: z.string().optional(),
    zone: z.string().optional(),
    seats: z.union([z.number(), z.string()]).optional(),
    is_active: z.boolean().optional(),
  })

  app.post('/tables', async (req, reply) => {
    const caller = await ownerOnly(req)
    const body = tableBody.parse(req.body)
    if (!body.store_id || !(await one('select 1 from stores where id = $1 and business_id = $2', [body.store_id, caller.business_id]))) {
      throw invalid('A valid branch is required.')
    }
    const name = body.name?.trim()
    if (!name) throw invalid('The table needs a name (e.g. T5).')
    if (await one('select 1 from dining_tables where store_id = $1 and lower(name) = lower($2)', [body.store_id, name])) {
      throw invalid('That branch already has a table with this name.')
    }
    if (!(Number(body.seats) > 0)) throw invalid('Seats must be at least 1.')
    const row = await one<TableRow>(
      `insert into dining_tables (store_id, name, zone, seats, is_active) values ($1, $2, $3, $4, $5) returning *`,
      [body.store_id, name, body.zone?.trim() || 'Main hall', Number(body.seats), body.is_active ?? true],
    )
    return reply.status(201).send(row)
  })

  app.patch('/tables/:id', async (req) => {
    const caller = await ownerOnly(req)
    const { id } = req.params as { id: string }
    const table = await one<TableRow>(
      'select t.* from dining_tables t join stores s on s.id = t.store_id where t.id = $1 and s.business_id = $2',
      [id, caller.business_id],
    )
    if (!table) throw notFound('table')
    const body = tableBody.parse(req.body)
    if (body.name !== undefined) {
      const name = body.name.trim()
      if (!name) throw invalid('The table needs a name.')
      if (await one('select 1 from dining_tables where store_id = $1 and id <> $2 and lower(name) = lower($3)', [table.store_id, table.id, name])) {
        throw invalid('That branch already has a table with this name.')
      }
      await ctx.db.query('update dining_tables set name = $2 where id = $1', [table.id, name])
    }
    if (body.zone !== undefined) await ctx.db.query('update dining_tables set zone = $2 where id = $1', [table.id, body.zone.trim() || 'Main hall'])
    if (body.seats !== undefined) {
      if (!(Number(body.seats) > 0)) throw invalid('Seats must be at least 1.')
      await ctx.db.query('update dining_tables set seats = $2 where id = $1', [table.id, Number(body.seats)])
    }
    if (body.is_active !== undefined) await ctx.db.query('update dining_tables set is_active = $2 where id = $1', [table.id, body.is_active])
    return (await one<TableRow>('select * from dining_tables where id = $1', [table.id]))!
  })

  app.delete('/tables/:id', async (req, reply) => {
    const caller = await ownerOnly(req)
    const { id } = req.params as { id: string }
    const table = await one<TableRow>(
      'select t.* from dining_tables t join stores s on s.id = t.store_id where t.id = $1 and s.business_id = $2',
      [id, caller.business_id],
    )
    if (!table) throw notFound('table')
    if (await one("select 1 from orders where status = 'open' and table_id = $1", [table.id])) {
      throw conflict('TABLE_OCCUPIED', 'Close its open tab before deleting this table.')
    }
    await ctx.db.query('delete from dining_tables where id = $1', [table.id])
    return reply.status(204).send()
  })
}
