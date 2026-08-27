import Big from 'big.js'
import { users } from './db'
import {
  cashMovements,
  customers,
  iso,
  ledger,
  makeOrder,
  orders,
  recomputeOrder,
  shifts,
  snapshotItem,
  tables,
  tickets,
  uid,
} from './posdb'
import type { DbShift } from './posdb'

/** One believable "day in the life" so every screen has something to show. */
export function seedWorld(): void {
  if (shifts.length) return // idempotent across HMR

  // --- shifts: both stores open this morning ---
  const alrayyanShift: DbShift = {
    id: uid('sh'),
    store_id: 's-alrayyan',
    status: 'open',
    opened_by: 'u-sara',
    closed_by: null,
    opening_float: '500.00',
    expected_cash: null,
    counted_cash: null,
    over_short: null,
    opened_at: iso(7 * 60),
    closed_at: null,
  }
  const karakShift: DbShift = {
    id: uid('sh'),
    store_id: 's-karak',
    status: 'open',
    opened_by: 'u-yusuf',
    closed_by: null,
    opening_float: '300.00',
    expected_cash: null,
    counted_cash: null,
    over_short: null,
    opened_at: iso(6 * 60),
    closed_at: null,
  }
  const drumsticksShift: DbShift = {
    id: uid('sh'),
    store_id: 's-drumsticks',
    status: 'open',
    opened_by: 'u-ds-manager',
    closed_by: null,
    opening_float: '400.00',
    expected_cash: null,
    counted_cash: null,
    over_short: null,
    opened_at: iso(5 * 60),
    closed_at: null,
  }
  shifts.push(alrayyanShift, karakShift, drumsticksShift)

  cashMovements.push({
    id: uid('cm'),
    shift_id: alrayyanShift.id,
    type: 'paid_out',
    amount: '250.00',
    reason: 'Bought change from exchange',
    created_by: 'u-sara',
    created_at: iso(5 * 60),
  })
  cashMovements.push({
    id: uid('cm'),
    shift_id: alrayyanShift.id,
    type: 'paid_in',
    amount: '100.00',
    reason: 'Owner float top-up',
    created_by: 'u-maryam',
    created_at: iso(3 * 60),
  })

  // --- customers & their credit history ---
  customers.push(
    { id: 'cu-mohammed', business_id: 'b-demo', name: 'Mohammed Al-Kuwari', phone: '5511 2233', email: 'm.alkuwari@gmail.com', credit_limit: '2000.00', notes: null, is_active: true },
    { id: 'cu-fatima', business_id: 'b-demo', name: 'Fatima Hassan', phone: '5522 6677', email: null, credit_limit: '1000.00', notes: null, is_active: true },
    { id: 'cu-noora', business_id: 'b-demo', name: 'Noora Al-Thani', phone: '6644 2288', email: null, credit_limit: '500.00', notes: null, is_active: true },
    { id: 'cu-ali', business_id: 'b-demo', name: 'Ali Reza', phone: '3355 9911', email: null, credit_limit: null, notes: 'Cash only — no credit', is_active: true },
  )
  const daysAgo = (d: number, note: string, customer: string, type: 'charge' | 'repayment', amount: string, method: 'cash' | null = null) =>
    ledger.push({
      id: uid('lg'),
      customer_id: customer,
      entry_type: type,
      amount,
      order_id: null,
      method: type === 'repayment' ? (method ?? 'cash') : null,
      note,
      created_by: 'u-sara',
      created_at: iso(d * 24 * 60),
      shift_id: null,
    })
  daysAgo(70, 'Order S1-old-0821', 'cu-mohammed', 'charge', '1000.00')
  daysAgo(48, 'Cash received', 'cu-mohammed', 'repayment', '-200.00')
  daysAgo(38, 'Order S1-old-0902', 'cu-mohammed', 'charge', '450.00')
  daysAgo(9, 'Order S1-old-1004', 'cu-mohammed', 'charge', '320.00')
  daysAgo(2, 'Cash received', 'cu-mohammed', 'repayment', '-320.00')
  daysAgo(33, 'Order S1-old-0918', 'cu-fatima', 'charge', '430.00')
  daysAgo(95, 'Order S1-old-0714', 'cu-noora', 'charge', '180.00')

  // --- tables at the restaurant ---
  tables.push(
    { id: 't-1', store_id: 's-karak', name: 'T1', zone: 'Main hall', seats: 2, is_active: true },
    { id: 't-2', store_id: 's-karak', name: 'T2', zone: 'Main hall', seats: 4, is_active: true },
    { id: 't-3', store_id: 's-karak', name: 'T3', zone: 'Main hall', seats: 4, is_active: true },
    { id: 't-4', store_id: 's-karak', name: 'T4', zone: 'Main hall', seats: 6, is_active: true },
    { id: 't-5', store_id: 's-karak', name: 'T5', zone: 'Family section', seats: 4, is_active: true },
    { id: 't-p1', store_id: 's-karak', name: 'P1', zone: 'Terrace', seats: 6, is_active: true },
    { id: 't-p2', store_id: 's-karak', name: 'P2', zone: 'Terrace', seats: 2, is_active: true },
    // Drumsticks — a small dine-in hall beside the counter
    { id: 't-ds1', store_id: 's-drumsticks', name: 'T1', zone: 'Hall', seats: 4, is_active: true },
    { id: 't-ds2', store_id: 's-drumsticks', name: 'T2', zone: 'Hall', seats: 4, is_active: true },
    { id: 't-ds3', store_id: 's-drumsticks', name: 'T3', zone: 'Hall', seats: 6, is_active: true },
    { id: 't-ds4', store_id: 's-drumsticks', name: 'T4', zone: 'Hall', seats: 2, is_active: true },
  )

  const sara = users.find((u) => u.id === 'u-sara')!
  const amal = users.find((u) => u.id === 'u-amal')!
  const yusuf = users.find((u) => u.id === 'u-yusuf')!

  const pay = (o: ReturnType<typeof makeOrder>, method: 'cash' | 'card' | 'online', amount: string, minutesAgo: number, tendered?: string) => {
    o.payments.push({
      id: uid('pay'),
      method,
      amount,
      tendered: tendered ?? null,
      change_given: tendered ? new Big(tendered).minus(amount).toFixed(2) : null,
      reference: method === 'card' ? '•••• 4242' : method === 'online' ? 'TXN-88214' : null,
      received_by: o.cashier_id,
      created_at: iso(minutesAgo),
    })
    if (new Big(o.total).minus(o.payments.reduce((a, p) => a.plus(p.amount), new Big(0))).lte(0)) {
      o.status = 'completed'
      o.completed_at = iso(minutesAgo)
    }
  }

  // --- a morning of retail sales at Al Rayyan ---
  const retailMenu: [string, string][][] = [
    [['p-tomato', '2'], ['p-milk', '1'], ['p-bread', '3']],
    [['p-water', '6'], ['p-karak', '2']],
    [['p-apple', '1.500'], ['p-banana', '1']],
    [['p-milk', '2'], ['p-laban', '1'], ['p-croissant', '4']],
    [['p-kofta', '1'], ['p-bread', '5']],
    [['p-cucumber', '2'], ['p-tomato', '1.250']],
    [['p-croissant', '2'], ['p-karak', '2']],
    [['p-water', '12']],
    [['p-milk', '1'], ['p-bread', '2'], ['p-banana', '2']],
    [['p-apple', '2'], ['p-laban', '2']],
  ]
  retailMenu.forEach((items, i) => {
    const minutesAgo = 420 - i * 42
    const o = makeOrder({
      store_id: 's-alrayyan',
      cashier: i % 3 === 0 ? amal : sara,
      order_type: 'counter',
      items: items.map(([product_id, quantity]) => ({ product_id, quantity })),
      created_at: iso(minutesAgo),
    })
    o.shift_id = alrayyanShift.id
    if (i % 4 === 1) {
      // split payment: some cash, rest card
      const half = new Big(o.total).div(2).toFixed(2)
      const rest = new Big(o.total).minus(half).toFixed(2)
      pay(o, 'cash', half, minutesAgo - 2, half)
      pay(o, 'card', rest, minutesAgo - 1)
    } else if (i % 4 === 2) {
      pay(o, 'card', o.total, minutesAgo - 1)
    } else if (i % 4 === 3) {
      pay(o, 'online', o.total, minutesAgo - 1)
    } else {
      const tendered = new Big(o.total).plus(new Big((i % 3) * 10)).toFixed(2)
      pay(o, 'cash', o.total, minutesAgo - 1, tendered)
    }
  })

  // one credit sale for Mohammed this morning
  const creditOrder = makeOrder({
    store_id: 's-alrayyan',
    cashier: sara,
    order_type: 'counter',
    customer_id: 'cu-mohammed',
    items: [
      { product_id: 'p-kofta', quantity: '1' },
      { product_id: 'p-bread', quantity: '5' },
    ],
    created_at: iso(200),
  })
  creditOrder.shift_id = alrayyanShift.id
  creditOrder.payments.push({
    id: uid('pay'),
    method: 'credit',
    amount: creditOrder.total,
    tendered: null,
    change_given: null,
    reference: null,
    received_by: sara.id,
    created_at: iso(199),
  })
  creditOrder.status = 'completed'
  creditOrder.completed_at = iso(199)
  ledger.push({
    id: uid('lg'),
    customer_id: 'cu-mohammed',
    entry_type: 'charge',
    amount: creditOrder.total,
    order_id: creditOrder.id,
    method: null,
    note: `Order ${creditOrder.order_number}`,
    created_by: sara.id,
    created_at: iso(199),
    shift_id: alrayyanShift.id,
  })

  // one voided order
  const voided = makeOrder({
    store_id: 's-alrayyan',
    cashier: sara,
    order_type: 'counter',
    items: [{ product_id: 'p-water', quantity: '1' }],
    created_at: iso(150),
  })
  voided.status = 'void'
  voided.note = 'Rang up by mistake'

  // --- lunch service at Karak Corner ---
  const lunches: [string, string][][] = [
    [['p-shawarma', '2'], ['p-karak', '2']],
    [['p-mixed', '1'], ['p-lime', '2'], ['p-bread', '2']],
    [['p-shawarma', '3'], ['p-water', '3']],
    [['p-kofta', '1'], ['p-lime', '1']],
  ]
  lunches.forEach((items, i) => {
    const minutesAgo = 200 - i * 35
    const o = makeOrder({
      store_id: 's-karak',
      cashier: yusuf,
      order_type: i % 2 === 0 ? 'dine_in' : 'takeaway',
      table_id: i % 2 === 0 ? ['t-1', 't-4'][(i / 2) | 0] : null,
      guest_count: i % 2 === 0 ? 2 + i : null,
      items: items.map(([product_id, quantity]) => ({ product_id, quantity })),
      created_at: iso(minutesAgo),
    })
    o.shift_id = karakShift.id
    o.items.forEach((it) => { it.sent_to_kitchen_at = iso(minutesAgo - 3) })
    if (i % 2 === 0) pay(o, 'card', o.total, minutesAgo - 30)
    else pay(o, 'cash', o.total, minutesAgo - 20, new Big(o.total).plus('10').toFixed(2))
    o.table_id = null // table freed after payment
  })

  // one live open tab on T3 with a sent round and an unsent round
  const tab = makeOrder({
    store_id: 's-karak',
    cashier: yusuf,
    order_type: 'dine_in',
    table_id: 't-3',
    guest_count: 4,
    items: [
      { product_id: 'p-mixed', quantity: '1' },
      { product_id: 'p-karak', quantity: '4' },
    ],
    created_at: iso(46),
  })
  tab.shift_id = karakShift.id
  tab.items.forEach((it) => { it.sent_to_kitchen_at = iso(44) })
  tickets.push({
    id: uid('tk'),
    order_id: tab.id,
    order_number: tab.order_number,
    table_name: 'T3',
    station_id: 'st-grill',
    status: 'in_progress',
    created_at: iso(44),
    done_at: null,
    items: [
      { id: uid('ti'), order_item_id: tab.items[0].id, product_name: 'Mixed Grill', quantity: '1', note: null, cancelled: false },
    ],
  })
  tickets.push({
    id: uid('tk'),
    order_id: tab.id,
    order_number: tab.order_number,
    table_name: 'T3',
    station_id: 'st-bar',
    status: 'done',
    created_at: iso(44),
    done_at: iso(38),
    items: [
      { id: uid('ti'), order_item_id: tab.items[1].id, product_name: 'Karak Tea', quantity: '4', note: null, cancelled: false },
    ],
  })
  // unsent second round
  tab.items.push(snapshotItem('p-shawarma', '2'))
  tab.items.push(snapshotItem('p-lime', '1'))
  recomputeOrder(tab)

  // --- a fortnight of closed days ---
  // Reports compare a window against the one before it; without prior days the
  // day-over-day movement has nothing to measure. These are plain completed
  // counter sales, off-shift, so only the report windows see them.
  const historyBaskets: [string, string][][] = [
    [['p-milk', '2'], ['p-bread', '2']],
    [['p-water', '6'], ['p-karak', '1']],
    [['p-tomato', '1.500'], ['p-cucumber', '2']],
    [['p-kofta', '1'], ['p-bread', '3']],
    [['p-croissant', '3'], ['p-laban', '1']],
    [['p-apple', '2'], ['p-banana', '2']],
  ]
  const clockNow = new Date()
  const nowMinuteOfDay = clockNow.getHours() * 60 + clockNow.getMinutes()
  /** minutes-ago for `hour:00` on the day `d` days back */
  const atHour = (d: number, hour: number) => d * 24 * 60 + (nowMinuteOfDay - hour * 60)
  for (let d = 1; d <= 14; d++) {
    const count = 3 + ((d * 5) % 3)
    for (let i = 0; i < count; i++) {
      const minutesAgo = atHour(d, 8 + i)
      const past = makeOrder({
        store_id: 's-alrayyan',
        cashier: i % 2 === 0 ? sara : amal,
        order_type: 'counter',
        items: historyBaskets[(d + i) % historyBaskets.length].map(([product_id, quantity]) => ({
          product_id,
          quantity,
        })),
        created_at: iso(minutesAgo),
      })
      past.shift_id = null
      if (i % 3 === 0) pay(past, 'card', past.total, minutesAgo - 1)
      else if (i % 4 === 3) pay(past, 'online', past.total, minutesAgo - 1)
      else pay(past, 'cash', past.total, minutesAgo - 1, past.total)
    }
  }

  void orders
}
