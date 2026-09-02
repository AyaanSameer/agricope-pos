import Big from 'big.js'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { Ctx } from '../app.js'
import { requireUser } from '../auth.js'
import { many, one } from '../db.js'
import { money, qty } from '../serialize.js'

/**
 * Reports. Windows follow the business's clock: "today" starts at midnight
 * in BUSINESS_TZ, and `previous` is the same-length window immediately
 * before, so "vs yesterday" compares like with like.
 */

type Range = 'today' | '7d' | 'month'

function parseRange(v: string | undefined): Range {
  return v === '7d' || v === 'month' ? v : 'today'
}

const DAYS: Record<Range, number> = { today: 1, '7d': 7, month: 30 }

/**
 * Window bounds as SQL, parameterised on tz ($1), days ($2) and how many days
 * to shift back ($3 — 0 for the current window, `days` for the previous).
 */
const WINDOW = `
  ((date_trunc('day', now() at time zone $1) - (($2::int - 1) * interval '1 day')) at time zone $1) - ($3::int * interval '1 day') as f,
  now() - ($3::int * interval '1 day') as t`

export async function reportRoutes(app: FastifyInstance, ctx: Ctx) {
  const tz = ctx.config.BUSINESS_TZ

  async function aggregate(businessId: string, storeId: string | undefined, days: number, back: number) {
    const params: unknown[] = [tz, days, back, businessId]
    let storeClause = ''
    if (storeId) {
      params.push(storeId)
      storeClause = `and o.store_id = $${params.length}`
    }
    const scope = `from orders o join stores s on s.id = o.store_id, w
                   where s.business_id = $4 and o.created_at >= w.f and o.created_at <= w.t ${storeClause}`
    const totals = await one<{
      gross_sales: string
      order_count: number
      refund_count: number
      void_count: number
      discount_total: string
      service_charge_total: string
    }>(
      `with w as (select ${WINDOW})
       select coalesce(sum(o.total) filter (where o.status = 'completed'), 0) as gross_sales,
              count(*) filter (where o.status = 'completed')::int as order_count,
              count(*) filter (where o.status = 'refunded')::int as refund_count,
              count(*) filter (where o.status = 'void')::int as void_count,
              coalesce(sum(o.discount_total) filter (where o.status = 'completed'), 0) as discount_total,
              coalesce(sum(o.service_charge_total) filter (where o.status = 'completed'), 0) as service_charge_total
       ${scope}`,
      params,
    )
    const byMethod = await many<{ method: string; total: string }>(
      `with w as (select ${WINDOW})
       select p.method, sum(p.amount) as total
         from payments p join orders o on o.id = p.order_id join stores s on s.id = o.store_id, w
        where s.business_id = $4 and o.status = 'completed' and p.amount > 0
          and o.created_at >= w.f and o.created_at <= w.t ${storeClause}
        group by p.method`,
      params,
    )
    const byType = await many<{ order_type: string; total: string }>(
      `with w as (select ${WINDOW})
       select o.order_type, sum(o.total) as total ${scope} and o.status = 'completed' group by o.order_type`,
      params,
    )
    const byHour = await many<{ hour: number; total: string }>(
      `with w as (select ${WINDOW})
       select extract(hour from o.created_at at time zone $1)::int as hour, sum(o.total) as total
       ${scope} and o.status = 'completed' group by 1 order by 1`,
      params,
    )
    const gross = new Big(totals?.gross_sales ?? 0)
    const count = totals?.order_count ?? 0
    const methods: Record<string, string> = { cash: '0.00', card: '0.00', online: '0.00', credit: '0.00' }
    for (const m of byMethod) methods[m.method] = money(m.total)
    return {
      gross_sales: gross.toFixed(2),
      order_count: count,
      average_order: count ? gross.div(count).toFixed(2) : '0.00',
      refund_count: totals?.refund_count ?? 0,
      void_count: totals?.void_count ?? 0,
      by_method: methods,
      by_type: Object.fromEntries(byType.map((r) => [r.order_type, money(r.total)])),
      by_hour: Object.fromEntries(byHour.map((r) => [String(r.hour), money(r.total)])),
      discount_total: money(totals?.discount_total ?? 0),
      service_charge_total: money(totals?.service_charge_total ?? 0),
    }
  }

  app.get('/reports/summary', async (req) => {
    const caller = await requireUser(ctx, req)
    const q = z.object({ store_id: z.string().optional(), range: z.string().optional() }).parse(req.query)
    const range = parseRange(q.range)
    const days = DAYS[range]
    const current = await aggregate(caller.business_id, q.store_id, days, 0)
    const prior = await aggregate(caller.business_id, q.store_id, days, days)

    const credit = await one<{ charged: string; repaid: string; outstanding: string }>(
      `with w as (select ${WINDOW})
       select coalesce(sum(l.amount) filter (where l.entry_type = 'charge' and l.created_at >= w.f and l.created_at <= w.t), 0) as charged,
              coalesce(sum(abs(l.amount)) filter (where l.entry_type = 'repayment' and l.created_at >= w.f and l.created_at <= w.t), 0) as repaid,
              coalesce(sum(l.amount), 0) as outstanding
         from credit_ledger l join customers c on c.id = l.customer_id, w
        where c.business_id = $4`,
      [tz, days, 0, caller.business_id],
    )

    return {
      ...current,
      range,
      credit_charged: money(credit?.charged ?? 0),
      credit_repaid: money(credit?.repaid ?? 0),
      credit_outstanding: money(credit?.outstanding ?? 0),
      previous: {
        gross_sales: prior.gross_sales,
        order_count: prior.order_count,
        average_order: prior.average_order,
        discount_total: prior.discount_total,
      },
    }
  })

  app.get('/reports/top-items', async (req) => {
    const caller = await requireUser(ctx, req)
    const q = z.object({ store_id: z.string().optional(), range: z.string().optional() }).parse(req.query)
    const days = DAYS[parseRange(q.range)]
    const params: unknown[] = [tz, days, 0, caller.business_id]
    let storeClause = ''
    if (q.store_id) {
      params.push(q.store_id)
      storeClause = `and o.store_id = $${params.length}`
    }
    const rows = await many<{ name: string; quantity: string; revenue: string }>(
      `with w as (select ${WINDOW})
       select i.product_name as name, sum(i.quantity) as quantity, sum(i.line_total) as revenue
         from order_items i join orders o on o.id = i.order_id join stores s on s.id = o.store_id, w
        where s.business_id = $4 and o.status = 'completed' and o.created_at >= w.f and o.created_at <= w.t ${storeClause}
        group by i.product_name order by revenue desc limit 5`,
      params,
    )
    return { data: rows.map((r) => ({ name: r.name, quantity: qty(r.quantity), revenue: money(r.revenue) })) }
  })

  app.get('/reports/credit-aging', async (req) => {
    const caller = await requireUser(ctx, req)
    const customers = await many<{ id: string; name: string; balance: string }>(
      `select c.id, c.name, coalesce(sum(l.amount), 0) as balance
         from customers c left join credit_ledger l on l.customer_id = c.id
        where c.business_id = $1 group by c.id, c.name having coalesce(sum(l.amount), 0) > 0`,
      [caller.business_id],
    )
    const rows: { customer_id: string; name: string; balance: string; days: number; bucket: string }[] = []
    for (const c of customers) {
      // FIFO: apply repayments/adjustments against charges oldest-first;
      // the first charge not fully covered sets the age.
      const entries = await many<{ amount: string; created_at: string }>(
        'select amount, created_at from credit_ledger where customer_id = $1 order by created_at, id',
        [c.id],
      )
      let credit = entries.filter((e) => new Big(e.amount).lt(0)).reduce((a, e) => a.plus(new Big(e.amount).abs()), new Big(0))
      let oldestUnpaid: string | null = null
      for (const e of entries) {
        const amt = new Big(e.amount)
        if (amt.lte(0)) continue
        if (credit.gte(amt)) credit = credit.minus(amt)
        else {
          oldestUnpaid = e.created_at
          break
        }
      }
      const days = oldestUnpaid ? Math.floor((Date.now() - new Date(oldestUnpaid).getTime()) / 86_400_000) : 0
      const bucket = days >= 90 ? '90+' : days >= 60 ? '60' : days >= 30 ? '30' : 'current'
      rows.push({ customer_id: c.id, name: c.name, balance: money(c.balance), days, bucket })
    }
    rows.sort((a, b) => b.days - a.days)
    const totals: Record<string, Big> = { current: new Big(0), '30': new Big(0), '60': new Big(0), '90+': new Big(0) }
    for (const r of rows) totals[r.bucket] = totals[r.bucket].plus(r.balance)
    return { data: rows, buckets: Object.fromEntries(Object.entries(totals).map(([k, v]) => [k, v.toFixed(2)])) }
  })
}
