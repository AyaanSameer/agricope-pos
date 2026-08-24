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
