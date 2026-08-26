import { api } from './client'

/** Floor-plan administration — owner only; seating stays on /tables/floor. */
export interface DiningTable {
  id: string
  store_id: string
  name: string
  zone: string
  seats: number
  is_active: boolean
}

export interface TableInput {
  store_id: string
  name: string
  zone: string
  seats: number
  is_active?: boolean
}

export function createTable(input: TableInput): Promise<DiningTable> {
  return api<DiningTable>('/tables', { method: 'POST', body: JSON.stringify(input) })
}

export function updateTable(
  id: string,
  input: Partial<Omit<TableInput, 'store_id'>>,
): Promise<DiningTable> {
  return api<DiningTable>(`/tables/${id}`, { method: 'PATCH', body: JSON.stringify(input) })
}

export function deleteTable(id: string): Promise<void> {
  return api<void>(`/tables/${id}`, { method: 'DELETE' })
}
