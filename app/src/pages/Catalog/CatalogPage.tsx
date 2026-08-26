import { useState } from 'react'
import type { FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import Big from 'big.js'
import {
  createCategory,
  createProduct,
  listCategories,
  listProducts,
  listStations,
  updateProduct,
} from '../../api/catalog'
import type { OptionGroup, Product, ProductInput } from '../../api/catalog'
import { ApiError } from '../../api/client'
import { fmt } from '../../lib/money'
import { offerActive } from '../../lib/pricing'
import './catalog.css'

/** Option groups edit as text — "Normal / Spicy / Mix", price deltas as "Extra shot:+6". */
interface GroupDraft {
  id?: string
  name: string
  required: boolean
  choicesText: string
}

interface Draft {
  id?: string
  name: string
  name_ar: string
  description: string
  category_ids: string[]
  barcode: string | null
  price: string
  price_online: string
  tax_rate: string
  is_combo: boolean
  offer_enabled: boolean
  offer_percent: string
  offer_ends: string // yyyy-mm-dd, empty = open-ended
  option_groups: GroupDraft[]
  kitchen_station_id: string | null
  is_active: boolean
}

const EMPTY: Draft = {
  name: '',
  name_ar: '',
  description: '',
  category_ids: [],
  barcode: null,
  price: '',
  price_online: '',
  tax_rate: '0',
  is_combo: false,
  offer_enabled: false,
  offer_percent: '20',
  offer_ends: '',
  option_groups: [],
  kitchen_station_id: null,
  is_active: true,
}

function groupToDraft(g: OptionGroup): GroupDraft {
  return {
    id: g.id,
    name: g.name,
    required: g.required,
    choicesText: g.choices
      .map((c) => (new Big(c.price_delta).gt(0) ? `${c.name}:+${c.price_delta}` : c.name))
      .join(' / '),
  }
}

function draftToGroups(drafts: GroupDraft[]): OptionGroup[] {
  return drafts
    .filter((d) => d.name.trim() && d.choicesText.trim())
    .map((d, gi) => ({
      id: d.id ?? `og-new-${gi}`,
      name: d.name.trim(),
      required: d.required,
      choices: d.choicesText
        .split('/')
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s, ci) => {
          const m = s.match(/^(.*?):\+\s*(\d+(?:\.\d{1,2})?)$/)
          return {
            id: `${d.id ?? `og-new-${gi}`}-c${ci}`,
            name: m ? m[1].trim() : s,
            price_delta: m ? new Big(m[2]).toFixed(2) : '0.00',
          }
        }),
    }))
}

function productToDraft(p: Product): Draft {
  return {
    id: p.id,
    name: p.name,
    name_ar: p.name_ar ?? '',
    description: p.description ?? '',
    category_ids: p.category_ids,
    barcode: p.barcode,
    price: p.price,
    price_online: p.price_online ?? '',
    tax_rate: p.tax_rate,
    is_combo: p.is_combo,
    offer_enabled: p.offer !== null,
    offer_percent: p.offer?.percent ?? '20',
    offer_ends: p.offer?.ends_at ? p.offer.ends_at.slice(0, 10) : '',
    option_groups: p.option_groups.map(groupToDraft),
    kitchen_station_id: p.kitchen_station_id,
    is_active: p.is_active,
  }
}

function draftToInput(d: Draft): ProductInput {
  return {
    name: d.name,
    name_ar: d.name_ar.trim() || null,
    description: d.description.trim() || null,
    category_ids: d.category_ids,
    barcode: d.barcode,
    price: d.price,
    price_online: d.price_online.trim() || null,
    tax_rate: d.tax_rate,
    is_combo: d.is_combo,
    offer: d.offer_enabled
      ? {
          percent: d.offer_percent,
          starts_at: null,
          ends_at: d.offer_ends ? new Date(`${d.offer_ends}T23:59:59`).toISOString() : null,
        }
      : null,
    option_groups: draftToGroups(d.option_groups),
    kitchen_station_id: d.kitchen_station_id,
    is_active: d.is_active,
  }
}

