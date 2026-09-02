import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

/**
 * Apply migrations/*.sql in name order, once each, recording every file in
 * schema_migrations. Idempotent: re-running does nothing until a new file
 * appears. Never drops anything — a rebuild is `dropdb` by a human first.
 *
 *   DATABASE_URL=postgres://… npm run migrate
 */
export async function migrate(databaseUrl: string, dir = fileURLToPath(new URL('../migrations', import.meta.url))) {
  const client = new pg.Client({ connectionString: databaseUrl })
  await client.connect()
  try {
    await client.query(
      'create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())',
    )
    const applied = new Set(
      (await client.query<{ name: string }>('select name from schema_migrations')).rows.map((r) => r.name),
    )
    const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()
    const done: string[] = []
    for (const file of files) {
      if (applied.has(file)) continue
      const sql = readFileSync(join(dir, file), 'utf8')
      await client.query('begin')
      try {
        await client.query(sql)
        await client.query('insert into schema_migrations (name) values ($1)', [file])
        await client.query('commit')
        done.push(file)
      } catch (err) {
        await client.query('rollback')
        throw new Error(`${file} failed: ${(err as Error).message}`)
      }
    }
    return done
  } finally {
    await client.end()
  }
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/^.*\//, ''))
if (isMain) {
  try {
    process.loadEnvFile(fileURLToPath(new URL('../.env', import.meta.url)))
  } catch {
    /* no .env — rely on the environment */
  }
  const url = process.env.DATABASE_URL
  if (!url) {
    console.error('DATABASE_URL is not set')
    process.exit(1)
  }
  migrate(url)
    .then((done) => {
      console.log(done.length ? `applied: ${done.join(', ')}` : 'nothing to apply')
    })
    .catch((err) => {
      console.error(err.message)
      process.exit(1)
    })
}
