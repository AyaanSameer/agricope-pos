import Big from 'big.js'
import { fmt } from './money'

/**
 * A KPI's change against the period before it.
 *
 * `good` is not the same as "up". Gross sales rising is good; discounts given
 * rising is not, and neither is credit outstanding. The caller says which way
 * it wants the number to move, and the tone follows the meaning rather than
 * the sign — otherwise a page of green pills would be telling the manager the
 * opposite of the truth.
 */
export type Delta = { text: string; good: boolean } | null

function tone(up: boolean, higherIsBetter: boolean): boolean {
  return up === higherIsBetter
}

/** Money rates read as percentages: "+8.4%". */
export function pctDelta(
  now: string | number,
  before: string | number | undefined,
  higherIsBetter = true,
): Delta {
  if (before === undefined) return null
  const prev = new Big(before)
  // Everything is up from nothing — a percentage against zero says nothing.
  if (prev.eq(0)) return null
  const pct = new Big(now).minus(prev).div(prev).times(100).round(1)
  const up = pct.gte(0)
  return { text: `${up ? '+' : '−'}${pct.abs().toFixed(1)}%`, good: tone(up, higherIsBetter) }
}

/** Counts read as the count: "+12 orders" says more than "+5.9%". */
export function countDelta(now: number, before: number | undefined, higherIsBetter = true): Delta {
  if (before === undefined) return null
  const diff = now - before
  if (diff === 0) return { text: '±0', good: true }
  return { text: `${diff > 0 ? '+' : '−'}${Math.abs(diff)}`, good: tone(diff > 0, higherIsBetter) }
}

/** Balances read as the movement: "+420" of credit taken on. */
export function moneyDelta(amount: string, higherIsBetter = true): Delta {
  const v = new Big(amount)
  if (v.eq(0)) return { text: '±0', good: true }
  return {
    text: `${v.gt(0) ? '+' : '−'}${fmt(v.abs().toFixed(2))}`,
    good: tone(v.gt(0), higherIsBetter),
  }
}
