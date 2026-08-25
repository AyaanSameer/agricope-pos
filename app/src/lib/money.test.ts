import { describe, expect, it } from 'vitest'
import { add, fmt, fmtQAR, gt, gte, isZero, mulQty, sub } from './money'

describe('money', () => {
  it('adds without float drift (0.10 + 0.20 = 0.30)', () => {
    expect(add('0.10', '0.20')).toBe('0.30')
  })

  it('sums a split payment exactly to the total', () => {
    expect(add('60.00', '40.00')).toBe('100.00')
  })

  it('subtracts to compute remaining due', () => {
    expect(sub('100.00', '60.00')).toBe('40.00')
  })

  it('goes negative for refunds', () => {
    expect(sub('0.00', '25.50')).toBe('-25.50')
  })

  it('multiplies quantity × unit price', () => {
    expect(mulQty('4.50', 2)).toBe('9.00')
  })

  it('handles weighed goods with 3-decimal quantities', () => {
    expect(mulQty('4.50', '1.250')).toBe('5.63') // 5.625 rounds half-up
  })

  it('always yields two decimals', () => {
    expect(add('1', '2')).toBe('3.00')
  })

  it('compares money', () => {
    expect(gt('100.00', '99.99')).toBe(true)
    expect(gte('40.00', '40.00')).toBe(true)
    expect(isZero('0.00')).toBe(true)
  })

  it('formats with thousands grouping', () => {
    expect(fmt('8432.5')).toBe('8,432.50')
    expect(fmt('1250')).toBe('1,250.00')
  })

  it('formats negatives with a minus sign', () => {
    expect(fmt('-5')).toBe('−5.00')
  })

  it('prefixes the currency', () => {
    expect(fmtQAR('65.9')).toBe('QAR 65.90')
  })
})
