import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { Logomark } from './Logomark'
import { PinSwitchOverlay } from './PinSwitchOverlay'
import './topbar.css'

/**
 * The one piece of chrome. Left: back to the hub — or the mark, when you are
 * already there. Centre: where you are, over which till you are on. Right: the
 * PIN pill, which hands the till to the next person.
 */
export function Topbar({
  title,
  subtitle,
  /** null = this IS the hub; a path = go there instead of the hub */
  backTo = '/',
}: {
  title: string
  subtitle?: string
  backTo?: string | null
}) {
  const { session } = useAuth()
  const navigate = useNavigate()
  const [pinOpen, setPinOpen] = useState(false)

  const initials = session
    ? session.user.name
        .split(' ')
        .map((w) => w[0])
        .slice(0, 2)
        .join('')
        .toUpperCase()
    : '—'

  return (
    <>
      <header className="topbar">
        {backTo === null ? (
          <span className="topbar-mark">
            <Logomark height={26} />
          </span>
        ) : (
          <button
            type="button"
            className="topbar-back"
            aria-label="Back"
            onClick={() => navigate(backTo)}
          >
            ‹
          </button>
        )}

        <div className="topbar-titles">
          <h1 className="topbar-h1">{title}</h1>
          {subtitle && <div className="topbar-sub">{subtitle}</div>}
        </div>

        <button
          type="button"
          className="topbar-pin"
          onClick={() => setPinOpen(true)}
          title="Hand the till to someone else"
        >
          <span className="topbar-avatar">{initials}</span>
          <span className="topbar-pin-label">PIN</span>
        </button>
      </header>

      {pinOpen && <PinSwitchOverlay onClose={() => setPinOpen(false)} />}
    </>
  )
}
