import { api } from './client'
import type { Paginated } from './types'

export interface Category {
  id: string
  name: string
  sort_order: number
}

export interface Product {
  id: string
  name: string
  category_id: string | null
  category_name: string | null
  barcode: string | null
  price: string
  tax_rate: string
  kitchen_station_id: string | null
  station_name: string | null
  is_active: boolean
}

export interface Station {
  id: string
  store_id: string
  name: string
}

export function listCategories(): Promise<Paginated<Category>> {
  return api<Paginated<Category>>('/categories')
}

export function createCategory(name: string): Promise<Category> {
  return api<Category>('/categories', { method: 'POST', body: JSON.stringify({ name }) })
}

export interface ProductFilters {
  search?: string
  category_id?: string
  barcode?: string
  include_inactive?: boolean
}

export function listProducts(filters: ProductFilters = {}): Promise<Paginated<Product>> {
  const q = new URLSearchParams()
  if (filters.search) q.set('search', filters.search)
  if (filters.category_id) q.set('category_id', filters.category_id)
  if (filters.barcode) q.set('barcode', filters.barcode)
  if (filters.include_inactive) q.set('include_inactive', 'true')
  const qs = q.toString()
  return api<Paginated<Product>>(`/products${qs ? `?${qs}` : ''}`)
}

export interface ProductInput {
  name: string
  category_id: string | null
  barcode: string | null
  price: string
  tax_rate: string
  kitchen_station_id: string | null
  is_active?: boolean
}

export function createProduct(input: ProductInput): Promise<Product> {
  return api<Product>('/products', { method: 'POST', body: JSON.stringify(input) })
}

export function updateProduct(id: string, input: Partial<ProductInput>): Promise<Product> {
  return api<Product>(`/products/${id}`, { method: 'PATCH', body: JSON.stringify(input) })
}

export function listStations(): Promise<Paginated<Station>> {
  return api<Paginated<Station>>('/kitchen/stations')
}
