import type { PoolClient } from 'pg'
import { one } from '../src/db.js'
import { drumsticksCategories, drumsticksItems } from './drumsticks.js'

/**
 * Drumsticks' real menu — 65 products across 10 categories, from the client's
 * two pricing files — loaded into a business. The seed uses it to build the
 * demo world; `import-catalogue.ts` uses it to put the same menu into a clean
 * production database, which is the one thing a go-live needs that the demo
 * seed must never be run for.
 *
 * Idempotent by name: a category, station or product the target already has
 * is left exactly as it is, so running it twice adds nothing.
 */

export interface CatalogueTarget {
  businessId: string
  /** the branch that owns the kitchen stations */
  branchId: string
  /** true = products belong to that branch; false = the business shares one list */
  perBranch: boolean
  /** the seed's readable ids (dp-001, st-ds-fry…); omit to let Postgres mint them */
  fixedIds?: boolean
}

export interface CatalogueResult {
  categories: number
  stations: number
  products: number
  skipped: number
}

const STATIONS: { key: 'FRY' | 'ASM' | 'COLD'; name: string; fixedId: string }[] = [
  { key: 'FRY', name: 'Fry station', fixedId: 'st-ds-fry' },
  { key: 'ASM', name: 'Assembly & Pack', fixedId: 'st-ds-asm' },
  { key: 'COLD', name: 'Drinks & Cold', fixedId: 'st-ds-cold' },
]

const inDays = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString()

export async function loadDrumsticksCatalogue(tx: PoolClient, target: CatalogueTarget): Promise<CatalogueResult> {
  const result: CatalogueResult = { categories: 0, stations: 0, products: 0, skipped: 0 }
  const storeId = target.perBranch ? target.branchId : null

  // ---- categories, by name ----
  const categoryId = new Map<string, string>()
  for (const c of drumsticksCategories) {
    const existing = await one<{ id: string }>(
      'select id from categories where business_id = $1 and lower(name) = lower($2)',
      [target.businessId, c.name],
      tx,
    )
    if (existing) {
      categoryId.set(c.id, existing.id)
      continue
    }
    const made = await one<{ id: string }>(
      `insert into categories (id, business_id, name, sort_order)
       values (coalesce($1, gen_random_uuid()::text), $2, $3,
               (select coalesce(max(sort_order), 0) + 1 from categories where business_id = $2))
       returning id`,
      [target.fixedIds ? c.id : null, target.businessId, c.name],
      tx,
    )
    categoryId.set(c.id, made!.id)
    result.categories++
  }

  // ---- the three stations, on the branch ----
  const stationId = new Map<'FRY' | 'ASM' | 'COLD', string>()
  for (const [i, st] of STATIONS.entries()) {
    const existing = await one<{ id: string }>(
      'select id from kitchen_stations where store_id = $1 and lower(name) = lower($2)',
      [target.branchId, st.name],
      tx,
    )
    if (existing) {
      stationId.set(st.key, existing.id)
      continue
    }
    const made = await one<{ id: string }>(
      `insert into kitchen_stations (id, store_id, name, sort_order)
       values (coalesce($1, gen_random_uuid()::text), $2, $3, $4) returning id`,
      [target.fixedIds ? st.fixedId : null, target.branchId, st.name, i + 1],
      tx,
    )
    stationId.set(st.key, made!.id)
    result.stations++
  }

  // ---- products ----
  for (const d of drumsticksItems) {
    const taken = await one(
      `select 1 from products where business_id = $1 and lower(name) = lower($2)
        and coalesce(store_id, '') = coalesce($3::text, '')`,
      [target.businessId, d.name, storeId],
      tx,
    )
    if (taken) {
      result.skipped++
      continue
    }
    // The files ship live discounts; open a 30-day window so the till shows them.
    const offer = d.offer_percent ? { percent: d.offer_percent, starts_at: null, ends_at: inDays(30) } : null
    const optionGroups = d.flavors
      ? [
          {
            id: `og-${d.id}`,
            name: d.flavor_label ?? 'Flavor',
            required: true,
            choices: d.flavors.map((f, i) => ({ id: `oc-${d.id}-${i}`, name: f, price_delta: '0.00' })),
          },
        ]
      : []
    const made = await one<{ id: string }>(
      `insert into products (id, business_id, store_id, name, name_ar, description, price, price_online, tax_rate,
                             is_combo, offer, offer_online, option_groups, kitchen_station_id)
       values (coalesce($1, gen_random_uuid()::text), $2, $3, $4, $5, $6, $7, $8, 0, $9, $10, $10, $11, $12)
       returning id`,
      [
        target.fixedIds ? d.id : null,
        target.businessId,
        storeId,
        d.name,
        d.name_ar,
        d.description,
        d.price,
        d.price_online,
        d.is_combo,
        offer ? JSON.stringify(offer) : null,
        JSON.stringify(optionGroups),
        stationId.get(d.station) ?? null,
      ],
      tx,
    )
    for (const [i, cat] of d.category_ids.entries()) {
      await tx.query('insert into product_categories (product_id, category_id, position) values ($1, $2, $3)', [
        made!.id,
        categoryId.get(cat),
        i,
      ])
    }
    result.products++
  }
  return result
}
