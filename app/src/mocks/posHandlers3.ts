import { http, HttpResponse, delay } from 'msw'
import Big from 'big.js'
import { requester, stores } from './db'
import {
  cashMovements,
  currentShift,
  customerBalance,
  customers,
  expectedCash,
  iso,
  ledger,
  orders,
  shifts,
  uid,
  userName,
} from './posdb'
import type { DbShift } from './posdb'
import { apiError } from './posHandlers'

function auth(request: Request) {
  return requester(request)
}

export function shiftReport(shift: DbShift) {
  let cashSales = new Big(0)
  let cashRefunds = new Big(0)
  for (const o of orders) {
    if (o.shift_id !== shift.id) continue
    for (const p of o.payments) {
      if (p.method !== 'cash') continue
      const amt = new Big(p.amount)
      if (amt.gte(0)) cashSales = cashSales.plus(amt)
      else cashRefunds = cashRefunds.plus(amt.abs())
    }
  }
  let cashRepayments = new Big(0)
  for (const e of ledger) {
    if (e.shift_id === shift.id && e.entry_type === 'repayment' && e.method === 'cash') {
      cashRepayments = cashRepayments.plus(new Big(e.amount).abs())
    }
  }
  let paidIn = new Big(0)
  let paidOut = new Big(0)
  const movements = cashMovements
    .filter((m) => m.shift_id === shift.id)
    .map((m) => {
      if (m.type === 'paid_in') paidIn = paidIn.plus(m.amount)
      else paidOut = paidOut.plus(m.amount)
      return { ...m, created_by_name: userName(m.created_by) }
    })
  return {
    ...shift,
    opened_by_name: userName(shift.opened_by),
    closed_by_name: shift.closed_by ? userName(shift.closed_by) : null,
    store_name: stores.find((s) => s.id === shift.store_id)?.name ?? '',
    cash_sales: cashSales.toFixed(2),
    cash_refunds: cashRefunds.toFixed(2),
    cash_repayments: cashRepayments.toFixed(2),
    paid_in: paidIn.toFixed(2),
    paid_out: paidOut.toFixed(2),
    live_expected_cash: expectedCash(shift),
    movements,
  }
}

function todays<T extends { created_at: string }>(list: T[]): T[] {
  const today = new Date().toISOString().slice(0, 10)
  return list.filter((x) => x.created_at.slice(0, 10) === today)
}

