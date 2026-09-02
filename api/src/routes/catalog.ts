import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { Ctx } from '../app.js'
import { requireRole, requireUser } from '../auth.js'
import { many, one, withTx } from '../db.js'
import type { Queryable } from '../db.js'
import { conflict, invalid, notFound } from '../errors.js'
import type { ProductOffer } from '../lib/pricing.js'
import { paginated, productOut } from '../serialize.js'
import type { ProductRow } from '../serialize.js'
import type { OptionGroup } from '../services/orders.js'

/**
 * What a business sells. Prices are tax-inclusive decimal strings; a product
 * can sit in several categories (the first is where reporting counts it);
 * offers and option groups are validated here and stored as JSON.
 */

const MONEY_RE = /^\d+(\.\d{1,2})?$/

const PRODUCT_SELECT = `
  select p.*,
         coalesce((select array_agg(pc.category_id order by pc.position) from product_categories pc where pc.product_id = p.id), '{}'::text[]) as category_ids,
         (select c.name from product_categories pc join categories c on c.id = pc.category_id
           where pc.product_id = p.id order by pc.position limit 1) as category_name,
         ks.name as station_name, st.name as store_name
    from products p
    left join kitchen_stations ks on ks.id = p.kitchen_station_id
    left join stores st on st.id = p.store_id`

function parseOptionGroups(raw: unknown): OptionGroup[] {
  if (!Array.isArray(raw)) return []
  const groups: OptionGroup[] = []
  for (const g of raw as Partial<OptionGroup>[]) {
    const name = String(g.name ?? '').trim()
    if (!name) throw invalid('Every option group needs a name.')
    const choices = (Array.isArray(g.choices) ? g.choices : [])
      .map((c, i) => ({
        id: c.id || `oc-${Math.random().toString(36).slice(2, 8)}-${i}`,
        name: String(c.name ?? '').trim(),
        price_delta: String(c.price_delta ?? '0.00'),
      }))
      .filter((c) => c.name)
    if (choices.length < 2) throw invalid(`Option group "${name}" needs at least two choices.`)
    for (const c of choices) {
      if (!MONEY_RE.test(c.price_delta)) throw invalid(`Price delta for "${c.name}" must look like "2.00".`)
    }
    groups.push({ id: g.id || `og-${Math.random().toString(36).slice(2, 8)}`, name, required: g.required ?? true, choices })
  }
  return groups
}

function parseOffer(raw: unknown): ProductOffer | null {
  if (raw === null || raw === undefined) return null
  const o = raw as Partial<ProductOffer>
  const percent = String(o.percent ?? '').trim()
  if (!/^\d+$/.test(percent) || Number(percent) <= 0 || Number(percent) >= 100) {
    throw invalid('Offer percent must be a whole number between 1 and 99.')
  }
  return { percent, starts_at: o.starts_at ?? null, ends_at: o.ends_at ?? null }
}

async function loadProduct(db: Queryable, businessId: string, id: string): Promise<ProductRow> {
  const row = await one<ProductRow>(`${PRODUCT_SELECT} where p.id = $1 and p.business_id = $2`, [id, businessId], db)
  if (!row) throw notFound('product')
  return row
}

async function setCategories(tx: Queryable, productId: string, categoryIds: string[], businessId: string) {
  if (categoryIds.length) {
    const own = await many<{ id: string }>('select id from categories where business_id = $1 and id = any($2)', [businessId, categoryIds], tx)
    if (own.length !== new Set(categoryIds).size) throw invalid('Unknown category.')
  }
  await tx.query('delete from product_categories where product_id = $1', [productId])
  let position = 0
  for (const id of [...new Set(categoryIds)]) {
    await tx.query('insert into product_categories (product_id, category_id, position) values ($1, $2, $3)', [productId, id, position++])
  }
}

const productBody = z.object({
  name: z.string().optional(),
  name_ar: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  category_ids: z.array(z.string()).optional(),
  category_id: z.string().nullable().optional(),
  barcode: z.string().nullable().optional(),
  /** the branch whose catalogue it belongs to */
  store_id: z.string().nullable().optional(),
  price: z.union([z.string(), z.number()]).optional(),
  price_online: z.union([z.string(), z.number()]).nullable().optional(),
  tax_rate: z.union([z.string(), z.number()]).optional(),
  is_combo: z.boolean().optional(),
  offer: z.unknown().optional(),
  offer_online: z.unknown().optional(),
  option_groups: z.unknown().optional(),
  kitchen_station_id: z.string().nullable().optional(),
  is_active: z.boolean().optional(),
})

