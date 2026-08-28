import { useState } from 'react'
import Big from 'big.js'
import type { Product } from '../api/catalog'
import type { CartSelection } from '../cart/CartContext'
import { fmt } from '../lib/money'
import { resolveUnitPrice } from '../lib/pricing'
import './optionpicker.css'

/**
 * A product with customisable options ("Flavor: Normal / Spicy / Mix") asks
 * the cashier to choose before it lands in the cart. One choice per group,
 * as full-width radio rows — at a till you aim with a thumb, not a cursor.
 * Required groups preselect their first choice so two taps ring the common case.
 */
export function OptionPicker({
  product,
  onAdd,
  onClose,
}: {
  product: Product
  onAdd: (selections: CartSelection[]) => void
  onClose: () => void
}) {
  const [chosen, setChosen] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      product.option_groups
        .filter((g) => g.required && g.choices.length)
        .map((g) => [g.id, g.choices[0].id]),
    ),
  )

  const ready = product.option_groups.every((g) => !g.required || chosen[g.id])

  const selections: CartSelection[] = []
  for (const g of product.option_groups) {
    const choice = g.choices.find((c) => c.id === chosen[g.id])
    if (choice) {
      selections.push({ choice_id: choice.id, label: choice.name, price_delta: choice.price_delta })
    }
  }

  // What the button promises is what the line will cost: base price with any
  // live offer applied, plus the surcharges chosen above it.
  const base = resolveUnitPrice(product, 'store')
  const total = selections.reduce((a, s) => a.plus(s.price_delta), new Big(base.price))

  return (
    <div
      className="optpick ag-scrim"
      role="dialog"
      aria-modal="true"
      aria-label={`Options for ${product.name}`}
    >
      <div className="optpick-card ag-modal">
        <div className="optpick-head">
          <span className="optpick-title">{product.name}</span>
        </div>

        {product.option_groups.map((g) => (
          <div key={g.id} className="optpick-group">
            <div className="optpick-group-head">
              <span className="optpick-group-name">{g.name}</span>
              <span className={g.required ? 'optpick-tag required' : 'optpick-tag'}>
                {g.required ? 'Required' : 'Optional'}
              </span>
            </div>
            <div className="optpick-choices">
              {g.choices.map((c) => {
                const picked = chosen[g.id] === c.id
                const extra = new Big(c.price_delta)
                return (
                  <button
                    key={c.id}
                    type="button"
                    role="radio"
                    aria-checked={picked}
                    className={picked ? 'optpick-choice picked' : 'optpick-choice'}
                    onClick={() =>
                      setChosen((prev) =>
                        !g.required && prev[g.id] === c.id
                          ? { ...prev, [g.id]: '' }
                          : { ...prev, [g.id]: c.id },
                      )
                    }
                  >
                    <span className="optpick-radio" aria-hidden="true" />
                    <span className="optpick-choice-name">{c.name}</span>
                    {extra.gt(0) && <span className="optpick-delta">+{fmt(c.price_delta)}</span>}
                  </button>
                )
              })}
            </div>
          </div>
        ))}

        <div className="optpick-actions">
          <button type="button" className="optpick-cancel" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="optpick-add"
            disabled={!ready}
            onClick={() => onAdd(selections)}
          >
            Add to sale · QAR {fmt(total.toFixed(2))}
          </button>
        </div>
      </div>
    </div>
  )
}
