import type { Role, Store, User, UserRecord } from '../api/types'
import type { ProductOffer } from '../lib/pricing'
import { drumsticksCategories, drumsticksItems } from './drumsticks'

/**
 * The in-memory mock world for MSW. Mirrors what the backend seed script
 * builds — TWO businesses now, each with its own branches, users, PINs and
 * staff, invisible to the other — so switching the mocks off later changes
 * nothing visible.
 *
 * Auth model (Phase 12): a BUSINESS has one login for all its branches.
 * Signing in yields a till token; the PERSON is identified by the PIN they
 * type on the till. Every person-scoped call still carries a user token.
 */

// ---------- platform admin (Agricope staff — above every business) ----------

export interface DbAdmin {
  id: string
  name: string
  email: string
  password: string
}

export const admins: DbAdmin[] = [
  { id: 'adm-root', name: 'Agricope Admin', email: 'admin@agricope.qa', password: 'demo123' },
]

/** Resolve the platform admin behind a request ("mock-admin.<id>"). */
export function requesterAdmin(request: Request): DbAdmin | null {
  const header = request.headers.get('Authorization') ?? ''
  const token = header.replace(/^Bearer\s+/i, '')
  if (!token.startsWith('mock-admin.')) return null
  const id = token.slice('mock-admin.'.length)
  return admins.find((a) => a.id === id) ?? null
}

// ---------- businesses ----------

export interface DbBusiness {
  id: string
  name: string
  email: string // the one login for all branches
  password: string
  /** Switched off: nobody can sign in, and only then may it be deleted. */
  is_active: boolean
}

export const businesses: DbBusiness[] = [
  { id: 'b-demo', name: 'Agricope Demo Trading Co.', email: 'demo@agricope.qa', password: 'demo123', is_active: true },
  { id: 'b-drumsticks', name: 'Drumsticks', email: 'drumsticks@agricope.qa', password: 'demo123', is_active: true },
  // Onboarded but not yet handed over — no branches, no owner login. The console
  // is where that gets finished.
  { id: 'b-karakhouse', name: 'Karak House', email: 'karakhouse@agricope.qa', password: 'demo123', is_active: true },
]

// ---------- stores (branches) ----------

export interface DbStore {
  id: string
  business_id: string
  name: string
  type: 'retail' | 'restaurant'
  address: string | null
  /** the number printed on the receipt, so a customer can call the branch */
  phone: string | null
  is_active: boolean
  /** Where kitchen work surfaces: the KDS board, or a printed kitchen ticket. */
  kitchen_mode: 'kds' | 'printer'
}

export const stores: DbStore[] = [
  { id: 's-alrayyan', business_id: 'b-demo', name: 'Al Rayyan Store', type: 'retail', address: 'Souq area, Al Rayyan, Doha', phone: '+974 4432 1180', is_active: true, kitchen_mode: 'kds' },
  { id: 's-karak', business_id: 'b-demo', name: 'Karak Corner', type: 'restaurant', address: 'Al Sadd, Doha', phone: '+974 4487 6620', is_active: true, kitchen_mode: 'kds' },
  { id: 's-drumsticks', business_id: 'b-drumsticks', name: 'Drumsticks — Barwa Village', type: 'restaurant', address: 'Barwa Village, Al Wakrah Road, Doha', phone: '+974 4012 8890', is_active: true, kitchen_mode: 'printer' },
]

/** Dine-in service charge, % per store — surfaced on the public store shape. */
export const serviceChargeRates: Record<string, string> = {
  's-alrayyan': '0',
  's-karak': '10',
  's-drumsticks': '0', // fast food — no service charge
}

export function storeBusinessId(storeId: string | null): string | null {
  return storeId ? (stores.find((s) => s.id === storeId)?.business_id ?? null) : null
}

// ---------- users (login identities, per business, identified by PIN) ----------

export interface DbUser {
  id: string
  name: string
  email: string // contact only — sign-in is the BUSINESS email
  role: Role
  business_id: string
  store_id: string | null
  pin: string | null // unique within the business
  is_active: boolean
}

