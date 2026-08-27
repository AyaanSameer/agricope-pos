import './pinpad.css'

/**
 * Reusable touch keypad — PINs now, cash tendered and quantities elsewhere.
 * `lg` is the full sign-in keypad (76px keys); `md` fits inside an overlay (72px).
 */
export function PinPad({
  onDigit,
  onBackspace,
  disabled = false,
  size = 'md',
}: {
  onDigit: (d: string) => void
  onBackspace: () => void
  disabled?: boolean
  size?: 'md' | 'lg'
}) {
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫']
  return (
    <div className={`pinpad pinpad-${size}`}>
      {keys.map((k, i) =>
        k === '' ? (
          <span key={i} />
        ) : (
          <button
            key={i}
            type="button"
            className={k === '⌫' ? 'pinpad-key pinpad-key-back' : 'pinpad-key'}
            disabled={disabled}
            onClick={() => (k === '⌫' ? onBackspace() : onDigit(k))}
          >
            {k}
          </button>
        ),
      )}
    </div>
  )
}

/** The four PIN dots — same shape everywhere a PIN is entered. */
export function PinDots({
  filled,
  length = 4,
  size = 'md',
}: {
  filled: number
  length?: number
  size?: 'md' | 'lg'
}) {
  return (
    <div className={`pin-dots pin-dots-${size}`} aria-label={`${filled} of ${length} digits`}>
      {Array.from({ length }).map((_, i) => (
        <span key={i} className={i < filled ? 'dot filled' : 'dot'} />
      ))}
    </div>
  )
}
