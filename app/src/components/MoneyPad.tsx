import './pinpad.css'

/** Touch keypad for money entry — digits, decimal point, backspace. */
export function MoneyPad({
  onKey,
  disabled = false,
  size = 'md',
}: {
  onKey: (key: string) => void // '0'-'9', '.', '⌫'
  disabled?: boolean
  /** the size class carries the --key custom properties the grid needs */
  size?: 'md' | 'lg' | 'fill'
}) {
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', '⌫']
  return (
    <div className={`pinpad pinpad-${size}`}>
      {keys.map((k) => (
        <button
          key={k}
          type="button"
          className={k === '⌫' ? 'pinpad-key pinpad-key-back' : 'pinpad-key'}
          disabled={disabled}
          onClick={() => onKey(k)}
        >
          {k}
        </button>
      ))}
    </div>
  )
}
