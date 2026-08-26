import { http, HttpResponse, delay } from 'msw'
import Big from 'big.js'
import { products, requester, stations, storeBusinessId } from './db'
import {
  currentShift,
  customerBalance,
  customers,
  iso,
  ledger,
  makeOrder,
  orders,
  recomputeOrder,
  snapshotItem,
  tables,
  tickets,
  toPublicOrder,
  uid,
  userName,
} from './posdb'
import { apiError, approval, APPROVAL_REQUIRED, findOrder } from './posHandlers'

function auth(request: Request) {
  return requester(request)
}

// ---------- incremental items (dine-in tabs) ----------

export const posHandlers2 = [
  http.post('/api/v1/orders/:id/items', async ({ request, params }) => {
    await delay(250)
    const caller = auth(request)
    if (!caller) return apiError(401, 'UNAUTHENTICATED', 'Sign in to continue.')
    const order = findOrder(params.id as string, caller)
    if (!order) return apiError(404, 'NOT_FOUND', 'No such order.')
    if (order.status !== 'open') return apiError(409, 'ORDER_NOT_OPEN', 'This tab is closed.')
    const body = (await request.json()) as {
      items?: { product_id: string; quantity: string; option_ids?: string[] }[]
    }
    for (const i of body.items ?? []) {
      const p = products.find(
        (x) => x.id === i.product_id && x.is_active && x.business_id === caller.business_id,
      )
      if (!p) return apiError(400, 'VALIDATION_ERROR', 'Unknown or inactive product.')
      const validChoices = new Set(p.option_groups.flatMap((g) => g.choices.map((c) => c.id)))
      if ((i.option_ids ?? []).some((id) => !validChoices.has(id))) {
        return apiError(400, 'VALIDATION_ERROR', `Unknown option for ${p.name}.`)
      }
      order.items.push(snapshotItem(i.product_id, i.quantity, '0', order.order_type, i.option_ids))
    }
    recomputeOrder(order)
    return HttpResponse.json(toPublicOrder(order))
  }),

  http.patch('/api/v1/orders/:id/items/:itemId', async ({ request, params }) => {
    await delay(200)
    const caller = auth(request)
    if (!caller) return apiError(401, 'UNAUTHENTICATED', 'Sign in to continue.')
    const order = findOrder(params.id as string, caller)
    if (!order) return apiError(404, 'NOT_FOUND', 'No such order.')
    if (order.status !== 'open') return apiError(409, 'ORDER_NOT_OPEN', 'This tab is closed.')
    const item = order.items.find((i) => i.id === params.itemId)
    if (!item) return apiError(404, 'NOT_FOUND', 'No such line.')
    if (item.sent_to_kitchen_at) {
      return apiError(409, 'ITEM_ALREADY_SENT', 'That line is already fired — pull it with a manager PIN instead.')
    }
    const body = (await request.json()) as { quantity?: string }
    if (!body.quantity || !(Number(body.quantity) > 0)) {
      return apiError(400, 'VALIDATION_ERROR', 'Quantity must be positive.')
    }
    item.quantity = body.quantity
    recomputeOrder(order)
    return HttpResponse.json(toPublicOrder(order))
  }),

  http.delete('/api/v1/orders/:id/items/:itemId', async ({ request, params }) => {
    await delay(200)
    const caller = auth(request)
    if (!caller) return apiError(401, 'UNAUTHENTICATED', 'Sign in to continue.')
    const order = findOrder(params.id as string, caller)
    if (!order) return apiError(404, 'NOT_FOUND', 'No such order.')
    if (order.status !== 'open') return apiError(409, 'ORDER_NOT_OPEN', 'This tab is closed.')
    const item = order.items.find((i) => i.id === params.itemId)
    if (!item) return apiError(404, 'NOT_FOUND', 'No such line.')
    if (item.sent_to_kitchen_at) {
      if (!approval(request, caller.business_id)) return APPROVAL_REQUIRED()
      for (const t of tickets) {
        for (const ti of t.items) if (ti.order_item_id === item.id) ti.cancelled = true
        if (t.items.every((ti) => ti.cancelled) && t.status !== 'done') t.status = 'cancelled'
      }
    }
    order.items = order.items.filter((i) => i.id !== item.id)
    recomputeOrder(order)
    return HttpResponse.json(toPublicOrder(order))
  }),

  // ---------- split & merge ----------

  http.post('/api/v1/orders/:id/split', async ({ request, params }) => {
    await delay(300)
    const caller = auth(request)
    if (!caller) return apiError(401, 'UNAUTHENTICATED', 'Sign in to continue.')
    const order = findOrder(params.id as string, caller)
    if (!order) return apiError(404, 'NOT_FOUND', 'No such order.')
    if (order.status !== 'open') return apiError(409, 'ORDER_NOT_OPEN', 'This tab is closed.')
    const body = (await request.json()) as { items?: { order_item_id: string; quantity: string }[] }
    if (!body.items?.length) return apiError(400, 'VALIDATION_ERROR', 'Pick at least one line to move.')

    const split = makeOrder({
      store_id: order.store_id,
      cashier: caller,
      order_type: order.order_type,
      table_id: order.table_id,
      guest_count: null,
      items: [],
    })
    for (const move of body.items) {
      const item = order.items.find((i) => i.id === move.order_item_id)
      if (!item) return apiError(400, 'VALIDATION_ERROR', 'Unknown line in split.')
      const moveQty = new Big(move.quantity)
      const haveQty = new Big(item.quantity)
      if (moveQty.lte(0) || moveQty.gt(haveQty)) {
        return apiError(400, 'VALIDATION_ERROR', 'Split quantity exceeds the line.')
      }
      if (moveQty.eq(haveQty)) {
        order.items = order.items.filter((i) => i.id !== item.id)
        split.items.push(item)
      } else {
        const perUnitDiscount = new Big(item.discount).div(haveQty)
        const movedDiscount = perUnitDiscount.times(moveQty).toFixed(2)
        item.quantity = haveQty.minus(moveQty).toString()
        item.discount = new Big(item.discount).minus(movedDiscount).toFixed(2)
        split.items.push({
          ...item,
          id: uid('oi'),
          quantity: moveQty.toString(),
          discount: movedDiscount,
        })
      }
    }
    recomputeOrder(order)
    recomputeOrder(split)
    return HttpResponse.json({ original: toPublicOrder(order), split: toPublicOrder(split) })
  }),

  http.post('/api/v1/orders/:id/merge', async ({ request, params }) => {
    await delay(300)
    const caller = auth(request)
    if (!caller) return apiError(401, 'UNAUTHENTICATED', 'Sign in to continue.')
    const target = findOrder(params.id as string, caller)
    if (!target) return apiError(404, 'NOT_FOUND', 'No such order.')
    const body = (await request.json()) as { source_order_id?: string }
    const source = findOrder(body.source_order_id ?? '', caller)
    if (!source) return apiError(404, 'NOT_FOUND', 'No such source order.')
    if (target.status !== 'open' || source.status !== 'open') {
      return apiError(409, 'ORDER_NOT_OPEN', 'Both tabs must be open to merge.')
    }
    if (source.payments.length) {
      return apiError(409, 'PAYMENTS_STARTED', 'The source tab already has payments.')
    }
    target.items.push(...source.items)
    source.items = []
    source.status = 'void'
    source.note = `Merged into ${target.order_number}`
    for (const t of tickets) {
      if (t.order_id === source.id) {
        t.order_id = target.id
        t.order_number = target.order_number
      }
    }
    recomputeOrder(source)
    recomputeOrder(target)
    return HttpResponse.json(toPublicOrder(target))
  }),

  // ---------- kitchen ----------

  http.post('/api/v1/orders/:id/send', async ({ request, params }) => {
    await delay(250)
    const caller = auth(request)
    if (!caller) return apiError(401, 'UNAUTHENTICATED', 'Sign in to continue.')
    const order = findOrder(params.id as string, caller)
    if (!order) return apiError(404, 'NOT_FOUND', 'No such order.')
    if (order.status !== 'open') return apiError(409, 'ORDER_NOT_OPEN', 'This tab is closed.')
    const unsent = order.items.filter((i) => !i.sent_to_kitchen_at)
    if (!unsent.length) return apiError(409, 'NOTHING_TO_SEND', 'Every line is already fired.')
    const now = iso()
    const byStation = new Map<string, typeof unsent>()
    for (const item of unsent) {
      item.sent_to_kitchen_at = now
      const product = products.find((p) => p.id === item.product_id)
      if (!product?.kitchen_station_id) continue // retail goods never make kitchen work
      const list = byStation.get(product.kitchen_station_id) ?? []
      list.push(item)
      byStation.set(product.kitchen_station_id, list)
    }
    for (const [stationId, items] of byStation) {
      tickets.push({
        id: uid('tk'),
        order_id: order.id,
        order_number: order.order_number,
        table_name: order.table_id ? (tables.find((t) => t.id === order.table_id)?.name ?? null) : order.order_type,
        station_id: stationId,
        status: 'new',
        created_at: now,
        done_at: null,
        items: items.map((i) => ({
          id: uid('ti'),
          order_item_id: i.id,
          product_name: i.product_name,
          quantity: i.quantity,
          note: i.options.length ? i.options.join(' · ') : null,
          cancelled: false,
        })),
      })
    }
    return HttpResponse.json(toPublicOrder(order))
  }),

  http.get('/api/v1/kitchen/tickets', async ({ request }) => {
    await delay(120)
    const caller = auth(request)
    if (!caller) return apiError(401, 'UNAUTHENTICATED', 'Sign in to continue.')
    const url = new URL(request.url)
    const stationId = url.searchParams.get('station_id')
    const status = url.searchParams.get('status')
    const ownStations = new Set(
      stations
        .filter((st) => storeBusinessId(st.store_id) === caller.business_id)
        .map((st) => st.id),
    )
    let data = tickets.filter((t) => ownStations.has(t.station_id))
    if (stationId) data = data.filter((t) => t.station_id === stationId)
    if (status) data = data.filter((t) => status.split(',').includes(t.status))
    data.sort((a, b) => a.created_at.localeCompare(b.created_at))
    return HttpResponse.json({ data, total: data.length, page: 1, limit: 100 })
  }),

  http.patch('/api/v1/kitchen/tickets/:id', async ({ request, params }) => {
    await delay(150)
    const caller = auth(request)
    if (!caller) return apiError(401, 'UNAUTHENTICATED', 'Sign in to continue.')
    const ticket = tickets.find(
      (t) =>
        t.id === params.id &&
        storeBusinessId(stations.find((st) => st.id === t.station_id)?.store_id ?? null) ===
          caller.business_id,
    )
    if (!ticket) return apiError(404, 'NOT_FOUND', 'No such ticket.')
    const body = (await request.json()) as { status?: 'new' | 'in_progress' | 'done' | 'cancelled' }
    if (!body.status) return apiError(400, 'VALIDATION_ERROR', 'A status is required.')
    ticket.status = body.status
    if (body.status === 'done') ticket.done_at = iso()
    return HttpResponse.json(ticket)
  }),

  // ---------- tables / floor ----------

  http.get('/api/v1/tables/floor', async ({ request }) => {
    await delay(200)
    const caller = auth(request)
    if (!caller) return apiError(401, 'UNAUTHENTICATED', 'Sign in to continue.')
    const url = new URL(request.url)
    const storeId = url.searchParams.get('store_id')
    const data = tables
      .filter(
        (t) =>
          t.is_active &&
          storeBusinessId(t.store_id) === caller.business_id &&
          (!storeId || t.store_id === storeId),
      )
      .map((t) => {
        const open = orders.find((o) => o.status === 'open' && o.table_id === t.id)
        return {
          ...t,
          order: open
            ? {
                order_id: open.id,
                order_number: open.order_number,
                total: open.total,
                guest_count: open.guest_count,
                opened_at: open.created_at,
                minutes_open: Math.round((Date.now() - new Date(open.created_at).getTime()) / 60000),
                unsent_count: open.items.filter((i) => !i.sent_to_kitchen_at).length,
              }
            : null,
        }
      })
    return HttpResponse.json({ data, total: data.length, page: 1, limit: 100 })
  }),

  // ---------- customers & credit ----------

  http.get('/api/v1/customers', async ({ request }) => {
    await delay(200)
    const caller = auth(request)
    if (!caller) return apiError(401, 'UNAUTHENTICATED', 'Sign in to continue.')
    const url = new URL(request.url)
    const search = url.searchParams.get('search')?.toLowerCase()
    let data = customers.filter((c) => c.is_active && c.business_id === caller.business_id)
    if (search) {
      data = data.filter(
        (c) => c.name.toLowerCase().includes(search) || (c.phone ?? '').includes(search),
      )
    }
    return HttpResponse.json({
      data: data.map((c) => ({ ...c, balance: customerBalance(c.id) })),
      total: data.length,
      page: 1,
      limit: 100,
    })
  }),

  http.post('/api/v1/customers', async ({ request }) => {
    await delay(250)
    const caller = auth(request)
    if (!caller) return apiError(401, 'UNAUTHENTICATED', 'Sign in to continue.')
    const body = (await request.json()) as Partial<(typeof customers)[number]>
    if (!body.name?.trim()) return apiError(400, 'VALIDATION_ERROR', 'A name is required.')
    const customer = {
      id: uid('cu'),
      business_id: caller.business_id,
      name: body.name.trim(),
      phone: body.phone ?? null,
      email: body.email ?? null,
      credit_limit: body.credit_limit ?? null,
      notes: body.notes ?? null,
      is_active: true,
    }
    customers.push(customer)
    return HttpResponse.json({ ...customer, balance: '0.00' }, { status: 201 })
  }),

  http.patch('/api/v1/customers/:id', async ({ request, params }) => {
    await delay(250)
    const caller = auth(request)
    if (!caller) return apiError(401, 'UNAUTHENTICATED', 'Sign in to continue.')
    const customer = customers.find(
      (c) => c.id === params.id && c.business_id === caller.business_id,
    )
    if (!customer) return apiError(404, 'NOT_FOUND', 'No such customer.')
    const body = (await request.json()) as Partial<typeof customer>
    if (body.name !== undefined) customer.name = body.name
    if (body.phone !== undefined) customer.phone = body.phone
    if (body.email !== undefined) customer.email = body.email
    if (body.credit_limit !== undefined) customer.credit_limit = body.credit_limit
    if (body.notes !== undefined) customer.notes = body.notes
    if (body.is_active !== undefined) customer.is_active = body.is_active
    return HttpResponse.json({ ...customer, balance: customerBalance(customer.id) })
  }),

  http.get('/api/v1/customers/:id/statement', async ({ request, params }) => {
    await delay(250)
    const caller = auth(request)
    if (!caller) return apiError(401, 'UNAUTHENTICATED', 'Sign in to continue.')
    const customer = customers.find(
      (c) => c.id === params.id && c.business_id === caller.business_id,
    )
    if (!customer) return apiError(404, 'NOT_FOUND', 'No such customer.')
    const entries = ledger
      .filter((e) => e.customer_id === customer.id)
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
    let running = new Big(0)
    const statement = entries.map((e) => {
      running = running.plus(e.amount)
      return {
        id: e.id,
        entry_type: e.entry_type,
        amount: e.amount,
        method: e.method,
        note: e.note,
        created_by_name: userName(e.created_by),
        created_at: e.created_at,
        balance: running.toFixed(2),
      }
    })
    return HttpResponse.json({
      customer: { ...customer, balance: customerBalance(customer.id) },
      entries: statement.reverse(), // newest first
    })
  }),

  http.post('/api/v1/customers/:id/repayments', async ({ request, params }) => {
    await delay(300)
    const caller = auth(request)
    if (!caller) return apiError(401, 'UNAUTHENTICATED', 'Sign in to continue.')
    const customer = customers.find(
      (c) => c.id === params.id && c.business_id === caller.business_id,
    )
    if (!customer) return apiError(404, 'NOT_FOUND', 'No such customer.')
    const body = (await request.json()) as {
      amount?: string
      method?: 'cash' | 'card' | 'online'
      note?: string
      store_id?: string
    }
    if (!body.amount || !new Big(body.amount).gt(0)) {
      return apiError(400, 'VALIDATION_ERROR', 'Repayment amount must be positive.')
    }
    if (!body.method) return apiError(400, 'VALIDATION_ERROR', 'How did they pay?')
    let shiftId: string | null = null
    if (body.method === 'cash') {
      if (!body.store_id) return apiError(400, 'VALIDATION_ERROR', 'Cash repayments need a store (the drawer).')
      const shift = currentShift(body.store_id)
      if (!shift) return apiError(409, 'NO_OPEN_SHIFT', 'Open a shift before taking cash.')
      shiftId = shift.id
    }
    const entry = {
      id: uid('lg'),
      customer_id: customer.id,
      entry_type: 'repayment' as const,
      amount: new Big(body.amount).times(-1).toFixed(2),
      order_id: null,
      method: body.method,
      note: body.note ?? null,
      created_by: caller.id,
      created_at: iso(),
      shift_id: shiftId,
    }
    ledger.push(entry)
    return HttpResponse.json(
      { entry, balance: customerBalance(customer.id) },
      { status: 201 },
    )
  }),

  http.get('/api/v1/customers/balances', async ({ request }) => {
    await delay(200)
    const caller = auth(request)
    if (!caller) return apiError(401, 'UNAUTHENTICATED', 'Sign in to continue.')
    const data = customers
      .filter((c) => c.is_active && c.business_id === caller.business_id)
      .map((c) => ({ ...c, balance: customerBalance(c.id) }))
      .filter((c) => new Big(c.balance).gt(0))
      .sort((a, b) => new Big(b.balance).minus(a.balance).toNumber())
    return HttpResponse.json({ data, total: data.length, page: 1, limit: 100 })
  }),
]
