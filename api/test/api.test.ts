import Big from 'big.js'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { computeTotals } from '../src/lib/totals.js'
import { call, loginAdmin, loginBusiness, startWorld, stopWorld, tillSession } from './harness.js'

/**
 * The flows money depends on, end to end against Postgres. Order matters:
 * later groups build on state earlier ones left, and the destructive admin
 * checks come last.
 */

let app: FastifyInstance
let sara: string // cashier, Al Rayyan (retail, shift open)
let yusuf: string // cashier, Karak Corner (restaurant, shift open)
let ayaan: string // owner, back office
let imran: string // Drumsticks manager — a different tenant

beforeAll(async () => {
  app = await startWorld()
  sara = (await tillSession(app, 'demo@agricope.qa', 's-alrayyan', '1234')).access_token
  yusuf = (await tillSession(app, 'demo@agricope.qa', 's-karak', '3456')).access_token
  ayaan = (await tillSession(app, 'demo@agricope.qa', null, '0000')).access_token
  imran = (await tillSession(app, 'drumsticks@agricope.qa', 's-drumsticks', '2222')).access_token
})

afterAll(async () => {
  await stopWorld(app)
})

describe('sign-in', () => {
  it('a wrong password is refused without saying which half was wrong', async () => {
    const res = await call(app, 'POST', '/auth/login', { body: { email: 'demo@agricope.qa', password: 'nope' } })
    expect(res.status).toBe(401)
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS')
  })

  it('a business gets a till token and only its ACTIVE branches', async () => {
    const biz = await loginBusiness(app, 'demo@agricope.qa')
    expect(biz.stores.map((s) => s.id).sort()).toEqual(['s-alrayyan', 's-karak'])
  })

  it('a PIN only opens the till the person is posted to', async () => {
    const biz = await loginBusiness(app, 'demo@agricope.qa')
    const wrongStore = await call(app, 'POST', '/auth/switch-cashier', {
      token: biz.business_token,
      body: { store_id: 's-karak', pin: '1234' }, // Sara is posted to Al Rayyan
    })
    expect(wrongStore.status).toBe(401)
    expect(wrongStore.body.error.code).toBe('INVALID_PIN')
    const owner = await call(app, 'POST', '/auth/switch-cashier', {
      token: biz.business_token,
      body: { store_id: 's-karak', pin: '0000' }, // owners work everywhere
    })
    expect(owner.status).toBe(200)
    expect(owner.body.user.role).toBe('owner')
  })

  it('the PIN door is rate-limited', async () => {
    const biz = await loginBusiness(app, 'demo@agricope.qa')
    let last = 0
    for (let i = 0; i < 12; i++) {
      const r = await call(app, 'POST', '/auth/switch-cashier', {
        token: biz.business_token,
        body: { store_id: 's-alrayyan', pin: '8888' },
        from: '203.0.113.7', // one till, hammering
      })
      last = r.status
    }
    expect(last).toBe(429)
  })
})

