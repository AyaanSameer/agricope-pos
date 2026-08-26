import { useState } from 'react'
import Big from 'big.js'
import type { Product } from '../api/catalog'
import type { CartSelection } from '../cart/CartContext'
import { fmt } from '../lib/money'
import './optionpicker.css'

/**
 * A product with customisable options ("Flavor: Normal / Spicy / Mix") asks
 * the cashier to choose before it lands in the cart. One choice per group;
 * required groups preselect their first choice so two taps ring the common case.
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

  function confirm() {
    const selections: CartSelection[] = []
    for (const g of product.option_groups) {
      const choiceId = chosen[g.id]
      if (!choiceId) continue
      const choice = g.choices.find((c) => c.id === choiceId)
      if (choice) {
        selections.push({ choice_id: choice.id, label: choice.name, price_delta: choice.price_delta })
      }
    }
    onAdd(selections)
  }

  return (
    <div className="optpick" role="dialog" aria-modal="true" aria-label={`Options for ${product.name}`}>
      <div className="optpick-card card">
        <div className="optpick-head">
          <h3>{product.name}</h3>
          {product.description && <p className="optpick-desc">{product.description}</p>}
        </div>

        {product.option_groups.map((g) => (
          <div key={g.id} className="optpick-group">
            <div className="optpick-group-name">
              {g.name}
              {!g.required && <span className="optpick-optional"> · optional</span>}
            </div>
            <div className="optpick-choices">
              {g.choices.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className={chosen[g.id] === c.id ? 'optpick-choice active' : 'optpick-choice'}
                  onClick={() =>
                    setChosen((prev) =>
                      !g.required && prev[g.id] === c.id
                        ? { ...prev, [g.id]: '' }
                        : { ...prev, [g.id]: c.id },
                    )
                  }
                >
                  {c.name}
                  {new Big(c.price_delta).gt(0) && (
                    <span className="optpick-delta">+{fmt(c.price_delta)}</span>
                  )}
                </button>
              ))}
            </div>
          </div>
        ))}

        <div className="optpick-actions">
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn-primary" disabled={!ready} onClick={confirm}>
            Add to sale
          </button>
        </div>
      </div>
    </div>
  )
}
