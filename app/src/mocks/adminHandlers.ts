import { http, HttpResponse, delay } from 'msw'
import {
  admins,
  businesses,
  categories,
  products,
  requesterAdmin,
  serviceChargeRates,
  stores,
  toPublicStore,
  users,
} from './db'
import type { DbBusiness, DbStore, DbUser } from './db'

/**
 * Platform admin — Agricope staff, above every business. Sees them all,
 * creates new ones, adds branches, and hands the first owner login over.
 * Regular business tokens never reach these endpoints.
 */

function apiError(status: number, code: string, message: string) {
  return HttpResponse.json({ error: { code, message } }, { status })
}

function requireAdmin(request: Request) {
  return requesterAdmin(request)
}

function toAdminBusiness(b: DbBusiness) {
  const own = users.filter((u) => u.business_id === b.id)
  return {
    id: b.id,
    name: b.name,
    email: b.email,
    stores: stores.filter((s) => s.business_id === b.id).map(toPublicStore),
    owners: own
      .filter((u) => u.role === 'owner')
      .map((u) => ({ id: u.id, name: u.name, email: u.email, has_pin: u.pin !== null })),
    user_count: own.length,
    product_count: products.filter((p) => p.business_id === b.id).length,
  }
}

export const adminHandlers = [
  http.get('/api/v1/admin/businesses', async ({ request }) => {
    await delay(250)
    if (!requireAdmin(request)) return apiError(401, 'UNAUTHENTICATED', 'Admin sign-in required.')
    const data = businesses.map(toAdminBusiness)
    return HttpResponse.json({ data, total: data.length, page: 1, limit: 50 })
  }),

  http.post('/api/v1/admin/businesses', async ({ request }) => {
    await delay(300)
    if (!requireAdmin(request)) return apiError(401, 'UNAUTHENTICATED', 'Admin sign-in required.')
    const body = (await request.json()) as { name?: string; email?: string; password?: string }
    const name = body.name?.trim()
    const email = body.email?.trim().toLowerCase()
    if (!name || !email || !body.password) {
      return apiError(400, 'VALIDATION_ERROR', 'Name, login email and password are required.')
    }
    if (businesses.some((b) => b.email === email)) {
      return apiError(400, 'VALIDATION_ERROR', 'A business already signs in with that email.')
    }
    const business: DbBusiness = {
      id: `b-${Math.random().toString(36).slice(2, 8)}`,
      name,
      email,
      password: body.password,
    }
    businesses.push(business)
    // Starter category so the new owner's Catalog page is not a dead end.
    categories.push({
      id: `c-${Math.random().toString(36).slice(2, 8)}`,
      business_id: business.id,
      name: 'General',
      sort_order: 1,
    })
    return HttpResponse.json(toAdminBusiness(business), { status: 201 })
  }),

  http.patch('/api/v1/admin/businesses/:id', async ({ request, params }) => {
    await delay(300)
    if (!requireAdmin(request)) return apiError(401, 'UNAUTHENTICATED', 'Admin sign-in required.')
    const business = businesses.find((b) => b.id === params.id)
    if (!business) return apiError(404, 'NOT_FOUND', 'No such business.')
    const body = (await request.json()) as { email?: string; password?: string }
    if (body.email !== undefined) {
      const email = body.email.trim().toLowerCase()
      if (!/^\S+@\S+\.\S+$/.test(email)) {
        return apiError(400, 'VALIDATION_ERROR', 'That does not look like an email address.')
      }
      if (businesses.some((b) => b.email === email && b.id !== business.id)) {
        return apiError(400, 'VALIDATION_ERROR', 'A business already signs in with that email.')
      }
      if (admins.some((a) => a.email === email)) {
        return apiError(400, 'VALIDATION_ERROR', 'That email belongs to a platform administrator.')
      }
      business.email = email
    }
    if (body.password !== undefined) {
      if (body.password.length < 8) {
        return apiError(400, 'VALIDATION_ERROR', 'The password needs at least 8 characters.')
      }
      business.password = body.password
    }
    return HttpResponse.json(toAdminBusiness(business))
  }),

  http.post('/api/v1/admin/businesses/:id/stores', async ({ request, params }) => {
    await delay(300)
    if (!requireAdmin(request)) return apiError(401, 'UNAUTHENTICATED', 'Admin sign-in required.')
    const business = businesses.find((b) => b.id === params.id)
    if (!business) return apiError(404, 'NOT_FOUND', 'No such business.')
    const body = (await request.json()) as {
      name?: string
      type?: 'retail' | 'restaurant'
      address?: string
      phone?: string
    }
    if (!body.name?.trim() || !body.type || !['retail', 'restaurant'].includes(body.type)) {
      return apiError(400, 'VALIDATION_ERROR', 'A branch needs a name and a type (retail or restaurant).')
    }
    const store: DbStore = {
      id: `s-${Math.random().toString(36).slice(2, 8)}`,
      business_id: business.id,
      name: body.name.trim(),
      type: body.type,
      address: body.address?.trim() || null,
      phone: body.phone?.trim() || null,
      is_active: true,
      kitchen_mode: 'kds',
    }
    stores.push(store)
    serviceChargeRates[store.id] = '0'
    return HttpResponse.json(toAdminBusiness(business), { status: 201 })
  }),

  http.post('/api/v1/admin/businesses/:id/owners', async ({ request, params }) => {
    await delay(300)
    if (!requireAdmin(request)) return apiError(401, 'UNAUTHENTICATED', 'Admin sign-in required.')
    const business = businesses.find((b) => b.id === params.id)
    if (!business) return apiError(404, 'NOT_FOUND', 'No such business.')
    const body = (await request.json()) as { name?: string; email?: string; pin?: string }
    if (!body.name?.trim() || !body.email?.trim()) {
      return apiError(400, 'VALIDATION_ERROR', 'The owner needs a name and a contact email.')
    }
    if (body.pin && !/^\d{4}$/.test(body.pin)) {
      return apiError(400, 'VALIDATION_ERROR', 'A till PIN is 4 digits.')
    }
    const own = users.filter((u) => u.business_id === business.id)
    if (own.some((u) => u.email === body.email)) {
      return apiError(400, 'VALIDATION_ERROR', 'That email already belongs to a user of this business.')
    }
    if (body.pin && own.some((u) => u.pin === body.pin)) {
      return apiError(400, 'VALIDATION_ERROR', 'That PIN is already in use in this business.')
    }
    const owner: DbUser = {
      id: `u-${Math.random().toString(36).slice(2, 8)}`,
      name: body.name.trim(),
      email: body.email.trim(),
      role: 'owner',
      business_id: business.id,
      store_id: null,
      pin: body.pin ?? null,
      is_active: true,
    }
    users.push(owner)
    return HttpResponse.json(toAdminBusiness(business), { status: 201 })
  }),

]
