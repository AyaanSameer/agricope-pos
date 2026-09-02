import { describe, expect, it } from 'vitest'
import { parse } from 'pg-connection-string'
import { databaseHost, isLocalDatabase, normalizeDatabaseUrl } from '../src/db.js'

/**
 * The owner keeps ONE connection string. psql and pg_dump need
 * `sslrootcert=system` to find a root certificate; node-postgres reads the
 * same parameter as a file path and throws ENOENT on it. If this ever stops
 * being handled, the API dies at boot on a string that works fine in psql —
 * the worst kind of failure to debug at a till.
 */
describe('database url', () => {
  const neon = 'postgres://u:p@ep-x.eu-central-1.aws.neon.tech/neondb?sslmode=verify-full'

  it('drops sslrootcert=system so the driver does not look for a file called "system"', () => {
    expect(() => parse(`${neon}&sslrootcert=system`)).toThrow(/ENOENT/)
    expect(() => parse(normalizeDatabaseUrl(`${neon}&sslrootcert=system`))).not.toThrow()
  })

  it('still verifies the certificate fully', () => {
    // `sslmode=verify-full` survives, and that is what turns verification on.
    const normalized = normalizeDatabaseUrl(`${neon}&sslrootcert=system`)
    expect(normalized).toContain('sslmode=verify-full')
    expect(parse(normalized).ssl).toEqual({})
  })

  it('leaves a real certificate path alone', () => {
    const withFile = `${neon}&sslrootcert=/etc/ssl/private-ca.pem`
    expect(normalizeDatabaseUrl(withFile)).toBe(withFile)
  })

  it('leaves everything else untouched', () => {
    expect(normalizeDatabaseUrl(neon)).toBe(neon)
    expect(normalizeDatabaseUrl('postgres://localhost:5432/agricope_pos')).toBe(
      'postgres://localhost:5432/agricope_pos',
    )
    // A libpq keyword string is not a URL; it must pass through, not explode.
    expect(normalizeDatabaseUrl('host=localhost dbname=agricope_pos')).toBe('host=localhost dbname=agricope_pos')
  })

  it('keeps the other parameters when it strips', () => {
    const normalized = normalizeDatabaseUrl(`${neon}&sslrootcert=system&channel_binding=require`)
    expect(normalized).toContain('channel_binding=require')
    expect(normalized).not.toContain('sslrootcert')
  })
})

/**
 * The seed writes three demo businesses whose every password is demo123, and
 * with --reset it truncates first. It must be able to tell the developer's own
 * Postgres from the business's live database before it does either.
 */
describe('is the database on this machine', () => {
  it('knows loopback', () => {
    expect(isLocalDatabase('postgres://localhost:5432/agricope_pos')).toBe(true)
    expect(isLocalDatabase('postgres://user:pw@127.0.0.1:5432/agricope_pos')).toBe(true)
    expect(isLocalDatabase('postgres://[::1]:5432/agricope_pos')).toBe(true)
  })

  it('knows a hosted database is not', () => {
    expect(isLocalDatabase('postgres://u:p@ep-x.eu-central-1.aws.neon.tech/neondb?sslmode=verify-full')).toBe(false)
    expect(isLocalDatabase('postgres://u:p@db.example.com:5432/pos')).toBe(false)
  })

  it('does not mistake the Cloud SQL socket for a local Postgres', () => {
    // It looks like a file path, but the database is a managed instance.
    expect(isLocalDatabase('postgres://pos_app:pw@/pos?host=/cloudsql/proj:me-central1:agricope-pos')).toBe(false)
    expect(isLocalDatabase('postgres://ayaan@/agricope_pos?host=/tmp')).toBe(true)
  })

  it('reports the host the guard makes you type', () => {
    expect(databaseHost('postgres://u:p@ep-x.eu-central-1.aws.neon.tech/neondb')).toBe('ep-x.eu-central-1.aws.neon.tech')
    expect(databaseHost('postgres://localhost:5432/agricope_pos')).toBe('localhost')
  })

  it('reads a libpq keyword string too', () => {
    expect(isLocalDatabase('host=localhost dbname=agricope_pos')).toBe(true)
    expect(isLocalDatabase('host=ep-x.eu-central-1.aws.neon.tech dbname=neondb')).toBe(false)
  })

  it('allows a plain local socket', () => {
    expect(isLocalDatabase('postgres:///agricope_pos')).toBe(true)
  })

  it('refuses a string it cannot read, rather than assuming it is safe', () => {
    // A guard that fails open is not a guard.
    expect(isLocalDatabase('')).toBe(false)
    expect(isLocalDatabase('not a connection string at all')).toBe(false)
  })
})
