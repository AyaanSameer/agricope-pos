import Big from 'big.js'
import { fileURLToPath } from 'node:url'
import type { PoolClient } from 'pg'
import { hashPassword, hashPin } from '../src/auth.js'
import { close, connect, one, withTx } from '../src/db.js'
import { createOrder, insertItems, loadOrder, loadProductsForSale, recompute, saveTotals, snapshotItem } from '../src/services/orders.js'
import type { LoadedOrder, OrderType } from '../src/services/orders.js'
import { loadDrumsticksCatalogue } from './catalogue.js'

/**
 * The development world — the same one the in-browser demo shows — written
 * into a real database through the real order engine, so every total in it
 * was computed by the code that computes totals in production.
 *
 *   npm run seed            # refuses if the database already holds a business
 *   npm run seed -- --reset # wipes everything first
 *
 * Every password is demo123. PINs are in README.md. None of this belongs in
 * a production database; production starts empty and the console creates
 * the first business.
 */

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000)

async function pay(
  tx: PoolClient,
  order: LoadedOrder,
  method: 'cash' | 'card' | 'online',
  amount: string,
  at: Date,
  tendered?: string,
) {
  await tx.query(
    `insert into payments (order_id, method, amount, tendered, change_given, reference, received_by, received_by_name, created_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      order.id,
      method,
      amount,
      tendered ?? null,
      tendered ? new Big(tendered).minus(amount).toFixed(2) : null,
      method === 'card' ? '•••• 4242' : method === 'online' ? 'TXN-88214' : null,
      order.cashier_id,
      order.cashier_name,
      at.toISOString(),
    ],
  )
  const paid = await one<{ sum: string }>('select coalesce(sum(amount), 0) as sum from payments where order_id = $1', [order.id], tx)
  if (new Big(order.total).minus(paid!.sum).lte(0)) {
    await tx.query("update orders set status = 'completed', completed_at = $2 where id = $1", [order.id, at.toISOString()])
  }
}

export interface SeedOptions {
  pepper: string
  tz: string
}

/** Build the whole demo world inside the given transaction. */
export async function seedWorld(tx: PoolClient, opts: SeedOptions) {
  const TZ = opts.tz
  const pw = await hashPassword('demo123')
  const pin = (biz: string, p: string) => hashPin(opts.pepper, biz, p)

  // ---------- platform ----------
  await tx.query(`insert into platform_admins (id, name, email, password_hash) values ('adm-root', 'Agricope Admin', 'admin@agricope.qa', $1)`, [pw])

  await tx.query(
    `insert into businesses (id, name, email, password_hash, is_active, receipt_footer, discount_approval_percent) values
       ('b-demo', 'Agricope Demo Trading Co.', 'demo@agricope.qa', $1, true, 'Thank you — see you tomorrow!', 10),
       ('b-drumsticks', 'Drumsticks', 'drumsticks@agricope.qa', $1, true, 'Thank you for choosing Drumsticks!', 10),
       ('b-karakhouse', 'Karak House', 'karakhouse@agricope.qa', $1, true, '', 10)`,
    [pw],
  )

  await tx.query(`insert into stores (id, business_id, store_number, name, type, address, phone, kitchen_mode, service_charge_rate) values
    ('s-alrayyan', 'b-demo', 1, 'Al Rayyan Store', 'retail', 'Souq area, Al Rayyan, Doha', '+974 4432 1180', 'kds', 0),
    ('s-karak', 'b-demo', 2, 'Karak Corner', 'restaurant', 'Al Sadd, Doha', '+974 4487 6620', 'kds', 10),
    ('s-drumsticks', 'b-drumsticks', 1, 'Drumsticks — Barwa Village', 'restaurant', 'Barwa Village, Al Wakrah Road, Doha', '+974 4012 8890', 'printer', 0)`)

  const users: [string, string, string, string, string, string | null, string][] = [
    ['u-sara', 'Sara Al-Ali', 'sara@alrayyan-market.qa', 'cashier', 'b-demo', 's-alrayyan', '1234'],
    ['u-amal', 'Amal Nasser', 'amal@alrayyan-market.qa', 'cashier', 'b-demo', 's-alrayyan', '2345'],
    ['u-yusuf', 'Yusuf Khan', 'yusuf@karakcorner.qa', 'cashier', 'b-demo', 's-karak', '3456'],
    ['u-maryam', 'Maryam Fahad', 'maryam@alrayyan-market.qa', 'manager', 'b-demo', 's-alrayyan', '9999'],
    ['u-ayaan', 'Ayaan Hydross', 'owner@agricope.qa', 'owner', 'b-demo', null, '0000'],
    ['u-ds-owner', 'Yousuf Al-Mannai', 'yousuf@drumsticks.qa', 'owner', 'b-drumsticks', null, '1111'],
    ['u-ds-manager', 'Imran Patel', 'imran@drumsticks.qa', 'manager', 'b-drumsticks', 's-drumsticks', '2222'],
    ['u-ds-cashier', 'Rhea Santos', 'rhea@drumsticks.qa', 'cashier', 'b-drumsticks', 's-drumsticks', '3333'],
    ['u-ds-waiter', 'Aisha Karim', 'aisha@drumsticks.qa', 'waiter', 'b-drumsticks', 's-drumsticks', '4444'],
  ]
  for (const [id, name, email, role, biz, store, p] of users) {
    await tx.query(
      `insert into users (id, business_id, store_id, name, email, role, pin_hash) values ($1, $2, $3, $4, $5, $6, $7)`,
      [id, biz, store, name, email, role, pin(biz, p)],
    )
  }

  await tx.query(`insert into staff_members (id, business_id, store_id, name, role_title) values
    ('stf-hassan', 'b-demo', 's-alrayyan', 'Hassan Mahmoud', 'Shelf stocker'),
    ('stf-lina', 'b-demo', 's-alrayyan', 'Lina Yousef', 'Cashier'),
    ('stf-ravi', 'b-demo', 's-karak', 'Ravi Kumar', 'Kitchen'),
    ('stf-ds-omar', 'b-drumsticks', 's-drumsticks', 'Omar Farouk', 'Fry cook'),
    ('stf-ds-jen', 'b-drumsticks', 's-drumsticks', 'Jennifer Cruz', 'Counter'),
    ('stf-ds-ali', 'b-drumsticks', 's-drumsticks', 'Ali Mansour', 'Pack & dispatch')`)

  // ---------- catalog ----------
  const demoCats: [string, string, number][] = [
    ['c-veg', 'Vegetables', 1], ['c-fruit', 'Fruits', 2], ['c-dairy', 'Dairy', 3],
    ['c-bakery', 'Bakery', 4], ['c-bev', 'Beverages', 5], ['c-grill', 'Meat & Grill', 6],
  ]
  for (const [id, name, sort] of demoCats) {
    await tx.query(`insert into categories (id, business_id, name, sort_order) values ($1, 'b-demo', $2, $3)`, [id, name, sort])
  }

  await tx.query(`insert into kitchen_stations (id, store_id, name, sort_order) values
    ('st-kitchen', 's-karak', 'Kitchen', 1), ('st-bar', 's-karak', 'Bar', 2), ('st-grill', 's-karak', 'Grill', 3)`)

  type P = { id: string; name: string; cat: string | null; barcode: string | null; price: string; station: string | null; active?: boolean; description?: string }
  const demoProducts: P[] = [
    { id: 'p-tomato', name: 'Tomatoes 1kg', cat: 'c-veg', barcode: '6280001112223', price: '4.50', station: null },
    { id: 'p-cucumber', name: 'Cucumbers 500g', cat: 'c-veg', barcode: '6280001112230', price: '2.75', station: null },
    { id: 'p-banana', name: 'Bananas 1kg', cat: 'c-fruit', barcode: '6280001113347', price: '6.00', station: null },
    { id: 'p-apple', name: 'Apples Fuji 1kg', cat: 'c-fruit', barcode: '6280001113354', price: '8.50', station: null },
    { id: 'p-milk', name: 'Fresh Milk 2L', cat: 'c-dairy', barcode: '6280001113408', price: '9.00', station: null },
    { id: 'p-laban', name: 'Laban 1L', cat: 'c-dairy', barcode: '6280001113415', price: '5.50', station: null },
    { id: 'p-bread', name: 'Arabic Bread ×5', cat: 'c-bakery', barcode: '6280001114412', price: '2.00', station: null },
    { id: 'p-croissant', name: 'Butter Croissant', cat: 'c-bakery', barcode: '6280001115521', price: '4.00', station: null },
    { id: 'p-water', name: 'Water 1.5L', cat: 'c-bev', barcode: '6280001116630', price: '1.50', station: null },
    { id: 'p-karak', name: 'Karak Tea', cat: 'c-bev', barcode: null, price: '3.00', station: 'st-bar' },
    { id: 'p-lime', name: 'Fresh Lime', cat: 'c-bev', barcode: null, price: '7.00', station: 'st-bar' },
    { id: 'p-shawarma', name: 'Chicken Shawarma', cat: 'c-grill', barcode: null, price: '12.00', station: 'st-kitchen' },
    { id: 'p-kofta', name: 'Lamb Kofta 1kg', cat: 'c-grill', barcode: '6280001118859', price: '38.00', station: 'st-grill' },
    { id: 'p-mixed', name: 'Mixed Grill', cat: 'c-grill', barcode: null, price: '58.00', station: 'st-grill', description: 'Lamb kofta, chicken tikka, beef skewers, grilled tomato & saj bread' },
    { id: 'p-halloumi-old', name: 'Halloumi 250g (old pack)', cat: 'c-dairy', barcode: '6280001110958', price: '12.00', station: null, active: false },
  ]
  for (const p of demoProducts) {
    await tx.query(
      `insert into products (id, business_id, name, description, barcode, price, tax_rate, kitchen_station_id, is_active)
       values ($1, 'b-demo', $2, $3, $4, $5, 0, $6, $7)`,
      [p.id, p.name, p.description ?? null, p.barcode, p.price, p.station, p.active ?? true],
    )
    if (p.cat) await tx.query(`insert into product_categories (product_id, category_id, position) values ($1, $2, 0)`, [p.id, p.cat])
  }
  // Drumsticks' real menu, through the same loader the go-live import uses.
  await loadDrumsticksCatalogue(tx, { businessId: 'b-drumsticks', branchId: 's-drumsticks', perBranch: false, fixedIds: true })

  await tx.query(`insert into dining_tables (id, store_id, name, zone, seats) values
    ('t-1', 's-karak', 'T1', 'Main hall', 2), ('t-2', 's-karak', 'T2', 'Main hall', 4), ('t-3', 's-karak', 'T3', 'Main hall', 4),
    ('t-4', 's-karak', 'T4', 'Main hall', 6), ('t-5', 's-karak', 'T5', 'Family section', 4),
    ('t-p1', 's-karak', 'P1', 'Terrace', 6), ('t-p2', 's-karak', 'P2', 'Terrace', 2),
    ('t-ds1', 's-drumsticks', 'T1', 'Hall', 4), ('t-ds2', 's-drumsticks', 'T2', 'Hall', 4),
    ('t-ds3', 's-drumsticks', 'T3', 'Hall', 6), ('t-ds4', 's-drumsticks', 'T4', 'Hall', 2)`)

  // ---------- customers & credit history ----------
  await tx.query(`insert into customers (id, business_id, name, phone, email, credit_limit, notes) values
    ('cu-mohammed', 'b-demo', 'Mohammed Al-Kuwari', '5511 2233', 'm.alkuwari@gmail.com', 2000.00, null),
    ('cu-fatima', 'b-demo', 'Fatima Hassan', '5522 6677', null, 1000.00, null),
    ('cu-noora', 'b-demo', 'Noora Al-Thani', '6644 2288', null, 500.00, null),
    ('cu-ali', 'b-demo', 'Ali Reza', '3355 9911', null, null, 'Cash only — no credit')`)
  const ledger = async (daysAgo: number, note: string, customer: string, type: 'charge' | 'repayment', amount: string) =>
    tx.query(
      `insert into credit_ledger (customer_id, entry_type, amount, method, note, created_by, created_by_name, created_at)
       values ($1, $2, $3, $4, $5, 'u-sara', 'Sara Al-Ali', $6)`,
      [customer, type, amount, type === 'repayment' ? 'cash' : null, note, minutesAgo(daysAgo * 24 * 60).toISOString()],
    )
  await ledger(70, 'Order S1-old-0821', 'cu-mohammed', 'charge', '1000.00')
  await ledger(48, 'Cash received', 'cu-mohammed', 'repayment', '-200.00')
  await ledger(38, 'Order S1-old-0902', 'cu-mohammed', 'charge', '450.00')
  await ledger(9, 'Order S1-old-1004', 'cu-mohammed', 'charge', '320.00')
  await ledger(2, 'Cash received', 'cu-mohammed', 'repayment', '-320.00')
  await ledger(33, 'Order S1-old-0918', 'cu-fatima', 'charge', '430.00')
  await ledger(95, 'Order S1-old-0714', 'cu-noora', 'charge', '180.00')

  // ---------- shifts: every branch opened this morning ----------
  const shift = async (id: string, store: string, by: string, byName: string, float: string, hoursAgo: number) =>
    tx.query(
      `insert into shifts (id, store_id, status, opened_by, opened_by_name, opening_float, opened_at) values ($1, $2, 'open', $3, $4, $5, $6)`,
      [id, store, by, byName, float, minutesAgo(hoursAgo * 60).toISOString()],
    )
  await shift('sh-alrayyan', 's-alrayyan', 'u-sara', 'Sara Al-Ali', '500.00', 7)
  await shift('sh-karak', 's-karak', 'u-yusuf', 'Yusuf Khan', '300.00', 6)
  await shift('sh-drumsticks', 's-drumsticks', 'u-ds-manager', 'Imran Patel', '400.00', 5)
  await tx.query(
    `insert into cash_movements (shift_id, type, amount, reason, created_by, created_by_name, created_at) values
       ('sh-alrayyan', 'paid_out', 250.00, 'Bought change from exchange', 'u-sara', 'Sara Al-Ali', $1),
       ('sh-alrayyan', 'paid_in', 100.00, 'Owner float top-up', 'u-maryam', 'Maryam Fahad', $2)`,
    [minutesAgo(5 * 60).toISOString(), minutesAgo(3 * 60).toISOString()],
  )

  // ---------- orders, through the real engine ----------
  const products = await loadProductsForSale(tx, 'b-demo', [
    ...demoProducts.map((p) => p.id),
  ])
  const sara = { id: 'u-sara', name: 'Sara Al-Ali' }
  const amal = { id: 'u-amal', name: 'Amal Nasser' }
  const yusuf = { id: 'u-yusuf', name: 'Yusuf Khan' }

  const order = (input: {
    store: string
    cashier: { id: string; name: string }
    type: OrderType
    items: [string, string][]
    at: Date
    customer?: string
    table?: string
    guests?: number
  }) =>
    createOrder(tx, {
      store_id: input.store,
      cashier: input.cashier,
      order_type: input.type,
      customer_id: input.customer ?? null,
      table_id: input.table ?? null,
      guest_count: input.guests ?? null,
      items: input.items.map(([id, q]) => snapshotItem(products.get(id)!, q, '0', input.type)),
      created_at: input.at,
      tz: TZ,
    })

  // a morning of retail sales at Al Rayyan
  const retail: [string, string][][] = [
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
  for (const [i, items] of retail.entries()) {
    const m = 420 - i * 42
    const o = await order({ store: 's-alrayyan', cashier: i % 3 === 0 ? amal : sara, type: 'counter', items, at: minutesAgo(m) })
    if (i % 4 === 1) {
      const half = new Big(o.total).div(2).toFixed(2)
      await pay(tx, o, 'cash', half, minutesAgo(m - 2), half)
      await pay(tx, o, 'card', new Big(o.total).minus(half).toFixed(2), minutesAgo(m - 1))
    } else if (i % 4 === 2) await pay(tx, o, 'card', o.total, minutesAgo(m - 1))
    else if (i % 4 === 3) await pay(tx, o, 'online', o.total, minutesAgo(m - 1))
    else await pay(tx, o, 'cash', o.total, minutesAgo(m - 1), new Big(o.total).plus((i % 3) * 10).toFixed(2))
  }

  // one credit sale for Mohammed this morning
  const credit = await order({ store: 's-alrayyan', cashier: sara, type: 'counter', customer: 'cu-mohammed', items: [['p-kofta', '1'], ['p-bread', '5']], at: minutesAgo(200) })
  await tx.query(
    `insert into payments (order_id, method, amount, received_by, received_by_name, created_at) values ($1, 'credit', $2, 'u-sara', 'Sara Al-Ali', $3)`,
    [credit.id, credit.total, minutesAgo(199).toISOString()],
  )
  await tx.query("update orders set status = 'completed', completed_at = $2 where id = $1", [credit.id, minutesAgo(199).toISOString()])
  await tx.query(
    `insert into credit_ledger (customer_id, entry_type, amount, order_id, note, created_by, created_by_name, created_at, shift_id)
     values ('cu-mohammed', 'charge', $1, $2, $3, 'u-sara', 'Sara Al-Ali', $4, 'sh-alrayyan')`,
    [credit.total, credit.id, `Order ${credit.order_number}`, minutesAgo(199).toISOString()],
  )

  // one voided order
  const voided = await order({ store: 's-alrayyan', cashier: sara, type: 'counter', items: [['p-water', '1']], at: minutesAgo(150) })
  await tx.query("update orders set status = 'void', note = 'Rang up by mistake' where id = $1", [voided.id])

  // lunch service at Karak Corner
  const lunches: [string, string][][] = [
    [['p-shawarma', '2'], ['p-karak', '2']],
    [['p-mixed', '1'], ['p-lime', '2'], ['p-bread', '2']],
    [['p-shawarma', '3'], ['p-water', '3']],
    [['p-kofta', '1'], ['p-lime', '1']],
  ]
  for (const [i, items] of lunches.entries()) {
    const m = 200 - i * 35
    const dineIn = i % 2 === 0
    const o = await order({
      store: 's-karak', cashier: yusuf, type: dineIn ? 'dine_in' : 'takeaway',
      table: dineIn ? ['t-1', 't-4'][(i / 2) | 0] : undefined, guests: dineIn ? 2 + i : undefined,
      items, at: minutesAgo(m),
    })
    await tx.query('update order_items set sent_to_kitchen_at = $2 where order_id = $1', [o.id, minutesAgo(m - 3).toISOString()])
    if (dineIn) await pay(tx, o, 'card', o.total, minutesAgo(m - 30))
    else await pay(tx, o, 'cash', o.total, minutesAgo(m - 20), new Big(o.total).plus('10').toFixed(2))
    await tx.query('update orders set table_id = null where id = $1', [o.id]) // freed after payment
  }

  // one live open tab on T3: a sent round and an unsent round
  const tab = await order({ store: 's-karak', cashier: yusuf, type: 'dine_in', table: 't-3', guests: 4, items: [['p-mixed', '1'], ['p-karak', '4']], at: minutesAgo(46) })
  await tx.query('update order_items set sent_to_kitchen_at = $2 where order_id = $1', [tab.id, minutesAgo(44).toISOString()])
  const [grillLine, barLine] = tab.items
  await tx.query(
    `insert into kitchen_tickets (id, order_id, order_number, table_name, station_id, status, created_at, done_at) values
       ('tk-grill', $1, $2, 'T3', 'st-grill', 'in_progress', $3, null),
       ('tk-bar', $1, $2, 'T3', 'st-bar', 'done', $3, $4)`,
    [tab.id, tab.order_number, minutesAgo(44).toISOString(), minutesAgo(38).toISOString()],
  )
  await tx.query(
    `insert into kitchen_ticket_items (ticket_id, order_item_id, product_name, description, quantity) values
       ('tk-grill', $1, 'Mixed Grill', 'Lamb kofta, chicken tikka, beef skewers, grilled tomato & saj bread', 1),
       ('tk-bar', $2, 'Karak Tea', null, 4)`,
    [grillLine.id, barLine.id],
  )
  await insertItems(tx, tab.id, [snapshotItem(products.get('p-shawarma')!, '2'), snapshotItem(products.get('p-lime')!, '1')], tab.items.length)
  const tabNow = (await loadOrder(tx, tab.id))!
  recompute(tabNow)
  await saveTotals(tx, tabNow)

  // a fortnight of closed days, so the reports have a "previous" to compare with
  const baskets: [string, string][][] = [
    [['p-milk', '2'], ['p-bread', '2']],
    [['p-water', '6'], ['p-karak', '1']],
    [['p-tomato', '1.500'], ['p-cucumber', '2']],
    [['p-kofta', '1'], ['p-bread', '3']],
    [['p-croissant', '3'], ['p-laban', '1']],
    [['p-apple', '2'], ['p-banana', '2']],
  ]
  const now = new Date()
  const minuteOfDay = now.getHours() * 60 + now.getMinutes()
  const atHour = (d: number, hour: number) => d * 24 * 60 + (minuteOfDay - hour * 60)
  for (let d = 1; d <= 14; d++) {
    const count = 3 + ((d * 5) % 3)
    for (let i = 0; i < count; i++) {
      const m = atHour(d, 8 + i)
      const past = await order({ store: 's-alrayyan', cashier: i % 2 === 0 ? sara : amal, type: 'counter', items: baskets[(d + i) % baskets.length], at: minutesAgo(m) })
      await tx.query('update orders set shift_id = null where id = $1', [past.id])
      if (i % 3 === 0) await pay(tx, past, 'card', past.total, minutesAgo(m - 1))
      else if (i % 4 === 3) await pay(tx, past, 'online', past.total, minutesAgo(m - 1))
      else await pay(tx, past, 'cash', past.total, minutesAgo(m - 1), past.total)
    }
  }
}

async function main() {
  try {
    process.loadEnvFile(fileURLToPath(new URL('../.env', import.meta.url)))
  } catch {
    /* environment only */
  }
  const url = process.env.DATABASE_URL
  const pepper = process.env.PIN_PEPPER
  if (!url || !pepper) {
    console.error('DATABASE_URL and PIN_PEPPER must be set')
    process.exit(1)
  }
  connect(url)
  const reset = process.argv.includes('--reset')
  const existing = await one<{ n: number }>('select count(*)::int as n from businesses')
  if (existing!.n > 0 && !reset) {
    console.error('The database already holds a business. Run with --reset to wipe and reseed.')
    process.exit(1)
  }
  await withTx(async (tx) => {
    if (reset) await tx.query('truncate platform_admins, businesses cascade')
    await seedWorld(tx, { pepper, tz: process.env.BUSINESS_TZ ?? 'Asia/Qatar' })
  })
  const counts = await one<Record<string, number>>(
    `select (select count(*) from businesses)::int as businesses, (select count(*) from products)::int as products,
            (select count(*) from orders)::int as orders, (select count(*) from users)::int as users`,
  )
  console.log('seeded:', counts)
  await close()
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/^.*\//, ''))
if (isMain) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