describe('a counter sale', () => {
  let orderId: string
  let total: string

  it('is priced by the server with the pinned totals formula', async () => {
    const res = await call(app, 'POST', '/orders', {
      token: sara,
      body: {
        store_id: 's-alrayyan',
        order_type: 'counter',
        items: [
          { product_id: 'p-tomato', quantity: '1.500' }, // 4.50 × 1.5
          { product_id: 'p-milk', quantity: '2' }, // 9.00 × 2
        ],
      },
    })
    expect(res.status).toBe(201)
    orderId = res.body.id
    total = res.body.total
    const expected = computeTotals({
      lines: [
        { unit_price: '4.50', quantity: '1.500', tax_rate: '0' },
        { unit_price: '9.00', quantity: '2', tax_rate: '0' },
      ],
      order_type: 'counter',
    })
    expect(res.body.total).toBe(expected.total) // 24.75
    expect(res.body.items[0].quantity).toBe('1.5')
    expect(res.body.items[0].line_total).toBe('6.75')
    expect(res.body.order_number).toMatch(/^S1-\d{8}-\d{4}$/)
    expect(res.body.cashier_name).toBe('Sara Al-Ali')
    expect(res.body.amount_due).toBe(total)
  })

  it('refuses a payment above what is due', async () => {
    const res = await call(app, 'POST', `/orders/${orderId}/payments`, {
      token: sara,
      body: { method: 'card', amount: new Big(total).plus(1).toFixed(2) },
    })
    expect(res.status).toBe(400)
  })

  it('settles with split cash + card, computes change, and completes on the last dirham', async () => {
    const cash = await call(app, 'POST', `/orders/${orderId}/payments`, {
      token: sara,
      body: { method: 'cash', amount: '10.00', tendered: '20.00' },
    })
    expect(cash.status).toBe(200)
    expect(cash.body.status).toBe('open')
    expect(cash.body.payments[0].change_given).toBe('10.00')
    expect(cash.body.amount_due).toBe(new Big(total).minus(10).toFixed(2))

    const card = await call(app, 'POST', `/orders/${orderId}/payments`, {
      token: sara,
      body: { method: 'card', amount: cash.body.amount_due, reference: '•••• 1111' },
    })
    expect(card.status).toBe(200)
    expect(card.body.status).toBe('completed')
    expect(card.body.amount_due).toBe('0.00')
    expect(card.body.completed_at).not.toBeNull()
  })

  it('a settled order cannot take another payment', async () => {
    const res = await call(app, 'POST', `/orders/${orderId}/payments`, {
      token: sara,
      body: { method: 'cash', amount: '1.00' },
    })
    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('ORDER_NOT_OPEN')
  })

  it('has a public receipt by token and a private one by id', async () => {
    const mine = await call(app, 'GET', `/orders/${orderId}/receipt`, { token: sara })
    expect(mine.status).toBe(200)
    expect(mine.body.business.name).toBe('Agricope Demo Trading Co.')
    const pub = await call(app, 'GET', `/r/${mine.body.order.receipt_token}`)
    expect(pub.status).toBe(200)
    expect(pub.body.order.total).toBe(total)
  })

  it('is invisible to another business', async () => {
    const res = await call(app, 'GET', `/orders/${orderId}`, { token: imran })
    expect(res.status).toBe(404)
  })
})

describe('credit', () => {
  it('refuses credit for a customer with no facility', async () => {
    const o = await call(app, 'POST', '/orders', {
      token: sara,
      body: { store_id: 's-alrayyan', customer_id: 'cu-ali', items: [{ product_id: 'p-water', quantity: '2' }] },
    })
    const res = await call(app, 'POST', `/orders/${o.body.id}/payments`, {
      token: sara,
      body: { method: 'credit', amount: o.body.total },
    })
    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('CREDIT_LIMIT_EXCEEDED')
  })

  it('blocks a sale that would breach the limit and allows one that fits, writing the ledger', async () => {
    // Noora: limit 500, owes 180 from the seed.
    const big = await call(app, 'POST', '/orders', {
      token: sara,
      body: { store_id: 's-alrayyan', customer_id: 'cu-noora', items: [{ product_id: 'p-kofta', quantity: '10' }] }, // 380
    })
    expect(big.body.customer_balance).toBe('180.00')
    const over = await call(app, 'POST', `/orders/${big.body.id}/payments`, {
      token: sara,
      body: { method: 'credit', amount: big.body.total },
    })
    expect(over.status).toBe(403)
    expect(over.body.error.message).toContain('over their QAR 500.00 limit')

    const small = await call(app, 'POST', '/orders', {
      token: sara,
      body: { store_id: 's-alrayyan', customer_id: 'cu-noora', items: [{ product_id: 'p-kofta', quantity: '2' }] }, // 76
    })
    const ok = await call(app, 'POST', `/orders/${small.body.id}/payments`, {
      token: sara,
      body: { method: 'credit', amount: small.body.total },
    })
    expect(ok.status).toBe(200)
    expect(ok.body.status).toBe('completed')
    expect(ok.body.customer_balance).toBe('256.00')

    const statement = await call(app, 'GET', '/customers/cu-noora/statement', { token: sara })
    expect(statement.status).toBe(200)
    expect(statement.body.customer.balance).toBe('256.00')
    expect(statement.body.entries[0].entry_type).toBe('charge')
    expect(statement.body.entries[0].amount).toBe('76.00')
    expect(statement.body.entries[0].balance).toBe('256.00')
  })

  it('a cash repayment needs an open drawer and lowers the balance', async () => {
    const res = await call(app, 'POST', '/customers/cu-noora/repayments', {
      token: sara,
      body: { amount: '56.00', method: 'cash', store_id: 's-alrayyan' },
    })
    expect(res.status).toBe(201)
    expect(res.body.balance).toBe('200.00')
  })

  it('setting a credit limit is a money decision — it needs a manager PIN', async () => {
    const noPin = await call(app, 'PATCH', '/customers/cu-ali', { token: sara, body: { credit_limit: '300.00' } })
    expect(noPin.status).toBe(403)
    expect(noPin.body.error.code).toBe('APPROVAL_REQUIRED')
    const cashierPin = await call(app, 'PATCH', '/customers/cu-ali', { token: sara, body: { credit_limit: '300.00' }, pin: '2345' })
    expect(cashierPin.status).toBe(403)
    const managerPin = await call(app, 'PATCH', '/customers/cu-ali', { token: sara, body: { credit_limit: '300.00' }, pin: '9999' })
    expect(managerPin.status).toBe(200)
    expect(managerPin.body.credit_limit).toBe('300.00')
  })
})

