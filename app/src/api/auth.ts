import { api } from './client'
import type { AdminLoginResponse, BusinessLoginResponse, LoginResponse } from './types'

/**
 * Stage 1 — the business signs in (one login covers every branch; nobody is
 * identified as a person yet). Platform admins share the same form and come
 * back with an admin_token instead.
 */
export function login(
  email: string,
  password: string,
): Promise<BusinessLoginResponse | AdminLoginResponse> {
  return api('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  })
}

/**
 * Stage 2 (and fast cashier hand-over): the store is the till's context, the
 * PIN identifies who is at it. Returns a full user session.
 * store_id null = back office (owner-level PINs only).
 */
export function switchCashier(store_id: string | null, pin: string): Promise<LoginResponse> {
  return api<LoginResponse>('/auth/switch-cashier', {
    method: 'POST',
    body: JSON.stringify({ store_id, pin }),
  })
}

/**
 * Owner only — changes the BUSINESS password, the one every till of this
 * business signs in with. The current password is re-checked server-side.
 */
export function changeBusinessPassword(
  current_password: string,
  new_password: string,
): Promise<void> {
  return api<void>('/auth/change-password', {
    method: 'POST',
    body: JSON.stringify({ current_password, new_password }),
  })
}
