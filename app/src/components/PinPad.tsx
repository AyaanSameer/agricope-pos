import './pinpad.css'

/**
 * The one touch keypad. PIN entry uses it at a single fixed size — the same
 * pad on the sign-in card and in every overlay that asks for a PIN.
 */
export function PinPad({
  onDigit,
  onBackspace,
  disabled = false,
}: {
  onDigit: (d: string) => void
  onBackspace: () => void
  disabled?: boolean
}) {
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫']
  return (
    <div className="pinpad pinpad-pin">
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
export function PinDots({ filled, length = 4 }: { filled: number; length?: number }) {
  return (
    <div className="pin-dots" aria-label={`${filled} of ${length} digits`}>
      {Array.from({ length }).map((_, i) => (
        <span key={i} className={i < filled ? 'dot filled' : 'dot'} />
      ))}
    </div>
  )
}