export function CatalogPage() {
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [categoryId, setCategoryId] = useState<string | null>(null)
  const [showInactive, setShowInactive] = useState(false)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [addingCategory, setAddingCategory] = useState(false)
  const [newCategory, setNewCategory] = useState('')

  const categoriesQuery = useQuery({ queryKey: ['categories'], queryFn: listCategories })
  const stationsQuery = useQuery({ queryKey: ['stations'], queryFn: listStations })
  const productsQuery = useQuery({
    queryKey: ['products', { search, categoryId, showInactive }],
    queryFn: () =>
      listProducts({
        search: search || undefined,
        category_id: categoryId ?? undefined,
        include_inactive: showInactive,
      }),
  })

  const invalidateProducts = () => queryClient.invalidateQueries({ queryKey: ['products'] })

  const save = useMutation({
    mutationFn: (d: Draft) => {
      const input = draftToInput(d)
      return d.id ? updateProduct(d.id, input) : createProduct(input)
    },
    onSuccess: () => {
      invalidateProducts()
      setDraft(null)
      setError(null)
    },
    onError: (err) =>
      setError(err instanceof ApiError ? err.message : 'Could not save — try again.'),
  })

  const toggleActive = useMutation({
    mutationFn: (p: Product) => updateProduct(p.id, { is_active: !p.is_active }),
    onSuccess: invalidateProducts,
  })

  const addCategory = useMutation({
    mutationFn: (name: string) => createCategory(name),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['categories'] })
      setNewCategory('')
      setAddingCategory(false)
    },
  })

  function edit(p: Product) {
    setError(null)
    setDraft(productToDraft(p))
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (draft) save.mutate(draft)
  }

  function toggleCategory(d: Draft, id: string): Draft {
    // Selection order matters: the first pick is the primary (reporting) category.
    return d.category_ids.includes(id)
      ? { ...d, category_ids: d.category_ids.filter((c) => c !== id) }
      : { ...d, category_ids: [...d.category_ids, id] }
  }

  const cats = categoriesQuery.data?.data ?? []
  const stations = stationsQuery.data?.data ?? []

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h2>Catalog</h2>
          <p className="page-sub">
            Products &amp; categories · prices include tax · changes never touch old receipts
          </p>
        </div>
        <button
          type="button"
          className="btn-primary cat-add"
          onClick={() => {
            setError(null)
            setDraft({ ...EMPTY, category_ids: categoryId ? [categoryId] : [] })
          }}
        >
          + Add product
        </button>
      </div>

      <div className="cat-toolbar">
        <input
          className="cat-search"
          placeholder="Search products…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="cat-chips">
          <button
            type="button"
            className={categoryId === null ? 'chip active' : 'chip'}
            onClick={() => setCategoryId(null)}
          >
            All
          </button>
          {cats.map((c) => (
            <button
              key={c.id}
              type="button"
              className={categoryId === c.id ? 'chip active' : 'chip'}
              onClick={() => setCategoryId(c.id)}
            >
              {c.name}
            </button>
          ))}
          {addingCategory ? (
            <form
              className="cat-newcat"
              onSubmit={(e) => {
                e.preventDefault()
                if (newCategory.trim()) addCategory.mutate(newCategory.trim())
              }}
            >
              <input
                autoFocus
                placeholder="Category name"
                value={newCategory}
                onChange={(e) => setNewCategory(e.target.value)}
              />
              <button type="submit" className="chip active">Save</button>
              <button type="button" className="chip" onClick={() => setAddingCategory(false)}>✕</button>
            </form>
          ) : (
            <button type="button" className="chip dashed" onClick={() => setAddingCategory(true)}>
              + New category
            </button>
          )}
        </div>
        <label className="cat-inactive">
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(e) => setShowInactive(e.target.checked)}
          />
          Show inactive
        </label>
      </div>

      <div className="card cat-table">
        <div className="cat-row cat-head-row">
          <span>Product</span><span>Category</span><span>Options</span><span>Offer</span><span className="num">In-store</span><span className="num">Online</span><span>Active</span><span />
        </div>
        {productsQuery.isPending && <div className="cat-loading">Loading…</div>}
        {productsQuery.data?.data.map((p) => (
          <div key={p.id} className={p.is_active ? 'cat-row' : 'cat-row inactive'}>
            <span className="cat-name">
              {p.name}
              {p.is_combo && <span className="cat-combo">combo</span>}
            </span>
            <span>
              {p.category_name ?? '—'}
              {p.category_ids.length > 1 && (
                <span className="cat-more"> +{p.category_ids.length - 1}</span>
              )}
            </span>
            <span className="cat-opts">
              {p.option_groups.length
                ? p.option_groups.map((g) => g.name).join(', ')
                : '—'}
            </span>
            <span>
              {p.offer ? (
                <span className={offerActive(p.offer) ? 'cat-offer live' : 'cat-offer'}>
                  −{p.offer.percent}%
                </span>
              ) : (
                '—'
              )}
            </span>
            <span className="num cat-price">{fmt(p.price)}</span>
            <span className="num cat-price">{p.price_online ? fmt(p.price_online) : '—'}</span>
            <span>
              <button
                type="button"
                className={p.is_active ? 'toggle on' : 'toggle'}
                aria-label={p.is_active ? 'Deactivate' : 'Activate'}
                onClick={() => toggleActive.mutate(p)}
              >
                <span className="knob" />
              </button>
            </span>
            <span>
              <button type="button" className="btn-secondary cat-edit" onClick={() => edit(p)}>
                Edit
              </button>
            </span>
          </div>
        ))}
        {productsQuery.data && productsQuery.data.data.length === 0 && (
          <div className="cat-loading">No products match.</div>
        )}
      </div>

      {draft && (
        <div className="cat-modal" role="dialog" aria-modal="true">
          <form className="cat-form card" onSubmit={onSubmit}>
            <h3>{draft.id ? 'Edit product' : 'New product'}</h3>

            <div className="cat-form-row">
              <label className="field">
                <span>Name</span>
                <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} required />
              </label>
              <label className="field">
                <span>Arabic name (receipts &amp; kitchen)</span>
                <input
                  dir="rtl"
                  value={draft.name_ar}
                  onChange={(e) => setDraft({ ...draft, name_ar: e.target.value })}
                />
              </label>
            </div>

            <label className="field">
              <span>Description (what's inside a combo)</span>
              <textarea
                rows={2}
                value={draft.description}
                onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              />
            </label>

            <div className="field">
              <span>Categories — first pick is where it reports</span>
              <div className="cat-form-cats">
                {cats.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    className={draft.category_ids.includes(c.id) ? 'chip active' : 'chip'}
                    onClick={() => setDraft(toggleCategory(draft, c.id))}
                  >
                    {draft.category_ids[0] === c.id ? '★ ' : ''}
                    {c.name}
                  </button>
                ))}
              </div>
            </div>

            <div className="cat-form-row">
              <label className="field">
                <span>In-store price (QAR, incl. tax)</span>
                <input
                  inputMode="decimal"
                  placeholder="35.00"
                  pattern="\d+(\.\d{1,2})?"
                  value={draft.price}
                  onChange={(e) => setDraft({ ...draft, price: e.target.value })}
                  required
                />
              </label>
              <label className="field">
                <span>Online price (blank = same)</span>
                <input
                  inputMode="decimal"
                  placeholder="38.00"
                  pattern="\d+(\.\d{1,2})?"
                  value={draft.price_online}
                  onChange={(e) => setDraft({ ...draft, price_online: e.target.value })}
                />
              </label>
              <label className="field">
                <span>Tax rate %</span>
                <input
                  inputMode="decimal"
                  value={draft.tax_rate}
                  onChange={(e) => setDraft({ ...draft, tax_rate: e.target.value })}
                />
              </label>
            </div>

            <div className="cat-offer-box">
              <label className="cat-check">
                <input
                  type="checkbox"
                  checked={draft.offer_enabled}
                  onChange={(e) => setDraft({ ...draft, offer_enabled: e.target.checked })}
                />
                Run a discount on this product
              </label>
              {draft.offer_enabled && (
                <div className="cat-form-row">
                  <label className="field">
                    <span>Discount %</span>
                    <input
                      inputMode="numeric"
                      pattern="\d+"
                      value={draft.offer_percent}
                      onChange={(e) => setDraft({ ...draft, offer_percent: e.target.value })}
                      required
                    />
                  </label>
                  <label className="field">
                    <span>Until (blank = until removed)</span>
                    <input
                      type="date"
                      value={draft.offer_ends}
                      onChange={(e) => setDraft({ ...draft, offer_ends: e.target.value })}
                    />
                  </label>
                </div>
              )}
            </div>

            <div className="field">
              <span>Customisable options — choices split with “/”, paid extras as “Name:+6.00”</span>
              {draft.option_groups.map((g, i) => (
                <div key={i} className="cat-group-row">
                  <input
                    className="cat-group-name"
                    placeholder="Flavor"
                    value={g.name}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        option_groups: draft.option_groups.map((x, j) =>
                          j === i ? { ...x, name: e.target.value } : x,
                        ),
                      })
                    }
                  />
                  <input
                    className="cat-group-choices"
                    placeholder="Normal / Spicy / Mix"
                    value={g.choicesText}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        option_groups: draft.option_groups.map((x, j) =>
                          j === i ? { ...x, choicesText: e.target.value } : x,
                        ),
                      })
                    }
                  />
                  <label className="cat-group-req" title="Cashier must choose">
                    <input
                      type="checkbox"
                      checked={g.required}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          option_groups: draft.option_groups.map((x, j) =>
                            j === i ? { ...x, required: e.target.checked } : x,
                          ),
                        })
                      }
                    />
                    req.
                  </label>
                  <button
                    type="button"
                    className="chip"
                    aria-label="Remove option group"
                    onClick={() =>
                      setDraft({
                        ...draft,
                        option_groups: draft.option_groups.filter((_, j) => j !== i),
                      })
                    }
                  >
                    ✕
                  </button>
                </div>
              ))}
              <button
                type="button"
                className="chip dashed"
                onClick={() =>
                  setDraft({
                    ...draft,
                    option_groups: [
                      ...draft.option_groups,
                      { name: '', required: true, choicesText: '' },
                    ],
                  })
                }
              >
                + Add option group
              </button>
            </div>

            <div className="cat-form-row">
              <label className="field">
                <span>Kitchen station (restaurant)</span>
                <select
                  value={draft.kitchen_station_id ?? ''}
                  onChange={(e) => setDraft({ ...draft, kitchen_station_id: e.target.value || null })}
                >
                  <option value="">None — no kitchen ticket</option>
                  {stations.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Barcode (scan-ready, optional)</span>
                <input
                  inputMode="numeric"
                  placeholder="628 000 111 …"
                  value={draft.barcode ?? ''}
                  onChange={(e) => setDraft({ ...draft, barcode: e.target.value.trim() || null })}
                />
              </label>
            </div>

            <div className="cat-form-row">
              <label className="cat-check">
                <input
                  type="checkbox"
                  checked={draft.is_combo}
                  onChange={(e) => setDraft({ ...draft, is_combo: e.target.checked })}
                />
                Combo — sold as a bundle of items
              </label>
              <label className="cat-check">
                <input
                  type="checkbox"
                  checked={draft.is_active}
                  onChange={(e) => setDraft({ ...draft, is_active: e.target.checked })}
                />
                Active — visible on the register
              </label>
            </div>

            {error && <div className="cat-error">{error}</div>}
            <div className="cat-form-actions">
              <button type="button" className="btn-secondary" onClick={() => setDraft(null)}>
                Cancel
              </button>
              <button type="submit" className="btn-primary" disabled={save.isPending}>
                {save.isPending ? 'Saving…' : 'Save product'}
              </button>
            </div>
            <p className="cat-note">
              Deactivating hides a product from the register; sold items keep their receipt
              snapshot forever.
            </p>
          </form>
        </div>
      )}
    </div>
  )
}
