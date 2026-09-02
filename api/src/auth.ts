import { createHmac, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import { SignJWT, jwtVerify } from 'jose'
import type { FastifyRequest } from 'fastify'
import { one } from './db.js'
import type { Queryable } from './db.js'
import { forbidden, unauthenticated } from './errors.js'

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number, opts: object) => Promise<Buffer>

/* ---------- passwords: scrypt, no dependency, parameters stored beside the hash ---------- */

const SCRYPT = { N: 16384, r: 8, p: 1, len: 64 }

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16)
  const key = await scrypt(password, salt, SCRYPT.len, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p })
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${key.toString('base64')}`
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algo, n, r, p, salt64, key64] = stored.split('$')
  if (algo !== 'scrypt' || !salt64 || !key64) return false
  const expected = Buffer.from(key64, 'base64')
  const actual = await scrypt(password, Buffer.from(salt64, 'base64'), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
  })
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

/* ---------- PINs: a keyed hash, so the till can look a person up by it ---------- */

/**
 * Four digits are 10,000 possibilities, so a slow hash buys nothing against
 * an offline attack — the pepper does. It lives in the environment, never in
 * the database, and the unique index on (business_id, pin_hash) is what
 * keeps a PIN unique within a business.
 */
export function hashPin(pepper: string, businessId: string, pin: string): string {
  return createHmac('sha256', pepper).update(`${businessId}:${pin}`).digest('hex')
}

export const PIN_RE = /^\d{4}$/

/* ---------- tokens ---------- */

export type TokenKind = 'admin' | 'business' | 'user' | 'refresh'

export interface TokenClaims {
  kind: TokenKind
  sub: string
  /** business id, on business and user tokens */
  bid?: string
}

const LIFETIME: Record<TokenKind, string> = {
  admin: '12h',
  business: '30d', // the till itself stays signed in; people come and go by PIN
  user: '12h',
  refresh: '30d',
}

export async function signToken(secret: string, claims: TokenClaims): Promise<string> {
  return new SignJWT({ kind: claims.kind, ...(claims.bid ? { bid: claims.bid } : {}) })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(claims.sub)
    .setIssuedAt()
    .setExpirationTime(LIFETIME[claims.kind])
    .sign(new TextEncoder().encode(secret))
}

export async function verifyToken(secret: string, token: string): Promise<TokenClaims | null> {
  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(secret))
    if (!payload.sub || typeof payload.kind !== 'string') return null
    return { kind: payload.kind as TokenKind, sub: payload.sub, bid: payload.bid as string | undefined }
  } catch {
    return null
  }
}

function bearer(req: FastifyRequest): string | null {
  const header = req.headers.authorization ?? ''
  const m = /^Bearer\s+(.+)$/i.exec(header)
  return m ? m[1] : null
}

/* ---------- who is calling ---------- */

export type Role = 'owner' | 'manager' | 'cashier' | 'waiter'

export interface AuthUser {
  id: string
  business_id: string
  store_id: string | null
  name: string
  email: string
  role: Role
}

export interface AuthAdmin {
  id: string
  name: string
  email: string
  password_hash: string
}

export interface AuthBusiness {
  id: string
  name: string
  is_active: boolean
}

export interface AuthContext {
  secret: string
  db: Queryable
}

/** The signed-in person, or null. Deactivating a login takes effect on the next request. */
export async function currentUser(ctx: AuthContext, req: FastifyRequest): Promise<AuthUser | null> {
  const token = bearer(req)
  if (!token) return null
  const claims = await verifyToken(ctx.secret, token)
  if (!claims || claims.kind !== 'user') return null
  return one<AuthUser>(
    `select u.id, u.business_id, u.store_id, u.name, u.email, u.role
       from users u join businesses b on b.id = u.business_id
      where u.id = $1 and u.is_active and b.is_active`,
    [claims.sub],
    ctx.db,
  )
}

export async function requireUser(ctx: AuthContext, req: FastifyRequest): Promise<AuthUser> {
  const user = await currentUser(ctx, req)
  if (!user) throw unauthenticated()
  return user
}

export async function requireRole(
  ctx: AuthContext,
  req: FastifyRequest,
  roles: Role[],
  message?: string,
): Promise<AuthUser> {
  const user = await requireUser(ctx, req)
  if (!roles.includes(user.role)) throw forbidden(message)
  return user
}

/** The business behind a till token (pre-PIN) or a user token. */
export async function requireBusiness(ctx: AuthContext, req: FastifyRequest): Promise<AuthBusiness> {
  const token = bearer(req)
  if (!token) throw unauthenticated()
  const claims = await verifyToken(ctx.secret, token)
  if (!claims) throw unauthenticated()
  const businessId = claims.kind === 'business' ? claims.sub : claims.kind === 'user' ? claims.bid : null
  if (!businessId) throw unauthenticated()
  if (claims.kind === 'user') {
    // A user token must still belong to an active login.
    const user = await currentUser(ctx, req)
    if (!user) throw unauthenticated()
  }
  const business = await one<AuthBusiness>(
    'select id, name, is_active from businesses where id = $1',
    [businessId],
    ctx.db,
  )
  if (!business) throw unauthenticated()
  if (!business.is_active) throw forbidden('This account is suspended. Contact Agricope.')
  return business
}

export async function requireAdmin(ctx: AuthContext, req: FastifyRequest): Promise<AuthAdmin> {
  const token = bearer(req)
  if (!token) throw unauthenticated('Admin sign-in required.')
  const claims = await verifyToken(ctx.secret, token)
  if (!claims || claims.kind !== 'admin') throw unauthenticated('Admin sign-in required.')
  const admin = await one<AuthAdmin>(
    'select id, name, email, password_hash from platform_admins where id = $1',
    [claims.sub],
    ctx.db,
  )
  if (!admin) throw unauthenticated('Admin sign-in required.')
  return admin
}

/**
 * Sensitive actions carry a manager or owner PIN in X-Approval-Pin. It must
 * belong to an active approver of the same business — never across tenants.
 */
export async function approverForPin(
  db: Queryable,
  pepper: string,
  businessId: string,
  pin: string | null | undefined,
): Promise<{ id: string; name: string } | null> {
  if (!pin || !PIN_RE.test(pin)) return null
  return one<{ id: string; name: string }>(
    `select id, name from users
      where business_id = $1 and pin_hash = $2 and is_active and role in ('manager', 'owner')`,
    [businessId, hashPin(pepper, businessId, pin)],
    db,
  )
}

export function approvalPinFrom(req: FastifyRequest): string | null {
  const v = req.headers['x-approval-pin']
  return typeof v === 'string' ? v : null
}
