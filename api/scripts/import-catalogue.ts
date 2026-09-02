import { fileURLToPath } from 'node:url'
import { close, connect, one, withTx } from '../src/db.js'
import { loadDrumsticksCatalogue } from './catalogue.js'

/**
 * Put Drumsticks' real menu into an EXISTING business — the go-live step the
 * demo seed cannot do, because the seed builds a whole fake world around it.
 *
 *   npm run import:catalogue -- --business drumsticks@agricope.qa --branch "Barwa Village"
 *
 * Against production, run it through the Cloud SQL Auth Proxy with
 * DATABASE_URL pointing at the proxy. Safe to repeat: names already there are
 * left alone and the summary says so.
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
  const email = arg('business')?.trim().toLowerCase()
  const branch = arg('branch')?.trim()
  if (!url) throw new Error('DATABASE_URL is not set')
  if (!email || !branch) throw new Error('Usage: --business <login email> --branch <branch name>')

  connect(url)
  const business = await one<{ id: string; name: string; shared_catalog: boolean }>(
    'select id, name, shared_catalog from businesses where email = $1',
    [email],
  )
  if (!business) throw new Error(`No business signs in as ${email}`)
  const store = await one<{ id: string; name: string }>(
    `select id, name from stores where business_id = $1 and lower(name) like '%' || lower($2) || '%' order by store_number limit 1`,
    [business.id, branch],
  )
  if (!store) throw new Error(`${business.name} has no branch matching "${branch}"`)

  const result = await withTx((tx) =>
    loadDrumsticksCatalogue(tx, {
      businessId: business.id,
      branchId: store.id,
      perBranch: !business.shared_catalog,
    }),
  )
  console.log(
    `${business.name} · ${store.name}${business.shared_catalog ? ' (shared catalogue)' : ''}: ` +
      `${result.products} products added, ${result.skipped} already there, ` +
      `${result.categories} categories and ${result.stations} stations created.`,
  )
  await close()
}

main().catch((err) => {
  console.error(err.message ?? err)
  process.exit(1)
})
