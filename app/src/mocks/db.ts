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
