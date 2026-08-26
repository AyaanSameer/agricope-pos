import { useEffect, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useAuth } from '../auth/AuthContext'
import { ApiError } from '../api/client'
import { PinPad } from './PinPad'
import { Logomark } from './Logomark'
import './pinswitch.css'

const PIN_LENGTH = 4

export function PinSwitchOverlay({ onClose }: { onClose: () => void }) {
  const { activeStore, switchByPin } = useAuth()
  const [pin, setPin] = useState('')
  const [error, setError] = useState<string | null>(null)

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
      switchMutation.mutate(pin)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pin])

  return (
    <div className="pinswitch" role="dialog" aria-modal="true" aria-label="Switch user">
      <div className="pinswitch-card">
        <Logomark size={40} variant="two-tone" />
        <h2>Switch user</h2>
        <p className="pinswitch-sub">
          {activeStore ? `${activeStore.name} · enter your PIN` : 'Enter your PIN'}
        </p>
        <div className="pinswitch-dots" aria-label={`${pin.length} of ${PIN_LENGTH} digits`}>
          {Array.from({ length: PIN_LENGTH }).map((_, i) => (
            <span key={i} className={i < pin.length ? 'dot filled' : 'dot'} />
          ))}
        </div>
        {error && <div className="pinswitch-error">{error}</div>}
        <PinPad
          disabled={switchMutation.isPending}
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
