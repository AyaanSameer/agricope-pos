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

let pool: pg.Pool | null = null

export function connect(databaseUrl: string): pg.Pool {
  pool = new pg.Pool({
    connectionString: databaseUrl,
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
