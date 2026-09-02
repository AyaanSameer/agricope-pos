import { api } from './client'
import type { Paginated } from './types'

/**
 * Staff = the workforce a manager runs — attendance, not logins. Users (till
 * logins) live in /users; a kitchen hand who never touches the till is staff.
 */
export interface StaffMember {
  id: string
  name: string
  role_title: string
  store_id: string | null
  store_name: string | null
  is_active: boolean
  /** open attendance entry — null when checked out */
  checked_in_at: string | null
  /** completed entries today, most recent first */
  today: AttendanceEntry[]
}

export interface AttendanceEntry {
  id: string
  check_in: string
  check_out: string | null
}

export function listStaff(store_id?: string): Promise<Paginated<StaffMember>> {
  const q = store_id ? `?store_id=${encodeURIComponent(store_id)}` : ''
  return api<Paginated<StaffMember>>(`/staff${q}`)
}

export interface StaffInput {
  name: string
  role_title: string
  store_id: string | null
  is_active?: boolean
}

export function createStaff(input: StaffInput): Promise<StaffMember> {
  return api<StaffMember>('/staff', { method: 'POST', body: JSON.stringify(input) })
}

export function updateStaff(id: string, input: Partial<StaffInput>): Promise<StaffMember> {
  return api<StaffMember>(`/staff/${id}`, { method: 'PATCH', body: JSON.stringify(input) })
}

export function checkInStaff(id: string): Promise<StaffMember> {
  return api<StaffMember>(`/staff/${id}/check-in`, { method: 'POST', body: JSON.stringify({}) })
}

export function checkOutStaff(id: string): Promise<StaffMember> {
  return api<StaffMember>(`/staff/${id}/check-out`, { method: 'POST', body: JSON.stringify({}) })
}

/** Owner only, and refused while the staff member is still active. */
export function deleteStaff(id: string): Promise<void> {
  return api<void>(`/staff/${id}`, { method: 'DELETE' })
}
