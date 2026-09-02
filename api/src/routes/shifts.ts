import Big from 'big.js'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { Ctx } from '../app.js'
import { requireUser } from '../auth.js'
import { many, one, withTx } from '../db.js'
import type { Queryable } from '../db.js'
import { conflict, invalid, notFound } from '../errors.js'
import { money, moneyOrNull, paginated } from '../serialize.js'
import { currentShift, expectedCash } from '../services/orders.js'

/**
 * The cash drawer. A shift opens with a counted float, absorbs every cash
 * movement, and closes against a count the server compares with what it
 * expected. The X report is the same figures live; the Z report is the
 * closed one.
 */

interface ShiftRow {
  id: string
  store_id: string
  status: 'open' | 'closed'
  opened_by: string | null
  opened_by_name: string
  closed_by: string | null
  closed_by_name: string | null
  opening_float: string
  expected_cash: string | null
  counted_cash: string | null
  over_short: string | null
  opened_at: string
  closed_at: string | null
  store_name: string
  cash_sales: string
  cash_refunds: string
  cash_repayments: string
  paid_in: string
  paid_out: string
}

const SHIFT_SELECT = `
  select s.*, st.name as store_name,
         coalesce((select sum(p.amount) from payments p join orders o on o.id = p.order_id
                    where o.shift_id = s.id and p.method = 'cash' and p.amount > 0), 0) as cash_sales,
         coalesce((select sum(-p.amount) from payments p join orders o on o.id = p.order_id
                    where o.shift_id = s.id and p.method = 'cash' and p.amount < 0), 0) as cash_refunds,
         coalesce((select sum(abs(l.amount)) from credit_ledger l
                    where l.shift_id = s.id and l.entry_type = 'repayment' and l.method = 'cash'), 0) as cash_repayments,
         coalesce((select sum(m.amount) from cash_movements m where m.shift_id = s.id and m.type = 'paid_in'), 0) as paid_in,
         coalesce((select sum(m.amount) from cash_movements m where m.shift_id = s.id and m.type = 'paid_out'), 0) as paid_out
    from shifts s join stores st on st.id = s.store_id`

async function shiftReport(db: Queryable, businessId: string, id: string) {
  const s = await one<ShiftRow>(`${SHIFT_SELECT} where s.id = $1 and st.business_id = $2`, [id, businessId], db)
  if (!s) throw notFound('shift')
  const movements = await many<{
    id: string
    shift_id: string
    type: 'paid_in' | 'paid_out'
    amount: string
    reason: string
    created_by: string | null
    created_by_name: string
    created_at: string
  }>('select * from cash_movements where shift_id = $1 order by created_at, id', [s.id], db)
  return {
    id: s.id,
    store_id: s.store_id,
    status: s.status,
    opened_by: s.opened_by,
    opened_by_name: s.opened_by_name,
    closed_by: s.closed_by,
    closed_by_name: s.closed_by_name,
    opening_float: money(s.opening_float),
    expected_cash: moneyOrNull(s.expected_cash),
    counted_cash: moneyOrNull(s.counted_cash),
    over_short: moneyOrNull(s.over_short),
    opened_at: s.opened_at,
    closed_at: s.closed_at,
    store_name: s.store_name,
    cash_sales: money(s.cash_sales),
    cash_refunds: money(s.cash_refunds),
    cash_repayments: money(s.cash_repayments),
    paid_in: money(s.paid_in),
    paid_out: money(s.paid_out),
    live_expected_cash: await expectedCash(db, s.id),
    movements: movements.map((m) => ({ ...m, amount: money(m.amount) })),
  }
}

const MONEY = /^\d+(\.\d{1,2})?$/

