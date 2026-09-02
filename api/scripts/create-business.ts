import { fileURLToPath } from 'node:url'
import { hashPassword, hashPin } from '../src/auth.js'
import { close, connect, one, withTx } from '../src/db.js'

/**
 * A business, its first branch and its owner's till login — the three rows
 * that have to exist before anyone can sell anything.
 *
 * The console does this too, but the console only exists once the app is
 * deployed, and the app is not much use pointed at a database with no
 * business in it. This breaks that circle: a production database can be built
 * from the command line, in the order go-live actually happens.
 *
 *   npm run create:business -- \
 *     --name "Drumsticks" --email drumsticks@agricope.qa --password '…' \
 *     --branch "Drumsticks — Barwa Village" --type restaurant \
 *     --owner "Ayaan Sameer" --owner-email ayaan@agricope.qa --pin 1111
 *
 * Everything it writes matches what POST /admin/businesses and POST /users
 * write, because a row made here has to be indistinguishable from a row made
 * in the console.
 */

const ROLE_OWNER = 'owner'
const TYPES = ['retail', 'restaurant'] as const

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
  const pepper = process.env.PIN_PEPPER
  const name = arg('name')?.trim()
  const email = arg('email')?.trim().toLowerCase()
  const password = arg('password')
  const branch = arg('branch')?.trim()
  const type = arg('type')?.trim()
  const owner = arg('owner')?.trim()
  const ownerEmail = arg('owner-email')?.trim().toLowerCase()
  const pin = arg('pin')?.trim()
  const address = arg('address')?.trim() || null
  const phone = arg('phone')?.trim() || null

  if (!url) throw new Error('DATABASE_URL is not set')
  if (!pepper) throw new Error('PIN_PEPPER is not set — the owner PIN cannot be hashed without it')
  if (!name || !email || !password) throw new Error('Usage: --name <business> --email <login email> --password <password> …')
  if (!branch || !type) throw new Error('A first branch is required: --branch <name> --type <retail|restaurant>')
  if (!(TYPES as readonly string[]).includes(type)) throw new Error(`--type must be one of: ${TYPES.join(', ')}`)
  if (!owner || !ownerEmail || !pin) throw new Error("The owner's till login is required: --owner <name> --owner-email <email> --pin <4 digits>")
  if (password.length < 8) throw new Error('The business password needs at least 8 characters.')
  if (!/^\d{4}$/.test(pin)) throw new Error('A till PIN is 4 digits.')

  connect(url)
  const taken = await one('select 1 from businesses where email = $1 union select 1 from platform_admins where email = $1', [email])
  if (taken) throw new Error(`${email} is already a sign-in on this platform.`)

  const result = await withTx(async (tx) => {
    const business = await one<{ id: string }>(
      'insert into businesses (name, email, password_hash) values ($1, $2, $3) returning id',
      [name, email, await hashPassword(password)],
      tx,
    )
    // The console gives a new owner one category so the Catalog page is not a
    // dead end; a business made here should look the same.
    await tx.query("insert into categories (business_id, name, sort_order) values ($1, 'General', 1)", [business!.id])
    const store = await one<{ id: string; store_number: number }>(
      `insert into stores (business_id, store_number, name, type, address, phone, kitchen_mode, service_charge_rate)
       values ($1, 1, $2, $3, $4, $5, 'kds', 0) returning id, store_number`,
      [business!.id, branch, type, address, phone],
      tx,
    )
    // store_id null: an owner works across every branch, not just this one.
    await one(
      `insert into users (business_id, store_id, name, email, role, pin_hash, is_active)
       values ($1, null, $2, $3, $4, $5, true)`,
      [business!.id, owner, ownerEmail, ROLE_OWNER, hashPin(pepper, business!.id, pin)],
      tx,
    )
    return { business: business!.id, store: store!.id, storeNumber: store!.store_number }
  })

  console.log(`${name} created.`)
  console.log(`  business sign-in : ${email}`)
  console.log(`  first branch     : ${branch} (${type}, S${result.storeNumber})`)
  console.log(`  owner at the till: ${owner}, PIN ${pin}`)
  console.log('')
  console.log('That PIN is hashed with PIN_PEPPER. It will only work while the API runs')
  console.log('with the SAME pepper this command just used. Deploy that value, or the')
  console.log('owner cannot get past the PIN pad.')
  console.log('')
  console.log('Next: npm run import:catalogue -- --business ' + email + ' --branch "' + branch + '"')
  await close()
}

main().catch((err) => {
  console.error(err.message ?? err)
  process.exit(1)
})
