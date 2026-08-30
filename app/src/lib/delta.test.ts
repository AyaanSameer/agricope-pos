import { describe, expect, it } from 'vitest'
import { countDelta, moneyDelta, pctDelta } from './delta'

describe('KPI deltas', () => {
  it('reads a money rate as a percentage', () => {
    expect(pctDelta('108', '100')?.text).toBe('+8.0%')
    expect(pctDelta('97.9', '100')?.text).toBe('−2.1%')
  })

  it('reads a count as the count', () => {
    expect(countDelta(214, 202)?.text).toBe('+12')
  })

  it('reads a balance as the movement', () => {
    expect(moneyDelta('420')?.text).toBe('+420.00')
  })

  it('has no comparison when the period before was empty', () => {
    expect(pctDelta('500', '0')).toBeNull()
    expect(pctDelta('500', undefined)).toBeNull()
  })

  // The whole point of the flag: the tone follows the meaning, not the sign.
  it('calls a rise good when higher is better', () => {
    expect(pctDelta('108', '100')?.good).toBe(true)
    expect(pctDelta('92', '100')?.good).toBe(false)
  })

  it('calls a rise bad when lower is better — discounts, credit owed', () => {
    expect(pctDelta('109', '100', false)?.good).toBe(false)
    expect(pctDelta('91', '100', false)?.good).toBe(true)
    expect(moneyDelta('420', false)?.good).toBe(false)
    expect(countDelta(5, 2, false)?.good).toBe(false)
  })

  it('treats no change as neutral-good either way', () => {
    expect(countDelta(7, 7)?.good).toBe(true)
    expect(moneyDelta('0', false)?.good).toBe(true)
  })
})