describe('discounts, voids and refunds', () => {
  it('a small discount sails through; a large one asks for a manager PIN', async () => {
    const o = await call(app, 'POST', '/orders', {
      token: sara,
      body: { store_id: 's-alrayyan', items: [{ product_id: 'p-milk', quantity: '10' }] }, // 90.00
    })
    const five = await call(app, 'POST', `/orders/${o.body.id}/discount`, {
      token: sara,
      body: { type: 'percent', value: '5', reason: 'loyal' },
    })
    expect(five.status).toBe(200)
    expect(five.body.discount_total).toBe('4.50')
    expect(five.body.total).toBe('85.50')

    const twenty = await call(app, 'POST', `/orders/${o.body.id}/discount`, {
      token: sara,
      body: { type: 'percent', value: '20', reason: 'complaint' },
    })
    expect(twenty.status).toBe(403)
    expect(twenty.body.error.code).toBe('APPROVAL_REQUIRED')

    const approved = await call(app, 'POST', `/orders/${o.body.id}/discount`, {
      token: sara,
      body: { type: 'percent', value: '20', reason: 'complaint' },
      pin: '9999',
    })
    expect(approved.status).toBe(200)
    expect(approved.body.total).toBe('72.00')

    // A Drumsticks manager's PIN means nothing on a demo-business till.
    const foreign = await call(app, 'POST', `/orders/${o.body.id}/discount`, {
      token: sara,
      body: { type: 'percent', value: '30' },
      pin: '2222',
    })
    expect(foreign.status).toBe(403)
  })

  it('voiding needs approval; refunding writes negative payments and needs the drawer for cash', async () => {
    const o = await call(app, 'POST', '/orders', {
      token: sara,
      body: { store_id: 's-alrayyan', items: [{ product_id: 'p-bread', quantity: '3' }] }, // 6.00
    })
    const noPin = await call(app, 'POST', `/orders/${o.body.id}/void`, { token: sara, body: {} })
    expect(noPin.status).toBe(403)
    await call(app, 'POST', `/orders/${o.body.id}/payments`, { token: sara, body: { method: 'cash', amount: '6.00' } })
    const refund = await call(app, 'POST', `/orders/${o.body.id}/refund`, { token: sara, body: {}, pin: '0000' })
    expect(refund.status).toBe(200)
    expect(refund.body.status).toBe('refunded')
    expect(refund.body.payments.map((p: { amount: string }) => p.amount)).toEqual(['6.00', '-6.00'])
  })
})

