import { api } from './client'
import type { Paginated } from './types'
import type { ProductOffer } from '../lib/pricing'

export interface Category {
  id: string
  name: string
  sort_order: number
}

export interface OptionChoice {
  id: string
  name: string
  price_delta: string // "0.00" for free choices
}

export interface OptionGroup {
  id: string
  name: string // e.g. "Flavor"
  required: boolean
  choices: OptionChoice[]
}

export interface Product {
  id: string
  name: string
  name_ar: string | null
  description: string | null
  /** primary placement — first of category_ids */
  category_id: string | null
  category_name: string | null
  category_ids: string[]
  barcode: string | null
  /** in-store price, tax-inclusive */
  price: string
  /** online-channel price; null = same as in-store */
  price_online: string | null
  tax_rate: string
  is_combo: boolean
  /** time-bound in-store discount */
  offer: ProductOffer | null
  /** time-bound online discount — independent of the in-store one */
  offer_online: ProductOffer | null
  /** customisable options, e.g. Flavor: Normal/Spicy/Mix */
  option_groups: OptionGroup[]
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
  name_ar?: string | null
  description?: string | null
  category_ids: string[]
  barcode: string | null
  price: string
  price_online?: string | null
  tax_rate: string
  is_combo?: boolean
  offer?: ProductOffer | null
  offer_online?: ProductOffer | null
  option_groups?: OptionGroup[]
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