export const users: DbUser[] = [
  { id: 'u-sara', name: 'Sara Al-Ali', email: 'sara@alrayyan-market.qa', role: 'cashier', business_id: 'b-demo', store_id: 's-alrayyan', pin: '1234', is_active: true },
  { id: 'u-amal', name: 'Amal Nasser', email: 'amal@alrayyan-market.qa', role: 'cashier', business_id: 'b-demo', store_id: 's-alrayyan', pin: '2345', is_active: true },
  { id: 'u-yusuf', name: 'Yusuf Khan', email: 'yusuf@karakcorner.qa', role: 'cashier', business_id: 'b-demo', store_id: 's-karak', pin: '3456', is_active: true },
  { id: 'u-maryam', name: 'Maryam Fahad', email: 'maryam@alrayyan-market.qa', role: 'manager', business_id: 'b-demo', store_id: 's-alrayyan', pin: '9999', is_active: true },
  { id: 'u-ayaan', name: 'Ayaan Hydross', email: 'owner@agricope.qa', role: 'owner', business_id: 'b-demo', store_id: null, pin: '0000', is_active: true },
  // Drumsticks — its own people, its own PINs; the demo business never sees them.
  { id: 'u-ds-owner', name: 'Yousuf Al-Mannai', email: 'yousuf@drumsticks.qa', role: 'owner', business_id: 'b-drumsticks', store_id: null, pin: '1111', is_active: true },
  { id: 'u-ds-manager', name: 'Imran Patel', email: 'imran@drumsticks.qa', role: 'manager', business_id: 'b-drumsticks', store_id: 's-drumsticks', pin: '2222', is_active: true },
  { id: 'u-ds-cashier', name: 'Rhea Santos', email: 'rhea@drumsticks.qa', role: 'cashier', business_id: 'b-drumsticks', store_id: 's-drumsticks', pin: '3333', is_active: true },
  // Waiters work the floor: tables, register and orders, but no drawer and no back office.
  { id: 'u-ds-waiter', name: 'Aisha Karim', email: 'aisha@drumsticks.qa', role: 'waiter', business_id: 'b-drumsticks', store_id: 's-drumsticks', pin: '4444', is_active: true },
]

export function storeName(store_id: string | null): string | null {
  return store_id ? (stores.find((s) => s.id === store_id)?.name ?? null) : null
}

export function toPublicUser(u: DbUser): User {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    business_id: u.business_id,
    store_id: u.store_id,
    store_name: storeName(u.store_id),
  }
}

export function toUserRecord(u: DbUser): UserRecord {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    store_id: u.store_id,
    store_name: storeName(u.store_id),
    is_active: u.is_active,
    has_pin: u.pin !== null,
  }
}

/** Resolve the requester from the mock JWT ("mock-jwt.<userId>"). */
export function requester(request: Request): DbUser | null {
  const header = request.headers.get('Authorization') ?? ''
  const token = header.replace(/^Bearer\s+/i, '')
  if (!token.startsWith('mock-jwt.')) return null
  const id = token.slice('mock-jwt.'.length)
  return users.find((u) => u.id === id && u.is_active) ?? null
}

/**
 * Resolve the BUSINESS behind a request — from a till token
 * ("mock-biz.<businessId>", pre-PIN) or from a signed-in user's token.
 */
export function requesterBusiness(request: Request): DbBusiness | null {
  const header = request.headers.get('Authorization') ?? ''
  const token = header.replace(/^Bearer\s+/i, '')
  if (token.startsWith('mock-biz.')) {
    const id = token.slice('mock-biz.'.length)
    return businesses.find((b) => b.id === id) ?? null
  }
  const user = requester(request)
  return user ? (businesses.find((b) => b.id === user.business_id) ?? null) : null
}

export function sessionFor(u: DbUser) {
  return {
    access_token: `mock-jwt.${u.id}`,
    refresh_token: `mock-refresh.${u.id}`,
    user: toPublicUser(u),
  }
}

export function businessSessionFor(b: DbBusiness) {
  return {
    business_token: `mock-biz.${b.id}`,
    business: { id: b.id, name: b.name },
    stores: stores.filter((s) => s.business_id === b.id && s.is_active).map(toPublicStore),
  }
}

export function toPublicStore(s: DbStore): Store {
  return {
    id: s.id,
    name: s.name,
    type: s.type,
    address: s.address,
    phone: s.phone,
    is_active: s.is_active,
    kitchen_mode: s.kitchen_mode,
    service_charge_rate: serviceChargeRates[s.id] ?? '0',
  }
}

// ---------- catalog ----------

export interface DbCategory {
  id: string
  business_id: string
  name: string
  sort_order: number
}

export interface DbStation {
  id: string
  store_id: string
  name: string
}

export interface DbOptionChoice {
  id: string
  name: string
  price_delta: string // money string; "0.00" for free choices
}

export interface DbOptionGroup {
  id: string
  name: string // e.g. "Flavor"
  required: boolean
  choices: DbOptionChoice[]
}

export interface DbProduct {
  id: string
  business_id: string
  name: string
  name_ar: string | null
  description: string | null
  /** first id = primary placement (reporting); the rest are menu placements */
  category_ids: string[]
  barcode: string | null
  price: string // in-store price, TAX-INCLUSIVE, money as strings everywhere
  price_online: string | null // online-channel price; null = same as in-store
  tax_rate: string // % — Qatar has no VAT today, tenants elsewhere will
  is_combo: boolean
  offer: ProductOffer | null // time-bound IN-STORE discount
  offer_online: ProductOffer | null // time-bound ONLINE discount (independent)
  option_groups: DbOptionGroup[] // customisable options (e.g. Spicy)
  kitchen_station_id: string | null
  is_active: boolean
}

