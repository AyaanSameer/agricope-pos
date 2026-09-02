import { describe, expect, it } from 'vitest'
import { parse } from 'pg-connection-string'
import { normalizeDatabaseUrl } from '../src/db.js'

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
