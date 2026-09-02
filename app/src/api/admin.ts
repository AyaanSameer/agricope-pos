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
  /** false = suspended: nobody can sign in, and only now may it be deleted */
  is_active: boolean
  /** orders on record across its branches — history that blocks a branch delete */
  order_count: number
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

/**
 * Change how a business signs in — its login email and/or password. Platform
 * admin only; takes effect on that business's next sign-in on every till.
 */
export function updateBusinessLogin(
  businessId: string,
  input: { email?: string; password?: string },
): Promise<AdminBusiness> {
  return api<AdminBusiness>(`/admin/businesses/${businessId}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  })
}

/** Suspend or restore a whole tenant. Suspended businesses cannot sign in. */
export function setBusinessActive(businessId: string, is_active: boolean): Promise<AdminBusiness> {
  return api<AdminBusiness>(`/admin/businesses/${businessId}`, {
    method: 'PATCH',
    body: JSON.stringify({ is_active }),
  })
}

/** Permanent, and refused while the business is still active. */
export function deleteBusiness(businessId: string): Promise<void> {
  return api<void>(`/admin/businesses/${businessId}`, { method: 'DELETE' })
}

export function updateBranch(
  businessId: string,
  storeId: string,
  input: { is_active?: boolean; name?: string; address?: string },
): Promise<AdminBusiness> {
  return api<AdminBusiness>(`/admin/businesses/${businessId}/stores/${storeId}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  })
}

/** Refused while active, and refused outright once the branch has sold anything. */
export function deleteBranch(businessId: string, storeId: string): Promise<AdminBusiness> {
  return api<AdminBusiness>(`/admin/businesses/${businessId}/stores/${storeId}`, {
    method: 'DELETE',
  })
}

/** The platform administrator's own password. */
export function changeAdminPassword(
  current_password: string,
  new_password: string,
): Promise<void> {
  return api<void>('/admin/change-password', {
    method: 'POST',
    body: JSON.stringify({ current_password, new_password }),
  })
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
