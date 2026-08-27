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
import { offerActive, resolveUnitPrice } from '../../lib/pricing'
import './catalog.css'

/** A choice is a chip: a name and, optionally, what it adds to the price. */
interface ChoiceDraft {
  id?: string
  name: string
  /** surcharge as typed — "" means free */
  delta: string
}

interface GroupDraft {
  id?: string
  name: string
  required: boolean
  choices: ChoiceDraft[]
}

interface Draft {
  id?: string
  sku?: string | null
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
    choices: g.choices.map((c) => ({
      id: c.id,
      name: c.name,
      delta: new Big(c.price_delta).gt(0) ? new Big(c.price_delta).toFixed(2) : '',
    })),
  }
}

function draftToGroups(drafts: GroupDraft[]): OptionGroup[] {
  return drafts
    .filter((d) => d.name.trim() && d.choices.some((c) => c.name.trim()))
    .map((d, gi) => {
      const gid = d.id ?? `og-new-${gi}`
      return {
        id: gid,
        name: d.name.trim(),
        required: d.required,
        choices: d.choices
          .filter((c) => c.name.trim())
          .map((c, ci) => ({
            id: c.id ?? `${gid}-c${ci}`,
            name: c.name.trim(),
            price_delta: c.delta.trim() ? new Big(c.delta).toFixed(2) : '0.00',
          })),
      }
    })
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

/** "12 days left" for the header badge — null when the offer is open-ended. */
function daysLeft(endsAt: string): number | null {
  if (!endsAt) return null
  const ms = new Date(`${endsAt}T23:59:59`).getTime() - Date.now()
  return ms <= 0 ? 0 : Math.ceil(ms / 86_400_000)
}

/** The second line of the product cell: Arabic name, then what the cashier is asked. */
function productSubtitle(p: Product): string {
  const bits: string[] = []
  if (p.name_ar) bits.push(p.name_ar)
  for (const g of p.option_groups) {
    const names = g.choices.map((c) => c.name)
    bits.push(names.length <= 3 ? `${g.name}: ${names.join(' / ')}` : `${g.name}: ${names.length} options`)
  }
  return bits.join('   ·   ')
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

  function patchGroup(d: Draft, i: number, patch: Partial<GroupDraft>): Draft {
    return {
      ...d,
      option_groups: d.option_groups.map((g, j) => (j === i ? { ...g, ...patch } : g)),
    }
  }

  function patchChoice(d: Draft, gi: number, ci: number, patch: Partial<ChoiceDraft>): Draft {
    const group = d.option_groups[gi]
    return patchGroup(d, gi, {
      choices: group.choices.map((c, j) => (j === ci ? { ...c, ...patch } : c)),
    })
  }

  function toggleCategory(d: Draft, id: string): Draft {
    // Selection order matters: the first pick is the primary (reporting) category.
    return d.category_ids.includes(id)
      ? { ...d, category_ids: d.category_ids.filter((c) => c !== id) }
      : { ...d, category_ids: [...d.category_ids, id] }
  }

  const cats = categoriesQuery.data?.data ?? []
  const stations = stationsQuery.data?.data ?? []
  const products = productsQuery.data?.data ?? []

  // The offer preview: exactly what resolveUnitPrice will hand the till.
  const preview =
    draft && draft.price
      ? resolveUnitPrice(
          {
            price: draft.price,
            price_online: null,
            offer: draft.offer_enabled
              ? {
                  percent: draft.offer_percent || '0',
                  starts_at: null,
                  ends_at: draft.offer_ends
                    ? new Date(`${draft.offer_ends}T23:59:59`).toISOString()
                    : null,
                }
              : null,
          },
          'store',
        )
      : null
  const draftDays = draft?.offer_enabled ? daysLeft(draft.offer_ends) : null

  return (
    <div className="page page-wide">
      <div className="page-head">
        <div>
          <h2>Catalog</h2>
          <p className="page-sub">
            {products.length} products · prices include tax · changes never touch old receipts
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

      {/* Six columns. Barcode and station live in the editor, where they are set. */}
      <div className="cat-table">
        <div className="cat-row cat-head-row">
          <span>Product</span>
          <span>Placement</span>
          <span>Offer</span>
          <span className="num">Store / online</span>
          <span>Active</span>
          <span />
        </div>
        {productsQuery.isPending && <div className="cat-loading">Loading…</div>}
        {products.map((p) => {
          const subtitle = productSubtitle(p)
          return (
            <div key={p.id} className={p.is_active ? 'cat-row' : 'cat-row inactive'}>
              <span className="cat-product">
                <span className="cat-product-top">
                  <span className="cat-name">{p.name}</span>
                  {p.is_combo && <span className="cat-combo">Combo</span>}
                </span>
                {subtitle && (
                  <span className="cat-product-sub" dir="auto">
                    {subtitle}
                  </span>
                )}
              </span>
              <span className="cat-placement">
                {p.category_name ?? '—'}
                {p.category_ids.length > 1 && (
                  <span className="cat-more">+{p.category_ids.length - 1}</span>
                )}
              </span>
              <span>
                {p.offer ? (
                  <span className={offerActive(p.offer) ? 'cat-offer live' : 'cat-offer'}>
                    −{p.offer.percent}%
                  </span>
                ) : (
                  <span className="cat-dash">—</span>
                )}
              </span>
              <span className="num cat-prices">
                <span className="cat-price-store">{fmt(p.price)}</span>
                <span className="cat-price-sep">/</span>
                <span className="cat-price-online">
                  {p.price_online ? fmt(p.price_online) : fmt(p.price)}
                </span>
              </span>
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
                <button type="button" className="cat-edit" onClick={() => edit(p)}>
                  Edit
                </button>
              </span>
            </div>
          )
        })}
        {productsQuery.data && products.length === 0 && (
          <div className="cat-loading">No products match.</div>
        )}
      </div>

      {draft && (
        <div className="cat-modal" role="dialog" aria-modal="true">
          <form className="editor" onSubmit={onSubmit}>
            {/* Header and footer pin; the two columns scroll between them. */}
            <header className="editor-head">
              <div className="editor-head-main">
                <div className="editor-title">
                  <h3>{draft.name || (draft.id ? 'Edit product' : 'New product')}</h3>
                  {draft.is_combo && <span className="badge badge-combo">Combo</span>}
                  {draft.offer_enabled && (
                    <span className="badge badge-offer">
                      Offer live
                      {draftDays !== null && ` · ${draftDays} ${draftDays === 1 ? 'day' : 'days'} left`}
                    </span>
                  )}
                </div>
                <p className="editor-sub">
                  {draft.id ? 'Edits never touch receipts already printed' : 'New product — nothing is live until you save'}
                </p>
              </div>
              <button
                type="button"
                className="editor-close"
                aria-label="Close"
                onClick={() => setDraft(null)}
              >
                ✕
              </button>
            </header>

            <div className="editor-body">
              <div className="editor-col editor-col-left">
                <div className="editor-block">
                  <div className="block-label">Identity</div>
                  <p className="block-hint">Shown on the till, the kitchen ticket and the receipt.</p>
                </div>

                <label className="field">
                  <span>Name</span>
                  <input
                    value={draft.name}
                    onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                    required
                  />
                </label>

                <label className="field">
                  <span>Arabic name</span>
                  <input
                    dir="rtl"
                    value={draft.name_ar}
                    onChange={(e) => setDraft({ ...draft, name_ar: e.target.value })}
                  />
                </label>

                <label className="field">
                  <span>Description</span>
                  <textarea
                    rows={2}
                    placeholder="What's inside a combo"
                    value={draft.description}
                    onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                  />
                </label>

                <div className="editor-block">
                  <div className="block-label">
                    Categories
                    <span className="block-note">★ first pick is where it reports</span>
                  </div>
                </div>
                <div className="editor-cats">
                  {cats.map((c) => {
                    const picked = draft.category_ids.includes(c.id)
                    const primary = draft.category_ids[0] === c.id
                    return (
                      <button
                        key={c.id}
                        type="button"
                        className={primary ? 'chip primary' : picked ? 'chip active' : 'chip'}
                        onClick={() => setDraft(toggleCategory(draft, c.id))}
                      >
                        {primary ? '★ ' : ''}
                        {c.name}
                      </button>
                    )
                  })}
                </div>

                <div className="editor-block">
                  <div className="block-label">Routing &amp; scanning</div>
                </div>
                <div className="editor-row">
                  <label className="field">
                    <span>Kitchen station</span>
                    <select
                      value={draft.kitchen_station_id ?? ''}
                      onChange={(e) =>
                        setDraft({ ...draft, kitchen_station_id: e.target.value || null })
                      }
                    >
                      <option value="">None — no kitchen ticket</option>
                      {stations.map((s) => (
                        <option key={s.id} value={s.id}>{s.name}</option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    <span>Barcode</span>
                    <input
                      inputMode="numeric"
                      placeholder="—"
                      value={draft.barcode ?? ''}
                      onChange={(e) => setDraft({ ...draft, barcode: e.target.value.trim() || null })}
                    />
                  </label>
                </div>

                <div className="switch-row">
                  <div>
                    <div className="switch-name">Combo</div>
                    <div className="switch-hint">Sold as a bundle of items</div>
                  </div>
                  <button
                    type="button"
                    className={draft.is_combo ? 'toggle on' : 'toggle'}
                    aria-pressed={draft.is_combo}
                    aria-label="Combo"
                    onClick={() => setDraft({ ...draft, is_combo: !draft.is_combo })}
                  >
                    <span className="knob" />
                  </button>
                </div>
                <div className="switch-row">
                  <div>
                    <div className="switch-name">Active</div>
                    <div className="switch-hint">Visible on the register</div>
                  </div>
                  <button
                    type="button"
                    className={draft.is_active ? 'toggle on' : 'toggle'}
                    aria-pressed={draft.is_active}
                    aria-label="Active"
                    onClick={() => setDraft({ ...draft, is_active: !draft.is_active })}
                  >
                    <span className="knob" />
                  </button>
                </div>
              </div>

              <div className="editor-col editor-col-right">
                <div className="editor-block">
                  <div className="block-label">Pricing &amp; offer</div>
                  <p className="block-hint">All prices include tax.</p>
                </div>

                <div className="editor-row editor-row-3">
                  <label className="field">
                    <span>In-store</span>
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
                    <span>Online</span>
                    <input
                      inputMode="decimal"
                      placeholder="same"
                      pattern="\d+(\.\d{1,2})?"
                      value={draft.price_online}
                      onChange={(e) => setDraft({ ...draft, price_online: e.target.value })}
                    />
                  </label>
                  <label className="field">
                    <span>Tax %</span>
                    <input
                      inputMode="decimal"
                      value={draft.tax_rate}
                      onChange={(e) => setDraft({ ...draft, tax_rate: e.target.value })}
                    />
                  </label>
                </div>

                <div className={draft.offer_enabled ? 'offer-panel on' : 'offer-panel'}>
                  <div className="offer-head">
                    <div>
                      <div className="offer-name">Run a discount</div>
                      <div className="offer-hint">Shows a struck-through price on the till</div>
                    </div>
                    <button
                      type="button"
                      className={draft.offer_enabled ? 'toggle on' : 'toggle'}
                      aria-pressed={draft.offer_enabled}
                      aria-label="Run a discount"
                      onClick={() => setDraft({ ...draft, offer_enabled: !draft.offer_enabled })}
                    >
                      <span className="knob" />
                    </button>
                  </div>

                  {draft.offer_enabled && (
                    <>
                      <div className="editor-row">
                        <label className="field">
                          <span>Percent off</span>
                          <input
                            inputMode="numeric"
                            pattern="\d+"
                            value={draft.offer_percent}
                            onChange={(e) => setDraft({ ...draft, offer_percent: e.target.value })}
                            required
                          />
                        </label>
                        <label className="field">
                          <span>Ends</span>
                          <input
                            type="date"
                            value={draft.offer_ends}
                            onChange={(e) => setDraft({ ...draft, offer_ends: e.target.value })}
                          />
                        </label>
                      </div>

                      {preview && (
                        <div className="offer-preview">
                          <span className="offer-preview-label">On the till</span>
                          <span className="offer-preview-now">QAR {fmt(preview.price)}</span>
                          {preview.offer_applied && (
                            <>
                              <span className="offer-preview-was">{fmt(preview.original)}</span>
                              <span className="cat-offer live">−{draft.offer_percent}%</span>
                            </>
                          )}
                        </div>
                      )}
                    </>
                  )}
                </div>

                <div className="editor-block">
                  <div className="block-label">Customisable options</div>
                  <p className="block-hint">What the cashier is asked before the item joins the sale.</p>
                </div>

                {draft.option_groups.map((g, gi) => (
                  <div key={gi} className="group-card">
                    <div className="group-head">
                      <input
                        className="group-name"
                        placeholder="Flavor"
                        value={g.name}
                        onChange={(e) => setDraft(patchGroup(draft, gi, { name: e.target.value }))}
                      />
                      <button
                        type="button"
                        className={g.required ? 'group-req on' : 'group-req'}
                        aria-pressed={g.required}
                        title="Must the cashier choose?"
                        onClick={() => setDraft(patchGroup(draft, gi, { required: !g.required }))}
                      >
                        {g.required ? 'Required' : 'Optional'}
                      </button>
                      <button
                        type="button"
                        className="group-remove"
                        aria-label="Remove option group"
                        onClick={() =>
                          setDraft({
                            ...draft,
                            option_groups: draft.option_groups.filter((_, j) => j !== gi),
                          })
                        }
                      >
                        ✕
                      </button>
                    </div>
                    <div className="group-choices">
                      {g.choices.map((c, ci) => (
                        <span key={ci} className="choice-chip">
                          <input
                            className="choice-name"
                            placeholder="Choice"
                            size={Math.max(4, c.name.length || 6)}
                            value={c.name}
                            onChange={(e) =>
                              setDraft(patchChoice(draft, gi, ci, { name: e.target.value }))
                            }
                          />
                          <input
                            className="choice-delta"
                            inputMode="decimal"
                            placeholder="+"
                            title="Surcharge for this choice"
                            size={Math.max(2, c.delta.length + 1)}
                            value={c.delta ? `+${c.delta}` : ''}
                            onChange={(e) =>
                              setDraft(
                                patchChoice(draft, gi, ci, {
                                  delta: e.target.value.replace(/[^\d.]/g, ''),
                                }),
                              )
                            }
                          />
                          <button
                            type="button"
                            className="choice-remove"
                            aria-label={`Remove ${c.name || 'choice'}`}
                            onClick={() =>
                              setDraft(
                                patchGroup(draft, gi, {
                                  choices: g.choices.filter((_, j) => j !== ci),
                                }),
                              )
                            }
                          >
                            ✕
                          </button>
                        </span>
                      ))}
                      <button
                        type="button"
                        className="choice-add"
                        onClick={() =>
                          setDraft(
                            patchGroup(draft, gi, {
                              choices: [...g.choices, { name: '', delta: '' }],
                            }),
                          )
                        }
                      >
                        + choice
                      </button>
                    </div>
                  </div>
                ))}

                <button
                  type="button"
                  className="group-add"
                  onClick={() =>
                    setDraft({
                      ...draft,
                      option_groups: [
                        ...draft.option_groups,
                        { name: '', required: true, choices: [{ name: '', delta: '' }] },
                      ],
                    })
                  }
                >
                  + Add option group
                </button>
              </div>
            </div>

            {error && <div className="cat-error">{error}</div>}

            <footer className="editor-foot">
              <p className="editor-note">
                Deactivating hides it from the register — sold items keep their snapshot forever.
              </p>
              <div className="editor-actions">
                <button type="button" className="btn-secondary" onClick={() => setDraft(null)}>
                  Cancel
                </button>
                <button type="submit" className="btn-primary" disabled={save.isPending}>
                  {save.isPending ? 'Saving…' : 'Save product'}
                </button>
              </div>
            </footer>
          </form>
        </div>
      )}
    </div>
  )
}
