import { http, HttpResponse, delay } from 'msw'
import {
  admins,
  attendance,
  businesses,
  categories,
  products,
  requesterAdmin,
  serviceChargeRates,
  staffMembers,
  stations,
  stores,
  toPublicStore,
  users,
} from './db'
import type { DbBusiness, DbStore, DbUser } from './db'
import { cashMovements, customers, ledger, orders, shifts, tables, tickets } from './posdb'
import { apiError } from './http'

/** Drop every element the predicate matches, in place. */
function purge<T>(list: T[], doomed: (item: T) => boolean) {
  for (let i = list.length - 1; i >= 0; i--) if (doomed(list[i])) list.splice(i, 1)
}

/**
 * Platform admin — Agricope staff, above every business. Sees them all,
 * creates new ones, adds branches, and hands the first owner login over.
 * Regular business tokens never reach these endpoints.
 */


function requireAdmin(request: Request) {
  return requesterAdmin(request)
}

function toAdminBusiness(b: DbBusiness) {
  const own = users.filter((u) => u.business_id === b.id)
  const ownStores = stores.filter((s) => s.business_id === b.id).map((s) => s.id)
  return {
    id: b.id,
    name: b.name,
    email: b.email,
    is_active: b.is_active,
    /** Financial history blocks a branch delete — the console says so up front. */
    order_count: orders.filter((o) => ownStores.includes(o.store_id)).length,
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
      is_active: true,
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
    const body = (await request.json()) as {
      email?: string
      password?: string
      is_active?: boolean
    }
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
    if (body.is_active !== undefined) business.is_active = body.is_active
    return HttpResponse.json(toAdminBusiness(business))
  }),

  /**
   * Removing a whole tenant. Deactivation has to come first — it is reversible,
   * it stops the tills immediately, and it makes this irreversible step a
   * deliberate second decision rather than one mis-click.
   */
  http.delete('/api/v1/admin/businesses/:id', async ({ request, params }) => {
    await delay(400)
    if (!requireAdmin(request)) return apiError(401, 'UNAUTHENTICATED', 'Admin sign-in required.')
    const idx = businesses.findIndex((b) => b.id === params.id)
    if (idx === -1) return apiError(404, 'NOT_FOUND', 'No such business.')
    const business = businesses[idx]
    if (business.is_active) {
      return apiError(409, 'STILL_ACTIVE', 'Deactivate this business before deleting it.')
    }
    const ownStores = stores.filter((s) => s.business_id === business.id).map((s) => s.id)
    const ownStaff = staffMembers.filter((s) => s.business_id === business.id).map((s) => s.id)
    const ownOrders = orders.filter((o) => ownStores.includes(o.store_id)).map((o) => o.id)
    const ownCustomers = customers.filter((c) => c.business_id === business.id).map((c) => c.id)
    const ownStations = stations.filter((s) => ownStores.includes(s.store_id)).map((s) => s.id)

    purge(tickets, (t) => ownStations.includes(t.station_id))
    purge(ledger, (l) => ownCustomers.includes(l.customer_id))
    purge(customers, (c) => c.business_id === business.id)
    purge(cashMovements, (m) => shifts.some((sh) => sh.id === m.shift_id && ownStores.includes(sh.store_id)))
    purge(shifts, (sh) => ownStores.includes(sh.store_id))
    purge(orders, (o) => ownOrders.includes(o.id))
    purge(tables, (t) => ownStores.includes(t.store_id))
    purge(stations, (s) => ownStores.includes(s.store_id))
    purge(attendance, (a) => ownStaff.includes(a.staff_id))
    purge(staffMembers, (s) => s.business_id === business.id)
    purge(products, (p) => p.business_id === business.id)
    purge(categories, (c) => c.business_id === business.id)
    purge(users, (u) => u.business_id === business.id)
    for (const id of ownStores) delete serviceChargeRates[id]
    purge(stores, (s) => s.business_id === business.id)
    businesses.splice(idx, 1)
    return new HttpResponse(null, { status: 204 })
  }),

  /** Branch settings from the console — deactivating is what this is for. */
  http.patch('/api/v1/admin/businesses/:id/stores/:storeId', async ({ request, params }) => {
    await delay(300)
    if (!requireAdmin(request)) return apiError(401, 'UNAUTHENTICATED', 'Admin sign-in required.')
    const business = businesses.find((b) => b.id === params.id)
    if (!business) return apiError(404, 'NOT_FOUND', 'No such business.')
    const store = stores.find((s) => s.id === params.storeId && s.business_id === business.id)
    if (!store) return apiError(404, 'NOT_FOUND', 'No such branch.')
    const body = (await request.json()) as { is_active?: boolean; name?: string; address?: string }
    if (body.name !== undefined) store.name = body.name.trim()
    if (body.address !== undefined) store.address = body.address.trim() || null
    if (body.is_active !== undefined) store.is_active = body.is_active
    return HttpResponse.json(toAdminBusiness(business))
  }),

  /**
   * A branch that ever sold anything keeps its history, so it can be switched
   * off but never deleted — removing it would orphan orders that still belong
   * to a live business. An unused branch is free to go.
   */
  http.delete('/api/v1/admin/businesses/:id/stores/:storeId', async ({ request, params }) => {
    await delay(350)
    if (!requireAdmin(request)) return apiError(401, 'UNAUTHENTICATED', 'Admin sign-in required.')
    const business = businesses.find((b) => b.id === params.id)
    if (!business) return apiError(404, 'NOT_FOUND', 'No such business.')
    const idx = stores.findIndex((s) => s.id === params.storeId && s.business_id === business.id)
    if (idx === -1) return apiError(404, 'NOT_FOUND', 'No such branch.')
    const store = stores[idx]
    if (store.is_active) {
      return apiError(409, 'STILL_ACTIVE', 'Deactivate this branch before deleting it.')
    }
    const sold = orders.filter((o) => o.store_id === store.id).length
    if (sold > 0) {
      return apiError(
        409,
        'HAS_HISTORY',
        `${store.name} has ${sold} order${sold === 1 ? '' : 's'} on record and cannot be deleted. It stays deactivated so its history survives.`,
      )
    }
    const ownStations = stations.filter((s) => s.store_id === store.id).map((s) => s.id)
    purge(tickets, (t) => ownStations.includes(t.station_id))
    purge(stations, (s) => s.store_id === store.id)
    purge(tables, (t) => t.store_id === store.id)
    purge(shifts, (sh) => sh.store_id === store.id)
    // People posted only to this branch lose their posting, not their login.
    for (const u of users) if (u.store_id === store.id) u.store_id = null
    for (const s of staffMembers) if (s.store_id === store.id) s.store_id = null
    delete serviceChargeRates[store.id]
    stores.splice(idx, 1)
    return HttpResponse.json(toAdminBusiness(business))
  }),

  /** The platform administrator's own sign-in password. */
  http.post('/api/v1/admin/change-password', async ({ request }) => {
    await delay(350)
    const admin = requireAdmin(request)
    if (!admin) return apiError(401, 'UNAUTHENTICATED', 'Admin sign-in required.')
    const body = (await request.json()) as { current_password?: string; new_password?: string }
    if (body.current_password !== admin.password) {
      return apiError(401, 'INVALID_CREDENTIALS', 'The current password is not right.')
    }
    if (!body.new_password || body.new_password.length < 8) {
      return apiError(400, 'VALIDATION_ERROR', 'The new password needs at least 8 characters.')
    }
    admin.password = body.new_password
    return new HttpResponse(null, { status: 204 })
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
