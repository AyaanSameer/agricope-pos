import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { listStores, updateStore } from '../../api/org'
import { ApiError } from '../../api/client'
import { useAuth } from '../../auth/AuthContext'
import './settings.css'

/**
 * Branch settings, run by the manager. Today: how kitchen work surfaces —
 * a KDS screen on the pass, or a printed kitchen ticket at the counter.
 */
export function SettingsPage() {
  const queryClient = useQueryClient()
  const { activeStore } = useAuth()
  const storesQuery = useQuery({ queryKey: ['stores'], queryFn: listStores })
  const [error, setError] = useState<string | null>(null)

  const setKitchenMode = useMutation({
    mutationFn: ({ id, mode }: { id: string; mode: 'kds' | 'printer' }) =>
      updateStore(id, { kitchen_mode: mode }),
    onSuccess: () => {
      setError(null)
      queryClient.invalidateQueries({ queryKey: ['stores'] })
    },
    onError: (err) =>
      setError(err instanceof ApiError ? err.message : 'Could not save — try again.'),
  })

  const stores = storesQuery.data?.data ?? []
  const visible = activeStore ? stores.filter((s) => s.id === activeStore.id) : stores

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h2>Settings</h2>
          <p className="page-sub">
            Branch settings · owner &amp; manager only
          </p>
        </div>
      </div>

      {error && <div className="settings-error">{error}</div>}

      <div className="settings-list">
        {storesQuery.isPending && <div className="settings-loading">Loading…</div>}
        {visible.map((store) => (
          <div key={store.id} className="card settings-card">
            <div className="settings-store">
              <div className="settings-store-name">{store.name}</div>
              <div className="settings-store-sub">
                {store.type === 'retail' ? 'Retail' : 'Restaurant'} · {store.address}
              </div>
            </div>

            <div className="settings-block">
              <div className="settings-block-head">
                <div className="settings-block-title">Kitchen output</div>
                <p className="settings-block-sub">
                  Where a sent order lands: the KDS board on the pass, or a printed kitchen
                  ticket for kitchens without a display.
                </p>
              </div>
              <div className="settings-seg" role="radiogroup" aria-label="Kitchen output">
                {(
                  [
                    { mode: 'kds', label: 'KDS board', hint: 'Live tickets on a screen' },
                    { mode: 'printer', label: 'Ticket printer', hint: 'Prints on send, no screen' },
                  ] as const
                ).map((opt) => (
                  <button
                    key={opt.mode}
                    type="button"
                    role="radio"
                    aria-checked={store.kitchen_mode === opt.mode}
                    className={
                      store.kitchen_mode === opt.mode ? 'settings-opt active' : 'settings-opt'
                    }
                    disabled={setKitchenMode.isPending}
                    onClick={() => setKitchenMode.mutate({ id: store.id, mode: opt.mode })}
                  >
                    <span className="settings-opt-label">{opt.label}</span>
                    <span className="settings-opt-hint">{opt.hint}</span>
                  </button>
                ))}
              </div>
              {store.kitchen_mode === 'printer' && (
                <p className="settings-note">
                  The Kitchen screen is hidden on this branch; sending a round opens a
                  printable ticket instead.
                </p>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
