import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { listCategories, listProducts } from '../../api/catalog'
import { useAuth } from '../../auth/AuthContext'
import { Logomark } from '../../components/Logomark'
import { fmt } from '../../lib/money'
import './register.css'

/** Colored category dots, assigned in category order — stable per session. */
const DOT_COLORS = ['#16a34a', '#f59e0b', '#3b82f6', '#d97706', '#06b6d4', '#d94720', '#8b5cf6']

export function RegisterPage() {
  const { session, activeStore } = useAuth()
  const [search, setSearch] = useState('')
  const [categoryId, setCategoryId] = useState<string | null>(null)

  const categoriesQuery = useQuery({ queryKey: ['categories'], queryFn: listCategories, enabled: !!activeStore })
  const productsQuery = useQuery({
    queryKey: ['products', { search, categoryId, showInactive: false }],
    queryFn: () =>
      listProducts({ search: search || undefined, category_id: categoryId ?? undefined }),
    enabled: !!activeStore,
  })

  const dotFor = useMemo(() => {
    const map = new Map<string, string>()
    categoriesQuery.data?.data.forEach((c, i) => map.set(c.id, DOT_COLORS[i % DOT_COLORS.length]))
    return (id: string | null) => (id ? (map.get(id) ?? '#9c998a') : '#9c998a')
  }, [categoriesQuery.data])

  if (!session) return null
  const { user } = session

  if (!activeStore) {
    return (
      <div className="register-empty card">
        <Logomark size={56} variant="two-tone" />
        <h2>Pick a store to open a till</h2>
        <p>You work across all stores — the register always belongs to one.</p>
        <Link to="/pick-store" className="btn-primary register-pick">
          Choose store
        </Link>
      </div>
    )
  }

  return (
    <div className="register">
      <div className="register-top">
        <div>
          <h2>Register — {activeStore.name}</h2>
          <p className="page-sub">
            {user.name} · {user.role}
          </p>
        </div>
        <input
          className="register-search"
          placeholder="Scan barcode or search products…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="register-tabs">
        <button
          type="button"
          className={categoryId === null ? 'chip active' : 'chip'}
          onClick={() => setCategoryId(null)}
        >
          All
        </button>
        {categoriesQuery.data?.data.map((c) => (
          <button
            key={c.id}
            type="button"
            className={categoryId === c.id ? 'chip active' : 'chip'}
            onClick={() => setCategoryId(c.id)}
          >
            {c.name}
          </button>
        ))}
      </div>

      <div className="register-grid">
        {productsQuery.isPending && <div className="register-note">Loading products…</div>}
        {productsQuery.data?.data.map((p) => (
          <button key={p.id} type="button" className="tile" title="Cart arrives in Phase 3">
            <span className="tile-cat">
              <span className="tile-dot" style={{ background: dotFor(p.category_id) }} />
              {p.category_name ?? 'Uncategorised'}
            </span>
            <span className="tile-name">{p.name}</span>
            <span className="tile-price">QAR {fmt(p.price)}</span>
          </button>
        ))}
        {productsQuery.data && productsQuery.data.data.length === 0 && (
          <div className="register-note">No products match — add them in Catalog.</div>
        )}
      </div>

      <div className="register-footnote">
        Tap-to-cart and Charge arrive in Phase 3 — this grid is live from the catalog.
      </div>
    </div>
  )
}
