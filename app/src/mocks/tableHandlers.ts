import { http, HttpResponse, delay } from 'msw'
import { requester, storeBusinessId, stores } from './db'
import type { DbUser } from './db'
import { orders, tables } from './posdb'
import type { DbTable } from './posdb'

/**
 * Table administration — the OWNER's floor plan. Managers and cashiers seat
 * guests on the floor; only the owner reshapes it.
 */

function apiError(status: number, code: string, message: string) {
  return HttpResponse.json({ error: { code, message } }, { status })
}

function requireOwner(request: Request): DbUser | Response {
  const user = requester(request)
  if (!user) return apiError(401, 'UNAUTHENTICATED', 'Sign in to continue.')
  if (user.role !== 'owner') {
    return apiError(403, 'FORBIDDEN', 'Only the owner can change table details.')
  }
  return user
}

function findOwn(id: string | readonly string[], caller: DbUser): DbTable | undefined {
  return tables.find(
    (t) => t.id === id && storeBusinessId(t.store_id) === caller.business_id,
  )
}

export const tableHandlers = [
  http.post('/api/v1/tables', async ({ request }) => {
    await delay(250)
    const caller = requireOwner(request)
    if (caller instanceof Response) return caller
    const body = (await request.json()) as Partial<DbTable>
    if (
      !body.store_id ||
      !stores.some((s) => s.id === body.store_id && s.business_id === caller.business_id)
    ) {
      return apiError(400, 'VALIDATION_ERROR', 'A valid branch is required.')
    }
    const name = body.name?.trim()
    if (!name) return apiError(400, 'VALIDATION_ERROR', 'The table needs a name (e.g. T5).')
    if (tables.some((t) => t.store_id === body.store_id && t.name.toLowerCase() === name.toLowerCase())) {
      return apiError(400, 'VALIDATION_ERROR', 'That branch already has a table with this name.')
    }
    if (!(Number(body.seats) > 0)) {
      return apiError(400, 'VALIDATION_ERROR', 'Seats must be at least 1.')
    }
    const table: DbTable = {
      id: `t-${Math.random().toString(36).slice(2, 8)}`,
      store_id: body.store_id,
      name,
      zone: body.zone?.trim() || 'Main hall',
      seats: Number(body.seats),
      is_active: body.is_active ?? true,
    }
    tables.push(table)
    return HttpResponse.json(table, { status: 201 })
  }),

  http.patch('/api/v1/tables/:id', async ({ request, params }) => {
    await delay(250)
    const caller = requireOwner(request)
    if (caller instanceof Response) return caller
    const table = findOwn(params.id as string, caller)
    if (!table) return apiError(404, 'NOT_FOUND', 'No such table.')
    const body = (await request.json()) as Partial<DbTable>
    if (body.name !== undefined) {
      const name = body.name.trim()
      if (!name) return apiError(400, 'VALIDATION_ERROR', 'The table needs a name.')
      if (
        tables.some(
          (t) => t.store_id === table.store_id && t.id !== table.id && t.name.toLowerCase() === name.toLowerCase(),
        )
      ) {
        return apiError(400, 'VALIDATION_ERROR', 'That branch already has a table with this name.')
      }
      table.name = name
    }
    if (body.zone !== undefined) table.zone = body.zone.trim() || 'Main hall'
    if (body.seats !== undefined) {
      if (!(Number(body.seats) > 0)) return apiError(400, 'VALIDATION_ERROR', 'Seats must be at least 1.')
      table.seats = Number(body.seats)
    }
    if (body.is_active !== undefined) table.is_active = body.is_active
    return HttpResponse.json(table)
  }),

  http.delete('/api/v1/tables/:id', async ({ request, params }) => {
    await delay(250)
    const caller = requireOwner(request)
    if (caller instanceof Response) return caller
    const table = findOwn(params.id as string, caller)
    if (!table) return apiError(404, 'NOT_FOUND', 'No such table.')
    if (orders.some((o) => o.status === 'open' && o.table_id === table.id)) {
      return apiError(409, 'TABLE_OCCUPIED', 'Close its open tab before deleting this table.')
    }
    tables.splice(tables.indexOf(table), 1)
    return new HttpResponse(null, { status: 204 })
  }),
]
