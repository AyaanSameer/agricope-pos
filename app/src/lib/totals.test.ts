import { describe, expect, it } from 'vitest'
import { computeTotals } from './totals'

/**
 * These cases pin THE formula. The backend must reproduce every one of them
 * to the halala — copy them into her integration suite.
 */
describe('computeTotals — the pinned order of operations', () => {
  it('computes the design-doc example: 105 subtotal − 5 line discount = 100', () => {
    const t = computeTotals({
      lines: [
        { unit_price: '35.00', quantity: '2' }, // 70.00
        { unit_price: '40.00', quantity: '1', discount: '5.00' }, // 35.00
      ],
      order_type: 'counter',
    })
    expect(t.subtotal).toBe('105.00')
    expect(t.total).toBe('105.00')
    expect(t.line_totals).toEqual(['70.00', '35.00'])
  })

  it('applies a percent order discount to the subtotal', () => {
    const t = computeTotals({
      lines: [{ unit_price: '38.00', quantity: '1' }],
      discount: { type: 'percent', value: '20' },
    })
    expect(t.discount_total).toBe('7.60')
    expect(t.total).toBe('30.40')
  })

  it('caps a fixed discount at the subtotal — never negative totals', () => {
    const t = computeTotals({
      lines: [{ unit_price: '10.00', quantity: '1' }],
      discount: { type: 'fixed', value: '25.00' },
    })
    expect(t.discount_total).toBe('10.00')
    expect(t.total).toBe('0.00')
  })

  it('adds service charge on dine-in only, after the discount', () => {
    const dineIn = computeTotals({
      lines: [{ unit_price: '100.00', quantity: '1' }],
      discount: { type: 'fixed', value: '20.00' },
      order_type: 'dine_in',
      service_charge_rate: '10',
    })
    expect(dineIn.service_charge_total).toBe('8.00') // 10% of (100 − 20)
    expect(dineIn.total).toBe('88.00')

    const takeaway = computeTotals({
      lines: [{ unit_price: '100.00', quantity: '1' }],
      order_type: 'takeaway',
      service_charge_rate: '10',
    })
    expect(takeaway.service_charge_total).toBe('0.00')
  })

  it('extracts inclusive tax per line from discounted amounts, apportioned by subtotal share', () => {
    const t = computeTotals({
      lines: [
        { unit_price: '100.00', quantity: '1', tax_rate: '10' }, // half the subtotal
        { unit_price: '100.00', quantity: '1', tax_rate: '0' },
      ],
      discount: { type: 'fixed', value: '40.00' },
    })
    // taxable line 1: 100 − 40×(100/200) = 80 → extracted: 80 × 10/110 = 7.27
    expect(t.tax_total).toBe('7.27')
    // prices are tax-inclusive, so tax never adds to the total
    expect(t.total).toBe('160.00') // 200 − 40
  })

  it('handles weighed quantities in line totals', () => {
    const t = computeTotals({ lines: [{ unit_price: '4.50', quantity: '1.250' }] })
    expect(t.subtotal).toBe('5.63')
  })
})
