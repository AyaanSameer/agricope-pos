/**
 * The real AGRICOPE brand art, straight out of Agricope files.fig — no part of
 * the mark is redrawn. The mark is 5 : 6.02, never square: every placement sets
 * a height and leaves the width to the intrinsic ratio.
 *
 * White art goes on greens, black and other dark grounds; full colour only on
 * light grounds. Clear space is X/2 all round, X = cap height of the wordmark.
 */
type Tone = 'white' | 'colour'

function art(base: string, tone: Tone) {
  return `/brand/agricope-${base}${tone === 'white' ? '-white' : ''}.svg`
}

/** The arch-over-field-rows mark on its own. */
export function Logomark({
  height = 32,
  tone = 'white',
  /** @deprecated use `height` — kept so older call sites keep working */
  size,
}: {
  height?: number | string
  tone?: Tone
  size?: number
}) {
  const h = size ?? height
  return (
    <img
      src={art('mark', tone)}
      alt=""
      aria-hidden="true"
      className="logo-art"
      style={{ height: h }}
    />
  )
}

/** Mark beside the two-line AGRI / COPE wordmark. */
export function Lockup({ height = 44, tone = 'white' }: { height?: number | string; tone?: Tone }) {
  return (
    <img src={art('lockup', tone)} alt="Agricope" className="logo-art" style={{ height }} />
  )
}

/** Mark stacked over AGRICOPE — the dense login treatment. */
export function StackedLockup({ height = 66, tone = 'white' }: { height?: number | string; tone?: Tone }) {
  return (
    <img src={art('stacked', tone)} alt="Agricope" className="logo-art" style={{ height }} />
  )
}
