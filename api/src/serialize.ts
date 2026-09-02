import Big from 'big.js'

/**
 * Row → wire. The frontend's contract is decimal strings for money, plain
 * strings for quantities, ISO timestamps, and no business_id leaking out.
 */

/** "4.5" → "4.50"; NUMERIC already arrives as a string, this just fixes the width. */
export function money(v: string | number | null | undefined): string {
  return new Big(v ?? 0).toFixed(2)
}

export function moneyOrNull(v: string | number | null | undefined): string | null {
  return v === null || v === undefined ? null : money(v)
}

/** numeric(12,3) says "2.000"; the till says "2". Weighed goods keep "1.5". */
export function qty(v: string | number): string {
  const s = new Big(v).toString()
  return s
}

/** percent columns come back as "10.00"; the contract says "10" */
export function rate(v: string | number | null | undefined): string {
  return new Big(v ?? 0).toString()
}

export interface StoreRow {
  id: string
  business_id?: string
  name: string
  type: 'retail' | 'restaurant'
  address: string | null
  phone: string | null
  is_active: boolean
  kitchen_mode: 'kds' | 'printer'
  service_charge_rate: string
}

export function storeOut(s: StoreRow) {
  return {
    id: s.id,
    name: s.name,
    type: s.type,
    address: s.address,
    phone: s.phone,
    is_active: s.is_active,
    kitchen_mode: s.kitchen_mode,
    service_charge_rate: rate(s.service_charge_rate),
  }
}

export interface UserRow {
  id: string
  business_id: string
  store_id: string | null
  store_name?: string | null
  name: string
  email: string
  role: 'owner' | 'manager' | 'cashier' | 'waiter'
  pin_hash?: string | null
  is_active: boolean
}

/** The session's view of a person. */
export function userOut(u: UserRow) {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    business_id: u.business_id,
    store_id: u.store_id,
    store_name: u.store_name ?? null,
  }
}

/** The Users page's view — PINs are write-only, so only whether one exists. */
export function userRecordOut(u: UserRow) {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    store_id: u.store_id,
    store_name: u.store_name ?? null,
    is_active: u.is_active,
    has_pin: u.pin_hash !== null && u.pin_hash !== undefined,
  }
}

export interface ProductRow {
  id: string
  name: string
  name_ar: string | null
  description: string | null
  barcode: string | null
  price: string
  price_online: string | null
  tax_rate: string
  is_combo: boolean
  offer: unknown | null
  offer_online: unknown | null
  option_groups: unknown
  kitchen_station_id: string | null
  station_name?: string | null
  is_active: boolean
  category_ids: string[]
  category_name?: string | null
  /** the branches that sell it; [] = every branch */
  store_ids: string[]
  store_names?: string[]
}

export function productOut(p: ProductRow) {
  return {
    id: p.id,
    name: p.name,
    name_ar: p.name_ar,
    description: p.description,
    category_id: p.category_ids[0] ?? null,
    category_name: p.category_name ?? null,
    category_ids: p.category_ids,
    barcode: p.barcode,
    price: money(p.price),
    price_online: moneyOrNull(p.price_online),
    tax_rate: rate(p.tax_rate),
    is_combo: p.is_combo,
    offer: p.offer ?? null,
    offer_online: p.offer_online ?? null,
    option_groups: p.option_groups ?? [],
    kitchen_station_id: p.kitchen_station_id,
    station_name: p.station_name ?? null,
    store_ids: p.store_ids ?? [],
    store_names: p.store_names ?? [],
    is_active: p.is_active,
  }
}

export interface CustomerRow {
  id: string
  name: string
  phone: string | null
  email: string | null
  credit_limit: string | null
  notes: string | null
  is_active: boolean
  balance?: string | null
}

export function customerOut(c: CustomerRow) {
  return {
    id: c.id,
    name: c.name,
    phone: c.phone,
    email: c.email,
    credit_limit: moneyOrNull(c.credit_limit),
    notes: c.notes,
    is_active: c.is_active,
    balance: money(c.balance ?? 0),
  }
}

export interface TicketItemRow {
  id: string
  product_name: string
  description: string | null
  quantity: string
  note: string | null
  cancelled: boolean
}

export interface TicketRow {
  id: string
  order_id: string
  order_number: string
  table_name: string | null
  station_id: string
  status: 'new' | 'in_progress' | 'done' | 'cancelled'
  created_at: string
  done_at: string | null
  items: TicketItemRow[]
}

export function ticketOut(t: TicketRow) {
  return {
    id: t.id,
    order_id: t.order_id,
    order_number: t.order_number,
    table_name: t.table_name,
    station_id: t.station_id,
    status: t.status,
    created_at: t.created_at,
    done_at: t.done_at,
    items: t.items.map((i) => ({
      id: i.id,
      product_name: i.product_name,
      description: i.description,
      quantity: qty(i.quantity),
      note: i.note,
      cancelled: i.cancelled,
    })),
  }
}

export function paginated<T>(data: T[], limit = data.length) {
  return { data, total: data.length, page: 1, limit }
}
