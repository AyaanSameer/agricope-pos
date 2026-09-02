import pg from 'pg'
import type { PoolClient, QueryResult, QueryResultRow } from 'pg'

/**
 * One pool for the process. NUMERIC comes back as a string — exactly the
 * decimal-string money the contract wants, and never a float. Timestamps
 * come back as ISO strings so the wire shape is what the frontend expects.
 */
pg.types.setTypeParser(1700, (v) => v) // numeric → string, untouched
pg.types.setTypeParser(1184, (v) => new Date(v).toISOString()) // timestamptz → ISO
pg.types.setTypeParser(1082, (v) => v) // date → 'YYYY-MM-DD'

export type Queryable = Pick<PoolClient, 'query'>

/**
 * One connection string has to work in three places: psql, pg_dump, and here.
 * A hosted Postgres reached over the internet wants `sslmode=verify-full`, and
 * libpq then demands a root certificate — `sslrootcert=system` points it at the
 * operating system's trust store. Node has no such need: it verifies against
 * its own bundled roots, and node-postgres reads `sslrootcert` as a FILE PATH,
 * so it would try to open a file called "system" and throw ENOENT at boot.
 *
 * Dropping the parameter here is what lets the owner keep a single string in
 * the secret manager instead of two that drift apart. Verification is not
 * weakened: `sslmode=verify-full` still asks for a full check against Node's
 * roots, which is where the certificate would have been validated anyway.
 */
export function normalizeDatabaseUrl(databaseUrl: string): string {
  try {
    const url = new URL(databaseUrl)
    if (url.searchParams.get('sslrootcert')?.toLowerCase() !== 'system') return databaseUrl
    url.searchParams.delete('sslrootcert')
    return url.toString()
  } catch {
    // Not a URL — a libpq keyword string, say. Hand it on untouched.
    return databaseUrl
  }
}

const SOCKET_SENTINEL = 'socket.invalid'

/**
 * Where a connection string points, as far as we can tell. `recognised` is
 * false only when the string is neither a URL nor a libpq keyword string; a
 * guard cannot treat "I have no idea" as "it is fine".
 *
 * An empty `host` means a plain Unix socket on this machine, which is what
 * `postgres:///agricope_pos` asks for.
 */
function locate(databaseUrl: string): { recognised: boolean; host: string } {
  const trimmed = databaseUrl.trim()
  if (!trimmed) return { recognised: false, host: '' }

  // A libpq keyword string: `host=localhost dbname=agricope_pos`.
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) {
    if (!/(?:^|\s)(?:host|dbname|user|port)=/.test(trimmed)) return { recognised: false, host: '' }
    return { recognised: true, host: /(?:^|\s)host=(\S+)/.exec(trimmed)?.[1] ?? '' }
  }

  // The socket form, `postgres://user:pw@/db?host=/path`, has an empty
  // authority, which the URL parser rejects outright. Lend it a hostname so
  // the query string can still be read, then take the sentinel back out.
  const parseable = trimmed
    .replace(/^([a-z][a-z0-9+.-]*:\/\/)\//i, `$1${SOCKET_SENTINEL}/`)
    .replace(/^([a-z][a-z0-9+.-]*:\/\/[^/]*@)\//i, `$1${SOCKET_SENTINEL}/`)
  try {
    const url = new URL(parseable)
    const hostname = url.hostname === SOCKET_SENTINEL ? '' : url.hostname
    return { recognised: true, host: hostname || url.searchParams.get('host') || '' }
  } catch {
    return { recognised: false, host: '' }
  }
}

/**
 * The host a connection string points at, for the message that asks someone
 * to type it back. '' for a Unix socket or a string we could not read.
 */
export function databaseHost(databaseUrl: string): string {
  return locate(databaseUrl).host
}

/**
 * Is this a database on this machine? Loopback and a plain Unix socket count.
 * A socket under /cloudsql does not: that is the Cloud SQL proxy, a managed
 * database wearing a local costume. Neither does a string we cannot read,
 * because a guard that fails open is not a guard.
 */
export function isLocalDatabase(databaseUrl: string): boolean {
  const { recognised, host } = locate(databaseUrl)
  if (!recognised) return false
  if (host.startsWith('/')) return !host.includes('cloudsql')
  if (!host) return true // a plain local socket
  return ['localhost', '127.0.0.1', '::1', '[::1]'].includes(host)
}

let pool: pg.Pool | null = null

export function connect(databaseUrl: string): pg.Pool {
  pool = new pg.Pool({
    connectionString: normalizeDatabaseUrl(databaseUrl),
    max: 10,
    // A serverless Postgres (Neon) suspends its compute after a quiet spell and
    // closes every idle connection when it does. Keep ours short-lived so the
    // pool rarely holds a dead one, and give the first query after a wake-up
    // long enough for the compute to start.
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 15_000,
    keepAlive: true,
  })
  // An idle client the server dropped raises here. Without a listener the
  // event is uncaught and takes the process down between two sales.
  pool.on('error', (err) => {
    console.error('idle database connection closed:', err.message)
  })
  return pool
}

export function getPool(): pg.Pool {
  if (!pool) throw new Error('Database not connected — call connect() first.')
  return pool
}

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = [],
  client: Queryable = getPool(),
): Promise<QueryResult<T>> {
  return client.query<T>(text, params)
}

export async function one<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = [],
  client: Queryable = getPool(),
): Promise<T | null> {
  const res = await client.query<T>(text, params)
  return res.rows[0] ?? null
}

export async function many<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = [],
  client: Queryable = getPool(),
): Promise<T[]> {
  const res = await client.query<T>(text, params)
  return res.rows
}

/**
 * Run `fn` inside one transaction. Anything that moves money runs here so a
 * payment and its ledger entry either both land or neither does.
 */
export async function withTx<T>(fn: (tx: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect()
  try {
    await client.query('begin')
    const result = await fn(client)
    await client.query('commit')
    return result
  } catch (err) {
    await client.query('rollback').catch(() => {})
    throw err
  } finally {
    client.release()
  }
}

export async function close(): Promise<void> {
  await pool?.end()
  pool = null
}
