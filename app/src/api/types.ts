export type Role = 'owner' | 'manager' | 'cashier'

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
  is_active: boolean
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