const inDays = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString()

export const categories: DbCategory[] = [
  { id: 'c-veg', business_id: 'b-demo', name: 'Vegetables', sort_order: 1 },
  { id: 'c-fruit', business_id: 'b-demo', name: 'Fruits', sort_order: 2 },
  { id: 'c-dairy', business_id: 'b-demo', name: 'Dairy', sort_order: 3 },
  { id: 'c-bakery', business_id: 'b-demo', name: 'Bakery', sort_order: 4 },
  { id: 'c-bev', business_id: 'b-demo', name: 'Beverages', sort_order: 5 },
  { id: 'c-grill', business_id: 'b-demo', name: 'Meat & Grill', sort_order: 6 },
  ...drumsticksCategories.map((c, i) => ({ id: c.id, business_id: 'b-drumsticks', name: c.name, sort_order: i + 1 })),
]

export const stations: DbStation[] = [
  { id: 'st-kitchen', store_id: 's-karak', name: 'Kitchen' },
  { id: 'st-bar', store_id: 's-karak', name: 'Bar' },
  { id: 'st-grill', store_id: 's-karak', name: 'Grill' },
  { id: 'st-ds-fry', store_id: 's-drumsticks', name: 'Fry station' },
  { id: 'st-ds-asm', store_id: 's-drumsticks', name: 'Assembly & Pack' },
  { id: 'st-ds-cold', store_id: 's-drumsticks', name: 'Drinks & Cold' },
]

const DS_STATION: Record<'FRY' | 'ASM' | 'COLD', string> = {
  FRY: 'st-ds-fry',
  ASM: 'st-ds-asm',
  COLD: 'st-ds-cold',
}

/** Legacy demo product rows, lifted to the Phase 12 shape. */
function demoProduct(
  p: { id: string; name: string; category_id: string | null; barcode: string | null; price: string; kitchen_station_id: string | null; is_active: boolean },
): DbProduct {
  return {
    id: p.id,
    business_id: 'b-demo',
    name: p.name,
    name_ar: null,
    description: null,
    category_ids: p.category_id ? [p.category_id] : [],
    barcode: p.barcode,
    price: p.price,
    price_online: null,
    tax_rate: '0',
    is_combo: false,
    offer: null,
    offer_online: null,
    option_groups: [],
    kitchen_station_id: p.kitchen_station_id,
    is_active: p.is_active,
  }
}

