import { z } from 'zod'

/**
 * Every setting the server needs, read once, validated once. A missing or
 * weak secret stops the process at boot rather than at the first request.
 */
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1),
  /** signs every token; 32+ random bytes, never reused across environments */
  JWT_SECRET: z.string().min(32),
  /** keyed into every PIN hash; a leaked table without it is 10,000 dead guesses */
  PIN_PEPPER: z.string().min(16),
  /** order numbers and report days follow the business's clock, not the server's */
  BUSINESS_TZ: z.string().default('Asia/Qatar'),
  /** the built SPA to serve in production; unset = API only */
  STATIC_DIR: z.string().optional(),
  LOG_LEVEL: z.string().default('info'),
})

export type Config = z.infer<typeof schema>

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env)
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n')
    throw new Error(`Configuration is not usable:\n${problems}`)
  }
  return parsed.data
}
