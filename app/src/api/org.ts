import { api } from './client'
import type { Paginated, Role, Store, UserRecord } from './types'

export function listStores(): Promise<Paginated<Store>> {
  return api<Paginated<Store>>('/stores')
}

/** Branch settings — today just the kitchen output mode. Manager/owner only. */
export function updateStore(
  id: string,
  input: { kitchen_mode?: 'kds' | 'printer' },
): Promise<Store> {
  return api<Store>(`/stores/${id}`, { method: 'PATCH', body: JSON.stringify(input) })
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

/** Owner only — a manager can deactivate, but only the owner deletes. */
export function deleteUser(id: string): Promise<void> {
  return api<void>(`/users/${id}`, { method: 'DELETE' })
}
