import { api } from './client'
import type { Paginated } from './types'

export interface Customer {
  id: string
  name: string
  phone: string | null
  email: string | null
  credit_limit: string | null
  notes: string | null
  is_active: boolean
  balance: string
}

export interface StatementEntry {
  id: string
  entry_type: 'charge' | 'repayment' | 'adjustment'
  amount: string
  method: 'cash' | 'card' | 'online' | null
  note: string | null
  created_by_name: string
  created_at: string
  balance: string
}

export function listCustomers(search?: string): Promise<Paginated<Customer>> {
  const q = search ? `?search=${encodeURIComponent(search)}` : ''
  return api<Paginated<Customer>>(`/customers${q}`)
}

export interface CustomerInput {
  name: string
  phone?: string | null
  email?: string | null
  credit_limit?: string | null
  notes?: string | null
}

export function createCustomer(input: CustomerInput): Promise<Customer> {
  return api<Customer>('/customers', { method: 'POST', body: JSON.stringify(input) })
}

export function updateCustomer(id: string, input: Partial<CustomerInput>): Promise<Customer> {
  return api<Customer>(`/customers/${id}`, { method: 'PATCH', body: JSON.stringify(input) })
}

export function getStatement(id: string): Promise<{ customer: Customer; entries: StatementEntry[] }> {
  return api(`/customers/${id}/statement`)
}

export function addRepayment(
  id: string,
  input: { amount: string; method: 'cash' | 'card' | 'online'; note?: string; store_id?: string },
): Promise<{ entry: StatementEntry; balance: string }> {
  return api(`/customers/${id}/repayments`, { method: 'POST', body: JSON.stringify(input) })
}
