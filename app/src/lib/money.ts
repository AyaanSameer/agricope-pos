import Big from 'big.js'

/**
 * Money moves through the API as decimal strings ("60.00") and must never
 * touch JS floats — 0.1 + 0.2 !== 0.3. All arithmetic goes through Big.
 */
export type Money = string

export function add(a: Money, b: Money): Money {
  return new Big(a).plus(b).toFixed(2)
}

export function sub(a: Money, b: Money): Money {
  return new Big(a).minus(b).toFixed(2)
}

/** quantity can be fractional for weighed goods ("1.250" kg) */
export function mulQty(unitPrice: Money, qty: string | number): Money {
  return new Big(unitPrice).times(qty).toFixed(2)
}

export function isZero(a: Money): boolean {
  return new Big(a).eq(0)
}

export function gt(a: Money, b: Money): boolean {
  return new Big(a).gt(b)
}

export function gte(a: Money, b: Money): boolean {
  return new Big(a).gte(b)
}

/** "1250.5" → "1,250.50" */
export function fmt(a: Money): string {
  const fixed = new Big(a).toFixed(2)
  const neg = fixed.startsWith('-')
  const [int, dec] = (neg ? fixed.slice(1) : fixed).split('.')
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return `${neg ? '−' : ''}${grouped}.${dec}`
}

export function fmtQAR(a: Money): string {
  return `QAR ${fmt(a)}`
}
