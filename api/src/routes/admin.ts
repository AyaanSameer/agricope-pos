import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { Ctx } from '../app.js'
import { PIN_RE, hashPassword, hashPin, requireAdmin, verifyPassword } from '../auth.js'
import { many, one, withTx } from '../db.js'
import type { Queryable } from '../db.js'
import { ApiError, conflict, invalid, notFound } from '../errors.js'
import { paginated, storeOut } from '../serialize.js'
import type { StoreRow } from '../serialize.js'

/**
 * The Agricope console — platform staff, above every business. Onboards
 * tenants, adds their branches, hands the first owner login over, and
 * switches a tenant off (reversibly) before it can ever be deleted.
 */

interface BusinessRow {
  id: string
  name: string
  email: string
  is_active: boolean
}

const EMAIL_RE = /^\S+@\S+\.\S+$/

async function loadBusiness(db: Queryable, id: string): Promise<BusinessRow> {
  const b = await one<BusinessRow>('select id, name, email, is_active from businesses where id = $1', [id], db)
  if (!b) throw notFound('business')
  return b
}

async function adminBusiness(db: Queryable, b: BusinessRow) {
  const stores = await many<StoreRow>('select * from stores where business_id = $1 order by store_number', [b.id], db)
  const owners = await many<{ id: string; name: string; email: string; has_pin: boolean }>(
    `select id, name, email, (pin_hash is not null) as has_pin from users
      where business_id = $1 and role = 'owner' order by created_at, name`,
    [b.id],
    db,
  )
  const counts = await one<{ user_count: number; product_count: number; order_count: number }>(
    `select (select count(*) from users where business_id = $1)::int as user_count,
            (select count(*) from products where business_id = $1)::int as product_count,
            (select count(*) from orders o join stores s on s.id = o.store_id where s.business_id = $1)::int as order_count`,
    [b.id],
    db,
  )
  return {
    id: b.id,
    name: b.name,
    email: b.email,
    is_active: b.is_active,
    order_count: counts?.order_count ?? 0,
    stores: stores.map(storeOut),
    owners,
    user_count: counts?.user_count ?? 0,
    product_count: counts?.product_count ?? 0,
  }
}

