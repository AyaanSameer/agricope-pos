import type { ReactNode } from 'react'
import { PinPad, PinDots } from './PinPad'
import './pincard.css'

/**
 * Every PIN in the system is asked for on this card — signing into a till,
 * handing the till over, and a manager approving something. Same shell, same
 * pad, same dots; only the chip, the question and the way out differ.
 *
 * The caller owns the shake: remount with a new `key` per failed attempt.
 */
export function PinCard({
  chip,
  title,
  hint,
  error,
  filled,
  length = 4,
  disabled = false,
  onDigit,
  onBackspace,
  footer,
}: {
  /** Context above the question — which till, or who is signing off. */
  chip?: ReactNode
  title: string
  hint: ReactNode
  error?: string | null
  filled: number
  length?: number
  disabled?: boolean
  onDigit: (d: string) => void
  onBackspace: () => void
  footer?: ReactNode
}) {
  return (
    <div className={error ? 'pin-card ag-shake' : 'pin-card'}>
      {chip && (
        <div className="pin-chip">
          <span className="dot" aria-hidden="true" />
          <span className="pin-chip-text">{chip}</span>
        </div>
      )}

      <div className="pin-who">
        <div className="pin-who-avatar" aria-hidden="true">
          ?
        </div>
        <h2>{title}</h2>
        {error ? <p className="pin-error">{error}</p> : <p className="pin-hint">{hint}</p>}
      </div>

      <PinDots filled={filled} length={length} />

      <PinPad disabled={disabled} onDigit={onDigit} onBackspace={onBackspace} />

      {footer}
    </div>
  )
}
