import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { listProducts } from '../api/catalog'
import type { Product } from '../api/catalog'
import { OptionPicker } from './OptionPicker'
import { fmt } from '../lib/money'
import { resolveUnitPrice } from '../lib/pricing'
import type { Channel } from '../lib/pricing'
import './additems.css'

/**
 * Pick a round of items to append to an existing open order. Shared by the
 * restaurant tab (dine-in rounds) and the Orders page (topping up an order
 * that has no table yet), so both add items exactly the same way.
 */
export function AddItemsModal({
  onAdd,
  onClose,
  title = 'Add round',
  submitLabel = 'to tab',
  channel = 'store',
}: {
  onAdd: (items: { product_id: string; quantity: string; option_ids?: string[] }[]) => Promise<void>
  onClose: () => void
  title?: string
  submitLabel?: string
  channel?: Channel
}) {
  const [search, setSearch] = useState('')
  const [picked, setPicked] = useState<
    Map<string, { product_id: string; name: string; qty: number; option_ids: string[]; labels: string[] }>
  >(new Map())
  const [pickingOptions, setPickingOptions] = useState<Product | null>(null)
  const [busy, setBusy] = useState(false)

  function addPick(p: Product, optionIds: string[], labels: string[]) {
    const key = [p.id, ...optionIds].join('|')
    setPicked((prev) => {
      const next = new Map(prev)
      const existing = next.get(key)
      next.set(key, {
        product_id: p.id,
        name: p.name,
        qty: (existing?.qty ?? 0) + 1,
        option_ids: optionIds,
        labels,
      })
      return next
    })
  }

  const productsQuery = useQuery({
    queryKey: ['products', { search, showInactive: false }],
    queryFn: () => listProducts({ search: search || undefined }),
  })

  const count = useMemo(() => [...picked.values()].reduce((a, p) => a + p.qty, 0), [picked])

  return (
    <div className="tab-additems" role="dialog" aria-modal="true">
      <div className="card tab-additems-card">
        <div className="tab-additems-head">
          <div className="tab-additems-title">
            <h3>{title}</h3>
            <p>Tap to increment. The round is unsent until you fire it.</p>
          </div>
          <button type="button" className="tab-additems-close" aria-label="Close" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="tab-additems-search">
          <span aria-hidden="true">⌕</span>
          <input
            placeholder="Search the menu…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="tab-additems-grid">
          {productsQuery.data?.data.map((p) => {
            const qty = [...picked.values()]
              .filter((x) => x.product_id === p.id)
              .reduce((a, x) => a + x.qty, 0)
            const price = resolveUnitPrice(p, channel).price
            return (
              <button
                key={p.id}
                type="button"
                className={qty > 0 ? 'tile picked' : 'tile'}
                onClick={() => {
                  if (p.option_groups.length) setPickingOptions(p)
                  else addPick(p, [], [])
                }}
              >
                <span className="tile-name">{p.name}</span>
                <span className="tile-price">QAR {fmt(price)}</span>
                {qty > 0 && <span className="tile-qty">×{qty}</span>}
              </button>
            )
          })}
        </div>
        <div className="tab-additems-foot">
        <button type="button" className="tab-additems-cancel" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="btn-primary tab-additems-add"
          disabled={count === 0 || busy}
          onClick={async () => {
            setBusy(true)
            await onAdd(
              [...picked.values()].map((p) => ({
                product_id: p.product_id,
                quantity: String(p.qty),
                option_ids: p.option_ids,
              })),
            )
            setBusy(false)
          }}
        >
          {busy ? 'Adding…' : `Add ${count} item${count === 1 ? '' : 's'} ${submitLabel}`}
        </button>
        </div>
      </div>
      {pickingOptions && (
        <OptionPicker
          product={pickingOptions}
          onAdd={(selections) => {
            addPick(
              pickingOptions,
              selections.map((s) => s.choice_id),
              selections.map((s) => s.label),
            )
            setPickingOptions(null)
          }}
          onClose={() => setPickingOptions(null)}
        />
      )}
    </div>
  )
}
