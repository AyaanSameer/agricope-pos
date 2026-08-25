import { useState } from 'react'
import type { FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  createCategory,
  createProduct,
  listCategories,
  listProducts,
  listStations,
  updateProduct,
} from '../../api/catalog'
import type { Product, ProductInput } from '../../api/catalog'
import { ApiError } from '../../api/client'
import { fmt } from '../../lib/money'
import './catalog.css'

type Draft = ProductInput & { id?: string }

const EMPTY: Draft = {
  name: '',
  category_id: null,
  barcode: null,
  price: '',
  tax_rate: '0',
  kitchen_station_id: null,
  is_active: true,
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
      const input: ProductInput = {
        name: d.name,
        category_id: d.category_id,
        barcode: d.barcode,
        price: d.price,
        tax_rate: d.tax_rate,
        kitchen_station_id: d.kitchen_station_id,
        is_active: d.is_active,
      }
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
    setDraft({
      id: p.id,
      name: p.name,
      category_id: p.category_id,
      barcode: p.barcode,
      price: p.price,
      tax_rate: p.tax_rate,
      kitchen_station_id: p.kitchen_station_id,
      is_active: p.is_active,
    })
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (draft) save.mutate(draft)
  }

  const cats = categoriesQuery.data?.data ?? []
  const stations = stationsQuery.data?.data ?? []

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h2>Catalog</h2>
          <p className="page-sub">
            Products &amp; categories · price changes never touch old receipts
          </p>
        </div>
        <button
          type="button"
          className="btn-primary cat-add"
          onClick={() => {
            setError(null)
            setDraft({ ...EMPTY, category_id: categoryId })
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
          <span>Product</span><span>Barcode</span><span>Category</span><span>Station</span><span className="num">Price (QAR)</span><span>Active</span><span />
        </div>
        {productsQuery.isPending && <div className="cat-loading">Loading…</div>}
        {productsQuery.data?.data.map((p) => (
          <div key={p.id} className={p.is_active ? 'cat-row' : 'cat-row inactive'}>
            <span className="cat-name">{p.name}</span>
            <span className="cat-code">{p.barcode ?? '—'}</span>
            <span>{p.category_name ?? '—'}</span>
            <span>{p.station_name ?? '—'}</span>
            <span className="num cat-price">{fmt(p.price)}</span>
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
            <label className="field">
              <span>Name</span>
              <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} required />
            </label>
            <div className="cat-form-row">
              <label className="field">
                <span>Category</span>
                <select
                  value={draft.category_id ?? ''}
                  onChange={(e) => setDraft({ ...draft, category_id: e.target.value || null })}
                >
                  <option value="">Uncategorised</option>
                  {cats.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </label>
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
            </div>
            <div className="cat-form-row">
              <label className="field">
                <span>Price (QAR)</span>
                <input
                  inputMode="decimal"
                  placeholder="4.50"
                  pattern="\d+(\.\d{1,2})?"
                  value={draft.price}
                  onChange={(e) => setDraft({ ...draft, price: e.target.value })}
                  required
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
            <label className="field">
              <span>Barcode (scan-ready, optional)</span>
              <input
                inputMode="numeric"
                placeholder="628 000 111 …"
                value={draft.barcode ?? ''}
                onChange={(e) => setDraft({ ...draft, barcode: e.target.value.trim() || null })}
              />
            </label>
            <label className="cat-check">
              <input
                type="checkbox"
                checked={draft.is_active ?? true}
                onChange={(e) => setDraft({ ...draft, is_active: e.target.checked })}
              />
              Active — visible on the register
            </label>
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
