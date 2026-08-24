/** The AGRICOPE arch-over-field-rows mark. White on dark green, two-tone on light. */
export function Logomark({ size = 32, variant = 'white' }: { size?: number; variant?: 'white' | 'two-tone' }) {
  const arch = variant === 'white' ? '#FFFFFF' : 'var(--leaf)'
  const rows = variant === 'white' ? '#FFFFFF' : 'var(--forest)'
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" aria-hidden="true">
      <path d="M13 21 A11 11 0 0 1 35 21" stroke={arch} strokeWidth="6.5" strokeLinecap="round" />
      <path d="M8 31 Q24 23 40 31" stroke={rows} strokeWidth="4.5" strokeLinecap="round" />
      <path d="M11 38 Q24 31.5 37 38" stroke={rows} strokeWidth="4.5" strokeLinecap="round" />
      <path d="M15 44.5 Q24 39.5 33 44.5" stroke={rows} strokeWidth="4.5" strokeLinecap="round" />
    </svg>
  )
}
