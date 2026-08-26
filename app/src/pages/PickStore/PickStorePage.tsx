import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation } from '@tanstack/react-query'
import { useAuth } from '../../auth/AuthContext'
import { ApiError } from '../../api/client'
import { Logomark } from '../../components/Logomark'
import { PinPad } from '../../components/PinPad'
import './pickstore.css'

const PIN_LENGTH = 4

/**
 * After the business signs in: pick the branch this till serves, then the PIN
 * says who is standing at it. Locking the till comes back here with the
 * branch remembered, straight to the PIN.
 */
export function PickStorePage() {
  const { businessSession, session, activeStore, setActiveStore, identify, signOut } = useAuth()
  const navigate = useNavigate()
  // If the till already has its branch (e.g. after a lock), jump to the PIN.
  const [stage, setStage] = useState<'store' | 'pin'>(activeStore ? 'pin' : 'store')
  const [backOffice, setBackOffice] = useState(false)
  const [pin, setPin] = useState('')
  const [error, setError] = useState<string | null>(null)

  const unlock = useMutation({
    mutationFn: (fullPin: string) => identify(fullPin, backOffice ? null : (activeStore?.id ?? null)),
    onSuccess: () => navigate('/', { replace: true }),
    onError: (err) => {
      setPin('')
      setError(err instanceof ApiError ? err.message : 'Could not sign in — try again.')
    },
  })

  useEffect(() => {
    if (stage === 'pin' && pin.length === PIN_LENGTH && !unlock.isPending) {
      setError(null)
      unlock.mutate(pin)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pin, stage])

  if (!businessSession) return null
  if (session) {
    // Already identified — nothing to do here.
    navigate('/', { replace: true })
    return null
  }

  const stores = businessSession.stores

  function chooseStore(id: string | null, name: string) {
    setBackOffice(id === null)
    setActiveStore(id ? { id, name } : null)
    setPin('')
    setError(null)
    setStage('pin')
  }

  if (stage === 'pin') {
    const tillLabel = backOffice
      ? 'Back office · all branches'
      : (activeStore?.name ?? 'this till')
    return (
      <div className="pickstore">
        <div className="pickstore-head">
          <Logomark size={44} />
          <h1>{businessSession.business.name}</h1>
          <p>
            {tillLabel} — enter your PIN to take the till
          </p>
        </div>

        <div className="pickstore-pin">
          <div className="pickstore-dots" aria-label={`${pin.length} of ${PIN_LENGTH} digits`}>
            {Array.from({ length: PIN_LENGTH }).map((_, i) => (
              <span key={i} className={i < pin.length ? 'dot filled' : 'dot'} />
            ))}
          </div>
          {error && <div className="pickstore-error">{error}</div>}
          <PinPad
            disabled={unlock.isPending}
            onDigit={(d) => setPin((p) => (p.length < PIN_LENGTH ? p + d : p))}
            onBackspace={() => setPin((p) => p.slice(0, -1))}
          />
          <button
            type="button"
            className="btn-secondary pickstore-back"
            onClick={() => {
              setStage('store')
              setPin('')
              setError(null)
            }}
          >
            ← Change branch
          </button>
        </div>

        <button type="button" className="pickstore-signout" onClick={signOut}>
          Sign the business out
        </button>
      </div>
    )
  }

  return (
    <div className="pickstore">
      <div className="pickstore-head">
        <Logomark size={44} />
        <h1>{businessSession.business.name}</h1>
        <p>Pick the branch this till serves — your PIN identifies you next.</p>
      </div>

      <div className="pickstore-grid">
        {stores.map((store) => (
          <button
            key={store.id}
            type="button"
            className="pickstore-tile"
            onClick={() => chooseStore(store.id, store.name)}
          >
            <span className={`pickstore-type ${store.type}`}>
              {store.type === 'retail' ? 'Retail' : 'Restaurant'}
            </span>
            <span className="pickstore-name">{store.name}</span>
            <span className="pickstore-addr">{store.address}</span>
          </button>
        ))}
        <button
          type="button"
          className="pickstore-tile all"
          onClick={() => chooseStore(null, 'All stores')}
        >
          <span className="pickstore-name">Back office</span>
          <span className="pickstore-addr">All branches — catalog, users, reports</span>
        </button>
      </div>

      <button type="button" className="pickstore-signout" onClick={signOut}>
        Sign the business out
      </button>
    </div>
  )
}