export const posHandlers3 = [
  // ---------- shifts & the cash drawer ----------

  http.post('/api/v1/shifts', async ({ request }) => {
    await delay(300)
    const caller = auth(request)
    if (!caller) return apiError(401, 'UNAUTHENTICATED', 'Sign in to continue.')
    const body = (await request.json()) as { store_id?: string; opening_float?: string }
    if (!body.store_id) return apiError(400, 'VALIDATION_ERROR', 'A store is required.')
    if (body.opening_float === undefined || new Big(body.opening_float).lt(0)) {
      return apiError(400, 'VALIDATION_ERROR', 'Count the opening float first.')
    }
    if (currentShift(body.store_id)) {
      return apiError(409, 'SHIFT_ALREADY_OPEN', 'This store already has an open shift.')
    }
    const shift: DbShift = {
      id: uid('sh'),
      store_id: body.store_id,
      status: 'open',
      opened_by: caller.id,
      closed_by: null,
      opening_float: new Big(body.opening_float).toFixed(2),
      expected_cash: null,
      counted_cash: null,
      over_short: null,
      opened_at: iso(),
      closed_at: null,
    }
    shifts.push(shift)
    return HttpResponse.json(shiftReport(shift), { status: 201 })
  }),

  http.get('/api/v1/shifts/current', async ({ request }) => {
    await delay(150)
    if (!auth(request)) return apiError(401, 'UNAUTHENTICATED', 'Sign in to continue.')
    const url = new URL(request.url)
    const storeId = url.searchParams.get('store_id')
    if (!storeId) return apiError(400, 'VALIDATION_ERROR', 'store_id is required.')
    const shift = currentShift(storeId)
    return HttpResponse.json({ shift: shift ? shiftReport(shift) : null })
  }),

  http.post('/api/v1/shifts/:id/movements', async ({ request, params }) => {
    await delay(250)
    const caller = auth(request)
    if (!caller) return apiError(401, 'UNAUTHENTICATED', 'Sign in to continue.')
    const shift = shifts.find((s) => s.id === params.id)
    if (!shift) return apiError(404, 'NOT_FOUND', 'No such shift.')
    if (shift.status !== 'open') return apiError(409, 'SHIFT_CLOSED', 'That shift is closed.')
    const body = (await request.json()) as { type?: 'paid_in' | 'paid_out'; amount?: string; reason?: string }
    if (!body.type || !body.amount || !new Big(body.amount).gt(0) || !body.reason?.trim()) {
      return apiError(400, 'VALIDATION_ERROR', 'Type, a positive amount and a reason are required.')
    }
    cashMovements.push({
      id: uid('cm'),
      shift_id: shift.id,
      type: body.type,
      amount: new Big(body.amount).toFixed(2),
      reason: body.reason.trim(),
      created_by: caller.id,
      created_at: iso(),
    })
    return HttpResponse.json(shiftReport(shift), { status: 201 })
  }),

  http.post('/api/v1/shifts/:id/close', async ({ request, params }) => {
    await delay(350)
    const caller = auth(request)
    if (!caller) return apiError(401, 'UNAUTHENTICATED', 'Sign in to continue.')
    const shift = shifts.find((s) => s.id === params.id)
    if (!shift) return apiError(404, 'NOT_FOUND', 'No such shift.')
    if (shift.status !== 'open') return apiError(409, 'SHIFT_CLOSED', 'That shift is already closed.')
    const body = (await request.json()) as { counted_cash?: string }
    if (body.counted_cash === undefined || new Big(body.counted_cash).lt(0)) {
      return apiError(400, 'VALIDATION_ERROR', 'Count the drawer first.')
    }
    shift.expected_cash = expectedCash(shift) // the server computes — never the client
    shift.counted_cash = new Big(body.counted_cash).toFixed(2)
    shift.over_short = new Big(shift.counted_cash).minus(shift.expected_cash).toFixed(2)
    shift.status = 'closed'
    shift.closed_by = caller.id
    shift.closed_at = iso()
    return HttpResponse.json(shiftReport(shift))
  }),

  http.get('/api/v1/shifts/:id/report', async ({ request, params }) => {
    await delay(200)
    if (!auth(request)) return apiError(401, 'UNAUTHENTICATED', 'Sign in to continue.')
    const shift = shifts.find((s) => s.id === params.id)
    if (!shift) return apiError(404, 'NOT_FOUND', 'No such shift.')
    return HttpResponse.json(shiftReport(shift))
  }),

  http.get('/api/v1/shifts', async ({ request }) => {
    await delay(200)
    if (!auth(request)) return apiError(401, 'UNAUTHENTICATED', 'Sign in to continue.')
    const url = new URL(request.url)
    const storeId = url.searchParams.get('store_id')
    let data = [...shifts]
    if (storeId) data = data.filter((s) => s.store_id === storeId)
    data.sort((a, b) => b.opened_at.localeCompare(a.opened_at))
    return HttpResponse.json({ data: data.map(shiftReport), total: data.length, page: 1, limit: 50 })
  }),

  // ---------- reports & dashboard ----------

  http.get('/api/v1/reports/summary', async ({ request }) => {
    await delay(300)
    if (!auth(request)) return apiError(401, 'UNAUTHENTICATED', 'Sign in to continue.')
    const url = new URL(request.url)
    const storeId = url.searchParams.get('store_id')
    let scope = todays(orders)
    if (storeId) scope = scope.filter((o) => o.store_id === storeId)
    const completed = scope.filter((o) => o.status === 'completed')
    const gross = completed.reduce((a, o) => a.plus(o.total), new Big(0))
    const byMethod: Record<string, Big> = { cash: new Big(0), card: new Big(0), online: new Big(0), credit: new Big(0) }
    const byType: Record<string, Big> = {}
    let discounts = new Big(0)
    let serviceCharge = new Big(0)
    const byHour: Record<string, Big> = {}
    for (const o of completed) {
      discounts = discounts.plus(o.discount_total)
      serviceCharge = serviceCharge.plus(o.service_charge_total)
      byType[o.order_type] = (byType[o.order_type] ?? new Big(0)).plus(o.total)
      const hour = new Date(o.created_at).getHours()
      byHour[hour] = (byHour[hour] ?? new Big(0)).plus(o.total)
      for (const p of o.payments) {
        if (new Big(p.amount).gt(0)) byMethod[p.method] = byMethod[p.method].plus(p.amount)
      }
    }
    const creditCharged = todays(ledger)
      .filter((e) => e.entry_type === 'charge')
      .reduce((a, e) => a.plus(e.amount), new Big(0))
    const creditRepaid = todays(ledger)
      .filter((e) => e.entry_type === 'repayment')
      .reduce((a, e) => a.plus(new Big(e.amount).abs()), new Big(0))
    const toMoney = (r: Record<string, Big>) =>
      Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v.toFixed(2)]))
    return HttpResponse.json({
      gross_sales: gross.toFixed(2),
      order_count: completed.length,
      average_order: completed.length ? gross.div(completed.length).toFixed(2) : '0.00',
      refund_count: scope.filter((o) => o.status === 'refunded').length,
      void_count: scope.filter((o) => o.status === 'void').length,
      by_method: toMoney(byMethod),
      by_type: toMoney(byType),
      by_hour: toMoney(byHour),
      discount_total: discounts.toFixed(2),
      service_charge_total: serviceCharge.toFixed(2),
      credit_charged: creditCharged.toFixed(2),
      credit_repaid: creditRepaid.toFixed(2),
      credit_outstanding: customers
        .reduce((a, c) => a.plus(customerBalance(c.id)), new Big(0))
        .toFixed(2),
    })
  }),

  http.get('/api/v1/reports/top-items', async ({ request }) => {
    await delay(250)
    if (!auth(request)) return apiError(401, 'UNAUTHENTICATED', 'Sign in to continue.')
    const url = new URL(request.url)
    const storeId = url.searchParams.get('store_id')
    let scope = todays(orders)
    if (storeId) scope = scope.filter((o) => o.store_id === storeId)
    const byName = new Map<string, { qty: Big; revenue: Big }>()
    for (const o of scope) {
      if (o.status !== 'completed') continue
      for (const i of o.items) {
        const row = byName.get(i.product_name) ?? { qty: new Big(0), revenue: new Big(0) }
        row.qty = row.qty.plus(i.quantity)
        row.revenue = row.revenue.plus(i.line_total)
        byName.set(i.product_name, row)
      }
    }
    const data = [...byName.entries()]
      .map(([name, r]) => ({ name, quantity: r.qty.toString(), revenue: r.revenue.toFixed(2) }))
      .sort((a, b) => new Big(b.revenue).minus(a.revenue).toNumber())
      .slice(0, 5)
    return HttpResponse.json({ data })
  }),

  http.get('/api/v1/reports/credit-aging', async ({ request }) => {
    await delay(250)
    if (!auth(request)) return apiError(401, 'UNAUTHENTICATED', 'Sign in to continue.')
    const rows = []
    for (const c of customers) {
      const balance = new Big(customerBalance(c.id))
      if (balance.lte(0)) continue
      // FIFO: apply repayments/adjustments against charges oldest-first;
      // the first charge not fully covered sets the age.
      const entries = ledger
        .filter((e) => e.customer_id === c.id)
        .sort((a, b) => a.created_at.localeCompare(b.created_at))
      let credit = entries
        .filter((e) => new Big(e.amount).lt(0))
        .reduce((a, e) => a.plus(new Big(e.amount).abs()), new Big(0))
      let oldestUnpaid: string | null = null
      for (const e of entries) {
        const amt = new Big(e.amount)
        if (amt.lte(0)) continue
        if (credit.gte(amt)) {
          credit = credit.minus(amt)
        } else {
          oldestUnpaid = e.created_at
          break
        }
      }
      const days = oldestUnpaid
        ? Math.floor((Date.now() - new Date(oldestUnpaid).getTime()) / 86_400_000)
        : 0
      const bucket = days >= 90 ? '90+' : days >= 60 ? '60' : days >= 30 ? '30' : 'current'
      rows.push({ customer_id: c.id, name: c.name, balance: balance.toFixed(2), days, bucket })
    }
    rows.sort((a, b) => b.days - a.days)
    const totals: Record<string, Big> = { current: new Big(0), '30': new Big(0), '60': new Big(0), '90+': new Big(0) }
    for (const r of rows) totals[r.bucket] = totals[r.bucket].plus(r.balance)
    return HttpResponse.json({
      data: rows,
      buckets: Object.fromEntries(Object.entries(totals).map(([k, v]) => [k, v.toFixed(2)])),
    })
  }),
]
