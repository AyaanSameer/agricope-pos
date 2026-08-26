import { api } from './client'
import type { Paginated, Store } from './types'

/**
 * Platform admin surface — Agricope staff only. Everything here spans
 * businesses, which no business token can do.
 */
export interface AdminBusiness {
  id: string
  name: string
  email: string // the business's one login
  stores: Store[]
  owners: { id: string; name: string; email: string; has_pin: boolean }[]
  user_count: number
  product_count: number
}

export function listBusinesses(): Promise<Paginated<AdminBusiness>> {
  return api<Paginated<AdminBusiness>>('/admin/businesses')
}

export function createBusiness(input: {
  name: string
  email: string
  password: string
}): Promise<AdminBusiness> {
  return api<AdminBusiness>('/admin/businesses', { method: 'POST', body: JSON.stringify(input) })
}

export function createBranch(
  businessId: string,
  input: { name: string; type: 'retail' | 'restaurant'; address?: string },
): Promise<AdminBusiness> {
  return api<AdminBusiness>(`/admin/businesses/${businessId}/stores`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function createOwner(
  businessId: string,
  input: { name: string; email: string; pin?: string },
): Promise<AdminBusiness> {
  return api<AdminBusiness>(`/admin/businesses/${businessId}/owners`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
}
