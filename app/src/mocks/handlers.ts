import { http, HttpResponse, delay } from 'msw'
import type { Role } from '../api/types'
import {
  admins,
  businesses,
  businessSessionFor,
  categories,
  products,
  requester,
  requesterBusiness,
  sessionFor,
  stations,
  stores,
  storeName,
  toPublicProduct,
  serviceChargeRates,
  toPublicStore,
  toUserRecord,
  users,
} from './db'
import type { DbOptionGroup, DbProduct, DbUser } from './db'
import type { ProductOffer } from '../lib/pricing'
import { settingsFor } from './posdb'
import { posHandlers } from './posHandlers'
import { posHandlers2 } from './posHandlers2'
import { posHandlers3 } from './posHandlers3'
import { staffHandlers } from './staffHandlers'
import { adminHandlers } from './adminHandlers'
import { tableHandlers } from './tableHandlers'

function apiError(status: number, code: string, message: string) {
  return HttpResponse.json({ error: { code, message } }, { status })
}

function requireRole(request: Request, roles: Role[]): DbUser | Response {
  const user = requester(request)
  if (!user) return apiError(401, 'UNAUTHENTICATED', 'Sign in to continue.')
  if (!roles.includes(user.role)) {
    return apiError(403, 'FORBIDDEN', 'You do not have permission to do this.')
  }
  return user
}

const MONEY_RE = /^\d+(\.\d{1,2})?$/

function parseOptionGroups(raw: unknown): DbOptionGroup[] | Response {
  if (!Array.isArray(raw)) return []
  const groups: DbOptionGroup[] = []
  for (const g of raw as Partial<DbOptionGroup>[]) {
    const name = String(g.name ?? '').trim()
    if (!name) return apiError(400, 'VALIDATION_ERROR', 'Every option group needs a name.')
    const choices = (Array.isArray(g.choices) ? g.choices : [])
      .map((c, i) => ({
        id: c.id || `oc-${Math.random().toString(36).slice(2, 8)}-${i}`,
        name: String(c.name ?? '').trim(),
        price_delta: String(c.price_delta ?? '0.00'),
      }))
      .filter((c) => c.name)
    if (choices.length < 2) {
      return apiError(400, 'VALIDATION_ERROR', `Option group "${name}" needs at least two choices.`)
    }
    for (const c of choices) {
      if (!MONEY_RE.test(c.price_delta)) {
        return apiError(400, 'VALIDATION_ERROR', `Price delta for "${c.name}" must look like "2.00".`)
      }
    }
    groups.push({
      id: g.id || `og-${Math.random().toString(36).slice(2, 8)}`,
      name,
      required: g.required ?? true,
      choices,
    })
  }
  return groups
}

function parseOffer(raw: unknown): ProductOffer | null | Response {
  if (raw === null || raw === undefined) return null
  const o = raw as Partial<ProductOffer>
  const percent = String(o.percent ?? '').trim()
  if (!/^\d+$/.test(percent) || Number(percent) <= 0 || Number(percent) >= 100) {
    return apiError(400, 'VALIDATION_ERROR', 'Offer percent must be a whole number between 1 and 99.')
  }
  return { percent, starts_at: o.starts_at ?? null, ends_at: o.ends_at ?? null }
}

