export type Role = 'owner' | 'manager' | 'cashier' | 'waiter'

export interface User {
  id: string
  name: string
  email: string
  role: Role
  business_id: string
  /** null = works across all stores (e.g. owner) */
  store_id: string | null
  store_name: string | null
}

/**
 * Stage 1 of sign-in: the BUSINESS logs in (one login for all branches).
 * The person is identified afterwards by the PIN they type on the till.
 */
export interface BusinessLoginResponse {
  business_token: string
  business: { id: string; name: string }
  stores: Store[]
}

/** Platform admin (Agricope staff) — above every business. */
export interface AdminLoginResponse {
  admin_token: string
  admin: { id: string; name: string }
}

/** Stage 2: a PIN resolves to a person and a full user session. */
export interface LoginResponse {
  access_token: string
  refresh_token: string
  user: User
}

export interface Store {
  id: string
  name: string
  type: 'retail' | 'restaurant'
  address: string | null
  /** printed on the receipt so a customer can call the branch */
  phone: string | null
  is_active: boolean
  /** Branch setting: kitchen work goes to the KDS board or a printed ticket. */
  kitchen_mode: 'kds' | 'printer'
  /** Dine-in service charge, percent ("10") — 0 where none applies. */
  service_charge_rate: string
}

/** Admin view of a user. PINs are write-only — the API never returns them. */
export interface UserRecord {
  id: string
  name: string
  email: string
  role: Role
  store_id: string | null
  store_name: string | null
  is_active: boolean
  has_pin: boolean
}

export interface Paginated<T> {
  data: T[]
  total: number
  page: number
  limit: number
}
