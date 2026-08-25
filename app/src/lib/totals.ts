import Big from 'big.js'
import type { Money } from './money'

/**
 * THE totals formula — the exact order of operations pinned in CONVENTIONS.md.
 * The mock server and the register's live preview both call this one function;
 * the real backend must reproduce it to the halala.
 *
 *   line_total     = unit_price × quantity − line discount
 *   subtotal       = Σ line_total
 *   discount_total = order discount applied to subtotal
 *   service_charge = service_charge_rate × (subtotal − discount_total)   [dine-in only]
 *   tax_total      = Σ per-line tax on discounted amounts (order discount
 *                    apportioned to lines by their share of the subtotal)
 *   total          = subtotal − discount_total + service_charge + tax_total
 */

export interface TotalsLine {
  unit_price: Money
  quantity: string | number
  discount?: Money // per-line money discount
  tax_rate?: string // percent
}

export interface OrderDiscount {
  type: 'percent' | 'fixed'
  value: string
}

export interface TotalsInput {
  lines: TotalsLine[]
  discount?: OrderDiscount | null
  order_type?: 'counter' | 'dine_in' | 'takeaway' | 'delivery'
  service_charge_rate?: string // percent, applies to dine_in only
}

export interface Totals {
  line_totals: Money[]
  subtotal: Money
  discount_total: Money
  service_charge_total: Money
  tax_total: Money
  total: Money
}

export function computeTotals(input: TotalsInput): Totals {
  const lineTotals = input.lines.map((l) =>
    new Big(l.unit_price).times(l.quantity).minus(l.discount ?? '0'),
  )
  const subtotal = lineTotals.reduce((a, b) => a.plus(b), new Big(0))

  let discountTotal = new Big(0)
  if (input.discount) {
    discountTotal =
      input.discount.type === 'percent'
        ? subtotal.times(input.discount.value).div(100)
        : new Big(input.discount.value)
    if (discountTotal.gt(subtotal)) discountTotal = subtotal
  }
  discountTotal = new Big(discountTotal.toFixed(2))

  const discounted = subtotal.minus(discountTotal)

  let serviceCharge = new Big(0)
  if (input.order_type === 'dine_in' && input.service_charge_rate) {
    serviceCharge = new Big(discounted.times(input.service_charge_rate).div(100).toFixed(2))
  }

  // Apportion the order discount to lines by subtotal share, then tax each line.
  let tax = new Big(0)
  if (subtotal.gt(0)) {
    input.lines.forEach((l, i) => {
      const rate = new Big(l.tax_rate ?? '0')
      if (rate.eq(0)) return
      const share = lineTotals[i].div(subtotal)
      const taxable = lineTotals[i].minus(discountTotal.times(share))
      tax = tax.plus(taxable.times(rate).div(100))
    })
  }
  tax = new Big(tax.toFixed(2))

  const total = discounted.plus(serviceCharge).plus(tax)

  return {
    line_totals: lineTotals.map((t) => t.toFixed(2)),
    subtotal: subtotal.toFixed(2),
    discount_total: discountTotal.toFixed(2),
    service_charge_total: serviceCharge.toFixed(2),
    tax_total: tax.toFixed(2),
    total: total.toFixed(2),
  }
}