export const products: DbProduct[] = [
  demoProduct({ id: 'p-tomato', name: 'Tomatoes 1kg', category_id: 'c-veg', barcode: '6280001112223', price: '4.50', kitchen_station_id: null, is_active: true }),
  demoProduct({ id: 'p-cucumber', name: 'Cucumbers 500g', category_id: 'c-veg', barcode: '6280001112230', price: '2.75', kitchen_station_id: null, is_active: true }),
  demoProduct({ id: 'p-banana', name: 'Bananas 1kg', category_id: 'c-fruit', barcode: '6280001113347', price: '6.00', kitchen_station_id: null, is_active: true }),
  demoProduct({ id: 'p-apple', name: 'Apples Fuji 1kg', category_id: 'c-fruit', barcode: '6280001113354', price: '8.50', kitchen_station_id: null, is_active: true }),
  demoProduct({ id: 'p-milk', name: 'Fresh Milk 2L', category_id: 'c-dairy', barcode: '6280001113408', price: '9.00', kitchen_station_id: null, is_active: true }),
  demoProduct({ id: 'p-laban', name: 'Laban 1L', category_id: 'c-dairy', barcode: '6280001113415', price: '5.50', kitchen_station_id: null, is_active: true }),
  demoProduct({ id: 'p-bread', name: 'Arabic Bread ×5', category_id: 'c-bakery', barcode: '6280001114412', price: '2.00', kitchen_station_id: null, is_active: true }),
  demoProduct({ id: 'p-croissant', name: 'Butter Croissant', category_id: 'c-bakery', barcode: '6280001115521', price: '4.00', kitchen_station_id: null, is_active: true }),
  demoProduct({ id: 'p-water', name: 'Water 1.5L', category_id: 'c-bev', barcode: '6280001116630', price: '1.50', kitchen_station_id: null, is_active: true }),
  demoProduct({ id: 'p-karak', name: 'Karak Tea', category_id: 'c-bev', barcode: null, price: '3.00', kitchen_station_id: 'st-bar', is_active: true }),
  demoProduct({ id: 'p-lime', name: 'Fresh Lime', category_id: 'c-bev', barcode: null, price: '7.00', kitchen_station_id: 'st-bar', is_active: true }),
  demoProduct({ id: 'p-shawarma', name: 'Chicken Shawarma', category_id: 'c-grill', barcode: null, price: '12.00', kitchen_station_id: 'st-kitchen', is_active: true }),
  demoProduct({ id: 'p-kofta', name: 'Lamb Kofta 1kg', category_id: 'c-grill', barcode: '6280001118859', price: '38.00', kitchen_station_id: 'st-grill', is_active: true }),
  { ...demoProduct({ id: 'p-mixed', name: 'Mixed Grill', category_id: 'c-grill', barcode: null, price: '58.00', kitchen_station_id: 'st-grill', is_active: true }), description: 'Lamb kofta, chicken tikka, beef skewers, grilled tomato & saj bread' },
  demoProduct({ id: 'p-halloumi-old', name: 'Halloumi 250g (old pack)', category_id: 'c-dairy', barcode: '6280001110958', price: '12.00', kitchen_station_id: null, is_active: false }),
  // Drumsticks — the client's real menu, from their pricing files.
  ...drumsticksItems.map((d): DbProduct => ({
    id: d.id,
    business_id: 'b-drumsticks',
    name: d.name,
    name_ar: d.name_ar,
    description: d.description,
    category_ids: d.category_ids,
    barcode: null,
    price: d.price,
    price_online: d.price_online,
    tax_rate: '0',
    is_combo: d.is_combo,
    // The files ship live discounts; open a 30-day window so the till shows them.
    offer: d.offer_percent ? { percent: d.offer_percent, starts_at: null, ends_at: inDays(30) } : null,
    offer_online: d.offer_percent
      ? { percent: d.offer_percent, starts_at: null, ends_at: inDays(30) }
      : null,
    option_groups: d.flavors
      ? [
          {
            id: `og-${d.id}`,
            name: d.flavor_label ?? 'Flavor',
            required: true,
            choices: d.flavors.map((f, i) => ({ id: `oc-${d.id}-${i}`, name: f, price_delta: '0.00' })),
          },
        ]
      : [],
    kitchen_station_id: DS_STATION[d.station],
    is_active: true,
  })),
]

export function categoryName(id: string | null): string | null {
  return id ? (categories.find((c) => c.id === id)?.name ?? null) : null
}

export function stationName(id: string | null): string | null {
  return id ? (stations.find((s) => s.id === id)?.name ?? null) : null
}

export function toPublicProduct(p: DbProduct) {
  const primary = p.category_ids[0] ?? null
  return {
    id: p.id,
    name: p.name,
    name_ar: p.name_ar,
    description: p.description,
    category_id: primary,
    category_name: categoryName(primary),
    category_ids: p.category_ids,
    barcode: p.barcode,
    price: p.price,
    price_online: p.price_online,
    tax_rate: p.tax_rate,
    is_combo: p.is_combo,
    offer: p.offer,
    offer_online: p.offer_online,
    option_groups: p.option_groups,
    kitchen_station_id: p.kitchen_station_id,
    station_name: stationName(p.kitchen_station_id),
    is_active: p.is_active,
  }
}

// ---------- staff (workforce — attendance, not logins) ----------

export interface DbStaffMember {
  id: string
  business_id: string
  store_id: string | null
  name: string
  role_title: string
  is_active: boolean
}

export interface DbAttendance {
  id: string
  staff_id: string
  check_in: string
  check_out: string | null
  recorded_by: string // user id of the manager on the till
}

export const staffMembers: DbStaffMember[] = [
  { id: 'stf-hassan', business_id: 'b-demo', store_id: 's-alrayyan', name: 'Hassan Mahmoud', role_title: 'Shelf stocker', is_active: true },
  { id: 'stf-lina', business_id: 'b-demo', store_id: 's-alrayyan', name: 'Lina Yousef', role_title: 'Cashier', is_active: true },
  { id: 'stf-ravi', business_id: 'b-demo', store_id: 's-karak', name: 'Ravi Kumar', role_title: 'Kitchen', is_active: true },
  { id: 'stf-ds-omar', business_id: 'b-drumsticks', store_id: 's-drumsticks', name: 'Omar Farouk', role_title: 'Fry cook', is_active: true },
  { id: 'stf-ds-jen', business_id: 'b-drumsticks', store_id: 's-drumsticks', name: 'Jennifer Cruz', role_title: 'Counter', is_active: true },
  { id: 'stf-ds-ali', business_id: 'b-drumsticks', store_id: 's-drumsticks', name: 'Ali Mansour', role_title: 'Pack & dispatch', is_active: true },
]

export const attendance: DbAttendance[] = []
