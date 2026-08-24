import { api } from './client'
import type { LoginResponse } from './types'

export function login(email: string, password: string): Promise<LoginResponse> {
  return api<LoginResponse>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  })
}

/**
 * Fast cashier hand-over on a till: the store is the till's context, the PIN
 * identifies who is taking over. Returns a full new session.
 */
export function switchCashier(store_id: string, pin: string): Promise<LoginResponse> {
  return api<LoginResponse>('/auth/switch-cashier', {
    method: 'POST',
    body: JSON.stringify({ store_id, pin }),
  })
}
