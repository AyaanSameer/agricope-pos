import { useEffect, useState } from 'react'
import { PinPad, PinDots } from './PinPad'
import './pinswitch.css'

const PIN_LENGTH = 4

/**
 * The one PIN mechanic, reused everywhere the design demands it: big
 * discounts, voids, refunds, pulling fired kitchen items. The caller retries
 * its request with the X-Approval-Pin header.
 */
export function ApprovalPinModal({
  title,
  message,
  busy = false,
  error,
  onSubmit,
  onClose,
}: {
  title: string
  message: string
  busy?: boolean
  error?: string | null
  onSubmit: (pin: string) => void
  onClose: () => void
}) {
  const [pin, setPin] = useState('')
  // Remounts the card per attempt so a repeated wrong PIN shakes every time.
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (pin.length === PIN_LENGTH && !busy) {
      onSubmit(pin)
      setPin('')
      setAttempt((n) => n + 1)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pin])

  return (
    <div className="pinswitch" role="dialog" aria-modal="true" aria-label={title}>
      <div className={error ? 'pinswitch-card ag-shake' : 'pinswitch-card'} key={attempt}>
        <h2>{title}</h2>
        <p className="pinswitch-sub">{message}</p>
        <PinDots filled={pin.length} length={PIN_LENGTH} />
        {error && <div className="pinswitch-error">{error}</div>}
        <PinPad
          disabled={busy}
          onDigit={(d) => setPin((p) => (p.length < PIN_LENGTH ? p + d : p))}
          onBackspace={() => setPin((p) => p.slice(0, -1))}
        />
        <button type="button" className="btn-secondary pinswitch-cancel" onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>
  )
}
