import { api } from './client'
import type { Paginated, Role, Store, UserRecord } from './types'

export function listStores(): Promise<Paginated<Store>> {
  return api<Paginated<Store>>('/stores')
}

export function listUsers(): Promise<Paginated<UserRecord>> {
  return api<Paginated<UserRecord>>('/users')
}

export interface UserInput {
  name: string
  email: string
  role: Role
  store_id: string | null
  pin?: string
  is_active?: boolean
}

export function createUser(input: UserInput): Promise<UserRecord> {
  return api<UserRecord>('/users', { method: 'POST', body: JSON.stringify(input) })
}

export function updateUser(id: string, input: Partial<UserInput>): Promise<UserRecord> {
  return api<UserRecord>(`/users/${id}`, { method: 'PATCH', body: JSON.stringify(input) })
}
