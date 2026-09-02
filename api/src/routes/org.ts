import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { Ctx } from '../app.js'
import { PIN_RE, hashPin, requireBusiness, requireRole } from '../auth.js'
import { many, one } from '../db.js'
import type { Queryable } from '../db.js'
import { conflict, invalid, notFound } from '../errors.js'
import { paginated, rate, storeOut, userRecordOut } from '../serialize.js'
import type { StoreRow, UserRow } from '../serialize.js'

/**
 * The business's own house: its branches and settings, the logins on its
 * tills, and the workforce it clocks in and out. Owners and managers only —
 * the till itself never reaches these.
 */

const ROLES = ['owner', 'manager', 'cashier', 'waiter'] as const

const USER_SELECT = `select u.*, s.name as store_name from users u left join stores s on s.id = u.store_id`

interface StaffRow {
  id: string
  name: string
  role_title: string
  store_id: string | null
  store_name: string | null
  is_active: boolean
  checked_in_at: string | null
  today: { id: string; check_in: string; check_out: string | null }[]
}

async function loadStaff(db: Queryable, tz: string, businessId: string, filter: { storeId?: string; id?: string }) {
  const params: unknown[] = [businessId, tz]
  const where = ['s.business_id = $1']
  if (filter.storeId) {
    params.push(filter.storeId)
    where.push(`(s.store_id = $${params.length} or s.store_id is null)`)
  }
  if (filter.id) {
    params.push(filter.id)
    where.push(`s.id = $${params.length}`)
  }
  return many<StaffRow>(
    `select s.id, s.name, s.role_title, s.store_id, s.is_active, st.name as store_name,
            (select a.check_in from attendance a where a.staff_id = s.id and a.check_out is null order by a.check_in desc limit 1) as checked_in_at,
            coalesce((select json_agg(json_build_object('id', a.id, 'check_in', a.check_in, 'check_out', a.check_out) order by a.check_in desc)
                        from attendance a
                       where a.staff_id = s.id
                         and a.check_in >= (date_trunc('day', now() at time zone $2) at time zone $2)), '[]'::json) as today
       from staff_members s left join stores st on st.id = s.store_id
      where ${where.join(' and ')}
      order by s.name`,
    params,
    db,
  )
}

function staffOut(s: StaffRow) {
  return {
    id: s.id,
    name: s.name,
    role_title: s.role_title,
    store_id: s.store_id,
    store_name: s.store_name,
    is_active: s.is_active,
    checked_in_at: s.checked_in_at,
    today: s.today,
  }
}

