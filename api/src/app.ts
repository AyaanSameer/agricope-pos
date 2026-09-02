import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import Fastify from 'fastify'
import type { FastifyInstance } from 'fastify'
import rateLimit from '@fastify/rate-limit'
import fastifyStatic from '@fastify/static'
import type { Config } from './config.js'
import { getPool } from './db.js'
import { errorHandler } from './errors.js'
import type { AuthContext } from './auth.js'
import { authRoutes } from './routes/auth.js'
import { adminRoutes } from './routes/admin.js'
import { orgRoutes } from './routes/org.js'
import { catalogRoutes } from './routes/catalog.js'
import { orderRoutes } from './routes/orders.js'
import { serviceRoutes } from './routes/service.js'
import { shiftRoutes } from './routes/shifts.js'
import { reportRoutes } from './routes/reports.js'

/** What every route module gets: config, the pool, and the auth helpers' context. */
export interface Ctx extends AuthContext {
  config: Config
}

export async function buildApp(config: Config): Promise<FastifyInstance> {
  const app = Fastify({
    logger:
      config.NODE_ENV === 'test'
        ? false
        : {
            level: config.LOG_LEVEL,
            ...(config.NODE_ENV === 'development' ? { transport: { target: 'pino-pretty' } } : {}),
          },
    trustProxy: true,
    bodyLimit: 1_048_576,
  })

  const ctx: Ctx = { config, secret: config.JWT_SECRET, db: getPool() }

  app.setErrorHandler(errorHandler)
  // Registered globally but only enforced where a route opts in (the two PIN/password doors).
  await app.register(rateLimit, { global: false })

  app.get('/healthz', async () => {
    await ctx.db.query('select 1')
    return { ok: true }
  })

  await app.register(
    async (api) => {
      await authRoutes(api, ctx)
      await adminRoutes(api, ctx)
      await orgRoutes(api, ctx)
      await catalogRoutes(api, ctx)
      await orderRoutes(api, ctx)
      await serviceRoutes(api, ctx)
      await shiftRoutes(api, ctx)
      await reportRoutes(api, ctx)
    },
    { prefix: '/api/v1' },
  )

  // Production: the same process serves the SPA, so /api/v1 is same-origin.
  if (config.STATIC_DIR) {
    const root = resolve(config.STATIC_DIR)
    if (!existsSync(root)) throw new Error(`STATIC_DIR does not exist: ${root}`)
    await app.register(fastifyStatic, { root, wildcard: false })
    // Anything that is not the API and not a file is a client route.
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/')) {
        return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'No such endpoint.' } })
      }
      return reply.sendFile('index.html')
    })
  } else {
    app.setNotFoundHandler((_req, reply) =>
      reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'No such endpoint.' } }),
    )
  }

  return app
}
