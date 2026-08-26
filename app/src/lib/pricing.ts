import Big from 'big.js'
import type { Money } from './money'

/**
 * Channel + offer price resolution — the ONE place a sell price is computed.
 * The register preview and the mock server both call this, so they always
 * agree (the same contract totals.ts has with computeTotals).
 *
 * Prices are TAX-INCLUSIVE (Gulf convention): what is resolved here is what
 * the customer pays; tax is extracted as a memo line, never added on top.
 */

export type Channel = 'store' | 'online'

export interface ProductOffer {
  /** whole-number percent, e.g. "20" */
  percent: string
  starts_at: string | null // null = already started
  ends_at: string | null // null = open-ended
}

export interface PricedProduct {
  price: string
  price_online: string | null
  offer: ProductOffer | null
}

export function offerActive(offer: ProductOffer | null, now: Date = new Date()): boolean {
  if (!offer) return false
  if (!(Number(offer.percent) > 0)) return false
  const t = now.toISOString()
  if (offer.starts_at && t < offer.starts_at) return false
  if (offer.ends_at && t > offer.ends_at) return false
  return true
}

export interface ResolvedPrice {
  /** what the customer pays for one unit (before option deltas) */
  price: Money
  /** the pre-offer price for this channel — equal to `price` when no offer runs */
  original: Money
  offer_applied: boolean
}

/** Base price for the channel, with any live offer applied. Rounded once, here. */
export function resolveUnitPrice(
  p: PricedProduct,
  channel: Channel,
  now: Date = new Date(),
): ResolvedPrice {
  const base = channel === 'online' && p.price_online !== null ? p.price_online : p.price
  if (!offerActive(p.offer, now)) {
    return { price: new Big(base).toFixed(2), original: new Big(base).toFixed(2), offer_applied: false }
  }
  const discounted = new Big(base).times(new Big(100).minus(p.offer!.percent)).div(100)
  return { price: discounted.toFixed(2), original: new Big(base).toFixed(2), offer_applied: true }
}

/** Selected option deltas stack on top of the resolved unit price. */
export function withOptionDeltas(unit: Money, deltas: Money[]): Money {
  return deltas.reduce((a, d) => a.plus(d), new Big(unit)).toFixed(2)
}

/** Orders placed on the online channel use online prices; everything else is in-store. */
export function channelForOrderType(
  orderType: 'counter' | 'dine_in' | 'takeaway' | 'delivery',
): Channel {
  return orderType === 'delivery' ? 'online' : 'store'
}
