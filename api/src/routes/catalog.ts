import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { Ctx } from '../app.js'
import { requireRole, requireUser } from '../auth.js'
import { many, one, withTx } from '../db.js'
import type { Queryable } from '../db.js'
import { invalid, notFound } from '../errors.js'
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
         ks.name as station_name
    from products p
    left join kitchen_stations ks on ks.id = p.kitchen_station_id`

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
      })
      .parse(req.query)
    const params: unknown[] = [caller.business_id]
    const where = ['p.business_id = $1']
    if (q.include_inactive !== 'true') where.push('p.is_active')
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
    if (body.barcode && (await one('select 1 from products where business_id = $1 and barcode = $2', [caller.business_id, body.barcode]))) {
      throw invalid('Another product already has that barcode.')
    }
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
        `insert into products (business_id, name, name_ar, description, barcode, price, price_online, tax_rate, is_combo, offer, offer_online, option_groups, kitchen_station_id, is_active)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) returning id`,
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
    if (body.barcode && (await one('select 1 from products where business_id = $1 and barcode = $2 and id <> $3', [caller.business_id, body.barcode, product.id]))) {
      throw invalid('Another product already has that barcode.')
    }
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

    await withTx(async (tx) => {
      if (sets.length) await tx.query(`update products set ${sets.join(', ')} where id = $1`, params)
      if (body.category_ids !== undefined) await setCategories(tx, product.id, body.category_ids, caller.business_id)
      else if (body.category_id !== undefined) await setCategories(tx, product.id, body.category_id ? [body.category_id] : [], caller.business_id)
    })
    return productOut(await loadProduct(ctx.db, caller.business_id, product.id))
  })

  app.get('/kitchen/stations', async (req) => {
    const caller = await requireUser(ctx, req)
    const rows = await many<{ id: string; store_id: string; name: string }>(
      `select ks.id, ks.store_id, ks.name from kitchen_stations ks join stores s on s.id = ks.store_id
        where s.business_id = $1 order by s.store_number, ks.sort_order, ks.name`,
      [caller.business_id],
    )
    return paginated(rows, 50)
  })
}
