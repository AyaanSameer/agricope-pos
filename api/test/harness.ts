import type { FastifyInstance } from 'fastify'
import { migrate } from '../scripts/migrate.js'
import { seedWorld } from '../scripts/seed.js'
import { buildApp } from '../src/app.js'
import { loadConfig } from '../src/config.js'
import type { Config } from '../src/config.js'
import { close, connect, withTx } from '../src/db.js'

/**
 * Integration tests run the real app against a real Postgres, seeded with
 * the same world the demo shows. No mocks: every assertion below went
 * through the router, the transaction and the schema.
 */

export const TEST_CONFIG: Config = loadConfig({
  NODE_ENV: 'test',
  PORT: '3999', // never listened on — app.inject() drives requests in-process
  DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgres://localhost:5432/agricope_pos_test',
  JWT_SECRET: 'test-secret-that-is-long-enough-for-the-schema-0123456789',
  PIN_PEPPER: 'test-pepper-0123456789',
  BUSINESS_TZ: 'Asia/Qatar',
  LOG_LEVEL: 'silent',
})

export async function startWorld(): Promise<FastifyInstance> {
  await migrate(TEST_CONFIG.DATABASE_URL)
  connect(TEST_CONFIG.DATABASE_URL)
  await withTx(async (tx) => {
    await tx.query('truncate platform_admins, businesses cascade')
    await seedWorld(tx, { pepper: TEST_CONFIG.PIN_PEPPER, tz: TEST_CONFIG.BUSINESS_TZ })
  })
  return buildApp(TEST_CONFIG)
}

export async function stopWorld(app: FastifyInstance) {
  await app.close()
  await close()
}

export interface Res<T = any> {
  status: number
  body: T
}

/**
 * The rate limiter keys on the caller's address, and every injected request
 * would otherwise share one. Each call gets its own — except where a test
 * pins one on purpose to prove the limiter bites.
 */
let nextHost = 1
function freshAddress(): string {
  nextHost += 1
  return `10.${(nextHost >> 16) & 255}.${(nextHost >> 8) & 255}.${nextHost & 255}`
}

export async function call<T = any>(
  app: FastifyInstance,
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  url: string,
  opts: { token?: string; body?: unknown; pin?: string; from?: string } = {},
): Promise<Res<T>> {
  const res = await app.inject({
    method,
    url: `/api/v1${url}`,
    headers: {
      'x-forwarded-for': opts.from ?? freshAddress(),
      ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
      ...(opts.pin ? { 'x-approval-pin': opts.pin } : {}),
      ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    ...(opts.body !== undefined ? { payload: JSON.stringify(opts.body) } : {}),
  })
  const text = res.body
  return { status: res.statusCode, body: text ? (JSON.parse(text) as T) : (undefined as T) }
}

export async function loginBusiness(app: FastifyInstance, email: string, password = 'demo123') {
  const res = await call<{ business_token: string; stores: { id: string }[] }>(app, 'POST', '/auth/login', {
    body: { email, password },
  })
  if (res.status !== 200) throw new Error(`login failed: ${JSON.stringify(res.body)}`)
  return res.body
}

export async function loginAdmin(app: FastifyInstance) {
  const res = await call<{ admin_token: string }>(app, 'POST', '/auth/login', {
    body: { email: 'admin@agricope.qa', password: 'demo123' },
  })
  if (res.status !== 200) throw new Error(`admin login failed: ${JSON.stringify(res.body)}`)
  return res.body.admin_token
}

/** Business sign-in, then a PIN → a user access token. */
export async function tillSession(app: FastifyInstance, email: string, storeId: string | null, pin: string) {
  const biz = await loginBusiness(app, email)
  const res = await call<{ access_token: string; user: { id: string; name: string; role: string } }>(
    app,
    'POST',
    '/auth/switch-cashier',
    { token: biz.business_token, body: { store_id: storeId, pin } },
  )
  if (res.status !== 200) throw new Error(`PIN failed: ${JSON.stringify(res.body)}`)
  return res.body
}
