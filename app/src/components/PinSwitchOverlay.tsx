import { useEffect, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useAuth } from '../auth/AuthContext'
import { ApiError } from '../api/client'
import { PinCard } from './PinCard'

const PIN_LENGTH = 4

/**
 * Handing the till over. Same card as signing in, so the hand-over is not a
 * different-looking prompt — the chip names who is signing off instead of
 * which branch you are opening.
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

  return (
    <div className="pin-scrim" role="dialog" aria-modal="true" aria-label="Switch user">
      <PinCard
        key={attempt}
        chip={outgoing ? `${outgoing.name} · signing off` : (activeStore?.name ?? null)}
        title="Who is taking over?"
        hint={`Enter your ${PIN_LENGTH}-digit PIN`}
        error={error}
        filled={pin.length}
        length={PIN_LENGTH}
        disabled={switchMutation.isPending}
        onDigit={(d) => setPin((p) => (p.length < PIN_LENGTH ? p + d : p))}
        onBackspace={() => setPin((p) => p.slice(0, -1))}
        footer={
          <button type="button" className="pin-foot pin-foot-quiet" onClick={onClose}>
            Cancel
          </button>
        }
      />
    </div>
  )
}
