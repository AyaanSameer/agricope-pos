import { fileURLToPath } from 'node:url'
import { hashPassword } from '../src/auth.js'
import { close, connect, one } from '../src/db.js'

/**
 * The first platform administrator. A production database starts with none,
 * and without one nobody can open the console to create the first business.
 *
 *   npm run create:admin -- --name "Agricope Admin" --email admin@agricope.qa --password 'a-strong-one'
 *
 * Against production, run it through the Cloud SQL Auth Proxy. The password
 * is hashed here with the same scrypt the API verifies with; change it from
 * the console's own "Change password" after the first sign-in.
 */

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i === -1 ? undefined : process.argv[i + 1]
}

async function main() {
  try {
    process.loadEnvFile(fileURLToPath(new URL('../.env', import.meta.url)))
  } catch {
    /* environment only */
  }
  const url = process.env.DATABASE_URL
  const name = arg('name')?.trim()
  const email = arg('email')?.trim().toLowerCase()
  const password = arg('password')
  if (!url) throw new Error('DATABASE_URL is not set')
  if (!name || !email || !password) throw new Error('Usage: --name <name> --email <email> --password <password>')
  if (password.length < 8) throw new Error('The password needs at least 8 characters.')

  connect(url)
  const taken = await one('select 1 from platform_admins where email = $1 union select 1 from businesses where email = $1', [email])
  if (taken) throw new Error(`${email} is already a sign-in on this platform.`)
  await one('insert into platform_admins (name, email, password_hash) values ($1, $2, $3)', [name, email, await hashPassword(password)])
  console.log(`Platform administrator ${name} <${email}> created. Sign in at /login and change the password from the console.`)
  await close()
}

main().catch((err) => {
  console.error(err.message ?? err)
  process.exit(1)
})
