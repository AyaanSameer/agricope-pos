import { useNavigate } from 'react-router-dom'
import './toosmall.css'

/**
 * Kitchen and Catalog need a canvas. Rather than shipping a cramped version
 * that nobody can work in, the phone says so plainly and offers the way back.
 */
export function TooSmallPage({ screen }: { screen: string }) {
  const navigate = useNavigate()
  return (
    <div className="toosmall">
      <div className="toosmall-card">
        <div className="toosmall-glyph" aria-hidden="true">
          ⤢
        </div>
        <h2>{screen} needs a bigger screen</h2>
        <p>
          This one works on a tablet or larger — there is too much on it to use well on a phone.
          Everything else in the app is here.
        </p>
        <button type="button" className="btn-primary" onClick={() => navigate('/')}>
          Back to the hub
        </button>
      </div>
    </div>
  )
}
