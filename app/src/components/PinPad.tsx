import './pinpad.css'

/** Reusable touch keypad — PINs now, cash tendered and quantities in later phases. */
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
    <div className="pinpad">
      {keys.map((k, i) =>
        k === '' ? (
          <span key={i} />
        ) : (
          <button
            key={i}
            type="button"
            className="pinpad-key"
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