describe('the restaurant floor and the kitchen', () => {
  let tabId: string

  it('a table can only hold one open tab', async () => {
    const floor = await call(app, 'GET', '/tables/floor?store_id=s-karak', { token: yusuf })
    const t3 = floor.body.data.find((t: { name: string }) => t.name === 'T3')
    expect(t3.order).not.toBeNull()
    tabId = t3.order.order_id
    expect(t3.order.unsent_count).toBe(2)
    const clash = await call(app, 'POST', '/orders', {
      token: yusuf,
      body: { store_id: 's-karak', order_type: 'dine_in', table_id: 't-3', items: [] },
    })
    expect(clash.status).toBe(409)
    expect(clash.body.error.code).toBe('TABLE_OCCUPIED')
  })

  it('sending a round fires one ticket per station, with the description on it', async () => {
    const sent = await call(app, 'POST', `/orders/${tabId}/send`, { token: yusuf, body: {} })
    expect(sent.status).toBe(200)
    expect(sent.body.items.every((i: { sent_to_kitchen_at: string | null }) => i.sent_to_kitchen_at)).toBe(true)
    const again = await call(app, 'POST', `/orders/${tabId}/send`, { token: yusuf, body: {} })
    expect(again.status).toBe(409)
    expect(again.body.error.code).toBe('NOTHING_TO_SEND')

    const kitchen = await call(app, 'GET', '/kitchen/tickets?station_id=st-kitchen&status=new', { token: yusuf })
    expect(kitchen.body.data).toHaveLength(1)
    expect(kitchen.body.data[0].items[0].product_name).toBe('Chicken Shawarma')
    const grill = await call(app, 'GET', '/kitchen/tickets?station_id=st-grill&status=new,in_progress', { token: yusuf })
    expect(grill.body.data[0].items[0].description).toContain('Lamb kofta')
  })

  it('a fired line cannot be edited without a PIN; the service charge rides on the tab', async () => {
    const tab = await call(app, 'GET', `/orders/${tabId}`, { token: yusuf })
    expect(tab.body.service_charge_total).toBe(new Big(tab.body.subtotal).times(10).div(100).toFixed(2))
    const line = tab.body.items[0]
    const edit = await call(app, 'PATCH', `/orders/${tabId}/items/${line.id}`, { token: yusuf, body: { quantity: '5' } })
    expect(edit.status).toBe(409)
    expect(edit.body.error.code).toBe('ITEM_ALREADY_SENT')
    const pull = await call(app, 'DELETE', `/orders/${tabId}/items/${line.id}`, { token: yusuf })
    expect(pull.status).toBe(403)
  })

  it('the kitchen is invisible to another tenant', async () => {
    const res = await call(app, 'GET', '/kitchen/tickets?station_id=st-grill', { token: imran })
    expect(res.body.data).toHaveLength(0)
  })
})

describe('the cash drawer', () => {
  it('the Z report: expected cash is the server\'s number, and the drawer closes short by what it is short', async () => {
    const current = await call(app, 'GET', '/shifts/current?store_id=s-alrayyan', { token: sara })
    expect(current.status).toBe(200)
    const live = current.body.shift.live_expected_cash
    // float 500 − 250 out + 100 in, plus every cash payment this shift, plus the 56.00 cash repayment above
    expect(new Big(live).gt(350)).toBe(true)
    expect(current.body.shift.cash_repayments).toBe('56.00')

    const counted = new Big(live).minus('4.07').toFixed(2)
    const closed = await call(app, 'POST', `/shifts/${current.body.shift.id}/close`, {
      token: sara,
      body: { counted_cash: counted },
    })
    expect(closed.status).toBe(200)
    expect(closed.body.expected_cash).toBe(live)
    expect(closed.body.over_short).toBe('-4.07')
    expect(closed.body.closed_by_name).toBe('Sara Al-Ali')
  })

  it('with the drawer closed, cash is refused until a new float is counted', async () => {
    const o = await call(app, 'POST', '/orders', {
      token: sara,
      body: { store_id: 's-alrayyan', items: [{ product_id: 'p-water', quantity: '1' }] },
    })
    const cash = await call(app, 'POST', `/orders/${o.body.id}/payments`, { token: sara, body: { method: 'cash', amount: '1.50' } })
    expect(cash.status).toBe(409)
    expect(cash.body.error.code).toBe('NO_OPEN_SHIFT')
    const card = await call(app, 'POST', `/orders/${o.body.id}/payments`, { token: sara, body: { method: 'card', amount: '1.50' } })
    expect(card.status).toBe(200)

    const reopened = await call(app, 'POST', '/shifts', { token: sara, body: { store_id: 's-alrayyan', opening_float: '300.00' } })
    expect(reopened.status).toBe(201)
    const twice = await call(app, 'POST', '/shifts', { token: sara, body: { store_id: 's-alrayyan', opening_float: '1.00' } })
    expect(twice.status).toBe(409)
    expect(twice.body.error.code).toBe('SHIFT_ALREADY_OPEN')
  })
})