export async function shiftRoutes(app: FastifyInstance, ctx: Ctx) {
  const ownStore = async (storeId: string | undefined, businessId: string) =>
    !!storeId && !!(await one('select 1 from stores where id = $1 and business_id = $2', [storeId, businessId]))

  app.post('/shifts', async (req, reply) => {
    const caller = await requireUser(ctx, req)
    const body = z.object({ store_id: z.string().optional(), opening_float: z.string().optional() }).parse(req.body)
    if (!(await ownStore(body.store_id, caller.business_id))) throw invalid('A store is required.')
    if (body.opening_float === undefined || !MONEY.test(body.opening_float) || new Big(body.opening_float).lt(0)) {
      throw invalid('Count the opening float first.')
    }
    if (await currentShift(ctx.db, body.store_id!)) throw conflict('SHIFT_ALREADY_OPEN', 'This store already has an open shift.')
    let id: string
    try {
      const row = await one<{ id: string }>(
        `insert into shifts (store_id, status, opened_by, opened_by_name, opening_float) values ($1, 'open', $2, $3, $4) returning id`,
        [body.store_id, caller.id, caller.name, new Big(body.opening_float).toFixed(2)],
      )
      id = row!.id
    } catch (err) {
      if ((err as { code?: string }).code === '23505') throw conflict('SHIFT_ALREADY_OPEN', 'This store already has an open shift.')
      throw err
    }
    return reply.status(201).send(await shiftReport(ctx.db, caller.business_id, id))
  })

  app.get('/shifts/current', async (req) => {
    const caller = await requireUser(ctx, req)
    const q = z.object({ store_id: z.string().optional() }).parse(req.query)
    if (!(await ownStore(q.store_id, caller.business_id))) throw invalid('store_id is required.')
    const shift = await currentShift(ctx.db, q.store_id!)
    return { shift: shift ? await shiftReport(ctx.db, caller.business_id, shift.id) : null }
  })

  app.get('/shifts', async (req) => {
    const caller = await requireUser(ctx, req)
    const q = z.object({ store_id: z.string().optional() }).parse(req.query)
    const params: unknown[] = [caller.business_id]
    const where = ['st.business_id = $1']
    if (q.store_id) {
      params.push(q.store_id)
      where.push(`s.store_id = $${params.length}`)
    }
    const ids = await many<{ id: string }>(
      `select s.id from shifts s join stores st on st.id = s.store_id where ${where.join(' and ')} order by s.opened_at desc limit 50`,
      params,
    )
    const data = []
    for (const { id } of ids) data.push(await shiftReport(ctx.db, caller.business_id, id))
    return paginated(data, 50)
  })

  app.post('/shifts/:id/movements', async (req, reply) => {
    const caller = await requireUser(ctx, req)
    const { id } = req.params as { id: string }
    const shift = await one<{ id: string; status: string }>(
      'select s.id, s.status from shifts s join stores st on st.id = s.store_id where s.id = $1 and st.business_id = $2',
      [id, caller.business_id],
    )
    if (!shift) throw notFound('shift')
    if (shift.status !== 'open') throw conflict('SHIFT_CLOSED', 'That shift is closed.')
    const body = z
      .object({ type: z.enum(['paid_in', 'paid_out']).optional(), amount: z.string().optional(), reason: z.string().optional() })
      .parse(req.body)
    if (!body.type || !body.amount || !MONEY.test(body.amount) || !new Big(body.amount).gt(0) || !body.reason?.trim()) {
      throw invalid('Type, a positive amount and a reason are required.')
    }
    await ctx.db.query(
      `insert into cash_movements (shift_id, type, amount, reason, created_by, created_by_name) values ($1, $2, $3, $4, $5, $6)`,
      [shift.id, body.type, new Big(body.amount).toFixed(2), body.reason.trim(), caller.id, caller.name],
    )
    return reply.status(201).send(await shiftReport(ctx.db, caller.business_id, shift.id))
  })

  app.post('/shifts/:id/close', async (req) => {
    const caller = await requireUser(ctx, req)
    const { id } = req.params as { id: string }
    const body = z.object({ counted_cash: z.string().optional() }).parse(req.body)
    if (body.counted_cash === undefined || !MONEY.test(body.counted_cash) || new Big(body.counted_cash).lt(0)) {
      throw invalid('Count the drawer first.')
    }
    await withTx(async (tx) => {
      const shift = await one<{ id: string; status: string }>(
        `select s.id, s.status from shifts s join stores st on st.id = s.store_id
          where s.id = $1 and st.business_id = $2 for update of s`,
        [id, caller.business_id],
        tx,
      )
      if (!shift) throw notFound('shift')
      if (shift.status !== 'open') throw conflict('SHIFT_CLOSED', 'That shift is already closed.')
      const expected = await expectedCash(tx, shift.id) // the server computes — never the client
      const counted = new Big(body.counted_cash!).toFixed(2)
      await tx.query(
        `update shifts set status = 'closed', expected_cash = $2, counted_cash = $3, over_short = $4,
                closed_by = $5, closed_by_name = $6, closed_at = now() where id = $1`,
        [shift.id, expected, counted, new Big(counted).minus(expected).toFixed(2), caller.id, caller.name],
      )
    })
    return shiftReport(ctx.db, caller.business_id, id)
  })

  app.get('/shifts/:id/report', async (req) => {
    const caller = await requireUser(ctx, req)
    const { id } = req.params as { id: string }
    return shiftReport(ctx.db, caller.business_id, id)
  })
}
