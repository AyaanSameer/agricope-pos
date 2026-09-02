import { api } from './client'
import type { Paginated, Role, Store, UserRecord } from './types'

export function listStores(): Promise<Paginated<Store>> {
  return api<Paginated<Store>>('/stores')
}

/** Branch settings. Manager/owner only. */
export interface StoreSettingsInput {
  kitchen_mode?: 'kds' | 'printer'
  name?: string
  address?: string
  phone?: string
  /** dine-in service charge, percent — "10" */
  service_charge_rate?: string
}

export function updateStore(id: string, input: StoreSettingsInput): Promise<Store> {
  return api<Store>(`/stores/${id}`, { method: 'PATCH', body: JSON.stringify(input) })
}

/** The tenant-wide settings row: receipt footer, approval threshold. */
export interface BusinessSettings {
  business_name: string
  receipt_footer: string
  /** discounts above this percent ask for a manager PIN */
  discount_approval_percent: string
  /** true = one catalogue for every branch; false = each branch keeps its own */
  shared_catalog: boolean
}

export function getBusinessSettings(): Promise<BusinessSettings> {
  return api<BusinessSettings>('/business-settings')
}

export function updateBusinessSettings(
  input: Partial<Pick<BusinessSettings, 'receipt_footer' | 'discount_approval_percent' | 'shared_catalog'>>,
): Promise<BusinessSettings> {
  return api<BusinessSettings>('/business-settings', { method: 'PATCH', body: JSON.stringify(input) })
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
