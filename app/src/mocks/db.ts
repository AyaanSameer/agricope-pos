import type { Role, Store, User, UserRecord } from '../api/types'

/**
 * The in-memory mock world for MSW. Mirrors what the backend seed script
 * builds (one demo business, one retail store, one restaurant) so switching
 * the mocks off later changes nothing visible.
 */
export interface DbUser {
  id: string
  name: string
  email: string
  role: Role
  business_id: string
  store_id: string | null
  pin: string | null
  password: string
  is_active: boolean
}

export const stores: Store[] = [
  { id: 's-alrayyan', name: 'Al Rayyan Store', type: 'retail', address: 'Souq area, Al Rayyan, Doha', is_active: true },
  { id: 's-karak', name: 'Karak Corner', type: 'restaurant', address: 'Al Sadd, Doha', is_active: true },
]

export const users: DbUser[] = [
  { id: 'u-sara', name: 'Sara Al-Ali', email: 'sara@alrayyan-market.qa', role: 'cashier', business_id: 'b-demo', store_id: 's-alrayyan', pin: '1234', password: 'demo123', is_active: true },
  { id: 'u-amal', name: 'Amal Nasser', email: 'amal@alrayyan-market.qa', role: 'cashier', business_id: 'b-demo', store_id: 's-alrayyan', pin: '2345', password: 'demo123', is_active: true },
  { id: 'u-yusuf', name: 'Yusuf Khan', email: 'yusuf@karakcorner.qa', role: 'cashier', business_id: 'b-demo', store_id: 's-karak', pin: '3456', password: 'demo123', is_active: true },
  { id: 'u-maryam', name: 'Maryam Fahad', email: 'maryam@alrayyan-market.qa', role: 'manager', business_id: 'b-demo', store_id: 's-alrayyan', pin: '9999', password: 'demo123', is_active: true },
  { id: 'u-ayaan', name: 'Ayaan Hydross', email: 'owner@agricope.qa', role: 'owner', business_id: 'b-demo', store_id: null, pin: '0000', password: 'demo123', is_active: true },
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

export function sessionFor(u: DbUser) {
  return {
    access_token: `mock-jwt.${u.id}`,
    refresh_token: `mock-refresh.${u.id}`,
    user: toPublicUser(u),
  }
}

// ---------- Phase 2: catalog ----------

export interface DbCategory {
  id: string
  name: string
  sort_order: number
}

export interface DbStation {
  id: string
  store_id: string
  name: string
}

export interface DbProduct {
  id: string
  name: string
  category_id: string | null
  barcode: string | null
  price: string // money as strings, everywhere
  tax_rate: string // % — Qatar has no VAT today, tenants elsewhere will
  kitchen_station_id: string | null
  is_active: boolean
}

export const categories: DbCategory[] = [
  { id: 'c-veg', name: 'Vegetables', sort_order: 1 },
  { id: 'c-fruit', name: 'Fruits', sort_order: 2 },
  { id: 'c-dairy', name: 'Dairy', sort_order: 3 },
  { id: 'c-bakery', name: 'Bakery', sort_order: 4 },
  { id: 'c-bev', name: 'Beverages', sort_order: 5 },
  { id: 'c-grill', name: 'Meat & Grill', sort_order: 6 },
]

export const stations: DbStation[] = [
  { id: 'st-kitchen', store_id: 's-karak', name: 'Kitchen' },
  { id: 'st-bar', store_id: 's-karak', name: 'Bar' },
  { id: 'st-grill', store_id: 's-karak', name: 'Grill' },
]

export const products: DbProduct[] = [
  { id: 'p-tomato', name: 'Tomatoes 1kg', category_id: 'c-veg', barcode: '6280001112223', price: '4.50', tax_rate: '0', kitchen_station_id: null, is_active: true },
  { id: 'p-cucumber', name: 'Cucumbers 500g', category_id: 'c-veg', barcode: '6280001112230', price: '2.75', tax_rate: '0', kitchen_station_id: null, is_active: true },
  { id: 'p-banana', name: 'Bananas 1kg', category_id: 'c-fruit', barcode: '6280001113347', price: '6.00', tax_rate: '0', kitchen_station_id: null, is_active: true },
  { id: 'p-apple', name: 'Apples Fuji 1kg', category_id: 'c-fruit', barcode: '6280001113354', price: '8.50', tax_rate: '0', kitchen_station_id: null, is_active: true },
  { id: 'p-milk', name: 'Fresh Milk 2L', category_id: 'c-dairy', barcode: '6280001113408', price: '9.00', tax_rate: '0', kitchen_station_id: null, is_active: true },
  { id: 'p-laban', name: 'Laban 1L', category_id: 'c-dairy', barcode: '6280001113415', price: '5.50', tax_rate: '0', kitchen_station_id: null, is_active: true },
  { id: 'p-bread', name: 'Arabic Bread ×5', category_id: 'c-bakery', barcode: '6280001114412', price: '2.00', tax_rate: '0', kitchen_station_id: null, is_active: true },
  { id: 'p-croissant', name: 'Butter Croissant', category_id: 'c-bakery', barcode: '6280001115521', price: '4.00', tax_rate: '0', kitchen_station_id: null, is_active: true },
  { id: 'p-water', name: 'Water 1.5L', category_id: 'c-bev', barcode: '6280001116630', price: '1.50', tax_rate: '0', kitchen_station_id: null, is_active: true },
  { id: 'p-karak', name: 'Karak Tea', category_id: 'c-bev', barcode: null, price: '3.00', tax_rate: '0', kitchen_station_id: 'st-bar', is_active: true },
  { id: 'p-lime', name: 'Fresh Lime', category_id: 'c-bev', barcode: null, price: '7.00', tax_rate: '0', kitchen_station_id: 'st-bar', is_active: true },
  { id: 'p-shawarma', name: 'Chicken Shawarma', category_id: 'c-grill', barcode: null, price: '12.00', tax_rate: '0', kitchen_station_id: 'st-kitchen', is_active: true },
  { id: 'p-kofta', name: 'Lamb Kofta 1kg', category_id: 'c-grill', barcode: '6280001118859', price: '38.00', tax_rate: '0', kitchen_station_id: 'st-grill', is_active: true },
  { id: 'p-mixed', name: 'Mixed Grill', category_id: 'c-grill', barcode: null, price: '58.00', tax_rate: '0', kitchen_station_id: 'st-grill', is_active: true },
  { id: 'p-halloumi-old', name: 'Halloumi 250g (old pack)', category_id: 'c-dairy', barcode: '6280001110958', price: '12.00', tax_rate: '0', kitchen_station_id: null, is_active: false },
]

export function categoryName(id: string | null): string | null {
  return id ? (categories.find((c) => c.id === id)?.name ?? null) : null
}

export function stationName(id: string | null): string | null {
  return id ? (stations.find((s) => s.id === id)?.name ?? null) : null
}

export function toPublicProduct(p: DbProduct) {
  return { ...p, category_name: categoryName(p.category_id), station_name: stationName(p.kitchen_station_id) }
}
