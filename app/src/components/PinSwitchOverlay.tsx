import { useEffect, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useAuth } from '../auth/AuthContext'
import { ApiError } from '../api/client'
import { PinPad, PinDots } from './PinPad'
import './pinswitch.css'

const PIN_LENGTH = 4

/**
 * Handing the till over. The design makes the hand-over explicit: who is
 * signing off sits above an empty avatar for whoever takes over, so nobody
 * types a PIN without seeing whose shift they are ending.
 */
export function PinSwitchOverlay({ onClose }: { onClose: () => void }) {
  const { session, activeStore, switchByPin } = useAuth()
  const [pin, setPin] = useState('')
  const [error, setError] = useState<string | null>(null)
  // Remounts the card per attempt so a repeated wrong PIN shakes every time.
  const [attempt, setAttempt] = useState(0)

  const switchMutation = useMutation({
    mutationFn: (fullPin: string) => switchByPin(fullPin),
    onSuccess: () => onClose(),
    onError: (err) => {
      setPin('')
      setError(err instanceof ApiError ? err.message : 'Could not switch — try again.')
    },
  })

  useEffect(() => {
    if (pin.length === PIN_LENGTH && !switchMutation.isPending) {
      setError(null)
      setAttempt((n) => n + 1)
      switchMutation.mutate(pin)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pin])

  const outgoing = session?.user
  const initials = outgoing
    ? outgoing.name
        .split(' ')
        .map((w) => w[0])
        .slice(0, 2)
        .join('')
    : '—'

  return (
    <div className="pinswitch" role="dialog" aria-modal="true" aria-label="Switch user">
      <div className={error ? 'pinswitch-card ag-shake' : 'pinswitch-card'} key={attempt}>
        <div className="pinswitch-badge">Handing over the till</div>

        {outgoing && (
          <div className="pinswitch-outgoing">
            <div className="pinswitch-out-avatar">{initials}</div>
            <div className="pinswitch-out-info">
              <div className="pinswitch-out-name">{outgoing.name}</div>
              <div className="pinswitch-out-role">
                <span>{outgoing.role}</span> · signing off
              </div>
            </div>
            <span className="pinswitch-arrow" aria-hidden="true">
              ↓
            </span>
          </div>
        )}

        <div className="pinswitch-incoming">
          <div className="pinswitch-in-avatar" aria-hidden="true">
            ?
          </div>
          <h2>Who is taking over?</h2>
          {error ? (
            <p className="pinswitch-error">{error}</p>
          ) : (
            <p className="pinswitch-sub">{activeStore ? activeStore.name : 'Enter your PIN'}</p>
          )}
        </div>

        <PinDots filled={pin.length} length={PIN_LENGTH} />

        <PinPad
          disabled={switchMutation.isPending}
          onDigit={(d) => setPin((p) => (p.length < PIN_LENGTH ? p + d : p))}
          onBackspace={() => setPin((p) => p.slice(0, -1))}
        />
        <button type="button" className="pinswitch-cancel" onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>
  )
}