export async function adminRoutes(app: FastifyInstance, ctx: Ctx) {
  app.get('/admin/businesses', async (req) => {
    await requireAdmin(ctx, req)
    const rows = await many<BusinessRow>('select id, name, email, is_active from businesses order by created_at, name')
    const data = []
    for (const b of rows) data.push(await adminBusiness(ctx.db, b))
    return paginated(data, 50)
  })

  app.post('/admin/businesses', async (req, reply) => {
    await requireAdmin(ctx, req)
    const body = z
      .object({ name: z.string().optional(), email: z.string().optional(), password: z.string().optional() })
      .parse(req.body)
    const name = body.name?.trim()
    const email = body.email?.trim().toLowerCase()
    if (!name || !email || !body.password) throw invalid('Name, login email and password are required.')
    if (!EMAIL_RE.test(email)) throw invalid('That does not look like an email address.')
    if (body.password.length < 8) throw invalid('The password needs at least 8 characters.')
    const taken = await one('select 1 from businesses where email = $1 union select 1 from platform_admins where email = $1', [email])
    if (taken) throw invalid('A business already signs in with that email.')
    const business = await withTx(async (tx) => {
      const b = await one<BusinessRow>(
        `insert into businesses (name, email, password_hash) values ($1, $2, $3) returning id, name, email, is_active`,
        [name, email, await hashPassword(body.password!)],
        tx,
      )
      // Starter category so the new owner's Catalog page is not a dead end.
      await tx.query(`insert into categories (business_id, name, sort_order) values ($1, 'General', 1)`, [b!.id])
      return b!
    })
    return reply.status(201).send(await adminBusiness(ctx.db, business))
  })

  app.patch('/admin/businesses/:id', async (req) => {
    await requireAdmin(ctx, req)
    const { id } = req.params as { id: string }
    const business = await loadBusiness(ctx.db, id)
    const body = z
      .object({ email: z.string().optional(), password: z.string().optional(), is_active: z.boolean().optional() })
      .parse(req.body)
    if (body.email !== undefined) {
      const email = body.email.trim().toLowerCase()
      if (!EMAIL_RE.test(email)) throw invalid('That does not look like an email address.')
      if (await one('select 1 from businesses where email = $1 and id <> $2', [email, business.id])) {
        throw invalid('A business already signs in with that email.')
      }
      if (await one('select 1 from platform_admins where email = $1', [email])) {
        throw invalid('That email belongs to a platform administrator.')
      }
      await ctx.db.query('update businesses set email = $2 where id = $1', [business.id, email])
    }
    if (body.password !== undefined) {
      if (body.password.length < 8) throw invalid('The password needs at least 8 characters.')
      await ctx.db.query('update businesses set password_hash = $2 where id = $1', [business.id, await hashPassword(body.password)])
    }
    if (body.is_active !== undefined) {
      await ctx.db.query('update businesses set is_active = $2 where id = $1', [business.id, body.is_active])
    }
    return adminBusiness(ctx.db, await loadBusiness(ctx.db, id))
  })

  /**
   * Removing a whole tenant. Deactivation has to come first — it is reversible,
   * it stops the tills immediately, and it makes this irreversible step a
   * deliberate second decision rather than one mis-click.
   */
  app.delete('/admin/businesses/:id', async (req, reply) => {
    await requireAdmin(ctx, req)
    const { id } = req.params as { id: string }
    const business = await loadBusiness(ctx.db, id)
    if (business.is_active) throw conflict('STILL_ACTIVE', 'Deactivate this business before deleting it.')
    await withTx(async (tx) => {
      // orders RESTRICT on their branch: clear them on purpose, then let the rest cascade.
      await tx.query('delete from orders where store_id in (select id from stores where business_id = $1)', [business.id])
      await tx.query('delete from businesses where id = $1', [business.id])
    })
    return reply.status(204).send()
  })

  app.post('/admin/businesses/:id/stores', async (req, reply) => {
    await requireAdmin(ctx, req)
    const { id } = req.params as { id: string }
    const business = await loadBusiness(ctx.db, id)
    const body = z
      .object({
        name: z.string().optional(),
        type: z.string().optional(),
        address: z.string().optional(),
        phone: z.string().optional(),
      })
      .parse(req.body)
    if (!body.name?.trim() || !body.type || !['retail', 'restaurant'].includes(body.type)) {
      throw invalid('A branch needs a name and a type (retail or restaurant).')
    }
    await withTx(async (tx) => {
      const next = await one<{ n: number }>(
        'select coalesce(max(store_number), 0) + 1 as n from stores where business_id = $1',
        [business.id],
        tx,
      )
      await tx.query(
        `insert into stores (business_id, store_number, name, type, address, phone, kitchen_mode, service_charge_rate)
         values ($1, $2, $3, $4, $5, $6, 'kds', 0)`,
        [business.id, next!.n, body.name!.trim(), body.type, body.address?.trim() || null, body.phone?.trim() || null],
      )
    })
    return reply.status(201).send(await adminBusiness(ctx.db, business))
  })

  /** Branch settings from the console — deactivating is what this is for. */
  app.patch('/admin/businesses/:id/stores/:storeId', async (req) => {
    await requireAdmin(ctx, req)
    const { id, storeId } = req.params as { id: string; storeId: string }
    const business = await loadBusiness(ctx.db, id)
    const store = await one<{ id: string }>('select id from stores where id = $1 and business_id = $2', [storeId, business.id])
    if (!store) throw notFound('branch')
    const body = z
      .object({ is_active: z.boolean().optional(), name: z.string().optional(), address: z.string().optional() })
      .parse(req.body)
    if (body.name !== undefined) await ctx.db.query('update stores set name = $2 where id = $1', [store.id, body.name.trim()])
    if (body.address !== undefined) await ctx.db.query('update stores set address = $2 where id = $1', [store.id, body.address.trim() || null])
    if (body.is_active !== undefined) await ctx.db.query('update stores set is_active = $2 where id = $1', [store.id, body.is_active])
    return adminBusiness(ctx.db, business)
  })

  /**
   * A branch that ever sold anything keeps its history, so it can be switched
   * off but never deleted — removing it would orphan orders that still belong
   * to a live business. An unused branch is free to go.
   */
  app.delete('/admin/businesses/:id/stores/:storeId', async (req) => {
    await requireAdmin(ctx, req)
    const { id, storeId } = req.params as { id: string; storeId: string }
    const business = await loadBusiness(ctx.db, id)
    const store = await one<{ id: string; name: string; is_active: boolean }>(
      'select id, name, is_active from stores where id = $1 and business_id = $2',
      [storeId, business.id],
    )
    if (!store) throw notFound('branch')
    if (store.is_active) throw conflict('STILL_ACTIVE', 'Deactivate this branch before deleting it.')
    const sold = await one<{ n: number }>('select count(*)::int as n from orders where store_id = $1', [store.id])
    if (sold && sold.n > 0) {
      throw conflict(
        'HAS_HISTORY',
        `${store.name} has ${sold.n} order${sold.n === 1 ? '' : 's'} on record and cannot be deleted. It stays deactivated so its history survives.`,
      )
    }
    // Stations, tables, shifts and counters cascade; people posted here lose the posting, not the login.
    await ctx.db.query('delete from stores where id = $1', [store.id])
    return adminBusiness(ctx.db, business)
  })

  app.post('/admin/businesses/:id/owners', async (req, reply) => {
    await requireAdmin(ctx, req)
    const { id } = req.params as { id: string }
    const business = await loadBusiness(ctx.db, id)
    const body = z.object({ name: z.string().optional(), email: z.string().optional(), pin: z.string().optional() }).parse(req.body)
    if (!body.name?.trim() || !body.email?.trim()) throw invalid('The owner needs a name and a contact email.')
    if (body.pin && !PIN_RE.test(body.pin)) throw invalid('A till PIN is 4 digits.')
    const email = body.email.trim()
    if (await one('select 1 from users where business_id = $1 and email = $2', [business.id, email])) {
      throw invalid('That email already belongs to a user of this business.')
    }
    const pinHash = body.pin ? hashPin(ctx.config.PIN_PEPPER, business.id, body.pin) : null
    if (pinHash && (await one('select 1 from users where business_id = $1 and pin_hash = $2', [business.id, pinHash]))) {
      throw invalid('That PIN is already in use in this business.')
    }
    await ctx.db.query(
      `insert into users (business_id, store_id, name, email, role, pin_hash) values ($1, null, $2, $3, 'owner', $4)`,
      [business.id, body.name.trim(), email, pinHash],
    )
    return reply.status(201).send(await adminBusiness(ctx.db, business))
  })

  /** The platform administrator's own sign-in password. */
  app.post('/admin/change-password', async (req, reply) => {
    const admin = await requireAdmin(ctx, req)
    const body = z.object({ current_password: z.string().optional(), new_password: z.string().optional() }).parse(req.body)
    if (!body.current_password || !(await verifyPassword(body.current_password, admin.password_hash))) {
      throw new ApiError(401, 'INVALID_CREDENTIALS', 'The current password is not right.')
    }
    if (!body.new_password || body.new_password.length < 8) throw invalid('The new password needs at least 8 characters.')
    await ctx.db.query('update platform_admins set password_hash = $2 where id = $1', [admin.id, await hashPassword(body.new_password)])
    return reply.status(204).send()
  })
}
