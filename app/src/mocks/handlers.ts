import { http, HttpResponse, delay } from 'msw'
import type { Role } from '../api/types'
import { requester, sessionFor, stores, storeName, toUserRecord, users } from './db'
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
]

export { storeName }
