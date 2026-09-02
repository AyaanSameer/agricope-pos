import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { Ctx } from '../app.js'
import { hashPassword, hashPin, requireBusiness, requireRole, signToken, verifyPassword, verifyToken } from '../auth.js'
import { many, one } from '../db.js'
import { ApiError, invalid, notFound } from '../errors.js'
import { storeOut, userOut } from '../serialize.js'
import type { StoreRow, UserRow } from '../serialize.js'

/**
 * Three kinds of sign-in share one form. A platform admin gets an admin
 * token. A business gets a till token and its branches; the person is then
 * identified by PIN and gets a user session. Both PIN doors are rate-limited —
 * four digits are only safe if nobody can try them ten thousand times.
 */

const LIMITED = { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }

async function userSession(ctx: Ctx, user: UserRow) {
  const [access_token, refresh_token] = await Promise.all([
    signToken(ctx.secret, { kind: 'user', sub: user.id, bid: user.business_id }),
    signToken(ctx.secret, { kind: 'refresh', sub: user.id, bid: user.business_id }),
  ])
  return { access_token, refresh_token, user: userOut(user) }
}

const USER_SELECT = `
  select u.*, s.name as store_name from users u left join stores s on s.id = u.store_id`

export async function authRoutes(app: FastifyInstance, ctx: Ctx) {
  app.post('/auth/login', LIMITED, async (req) => {
    const body = z.object({ email: z.string().trim().toLowerCase(), password: z.string() }).parse(req.body)
    const wrong = new ApiError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect.')

    const admin = await one<{ id: string; name: string; password_hash: string }>(
      'select id, name, password_hash from platform_admins where email = $1',
      [body.email],
    )
    if (admin) {
      if (!(await verifyPassword(body.password, admin.password_hash))) throw wrong
      return {
        admin_token: await signToken(ctx.secret, { kind: 'admin', sub: admin.id }),
        admin: { id: admin.id, name: admin.name },
      }
    }

    const business = await one<{ id: string; name: string; password_hash: string; is_active: boolean }>(
      'select id, name, password_hash, is_active from businesses where email = $1',
      [body.email],
    )
    if (!business || !(await verifyPassword(body.password, business.password_hash))) throw wrong
    if (!business.is_active) {
      throw new ApiError(403, 'BUSINESS_SUSPENDED', 'This account is suspended. Contact Agricope.')
    }
    const stores = await many<StoreRow>(
      'select * from stores where business_id = $1 and is_active order by store_number',
      [business.id],
    )
    return {
      business_token: await signToken(ctx.secret, { kind: 'business', sub: business.id }),
      business: { id: business.id, name: business.name },
      stores: stores.map(storeOut),
    }
  })

  app.post('/auth/refresh', async (req) => {
    const body = z.object({ refresh_token: z.string() }).parse(req.body)
    const claims = await verifyToken(ctx.secret, body.refresh_token)
    const expired = new ApiError(401, 'INVALID_TOKEN', 'Session expired — sign in again.')
    if (!claims || claims.kind !== 'refresh') throw expired
    const user = await one<UserRow>(
      `${USER_SELECT} join businesses b on b.id = u.business_id where u.id = $1 and u.is_active and b.is_active`,
      [claims.sub],
    )
    if (!user) throw expired
    return userSession(ctx, user)
  })

  app.post('/auth/switch-cashier', LIMITED, async (req) => {
    const business = await requireBusiness(ctx, req)
    const body = z
      .object({ store_id: z.string().nullable().optional(), pin: z.string() })
      .parse(req.body)
    if (body.store_id) {
      const store = await one('select 1 from stores where id = $1 and business_id = $2', [body.store_id, business.id])
      if (!store) throw invalid('That branch does not belong to this business.')
    }
    const user = await one<UserRow>(
      `${USER_SELECT}
        where u.business_id = $1 and u.is_active and u.pin_hash = $2
          and ${body.store_id ? '(u.store_id is null or u.store_id = $3)' : 'u.store_id is null'}`,
      body.store_id
        ? [business.id, hashPin(ctx.config.PIN_PEPPER, business.id, body.pin), body.store_id]
        : [business.id, hashPin(ctx.config.PIN_PEPPER, business.id, body.pin)],
    )
    if (!user) throw new ApiError(401, 'INVALID_PIN', 'That PIN does not match anyone on this till.')
    return userSession(ctx, user)
  })

  // Owner only — the BUSINESS password, which every till signs in with.
  app.post('/auth/change-password', async (req, reply) => {
    const caller = await requireRole(ctx, req, ['owner'])
    const body = z.object({ current_password: z.string(), new_password: z.string() }).parse(req.body)
    const business = await one<{ password_hash: string }>(
      'select password_hash from businesses where id = $1',
      [caller.business_id],
    )
    if (!business) throw notFound('business')
    if (!(await verifyPassword(body.current_password, business.password_hash))) {
      throw new ApiError(401, 'INVALID_CREDENTIALS', 'The current password is not right.')
    }
    if (body.new_password.length < 8) throw invalid('The new password needs at least 8 characters.')
    await ctx.db.query('update businesses set password_hash = $2 where id = $1', [
      caller.business_id,
      await hashPassword(body.new_password),
    ])
    return reply.status(204).send()
  })
}
