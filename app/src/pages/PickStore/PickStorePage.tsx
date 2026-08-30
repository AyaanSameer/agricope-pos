import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useMutation } from '@tanstack/react-query'
import { useAuth } from '../../auth/AuthContext'
import { ApiError } from '../../api/client'
import { Logomark } from '../../components/Logomark'
import { PinCard } from '../../components/PinCard'
import './pickstore.css'

const PIN_LENGTH = 4

/**
 * After the business signs in: pick the branch this till serves, then the PIN
 * says who is standing at it. Locking the till comes back here with the
 * branch remembered, straight to the PIN.
 */
export function PickStorePage() {
  const { businessSession, activeStore, setActiveStore, identify, signOut } = useAuth()
  const navigate = useNavigate()
  // If the till already has its branch (e.g. after a lock), jump to the PIN —
  // unless the person came here deliberately to move the till to another branch.
  const [searchParams] = useSearchParams()
  const changingBranch = searchParams.get('change') === '1'
  // A till screen reached without a branch sends the person here with the
  // screen it wanted; picking and identifying continues to it.
  const nextParam = searchParams.get('next')
  const next = nextParam && nextParam.startsWith('/') && !nextParam.startsWith('//') ? nextParam : '/'
  const needsBranch = next !== '/'
  const [stage, setStage] = useState<'store' | 'pin'>(
    activeStore && !changingBranch ? 'pin' : 'store',
  )
  const [backOffice, setBackOffice] = useState(false)
  const [pin, setPin] = useState('')
  const [error, setError] = useState<string | null>(null)
  // Remounts the card per attempt so a repeated wrong PIN shakes every time.
  const [attempt, setAttempt] = useState(0)

  const unlock = useMutation({
    mutationFn: (fullPin: string) => identify(fullPin, backOffice ? null : (activeStore?.id ?? null)),
    onSuccess: () => navigate(next, { replace: true }),
    onError: (err) => {
      setPin('')
      setError(err instanceof ApiError ? err.message : 'That PIN does not match anyone here.')
    },
  })

  useEffect(() => {
    if (stage === 'pin' && pin.length === PIN_LENGTH && !unlock.isPending) {
      setError(null)
      setAttempt((n) => n + 1)
      unlock.mutate(pin)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pin, stage])

  if (!businessSession) return null

  const stores = businessSession.stores

  function chooseStore(id: string | null, name: string) {
    setBackOffice(id === null)
    setActiveStore(id ? { id, name } : null)
    setPin('')
    setError(null)
    setStage('pin')
  }

  if (stage === 'pin') {
    // The chip names the till, not the tenant — a branch name already carries it.
    const tillLabel = backOffice
      ? `${businessSession.business.name} · Back office`
      : (activeStore?.name ?? businessSession.business.name)
    return (
      <div className="pickstore">
        <span className="pickstore-orb pickstore-orb-1" aria-hidden="true" />
        <span className="pickstore-orb pickstore-orb-2" aria-hidden="true" />
        <div className="pickstore-inner pickstore-inner-pin">
          <PinCard
            key={attempt}
            chip={tillLabel}
            title="Who is taking the till?"
            hint={`Enter your ${PIN_LENGTH}-digit PIN`}
            error={error}
            filled={pin.length}
            length={PIN_LENGTH}
            disabled={unlock.isPending}
            onDigit={(d) => setPin((p) => (p.length < PIN_LENGTH ? p + d : p))}
            onBackspace={() => setPin((p) => p.slice(0, -1))}
            footer={
              <button
                type="button"
                className="pin-foot"
                onClick={() => {
                  setStage('store')
                  setPin('')
                  setError(null)
                }}
              >
                ← Change branch
              </button>
            }
          />

          <button type="button" className="pickstore-signout" onClick={signOut}>
            Sign the business out
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="pickstore">
      <span className="pickstore-orb pickstore-orb-1" aria-hidden="true" />
      <span className="pickstore-orb pickstore-orb-2" aria-hidden="true" />
      <div className="pickstore-inner">
        <div className="pickstore-head">
          <Logomark height={48} />
          <h1>{businessSession.business.name}</h1>
          <p>
            {needsBranch
              ? 'That screen belongs to a branch — pick the one this till serves.'
              : 'Which till are you opening?'}
          </p>
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
              <span className="pickstore-fill" />
              <span className="pickstore-name">{store.name}</span>
              <span className="pickstore-addr">{store.address}</span>
            </button>
          ))}
          {!needsBranch && (
            <button
              type="button"
              className="pickstore-tile all"
              onClick={() => chooseStore(null, 'All stores')}
            >
              <span className="pickstore-type none">No till</span>
              <span className="pickstore-fill" />
              <span className="pickstore-name">Back office</span>
              <span className="pickstore-addr">All branches — catalog, users, reports</span>
            </button>
          )}
        </div>

        <button type="button" className="pickstore-signout" onClick={signOut}>
          Sign the business out
        </button>
      </div>
    </div>
  )
}