export async function catalogRoutes(app: FastifyInstance, ctx: Ctx) {
  /**
   * A product belongs to one branch's catalogue — or to none, while the
   * business runs a single shared list. Which applies is the owner's setting,
   * so it is read rather than assumed.
   */
  const resolveBranch = async (
    businessId: string,
    given: string | null | undefined,
    fallback: string | null,
  ): Promise<string | null> => {
    const storeId = given === undefined ? fallback : given
    if (storeId) {
      const own = await one('select 1 from stores where id = $1 and business_id = $2', [storeId, businessId])
      if (!own) throw invalid('That branch does not belong to this business.')
      // Remembered even while the list is shared, so the setting can be turned
      // off and on again without losing what the owner already decided.
      return storeId
    }
    const biz = await one<{ shared_catalog: boolean }>('select shared_catalog from businesses where id = $1', [businessId])
    if (!biz?.shared_catalog) {
      throw invalid('This business keeps a catalogue per branch, so a product needs a branch.')
    }
    return null
  }

  /**
   * A barcode must resolve to one product at the till that scans it — so it may
   * repeat across branches, but never within one. A product on no branch sits
   * on every till, and therefore clashes with all of them.
   */
  const assertBarcodeFree = async (
    businessId: string,
    barcode: string | null | undefined,
    storeId: string | null,
    exceptId: string | null,
  ) => {
    if (!barcode) return
    const clash = await one<{ name: string }>(
      `select p.name from products p
        where p.business_id = $1 and p.barcode = $2 and ($3::text is null or p.id <> $3)
          and ($4::text is null or p.store_id is null or p.store_id = $4)
        limit 1`,
      [businessId, barcode, exceptId, storeId],
    )
    if (clash) throw invalid(`${clash.name} already has that barcode on this branch.`)
  }

  // ---------- categories ----------

  app.get('/categories', async (req) => {
    const caller = await requireUser(ctx, req)
    const rows = await many<{ id: string; name: string; sort_order: number }>(
      'select id, name, sort_order from categories where business_id = $1 order by sort_order, name',
      [caller.business_id],
    )
    return paginated(rows, 100)
  })

  app.post('/categories', async (req, reply) => {
    const caller = await requireRole(ctx, req, ['owner', 'manager'])
    const body = z.object({ name: z.string().optional() }).parse(req.body)
    const name = body.name?.trim()
    if (!name) throw invalid('Category name is required.')
    if (await one('select 1 from categories where business_id = $1 and lower(name) = lower($2)', [caller.business_id, name])) {
      throw invalid('That category already exists.')
    }
    const count = await one<{ n: number }>('select count(*)::int as n from categories where business_id = $1', [caller.business_id])
    const row = await one<{ id: string; name: string; sort_order: number }>(
      'insert into categories (business_id, name, sort_order) values ($1, $2, $3) returning id, name, sort_order',
      [caller.business_id, name, (count?.n ?? 0) + 1],
    )
    return reply.status(201).send(row)
  })

  // ---------- products ----------

  app.get('/products', async (req) => {
    const caller = await requireUser(ctx, req)
    const q = z
      .object({
        search: z.string().optional(),
        category_id: z.string().optional(),
        barcode: z.string().optional(),
        include_inactive: z.string().optional(),
        store_id: z.string().optional(),
      })
      .parse(req.query)
    const params: unknown[] = [caller.business_id]
    const where = ['p.business_id = $1']
    if (q.include_inactive !== 'true') where.push('p.is_active')
    // A branch-scoped catalogue only exists once the owner has asked for one.
    // While it is shared, a product's home branch is remembered but ignored.
    if (q.store_id) {
      const biz = await one<{ shared_catalog: boolean }>('select shared_catalog from businesses where id = $1', [caller.business_id])
      if (!biz?.shared_catalog) {
        params.push(q.store_id)
        where.push(`p.store_id = $${params.length}`)
      }
    }
    if (q.barcode) {
      params.push(q.barcode)
      where.push(`p.barcode = $${params.length}`)
    }
    if (q.category_id) {
      params.push(q.category_id)
      where.push(`exists (select 1 from product_categories pc where pc.product_id = p.id and pc.category_id = $${params.length})`)
    }
    if (q.search) {
      params.push(`%${q.search.toLowerCase()}%`)
      where.push(`lower(p.name) like $${params.length}`)
    }
    const rows = await many<ProductRow>(`${PRODUCT_SELECT} where ${where.join(' and ')} order by p.created_at, p.id`, params)
    return paginated(rows.map(productOut), 200)
  })

  app.post('/products', async (req, reply) => {
    const caller = await requireRole(ctx, req, ['owner', 'manager'])
    const body = productBody.parse(req.body)
    if (!body.name?.trim() || body.price === undefined || body.price === '') throw invalid('Name and price are required.')
    if (!MONEY_RE.test(String(body.price))) throw invalid('Price must be a decimal string like "4.50".')
    if (body.price_online && !MONEY_RE.test(String(body.price_online))) throw invalid('Online price must be a decimal string like "4.50".')
    const branch = await resolveBranch(caller.business_id, body.store_id, null)
    await assertBarcodeFree(caller.business_id, body.barcode, branch, null)
    if (body.kitchen_station_id) {
      const st = await one('select 1 from kitchen_stations ks join stores s on s.id = ks.store_id where ks.id = $1 and s.business_id = $2', [body.kitchen_station_id, caller.business_id])
      if (!st) throw invalid('Unknown kitchen station.')
    }
    const optionGroups = parseOptionGroups(body.option_groups)
    const offer = parseOffer(body.offer)
    const offerOnline = parseOffer(body.offer_online)
    const categoryIds = Array.isArray(body.category_ids) ? body.category_ids : body.category_id ? [body.category_id] : []
    const id = await withTx(async (tx) => {
      const created = await one<{ id: string }>(
        `insert into products (business_id, name, name_ar, description, barcode, price, price_online, tax_rate, is_combo, offer, offer_online, option_groups, kitchen_station_id, is_active, store_id)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) returning id`,
        [
          caller.business_id,
          body.name!.trim(),
          body.name_ar?.trim() || null,
          body.description?.trim() || null,
          body.barcode || null,
          String(body.price),
          body.price_online ? String(body.price_online) : null,
          String(body.tax_rate ?? '0'),
          body.is_combo ?? false,
          offer ? JSON.stringify(offer) : null,
          offerOnline ? JSON.stringify(offerOnline) : null,
          JSON.stringify(optionGroups),
          body.kitchen_station_id ?? null,
          body.is_active ?? true,
          branch,
        ],
        tx,
      )
      await setCategories(tx, created!.id, categoryIds, caller.business_id)
      return created!.id
    })
    return reply.status(201).send(productOut(await loadProduct(ctx.db, caller.business_id, id)))
  })

  app.patch('/products/:id', async (req) => {
    const caller = await requireRole(ctx, req, ['owner', 'manager'])
    const { id } = req.params as { id: string }
    const product = await loadProduct(ctx.db, caller.business_id, id)
    const body = productBody.parse(req.body)
    const branch = await resolveBranch(caller.business_id, body.store_id, product.store_id)
    await assertBarcodeFree(
      caller.business_id,
      body.barcode !== undefined ? body.barcode : product.barcode,
      branch,
      product.id,
    )
    if (body.price !== undefined && !MONEY_RE.test(String(body.price))) throw invalid('Price must be a decimal string like "4.50".')
    if (body.price_online != null && body.price_online !== '' && !MONEY_RE.test(String(body.price_online))) {
      throw invalid('Online price must be a decimal string like "4.50".')
    }
    if (body.kitchen_station_id) {
      const st = await one('select 1 from kitchen_stations ks join stores s on s.id = ks.store_id where ks.id = $1 and s.business_id = $2', [body.kitchen_station_id, caller.business_id])
      if (!st) throw invalid('Unknown kitchen station.')
    }
    const sets: string[] = []
    const params: unknown[] = [product.id]
    const set = (col: string, value: unknown) => {
      params.push(value)
      sets.push(`${col} = $${params.length}`)
    }
    if (body.option_groups !== undefined) set('option_groups', JSON.stringify(parseOptionGroups(body.option_groups)))
    if (body.offer_online !== undefined) {
      const o = parseOffer(body.offer_online)
      set('offer_online', o ? JSON.stringify(o) : null)
    }
    if (body.offer !== undefined) {
      const o = parseOffer(body.offer)
      set('offer', o ? JSON.stringify(o) : null)
    }
    if (body.name !== undefined) set('name', body.name)
    if (body.name_ar !== undefined) set('name_ar', body.name_ar?.trim() || null)
    if (body.description !== undefined) set('description', body.description?.trim() || null)
    if (body.barcode !== undefined) set('barcode', body.barcode || null)
    if (body.price !== undefined) set('price', String(body.price))
    if (body.price_online !== undefined) set('price_online', body.price_online ? String(body.price_online) : null)
    if (body.tax_rate !== undefined) set('tax_rate', String(body.tax_rate))
    if (body.is_combo !== undefined) set('is_combo', body.is_combo)
    if (body.kitchen_station_id !== undefined) set('kitchen_station_id', body.kitchen_station_id)

    if (body.is_active !== undefined) set('is_active', body.is_active)
    if (branch !== product.store_id) set('store_id', branch)

    await withTx(async (tx) => {
      if (sets.length) await tx.query(`update products set ${sets.join(', ')} where id = $1`, params)
      if (body.category_ids !== undefined) await setCategories(tx, product.id, body.category_ids, caller.business_id)
      else if (body.category_id !== undefined) await setCategories(tx, product.id, body.category_id ? [body.category_id] : [], caller.business_id)
    })
    return productOut(await loadProduct(ctx.db, caller.business_id, product.id))
  })

  /**
   * Stand a branch's catalogue up from one that already exists. Copies the
   * source branch's own products — not the "all branches" ones, which the
   * target already sells — and skips any name the target already carries, so
   * running it twice does not double the menu.
   *
   * Kitchen routing is remapped by station NAME, because stations belong to a
   * branch: a product sent to the source's "Grill" lands on the target's
   * "Grill" if it has one, and on nothing if it does not.
   */
  app.post('/catalog/copy', async (req) => {
    const caller = await requireRole(ctx, req, ['owner'], 'Only the owner can copy a catalogue.')
    const body = z.object({ from_store_id: z.string().optional(), to_store_id: z.string().optional() }).parse(req.body)
    if (!body.from_store_id || !body.to_store_id) throw invalid('Both a source and a target branch are required.')
    if (body.from_store_id === body.to_store_id) throw invalid('Pick two different branches.')
    const branches = await many<{ id: string }>('select id from stores where business_id = $1 and id = any($2)', [
      caller.business_id,
      [body.from_store_id, body.to_store_id],
    ])
    if (branches.length !== 2) throw invalid('Both branches must belong to this business.')
    const biz = await one<{ shared_catalog: boolean }>('select shared_catalog from businesses where id = $1', [caller.business_id])
    if (biz?.shared_catalog) {
      throw conflict(
        'CATALOG_IS_SHARED',
        'This business runs one catalogue for every branch, so there is nothing to copy. Switch to a catalogue per branch first.',
      )
    }

    return withTx(async (tx) => {
      const source = await many<ProductRow>(
        `${PRODUCT_SELECT} where p.business_id = $1 and p.store_id = $2 order by p.created_at, p.id`,
        [caller.business_id, body.from_store_id],
        tx,
      )
      // What the target already sells stays exactly as it is — this adds, it
      // never replaces, so anything the second branch put on its own list is
      // untouched and its own prices win.
      const taken = new Set(
        (
          await many<{ name: string }>('select lower(name) as name from products where business_id = $1 and store_id = $2', [
            caller.business_id,
            body.to_store_id,
          ], tx)
        ).map((r) => r.name),
      )
      const targetStations = new Map(
        (
          await many<{ id: string; name: string }>('select id, lower(name) as name from kitchen_stations where store_id = $1', [body.to_store_id], tx)
        ).map((r) => [r.name, r.id]),
      )
      const sourceStations = new Map(
        (
          await many<{ id: string; name: string }>('select id, lower(name) as name from kitchen_stations where store_id = $1', [body.from_store_id], tx)
        ).map((r) => [r.id, r.name]),
      )

      let copied = 0
      let skipped = 0
      for (const p of source) {
        if (taken.has(p.name.toLowerCase())) {
          skipped++
          continue
        }
        const stationName = p.kitchen_station_id ? sourceStations.get(p.kitchen_station_id) : undefined
        const station = stationName ? (targetStations.get(stationName) ?? null) : null
        const made = await one<{ id: string }>(
          `insert into products (business_id, store_id, name, name_ar, description, barcode, price, price_online, tax_rate,
                                 is_combo, offer, offer_online, option_groups, kitchen_station_id, is_active)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) returning id`,
          [
            caller.business_id,
            body.to_store_id,
            p.name,
            p.name_ar,
            p.description,
            p.barcode,
            p.price,
            p.price_online,
            p.tax_rate,
            p.is_combo,
            p.offer ? JSON.stringify(p.offer) : null,
            p.offer_online ? JSON.stringify(p.offer_online) : null,
            JSON.stringify(p.option_groups ?? []),
            station,
            p.is_active,
          ],
          tx,
        )
        // Categories are business-wide, so the placements carry over as they are.
        await setCategories(tx, made!.id, p.category_ids, caller.business_id)
        copied++
      }
      return { copied, skipped }
    })
  })

  app.get('/kitchen/stations', async (req) => {
    const caller = await requireUser(ctx, req)
    const q = z.object({ store_id: z.string().optional() }).parse(req.query)
    const params: unknown[] = [caller.business_id]
    let scope = ''
    if (q.store_id) {
      params.push(q.store_id)
      scope = `and ks.store_id = $${params.length}`
    }
    const rows = await many<{ id: string; store_id: string; name: string; sort_order: number }>(
      `select ks.id, ks.store_id, ks.name, ks.sort_order from kitchen_stations ks join stores s on s.id = ks.store_id
        where s.business_id = $1 ${scope} order by s.store_number, ks.sort_order, ks.name`,
      params,
    )
    return paginated(rows, 50)
  })

  /**
   * Stations are the owner's floor plan for the kitchen: what a branch has,
   * what each is called, and which retire. Products route to them, so the
   * names show up on tickets and on the KDS.
   */
  const ownStation = async (id: string, businessId: string) => {
    const row = await one<{ id: string; store_id: string; name: string }>(
      `select ks.id, ks.store_id, ks.name from kitchen_stations ks join stores s on s.id = ks.store_id
        where ks.id = $1 and s.business_id = $2`,
      [id, businessId],
    )
    if (!row) throw notFound('kitchen station')
    return row
  }

  app.post('/kitchen/stations', async (req, reply) => {
    const caller = await requireRole(ctx, req, ['owner'], 'Only the owner can change kitchen stations.')
    const body = z.object({ store_id: z.string().optional(), name: z.string().optional() }).parse(req.body)
    const name = body.name?.trim()
    if (!name) throw invalid('The station needs a name (e.g. Grill).')
    if (!body.store_id || !(await one('select 1 from stores where id = $1 and business_id = $2', [body.store_id, caller.business_id]))) {
      throw invalid('A valid branch is required.')
    }
    if (await one('select 1 from kitchen_stations where store_id = $1 and lower(name) = lower($2)', [body.store_id, name])) {
      throw invalid('That branch already has a station with this name.')
    }
    const next = await one<{ n: number }>('select coalesce(max(sort_order), 0) + 1 as n from kitchen_stations where store_id = $1', [body.store_id])
    const row = await one('insert into kitchen_stations (store_id, name, sort_order) values ($1, $2, $3) returning id, store_id, name, sort_order', [
      body.store_id,
      name,
      next!.n,
    ])
    return reply.status(201).send(row)
  })

  app.patch('/kitchen/stations/:id', async (req) => {
    const caller = await requireRole(ctx, req, ['owner'], 'Only the owner can change kitchen stations.')
    const { id } = req.params as { id: string }
    const station = await ownStation(id, caller.business_id)
    const body = z.object({ name: z.string().optional() }).parse(req.body)
    if (body.name !== undefined) {
      const name = body.name.trim()
      if (!name) throw invalid('The station needs a name.')
      if (await one('select 1 from kitchen_stations where store_id = $1 and id <> $2 and lower(name) = lower($3)', [station.store_id, station.id, name])) {
        throw invalid('That branch already has a station with this name.')
      }
      await ctx.db.query('update kitchen_stations set name = $2 where id = $1', [station.id, name])
    }
    return one('select id, store_id, name, sort_order from kitchen_stations where id = $1', [station.id])
  })

  app.delete('/kitchen/stations/:id', async (req, reply) => {
    const caller = await requireRole(ctx, req, ['owner'], 'Only the owner can change kitchen stations.')
    const { id } = req.params as { id: string }
    const station = await ownStation(id, caller.business_id)
    // Live tickets hang off a station and would go with it — the kitchen would
    // lose work it is in the middle of. Finish the board first.
    const live = await one<{ n: number }>(
      "select count(*)::int as n from kitchen_tickets where station_id = $1 and status in ('new', 'in_progress')",
      [station.id],
    )
    if (live && live.n > 0) {
      throw conflict(
        'STATION_BUSY',
        `${station.name} has ${live.n} ticket${live.n === 1 ? '' : 's'} still on the board. Clear them before removing it.`,
      )
    }
    // Products routed here simply stop making kitchen work (FK is SET NULL).
    await ctx.db.query('delete from kitchen_stations where id = $1', [station.id])
    return reply.status(204).send()
  })
}
