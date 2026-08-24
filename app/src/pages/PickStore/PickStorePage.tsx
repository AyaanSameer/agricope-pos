import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { listStores } from '../../api/org'
import { useAuth } from '../../auth/AuthContext'
import { Logomark } from '../../components/Logomark'
import './pickstore.css'

/** Owners work across stores; a till always belongs to one. */
export function PickStorePage() {
  const { session, setActiveStore, signOut } = useAuth()
  const navigate = useNavigate()
  const storesQuery = useQuery({ queryKey: ['stores'], queryFn: listStores })

  if (!session) return null

  function choose(id: string | null, name: string) {
    setActiveStore(id ? { id, name } : null)
    navigate('/', { replace: true })
  }

  return (
    <div className="pickstore">
      <div className="pickstore-head">
        <Logomark size={44} />
        <h1>Where are you working today?</h1>
        <p>Good {new Date().getHours() < 12 ? 'morning' : 'afternoon'}, {session.user.name.split(' ')[0]} — pick a store to open its till, or stay across all stores for the back office.</p>
      </div>

      <div className="pickstore-grid">
        {storesQuery.isPending && <div className="pickstore-loading">Loading stores…</div>}
        {storesQuery.data?.data.map((store) => (
          <button
            key={store.id}
            type="button"
            className="pickstore-tile"
            onClick={() => choose(store.id, store.name)}
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
          onClick={() => choose(null, 'All stores')}
        >
          <span className="pickstore-name">All stores</span>
          <span className="pickstore-addr">Back office — catalog, users, reports</span>
        </button>
      </div>

      <button type="button" className="pickstore-signout" onClick={signOut}>
        Sign out
      </button>
    </div>
  )
}
