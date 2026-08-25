import { http, HttpResponse, delay } from 'msw'
import type { Role } from '../api/types'
import { categories, products, requester, sessionFor, stations, stores, storeName, toPublicProduct, toUserRecord, users } from './db'
import type { DbProduct } from './db'
import type { DbUser } from './db'

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

export const handlers = [
  http.post('/api/v1/auth/login', async ({ request }) => {
    await delay(400)
    const body = (await request.json()) as { email?: string; password?: string }
    const user = users.find((u) => u.email === body.email && u.is_active)
    if (!user || user.password !== body.password) {
      return apiError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect.')
    }
    return HttpResponse.json(sessionFor(user))
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
    const caller = requester(request)
    if (!caller) return apiError(401, 'UNAUTHENTICATED', 'Sign in to continue.')
    const body = (await request.json()) as { store_id?: string; pin?: string }
    const user = users.find(
      (u) =>
        u.is_active &&
        u.business_id === caller.business_id &&
        u.pin !== null &&
        u.pin === body.pin &&
        (u.store_id === null || u.store_id === body.store_id),
    )
    if (!user) return apiError(401, 'INVALID_PIN', 'That PIN does not match anyone on this till.')
    return HttpResponse.json(sessionFor(user))
  }),

  http.get('/api/v1/stores', async ({ request }) => {
    await delay(250)
    const caller = requester(request)
    if (!caller) return apiError(401, 'UNAUTHENTICATED', 'Sign in to continue.')
    const data = stores.filter((s) => s.is_active)
    return HttpResponse.json({ data, total: data.length, page: 1, limit: 50 })
  }),

  http.get('/api/v1/users', async ({ request }) => {
    await delay(250)
    const caller = requireRole(request, ['owner', 'manager'])
    if (caller instanceof Response) return caller
    const data = users.map(toUserRecord)
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
    if (users.some((u) => u.email === body.email)) {
      return apiError(400, 'VALIDATION_ERROR', 'A user with that email already exists.')
    }
    if (body.pin && users.some((u) => u.pin === body.pin)) {
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
      password: 'demo123',
      is_active: body.is_active ?? true,
    }
    users.push(user)
    return HttpResponse.json(toUserRecord(user), { status: 201 })
  }),

  http.patch('/api/v1/users/:id', async ({ request, params }) => {
    await delay(300)
    const caller = requireRole(request, ['owner', 'manager'])
    if (caller instanceof Response) return caller
    const user = users.find((u) => u.id === params.id)
    if (!user) return apiError(404, 'NOT_FOUND', 'No such user.')
    const body = (await request.json()) as Partial<DbUser> & { pin?: string }
    if (body.pin && users.some((u) => u.pin === body.pin && u.id !== user.id)) {
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

  // ---------- Phase 2: catalog ----------

  http.get('/api/v1/categories', async ({ request }) => {
    await delay(200)
    if (!requester(request)) return apiError(401, 'UNAUTHENTICATED', 'Sign in to continue.')
    const data = [...categories].sort((a, b) => a.sort_order - b.sort_order)
    return HttpResponse.json({ data, total: data.length, page: 1, limit: 100 })
  }),

  http.post('/api/v1/categories', async ({ request }) => {
    await delay(250)
    const caller = requireRole(request, ['owner', 'manager'])
    if (caller instanceof Response) return caller
    const body = (await request.json()) as { name?: string }
    const name = body.name?.trim()
    if (!name) return apiError(400, 'VALIDATION_ERROR', 'Category name is required.')
    if (categories.some((c) => c.name.toLowerCase() === name.toLowerCase())) {
      return apiError(400, 'VALIDATION_ERROR', 'That category already exists.')
    }
    const cat = { id: `c-${Math.random().toString(36).slice(2, 8)}`, name, sort_order: categories.length + 1 }
    categories.push(cat)
    return HttpResponse.json(cat, { status: 201 })
  }),

  http.get('/api/v1/products', async ({ request }) => {
    await delay(250)
    if (!requester(request)) return apiError(401, 'UNAUTHENTICATED', 'Sign in to continue.')
    const url = new URL(request.url)
    const barcode = url.searchParams.get('barcode')
    const search = url.searchParams.get('search')?.toLowerCase()
    const categoryId = url.searchParams.get('category_id')
    const includeInactive = url.searchParams.get('include_inactive') === 'true'
    let data = products.filter((p) => includeInactive || p.is_active)
    if (barcode) data = data.filter((p) => p.barcode === barcode)
    if (categoryId) data = data.filter((p) => p.category_id === categoryId)
    if (search) data = data.filter((p) => p.name.toLowerCase().includes(search))
    return HttpResponse.json({ data: data.map(toPublicProduct), total: data.length, page: 1, limit: 200 })
  }),

  http.post('/api/v1/products', async ({ request }) => {
    await delay(300)
    const caller = requireRole(request, ['owner', 'manager'])
    if (caller instanceof Response) return caller
    const body = (await request.json()) as Partial<DbProduct>
    if (!body.name?.trim() || !body.price) {
      return apiError(400, 'VALIDATION_ERROR', 'Name and price are required.')
    }
    if (!/^\d+(\.\d{1,2})?$/.test(String(body.price))) {
      return apiError(400, 'VALIDATION_ERROR', 'Price must be a decimal string like "4.50".')
    }
    if (body.barcode && products.some((p) => p.barcode === body.barcode)) {
      return apiError(400, 'VALIDATION_ERROR', 'Another product already has that barcode.')
    }
    const product: DbProduct = {
      id: `p-${Math.random().toString(36).slice(2, 8)}`,
      name: body.name.trim(),
      category_id: body.category_id ?? null,
      barcode: body.barcode || null,
      price: String(body.price),
      tax_rate: String(body.tax_rate ?? '0'),
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
    const product = products.find((p) => p.id === params.id)
    if (!product) return apiError(404, 'NOT_FOUND', 'No such product.')
    const body = (await request.json()) as Partial<DbProduct>
    if (body.barcode && products.some((p) => p.barcode === body.barcode && p.id !== product.id)) {
      return apiError(400, 'VALIDATION_ERROR', 'Another product already has that barcode.')
    }
    if (body.price !== undefined && !/^\d+(\.\d{1,2})?$/.test(String(body.price))) {
      return apiError(400, 'VALIDATION_ERROR', 'Price must be a decimal string like "4.50".')
    }
    if (body.name !== undefined) product.name = body.name
    if (body.category_id !== undefined) product.category_id = body.category_id
    if (body.barcode !== undefined) product.barcode = body.barcode || null
    if (body.price !== undefined) product.price = String(body.price)
    if (body.tax_rate !== undefined) product.tax_rate = String(body.tax_rate)
    if (body.kitchen_station_id !== undefined) product.kitchen_station_id = body.kitchen_station_id
    if (body.is_active !== undefined) product.is_active = body.is_active
    return HttpResponse.json(toPublicProduct(product))
  }),

  http.get('/api/v1/kitchen/stations', async ({ request }) => {
    await delay(150)
    if (!requester(request)) return apiError(401, 'UNAUTHENTICATED', 'Sign in to continue.')
    return HttpResponse.json({ data: stations, total: stations.length, page: 1, limit: 50 })
  }),
]

export { storeName }
