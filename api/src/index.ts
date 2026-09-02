import { fileURLToPath } from 'node:url'
import { loadConfig } from './config.js'
import { connect, close } from './db.js'
import { buildApp } from './app.js'

try {
  process.loadEnvFile(fileURLToPath(new URL('../.env', import.meta.url)))
} catch {
  /* no .env — production reads the environment directly */
}

const config = loadConfig()
connect(config.DATABASE_URL)

const app = await buildApp(config)

const shutdown = async (signal: string) => {
  app.log.info({ signal }, 'shutting down')
  await app.close()
  await close()
  process.exit(0)
}
process.on('SIGTERM', () => void shutdown('SIGTERM'))
process.on('SIGINT', () => void shutdown('SIGINT'))

await app.listen({ port: config.PORT, host: '0.0.0.0' })
