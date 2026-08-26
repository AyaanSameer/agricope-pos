import { http, HttpResponse, delay } from 'msw'
import type { Role } from '../api/types'
import { attendance, requester, staffMembers, storeName, stores } from './db'
import type { DbStaffMember, DbUser } from './db'

/**
 * Staff = workforce attendance, run by the manager from the Staff page.
 * Distinct from /users: a fry cook who never touches the till is staff, not a
 * login. Check-in/out writes an attendance ledger.
 */

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

function startOfToday(): string {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d.toISOString()
}

function toPublicStaff(s: DbStaffMember) {
  const open = attendance.find((a) => a.staff_id === s.id && a.check_out === null)
  const today = attendance
    .filter((a) => a.staff_id === s.id && a.check_in >= startOfToday())
    .sort((a, b) => b.check_in.localeCompare(a.check_in))
    .map((a) => ({ id: a.id, check_in: a.check_in, check_out: a.check_out }))
  return {
    id: s.id,
    name: s.name,
    role_title: s.role_title,
    store_id: s.store_id,
    store_name: storeName(s.store_id),
    is_active: s.is_active,
    checked_in_at: open?.check_in ?? null,
    today,
  }
}

export const staffHandlers = [
  http.get('/api/v1/staff', async ({ request }) => {
    await delay(200)
    const caller = requireRole(request, ['owner', 'manager'])
    if (caller instanceof Response) return caller
    const url = new URL(request.url)
    const storeId = url.searchParams.get('store_id')
    let data = staffMembers.filter((s) => s.business_id === caller.business_id)
    if (storeId) data = data.filter((s) => s.store_id === storeId || s.store_id === null)
    return HttpResponse.json({
      data: data.map(toPublicStaff),
      total: data.length,
      page: 1,
      limit: 100,
    })
  }),

  http.post('/api/v1/staff', async ({ request }) => {
    await delay(250)
    const caller = requireRole(request, ['owner', 'manager'])
    if (caller instanceof Response) return caller
    const body = (await request.json()) as Partial<DbStaffMember>
    if (!body.name?.trim() || !body.role_title?.trim()) {
      return apiError(400, 'VALIDATION_ERROR', 'Name and role are required.')
    }
    if (body.store_id && !stores.some((s) => s.id === body.store_id && s.business_id === caller.business_id)) {
      return apiError(400, 'VALIDATION_ERROR', 'That branch does not belong to this business.')
    }
    const member: DbStaffMember = {
      id: `stf-${Math.random().toString(36).slice(2, 8)}`,
      business_id: caller.business_id,
      store_id: body.store_id ?? null,
      name: body.name.trim(),
      role_title: body.role_title.trim(),
      is_active: body.is_active ?? true,
    }
    staffMembers.push(member)
    return HttpResponse.json(toPublicStaff(member), { status: 201 })
  }),

  http.patch('/api/v1/staff/:id', async ({ request, params }) => {
    await delay(250)
    const caller = requireRole(request, ['owner', 'manager'])
    if (caller instanceof Response) return caller
    const member = staffMembers.find(
      (s) => s.id === params.id && s.business_id === caller.business_id,
    )
    if (!member) return apiError(404, 'NOT_FOUND', 'No such staff member.')
    const body = (await request.json()) as Partial<DbStaffMember>
    if (body.name !== undefined) member.name = body.name.trim()
    if (body.role_title !== undefined) member.role_title = body.role_title.trim()
    if (body.store_id !== undefined) member.store_id = body.store_id
    if (body.is_active !== undefined) member.is_active = body.is_active
    return HttpResponse.json(toPublicStaff(member))
  }),

  http.post('/api/v1/staff/:id/check-in', async ({ request, params }) => {
    await delay(200)
    const caller = requireRole(request, ['owner', 'manager'])
    if (caller instanceof Response) return caller
    const member = staffMembers.find(
      (s) => s.id === params.id && s.business_id === caller.business_id && s.is_active,
    )
    if (!member) return apiError(404, 'NOT_FOUND', 'No such staff member.')
    if (attendance.some((a) => a.staff_id === member.id && a.check_out === null)) {
      return apiError(409, 'ALREADY_CHECKED_IN', `${member.name} is already checked in.`)
    }
    attendance.push({
      id: `att-${Math.random().toString(36).slice(2, 8)}`,
      staff_id: member.id,
      check_in: new Date().toISOString(),
      check_out: null,
      recorded_by: caller.id,
    })
    return HttpResponse.json(toPublicStaff(member))
  }),

  http.post('/api/v1/staff/:id/check-out', async ({ request, params }) => {
    await delay(200)
    const caller = requireRole(request, ['owner', 'manager'])
    if (caller instanceof Response) return caller
    const member = staffMembers.find(
      (s) => s.id === params.id && s.business_id === caller.business_id,
    )
    if (!member) return apiError(404, 'NOT_FOUND', 'No such staff member.')
    const open = attendance.find((a) => a.staff_id === member.id && a.check_out === null)
    if (!open) return apiError(409, 'NOT_CHECKED_IN', `${member.name} is not checked in.`)
    open.check_out = new Date().toISOString()
    return HttpResponse.json(toPublicStaff(member))
  }),
]