export async function orgRoutes(app: FastifyInstance, ctx: Ctx) {
  const staffOne = async (businessId: string, id: string) => {
    const [row] = await loadStaff(ctx.db, ctx.config.BUSINESS_TZ, businessId, { id })
    if (!row) throw notFound('staff member')
    return staffOut(row)
  }

  // ---------- branches ----------

  app.get('/stores', async (req) => {
    const business = await requireBusiness(ctx, req)
    const rows = await many<StoreRow>('select * from stores where business_id = $1 and is_active order by store_number', [business.id])
    return paginated(rows.map(storeOut), 50)
  })

  app.patch('/stores/:id', async (req) => {
    const caller = await requireRole(ctx, req, ['owner', 'manager'])
    const { id } = req.params as { id: string }
    const store = await one<StoreRow>('select * from stores where id = $1 and business_id = $2', [id, caller.business_id])
    if (!store) throw notFound('branch')
    const body = z
      .object({
        kitchen_mode: z.string().optional(),
        name: z.string().optional(),
        address: z.string().optional(),
        phone: z.string().optional(),
        service_charge_rate: z.string().optional(),
      })
      .parse(req.body)
    if (body.kitchen_mode !== undefined) {
      if (!['kds', 'printer'].includes(body.kitchen_mode)) throw invalid('kitchen_mode must be "kds" or "printer".')
      await ctx.db.query('update stores set kitchen_mode = $2 where id = $1', [store.id, body.kitchen_mode])
    }
    if (body.name !== undefined) {
      if (!body.name.trim()) throw invalid('The branch needs a name.')
      await ctx.db.query('update stores set name = $2 where id = $1', [store.id, body.name.trim()])
    }
    if (body.address !== undefined) await ctx.db.query('update stores set address = $2 where id = $1', [store.id, body.address.trim() || null])
    if (body.phone !== undefined) await ctx.db.query('update stores set phone = $2 where id = $1', [store.id, body.phone.trim() || null])
    if (body.service_charge_rate !== undefined) {
      const n = Number(body.service_charge_rate)
      if (!Number.isFinite(n) || n < 0 || n > 25) throw invalid('Service charge must be between 0 and 25%.')
      // Open tabs pick this up on their next recalculation; closed orders keep their snapshot.
      await ctx.db.query('update stores set service_charge_rate = $2 where id = $1', [store.id, n])
    }
    return storeOut((await one<StoreRow>('select * from stores where id = $1', [store.id]))!)
  })

  // ---------- business-wide settings ----------

  const settings = async (businessId: string) => {
    const row = await one<{ name: string; receipt_footer: string; discount_approval_percent: string }>(
      'select name, receipt_footer, discount_approval_percent from businesses where id = $1',
      [businessId],
    )
    return {
      business_name: row?.name ?? '',
      receipt_footer: row?.receipt_footer ?? '',
      discount_approval_percent: rate(row?.discount_approval_percent ?? 0),
    }
  }

  app.get('/business-settings', async (req) => {
    const caller = await requireRole(ctx, req, ['owner', 'manager'])
    return settings(caller.business_id)
  })

  app.patch('/business-settings', async (req) => {
    const caller = await requireRole(ctx, req, ['owner', 'manager'])
    const body = z.object({ receipt_footer: z.string().optional(), discount_approval_percent: z.string().optional() }).parse(req.body)
    if (body.receipt_footer !== undefined) {
      await ctx.db.query('update businesses set receipt_footer = $2 where id = $1', [caller.business_id, body.receipt_footer.trim()])
    }
    if (body.discount_approval_percent !== undefined) {
      const n = Number(body.discount_approval_percent)
      if (!Number.isFinite(n) || n < 0 || n > 100) throw invalid('The approval threshold is a percent, 0–100.')
      await ctx.db.query('update businesses set discount_approval_percent = $2 where id = $1', [caller.business_id, n])
    }
    return settings(caller.business_id)
  })

  // ---------- logins ----------

  app.get('/users', async (req) => {
    const caller = await requireRole(ctx, req, ['owner', 'manager'])
    const rows = await many<UserRow>(`${USER_SELECT} where u.business_id = $1 order by u.created_at, u.name`, [caller.business_id])
    return paginated(rows.map(userRecordOut), 50)
  })

  app.post('/users', async (req, reply) => {
    const caller = await requireRole(ctx, req, ['owner', 'manager'])
    const body = z
      .object({
        name: z.string().optional(),
        email: z.string().optional(),
        role: z.string().optional(),
        store_id: z.string().nullable().optional(),
        pin: z.string().optional(),
        is_active: z.boolean().optional(),
      })
      .parse(req.body)
    if (!body.name || !body.email || !body.role) throw invalid('Name, email and role are required.')
    if (!(ROLES as readonly string[]).includes(body.role)) throw invalid('Unknown role.')
    if (body.pin && !PIN_RE.test(body.pin)) throw invalid('A till PIN is 4 digits.')
    if (await one('select 1 from users where business_id = $1 and email = $2', [caller.business_id, body.email])) {
      throw invalid('A user with that email already exists.')
    }
    if (body.store_id && !(await one('select 1 from stores where id = $1 and business_id = $2', [body.store_id, caller.business_id]))) {
      throw invalid('That branch does not belong to this business.')
    }
    const pinHash = body.pin ? hashPin(ctx.config.PIN_PEPPER, caller.business_id, body.pin) : null
    if (pinHash && (await one('select 1 from users where business_id = $1 and pin_hash = $2', [caller.business_id, pinHash]))) {
      throw invalid('That PIN is already in use — pick another.')
    }
    const created = await one<{ id: string }>(
      `insert into users (business_id, store_id, name, email, role, pin_hash, is_active) values ($1, $2, $3, $4, $5, $6, $7) returning id`,
      [caller.business_id, body.store_id ?? null, body.name, body.email, body.role, pinHash, body.is_active ?? true],
    )
    const row = await one<UserRow>(`${USER_SELECT} where u.id = $1`, [created!.id])
    return reply.status(201).send(userRecordOut(row!))
  })

  app.patch('/users/:id', async (req) => {
    const caller = await requireRole(ctx, req, ['owner', 'manager'])
    const { id } = req.params as { id: string }
    const user = await one<UserRow>(`${USER_SELECT} where u.id = $1 and u.business_id = $2`, [id, caller.business_id])
    if (!user) throw notFound('user')
    const body = z
      .object({
        name: z.string().optional(),
        email: z.string().optional(),
        role: z.string().optional(),
        store_id: z.string().nullable().optional(),
        pin: z.string().optional(),
        is_active: z.boolean().optional(),
      })
      .parse(req.body)
    if (body.pin) {
      if (!PIN_RE.test(body.pin)) throw invalid('A till PIN is 4 digits.')
      const pinHash = hashPin(ctx.config.PIN_PEPPER, caller.business_id, body.pin)
      if (await one('select 1 from users where business_id = $1 and pin_hash = $2 and id <> $3', [caller.business_id, pinHash, user.id])) {
        throw invalid('That PIN is already in use — pick another.')
      }
      await ctx.db.query('update users set pin_hash = $2 where id = $1', [user.id, pinHash])
    }
    if (body.role !== undefined && !(ROLES as readonly string[]).includes(body.role)) throw invalid('Unknown role.')
    if (body.name !== undefined) await ctx.db.query('update users set name = $2 where id = $1', [user.id, body.name])
    if (body.email !== undefined) await ctx.db.query('update users set email = $2 where id = $1', [user.id, body.email])
    if (body.role !== undefined) await ctx.db.query('update users set role = $2 where id = $1', [user.id, body.role])
    if (body.store_id !== undefined) await ctx.db.query('update users set store_id = $2 where id = $1', [user.id, body.store_id])
    if (body.is_active !== undefined) await ctx.db.query('update users set is_active = $2 where id = $1', [user.id, body.is_active])
    return userRecordOut((await one<UserRow>(`${USER_SELECT} where u.id = $1`, [user.id]))!)
  })

  app.delete('/users/:id', async (req, reply) => {
    const caller = await requireRole(ctx, req, ['owner'])
    const { id } = req.params as { id: string }
    const user = await one<{ id: string; is_active: boolean }>(
      'select id, is_active from users where id = $1 and business_id = $2',
      [id, caller.business_id],
    )
    if (!user) throw notFound('user')
    if (user.id === caller.id) throw invalid('You cannot delete your own account.')
    // Deactivate first, delete second: switching a login off is reversible and
    // is the step that proves the person is really gone from the rota.
    if (user.is_active) throw conflict('STILL_ACTIVE', 'Deactivate this login before deleting it.')
    await ctx.db.query('delete from users where id = $1', [user.id])
    return reply.status(204).send()
  })

  // ---------- staff: workforce attendance, distinct from till logins ----------

  app.get('/staff', async (req) => {
    const caller = await requireRole(ctx, req, ['owner', 'manager'])
    const q = z.object({ store_id: z.string().optional() }).parse(req.query)
    const rows = await loadStaff(ctx.db, ctx.config.BUSINESS_TZ, caller.business_id, { storeId: q.store_id })
    return paginated(rows.map(staffOut), 100)
  })

  app.post('/staff', async (req, reply) => {
    const caller = await requireRole(ctx, req, ['owner', 'manager'])
    const body = z
      .object({
        name: z.string().optional(),
        role_title: z.string().optional(),
        store_id: z.string().nullable().optional(),
        is_active: z.boolean().optional(),
      })
      .parse(req.body)
    if (!body.name?.trim() || !body.role_title?.trim()) throw invalid('Name and role are required.')
    if (body.store_id && !(await one('select 1 from stores where id = $1 and business_id = $2', [body.store_id, caller.business_id]))) {
      throw invalid('That branch does not belong to this business.')
    }
    const created = await one<{ id: string }>(
      `insert into staff_members (business_id, store_id, name, role_title, is_active) values ($1, $2, $3, $4, $5) returning id`,
      [caller.business_id, body.store_id ?? null, body.name.trim(), body.role_title.trim(), body.is_active ?? true],
    )
    return reply.status(201).send(await staffOne(caller.business_id, created!.id))
  })

  app.patch('/staff/:id', async (req) => {
    const caller = await requireRole(ctx, req, ['owner', 'manager'])
    const { id } = req.params as { id: string }
    const member = await one<{ id: string }>('select id from staff_members where id = $1 and business_id = $2', [id, caller.business_id])
    if (!member) throw notFound('staff member')
    const body = z
      .object({
        name: z.string().optional(),
        role_title: z.string().optional(),
        store_id: z.string().nullable().optional(),
        is_active: z.boolean().optional(),
      })
      .parse(req.body)
    if (body.name !== undefined) await ctx.db.query('update staff_members set name = $2 where id = $1', [member.id, body.name.trim()])
    if (body.role_title !== undefined) await ctx.db.query('update staff_members set role_title = $2 where id = $1', [member.id, body.role_title.trim()])
    if (body.store_id !== undefined) await ctx.db.query('update staff_members set store_id = $2 where id = $1', [member.id, body.store_id])
    if (body.is_active !== undefined) await ctx.db.query('update staff_members set is_active = $2 where id = $1', [member.id, body.is_active])
    return staffOne(caller.business_id, member.id)
  })

  app.post('/staff/:id/check-in', async (req) => {
    const caller = await requireRole(ctx, req, ['owner', 'manager'])
    const { id } = req.params as { id: string }
    const member = await one<{ id: string; name: string }>(
      'select id, name from staff_members where id = $1 and business_id = $2 and is_active',
      [id, caller.business_id],
    )
    if (!member) throw notFound('staff member')
    if (await one('select 1 from attendance where staff_id = $1 and check_out is null', [member.id])) {
      throw conflict('ALREADY_CHECKED_IN', `${member.name} is already checked in.`)
    }
    await ctx.db.query('insert into attendance (staff_id, recorded_by) values ($1, $2)', [member.id, caller.id])
    return staffOne(caller.business_id, member.id)
  })

  app.post('/staff/:id/check-out', async (req) => {
    const caller = await requireRole(ctx, req, ['owner', 'manager'])
    const { id } = req.params as { id: string }
    const member = await one<{ id: string; name: string }>(
      'select id, name from staff_members where id = $1 and business_id = $2',
      [id, caller.business_id],
    )
    if (!member) throw notFound('staff member')
    const open = await one<{ id: string }>('select id from attendance where staff_id = $1 and check_out is null', [member.id])
    if (!open) throw conflict('NOT_CHECKED_IN', `${member.name} is not checked in.`)
    await ctx.db.query('update attendance set check_out = now() where id = $1', [open.id])
    return staffOne(caller.business_id, member.id)
  })

  // Staff follow the same two-step rule. Attendance rows go with the person —
  // they are a rota record, not a financial one.
  app.delete('/staff/:id', async (req, reply) => {
    const caller = await requireRole(ctx, req, ['owner'])
    const { id } = req.params as { id: string }
    const member = await one<{ id: string; is_active: boolean }>(
      'select id, is_active from staff_members where id = $1 and business_id = $2',
      [id, caller.business_id],
    )
    if (!member) throw notFound('staff member')
    if (member.is_active) throw conflict('STILL_ACTIVE', 'Deactivate this staff member before deleting them.')
    await ctx.db.query('delete from staff_members where id = $1', [member.id])
    return reply.status(204).send()
  })
}
