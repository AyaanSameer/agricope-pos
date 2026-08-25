import './pinpad.css'

/** Touch keypad for money entry — digits, decimal point, backspace. */
export function MoneyPad({
  onKey,
  disabled = false,
}: {
  onKey: (key: string) => void // '0'-'9', '.', '⌫'
  disabled?: boolean
}) {
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', '⌫']
  return (
    <div className="pinpad">
      {keys.map((k) => (
        <button
          key={k}
          type="button"
          className="pinpad-key"
          disabled={disabled}
          onClick={() => onKey(k)}
        >
          {k}
        </button>
      ))}
    </div>
  )
}