export const handlers = [
  // ---------- auth: one login per business, the PIN identifies the person ----------

  http.post('/api/v1/auth/login', async ({ request }) => {
    await delay(400)
    const body = (await request.json()) as { email?: string; password?: string }
    // Platform admins share the login form but live above every business.
    const admin = admins.find((a) => a.email === body.email)
    if (admin) {
      if (admin.password !== body.password) {
        return apiError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect.')
      }
      return HttpResponse.json({
        admin_token: `mock-admin.${admin.id}`,
        admin: { id: admin.id, name: admin.name },
      })
    }
    const business = businesses.find((b) => b.email === body.email)
    if (!business || business.password !== body.password) {
      return apiError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect.')
    }
    return HttpResponse.json(businessSessionFor(business))
  }),

  http.post('/api/v1/auth/refresh', async ({ request }) => {
    await delay(150)
    const body = (await request.json()) as { refresh_token?: string }
    const id = body.refresh_token?.startsWith('mock-refresh.')
      ? body.refresh_token.slice('mock-refresh.'.length)
      : null
    const user = users.find((u) => u.id === id && u.is_active)
    if (!user) return apiError(401, 'INVALID_TOKEN', 'Session expired — sign in again.')
    return HttpResponse.json(sessionFor(user))
  }),

  http.post('/api/v1/auth/switch-cashier', async ({ request }) => {
    await delay(300)
    const business = requesterBusiness(request)
    if (!business) return apiError(401, 'UNAUTHENTICATED', 'Sign in to continue.')
    const body = (await request.json()) as { store_id?: string | null; pin?: string }
    if (body.store_id && !stores.some((s) => s.id === body.store_id && s.business_id === business.id)) {
      return apiError(400, 'VALIDATION_ERROR', 'That branch does not belong to this business.')
    }
    const user = users.find(
      (u) =>
        u.is_active &&
        u.business_id === business.id &&
        u.pin !== null &&
        u.pin === body.pin &&
        (body.store_id
          ? u.store_id === null || u.store_id === body.store_id
          : u.store_id === null), // back office: cross-store people only
    )
    if (!user) return apiError(401, 'INVALID_PIN', 'That PIN does not match anyone on this till.')
    return HttpResponse.json(sessionFor(user))
  }),

  // Owner only — the BUSINESS password, which every till signs in with.
  http.post('/api/v1/auth/change-password', async ({ request }) => {
    await delay(350)
    const caller = requireRole(request, ['owner'])
    if (caller instanceof Response) return caller
    const business = businesses.find((b) => b.id === caller.business_id)
    if (!business) return apiError(404, 'NOT_FOUND', 'No such business.')
    const body = (await request.json()) as { current_password?: string; new_password?: string }
    if (body.current_password !== business.password) {
      return apiError(401, 'INVALID_CREDENTIALS', 'The current password is not right.')
    }
    if (!body.new_password || body.new_password.length < 8) {
      return apiError(400, 'VALIDATION_ERROR', 'The new password needs at least 8 characters.')
    }
    business.password = body.new_password
    return new HttpResponse(null, { status: 204 })
  }),

  // ---------- org ----------

  http.get('/api/v1/stores', async ({ request }) => {
    await delay(250)
    const business = requesterBusiness(request)
    if (!business) return apiError(401, 'UNAUTHENTICATED', 'Sign in to continue.')
    const data = stores
      .filter((s) => s.business_id === business.id && s.is_active)
      .map(toPublicStore)
    return HttpResponse.json({ data, total: data.length, page: 1, limit: 50 })
  }),

  http.patch('/api/v1/stores/:id', async ({ request, params }) => {
    await delay(250)
    const caller = requireRole(request, ['owner', 'manager'])
    if (caller instanceof Response) return caller
    const store = stores.find((s) => s.id === params.id && s.business_id === caller.business_id)
    if (!store) return apiError(404, 'NOT_FOUND', 'No such branch.')
    const body = (await request.json()) as {
      kitchen_mode?: 'kds' | 'printer'
      name?: string
      address?: string
      phone?: string
      service_charge_rate?: string
    }
    if (body.kitchen_mode !== undefined) {
      if (!['kds', 'printer'].includes(body.kitchen_mode)) {
        return apiError(400, 'VALIDATION_ERROR', 'kitchen_mode must be "kds" or "printer".')
      }
      store.kitchen_mode = body.kitchen_mode
    }
    if (body.name !== undefined) {
      if (!body.name.trim()) return apiError(400, 'VALIDATION_ERROR', 'The branch needs a name.')
      store.name = body.name.trim()
    }
    if (body.address !== undefined) store.address = body.address.trim() || null
    if (body.phone !== undefined) store.phone = body.phone.trim() || null
    if (body.service_charge_rate !== undefined) {
      const n = Number(body.service_charge_rate)
      if (!Number.isFinite(n) || n < 0 || n > 25) {
        return apiError(400, 'VALIDATION_ERROR', 'Service charge must be between 0 and 25%.')
      }
      // New tabs pick this up on their next recalculation; closed orders keep
      // the snapshot they were rung up with.
      serviceChargeRates[store.id] = String(n)
    }
    return HttpResponse.json(toPublicStore(store))
  }),

  // ---- Business settings: the tenant JSONB — receipt footer, approvals ----
  http.get('/api/v1/business-settings', async ({ request }) => {
    await delay(200)
    const caller = requireRole(request, ['owner', 'manager'])
    if (caller instanceof Response) return caller
    return HttpResponse.json(settingsFor(caller.business_id))
  }),

  http.patch('/api/v1/business-settings', async ({ request }) => {
    await delay(250)
    const caller = requireRole(request, ['owner', 'manager'])
    if (caller instanceof Response) return caller
    const st = settingsFor(caller.business_id)
    const body = (await request.json()) as Partial<
      Pick<typeof st, 'receipt_footer' | 'discount_approval_percent'>
    >
    if (body.receipt_footer !== undefined) st.receipt_footer = body.receipt_footer.trim()
    if (body.discount_approval_percent !== undefined) {
      const n = Number(body.discount_approval_percent)
      if (!Number.isFinite(n) || n < 0 || n > 100) {
        return apiError(400, 'VALIDATION_ERROR', 'The approval threshold is a percent, 0–100.')
      }
      st.discount_approval_percent = String(n)
    }
    return HttpResponse.json(st)
  }),

  http.get('/api/v1/users', async ({ request }) => {
    await delay(250)
    const caller = requireRole(request, ['owner', 'manager'])
    if (caller instanceof Response) return caller
    const data = users.filter((u) => u.business_id === caller.business_id).map(toUserRecord)
    return HttpResponse.json({ data, total: data.length, page: 1, limit: 50 })
  }),

  http.post('/api/v1/users', async ({ request }) => {
    await delay(300)
    const caller = requireRole(request, ['owner', 'manager'])
    if (caller instanceof Response) return caller
    const body = (await request.json()) as Partial<DbUser> & { pin?: string }
    if (!body.name || !body.email || !body.role) {
      return apiError(400, 'VALIDATION_ERROR', 'Name, email and role are required.')
    }
    const own = users.filter((u) => u.business_id === caller.business_id)
    if (own.some((u) => u.email === body.email)) {
      return apiError(400, 'VALIDATION_ERROR', 'A user with that email already exists.')
    }
    if (body.pin && own.some((u) => u.pin === body.pin)) {
      return apiError(400, 'VALIDATION_ERROR', 'That PIN is already in use — pick another.')
    }
    const user: DbUser = {
      id: `u-${Math.random().toString(36).slice(2, 8)}`,
      name: body.name,
      email: body.email,
      role: body.role as Role,
      business_id: caller.business_id,
      store_id: body.store_id ?? null,
      pin: body.pin ?? null,
      is_active: body.is_active ?? true,
    }
    users.push(user)
    return HttpResponse.json(toUserRecord(user), { status: 201 })
  }),

  http.patch('/api/v1/users/:id', async ({ request, params }) => {
    await delay(300)
    const caller = requireRole(request, ['owner', 'manager'])
    if (caller instanceof Response) return caller
    const user = users.find((u) => u.id === params.id && u.business_id === caller.business_id)
    if (!user) return apiError(404, 'NOT_FOUND', 'No such user.')
    const body = (await request.json()) as Partial<DbUser> & { pin?: string }
    if (
      body.pin &&
      users.some((u) => u.business_id === caller.business_id && u.pin === body.pin && u.id !== user.id)
    ) {
      return apiError(400, 'VALIDATION_ERROR', 'That PIN is already in use — pick another.')
    }
    if (body.name !== undefined) user.name = body.name
    if (body.email !== undefined) user.email = body.email
    if (body.role !== undefined) user.role = body.role as Role
    if (body.store_id !== undefined) user.store_id = body.store_id
    if (body.pin !== undefined) user.pin = body.pin
    if (body.is_active !== undefined) user.is_active = body.is_active
    return HttpResponse.json(toUserRecord(user))
  }),

  http.delete('/api/v1/users/:id', async ({ request, params }) => {
    await delay(300)
    const caller = requireRole(request, ['owner'])
    if (caller instanceof Response) return caller
    const idx = users.findIndex((u) => u.id === params.id && u.business_id === caller.business_id)
    if (idx === -1) return apiError(404, 'NOT_FOUND', 'No such user.')
    if (users[idx].id === caller.id) {
      return apiError(400, 'VALIDATION_ERROR', 'You cannot delete your own account.')
    }
    users.splice(idx, 1)
    return new HttpResponse(null, { status: 204 })
  }),

  // ---------- catalog ----------

  http.get('/api/v1/categories', async ({ request }) => {
    await delay(200)
    const caller = requester(request)
    if (!caller) return apiError(401, 'UNAUTHENTICATED', 'Sign in to continue.')
    const data = categories
      .filter((c) => c.business_id === caller.business_id)
      .sort((a, b) => a.sort_order - b.sort_order)
      .map(({ business_id: _b, ...c }) => c)
    return HttpResponse.json({ data, total: data.length, page: 1, limit: 100 })
  }),

  http.post('/api/v1/categories', async ({ request }) => {
    await delay(250)
    const caller = requireRole(request, ['owner', 'manager'])
    if (caller instanceof Response) return caller
    const body = (await request.json()) as { name?: string }
    const name = body.name?.trim()
    if (!name) return apiError(400, 'VALIDATION_ERROR', 'Category name is required.')
    const own = categories.filter((c) => c.business_id === caller.business_id)
    if (own.some((c) => c.name.toLowerCase() === name.toLowerCase())) {
      return apiError(400, 'VALIDATION_ERROR', 'That category already exists.')
    }
    const cat = {
      id: `c-${Math.random().toString(36).slice(2, 8)}`,
      business_id: caller.business_id,
      name,
      sort_order: own.length + 1,
    }
    categories.push(cat)
    const { business_id: _b, ...pub } = cat
    return HttpResponse.json(pub, { status: 201 })
  }),

  http.get('/api/v1/products', async ({ request }) => {
    await delay(250)
    const caller = requester(request)
    if (!caller) return apiError(401, 'UNAUTHENTICATED', 'Sign in to continue.')
    const url = new URL(request.url)
    const barcode = url.searchParams.get('barcode')
    const search = url.searchParams.get('search')?.toLowerCase()
    const categoryId = url.searchParams.get('category_id')
    const includeInactive = url.searchParams.get('include_inactive') === 'true'
    let data = products.filter(
      (p) => p.business_id === caller.business_id && (includeInactive || p.is_active),
    )
    if (barcode) data = data.filter((p) => p.barcode === barcode)
    if (categoryId) data = data.filter((p) => p.category_ids.includes(categoryId))
    if (search) data = data.filter((p) => p.name.toLowerCase().includes(search))
    return HttpResponse.json({ data: data.map(toPublicProduct), total: data.length, page: 1, limit: 200 })
  }),

  http.post('/api/v1/products', async ({ request }) => {
    await delay(300)
    const caller = requireRole(request, ['owner', 'manager'])
    if (caller instanceof Response) return caller
    const body = (await request.json()) as Partial<DbProduct> & { category_id?: string | null }
    if (!body.name?.trim() || !body.price) {
      return apiError(400, 'VALIDATION_ERROR', 'Name and price are required.')
    }
    if (!MONEY_RE.test(String(body.price))) {
      return apiError(400, 'VALIDATION_ERROR', 'Price must be a decimal string like "4.50".')
    }
    if (body.price_online && !MONEY_RE.test(String(body.price_online))) {
      return apiError(400, 'VALIDATION_ERROR', 'Online price must be a decimal string like "4.50".')
    }
    const own = products.filter((p) => p.business_id === caller.business_id)
    if (body.barcode && own.some((p) => p.barcode === body.barcode)) {
      return apiError(400, 'VALIDATION_ERROR', 'Another product already has that barcode.')
    }
    const optionGroups = parseOptionGroups(body.option_groups)
    if (optionGroups instanceof Response) return optionGroups
    const offer = parseOffer(body.offer)
    if (offer instanceof Response) return offer
    const offerOnline = parseOffer(body.offer_online)
    if (offerOnline instanceof Response) return offerOnline
    const categoryIds = Array.isArray(body.category_ids)
      ? body.category_ids
      : body.category_id
        ? [body.category_id]
        : []
    const product: DbProduct = {
      id: `p-${Math.random().toString(36).slice(2, 8)}`,
      business_id: caller.business_id,
      name: body.name.trim(),
      name_ar: body.name_ar?.trim() || null,
      description: body.description?.trim() || null,
      category_ids: categoryIds,
      barcode: body.barcode || null,
      price: String(body.price),
      price_online: body.price_online ? String(body.price_online) : null,
      tax_rate: String(body.tax_rate ?? '0'),
      is_combo: body.is_combo ?? false,
      offer,
      offer_online: offerOnline,
      option_groups: optionGroups,
      kitchen_station_id: body.kitchen_station_id ?? null,
      is_active: body.is_active ?? true,
    }
    products.push(product)
    return HttpResponse.json(toPublicProduct(product), { status: 201 })
  }),

  http.patch('/api/v1/products/:id', async ({ request, params }) => {
    await delay(300)
    const caller = requireRole(request, ['owner', 'manager'])
    if (caller instanceof Response) return caller
    const product = products.find(
      (p) => p.id === params.id && p.business_id === caller.business_id,
    )
    if (!product) return apiError(404, 'NOT_FOUND', 'No such product.')
    const body = (await request.json()) as Partial<DbProduct> & { category_id?: string | null }
    if (
      body.barcode &&
      products.some(
        (p) => p.business_id === caller.business_id && p.barcode === body.barcode && p.id !== product.id,
      )
    ) {
      return apiError(400, 'VALIDATION_ERROR', 'Another product already has that barcode.')
    }
    if (body.price !== undefined && !MONEY_RE.test(String(body.price))) {
      return apiError(400, 'VALIDATION_ERROR', 'Price must be a decimal string like "4.50".')
    }
    if (body.price_online != null && body.price_online !== '' && !MONEY_RE.test(String(body.price_online))) {
      return apiError(400, 'VALIDATION_ERROR', 'Online price must be a decimal string like "4.50".')
    }
    if (body.option_groups !== undefined) {
      const parsed = parseOptionGroups(body.option_groups)
      if (parsed instanceof Response) return parsed
      product.option_groups = parsed
    }
    if (body.offer_online !== undefined) {
      const parsedOnline = parseOffer(body.offer_online)
      if (parsedOnline instanceof Response) return parsedOnline
      product.offer_online = parsedOnline
    }
    if (body.offer !== undefined) {
      const parsed = parseOffer(body.offer)
      if (parsed instanceof Response) return parsed
      product.offer = parsed
    }
    if (body.name !== undefined) product.name = body.name
    if (body.name_ar !== undefined) product.name_ar = body.name_ar?.trim() || null
    if (body.description !== undefined) product.description = body.description?.trim() || null
    if (body.category_ids !== undefined) product.category_ids = body.category_ids
    else if (body.category_id !== undefined) product.category_ids = body.category_id ? [body.category_id] : []
    if (body.barcode !== undefined) product.barcode = body.barcode || null
    if (body.price !== undefined) product.price = String(body.price)
    if (body.price_online !== undefined) {
      product.price_online = body.price_online ? String(body.price_online) : null
    }
    if (body.tax_rate !== undefined) product.tax_rate = String(body.tax_rate)
    if (body.is_combo !== undefined) product.is_combo = body.is_combo
    if (body.kitchen_station_id !== undefined) product.kitchen_station_id = body.kitchen_station_id
    if (body.is_active !== undefined) product.is_active = body.is_active
    return HttpResponse.json(toPublicProduct(product))
  }),

  http.get('/api/v1/kitchen/stations', async ({ request }) => {
    await delay(150)
    const caller = requester(request)
    if (!caller) return apiError(401, 'UNAUTHENTICATED', 'Sign in to continue.')
    const ownStores = new Set(
      stores.filter((s) => s.business_id === caller.business_id).map((s) => s.id),
    )
    const data = stations.filter((s) => ownStores.has(s.store_id))
    return HttpResponse.json({ data, total: data.length, page: 1, limit: 50 })
  }),

  ...adminHandlers,
  ...staffHandlers,
  ...tableHandlers,
  ...posHandlers,
  ...posHandlers2,
  ...posHandlers3,
]

export { storeName }