describe('reports', () => {
  it('today has sales and a previous window to compare with', async () => {
    const res = await call(app, 'GET', '/reports/summary?range=today', { token: ayaan })
    expect(res.status).toBe(200)
    expect(new Big(res.body.gross_sales).gt(0)).toBe(true)
    expect(Object.keys(res.body.by_method).sort()).toEqual(['card', 'cash', 'credit', 'online'])
    expect(res.body.previous.order_count).toBeGreaterThan(0)
  })

  it('credit ageing is FIFO', async () => {
    const res = await call(app, 'GET', '/reports/credit-aging', { token: ayaan })
    const by = Object.fromEntries(res.body.data.map((r: { name: string; bucket: string }) => [r.name, r.bucket]))
    expect(by['Noora Al-Thani']).toBe('90+') // 180 charged 95 days ago, never fully repaid
    expect(by['Fatima Hassan']).toBe('30')
    // Mohammed: 520 repaid covers only part of the 1000 charged 70 days ago
    expect(by['Mohammed Al-Kuwari']).toBe('60')
  })
})

describe('deactivate first, delete second', () => {
  it('a login must be off before it can go, and its name stays on its orders', async () => {
    const active = await call(app, 'DELETE', '/users/u-amal', { token: ayaan })
    expect(active.status).toBe(409)
    expect(active.body.error.code).toBe('STILL_ACTIVE')
    const off = await call(app, 'PATCH', '/users/u-amal', { token: ayaan, body: { is_active: false } })
    expect(off.status).toBe(200)
    const gone = await call(app, 'DELETE', '/users/u-amal', { token: ayaan })
    expect(gone.status).toBe(204)
    const orders = await call(app, 'GET', '/orders?store_id=s-alrayyan', { token: ayaan })
    expect(orders.body.data.some((o: { cashier_name: string }) => o.cashier_name === 'Amal Nasser')).toBe(true)
  })

  it('a manager cannot delete a login at all', async () => {
    const maryam = (await tillSession(app, 'demo@agricope.qa', 's-alrayyan', '9999')).access_token
    const res = await call(app, 'DELETE', '/users/u-yusuf', { token: maryam })
    expect(res.status).toBe(403)
  })

  it('a branch with history can be switched off but never deleted', async () => {
    const admin = await loginAdmin(app)
    const active = await call(app, 'DELETE', '/admin/businesses/b-demo/stores/s-alrayyan', { token: admin })
    expect(active.status).toBe(409)
    expect(active.body.error.code).toBe('STILL_ACTIVE')
    await call(app, 'PATCH', '/admin/businesses/b-demo/stores/s-alrayyan', { token: admin, body: { is_active: false } })
    const history = await call(app, 'DELETE', '/admin/businesses/b-demo/stores/s-alrayyan', { token: admin })
    expect(history.status).toBe(409)
    expect(history.body.error.code).toBe('HAS_HISTORY')
    // switched off, it no longer appears on the till
    const biz = await loginBusiness(app, 'demo@agricope.qa')
    expect(biz.stores.map((s) => s.id)).toEqual(['s-karak'])
    await call(app, 'PATCH', '/admin/businesses/b-demo/stores/s-alrayyan', { token: admin, body: { is_active: true } })
  })

  it('a business is suspended before it is deleted, and its history goes with it', async () => {
    const admin = await loginAdmin(app)
    const active = await call(app, 'DELETE', '/admin/businesses/b-demo', { token: admin })
    expect(active.status).toBe(409)
    const suspended = await call(app, 'PATCH', '/admin/businesses/b-demo', { token: admin, body: { is_active: false } })
    expect(suspended.status).toBe(200)
    expect(suspended.body.is_active).toBe(false)
    const locked = await call(app, 'POST', '/auth/login', { body: { email: 'demo@agricope.qa', password: 'demo123' } })
    expect(locked.status).toBe(403)
    expect(locked.body.error.code).toBe('BUSINESS_SUSPENDED')
    // an already-issued till token stops working too
    const stale = await call(app, 'GET', '/orders', { token: sara })
    expect(stale.status).toBe(401)

    const gone = await call(app, 'DELETE', '/admin/businesses/b-demo', { token: admin })
    expect(gone.status).toBe(204)
    const list = await call(app, 'GET', '/admin/businesses', { token: admin })
    expect(list.body.data.map((b: { id: string }) => b.id).sort()).toEqual(['b-drumsticks', 'b-karakhouse'])
    // the other tenant is untouched
    const ds = await call(app, 'GET', '/products', { token: imran })
    expect(ds.body.data.length).toBeGreaterThan(50)
  })
})
