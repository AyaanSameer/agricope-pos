import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from '../../api/client'
import { createOrder } from '../../api/orders'
import { createTable, deleteTable, updateTable } from '../../api/tables'
import { useAuth } from '../../auth/AuthContext'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { fmt } from '../../lib/money'
import './floor.css'

interface FloorTable {
  id: string
  name: string
  zone: string
  seats: number
  order: {
    order_id: string
    order_number: string
    total: string
    guest_count: number | null
    minutes_open: number
    unsent_count: number
  } | null
}

/** The waiter's home screen — every table, its tab, and how long it's been sitting. */
export function FloorPage() {
  const { activeStore, session } = useAuth()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [zone, setZone] = useState<string | null>(null)
  const [seating, setSeating] = useState<FloorTable | null>(null)
  const [guests, setGuests] = useState(2)
  const [managing, setManaging] = useState(false)
  const isOwner = session?.user.role === 'owner'

  const floorQuery = useQuery({
    queryKey: ['floor', activeStore?.id],
    queryFn: () => api<{ data: FloorTable[] }>(`/tables/floor?store_id=${activeStore!.id}`),
    enabled: !!activeStore,
    refetchInterval: 10_000,
  })

  const seat = useMutation({
    mutationFn: (t: FloorTable) =>
      createOrder({
        store_id: activeStore!.id,
        order_type: 'dine_in',
        table_id: t.id,
        guest_count: guests,
        items: [],
      }),
    onSuccess: (order) => {
      queryClient.invalidateQueries({ queryKey: ['floor'] })
      setSeating(null)
      navigate(`/tab/${order.id}`)
    },
  })

  if (!activeStore) {
    return <div className="card floor-empty">Pick a store first.</div>
  }
  const tablesList = floorQuery.data?.data ?? []
  const zones = [...new Set(tablesList.map((t) => t.zone))]
  const visible = zone ? tablesList.filter((t) => t.zone === zone) : tablesList
  const openTabs = tablesList.filter((t) => t.order)

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h2>Floor — {activeStore.name}</h2>
          <p className="page-sub">
            {openTabs.length} open tab{openTabs.length === 1 ? '' : 's'} · QAR{' '}
            {fmt(openTabs.reduce((a, t) => a + Number(t.order!.total), 0).toFixed(2))} on tables
          </p>
        </div>
        {isOwner && (
          <button type="button" className="btn-secondary" onClick={() => setManaging(true)}>
            Manage tables
          </button>
        )}
      </div>

      <div className="floor-zones">
        <button type="button" className={zone === null ? 'chip active' : 'chip'} onClick={() => setZone(null)}>
          All zones
        </button>
        {zones.map((z) => (
          <button key={z} type="button" className={zone === z ? 'chip active' : 'chip'} onClick={() => setZone(z)}>
            {z}
          </button>
        ))}
        <div className="floor-legend">
          <span><i className="dot free" /> Free</span>
          <span><i className="dot occ" /> Occupied</span>
          <span><i className="dot warn" /> 60+ min</span>
        </div>
      </div>

      <div className="floor-grid">
        {visible.map((t) => {
          const state = !t.order ? 'free' : t.order.minutes_open >= 60 ? 'warn' : 'occ'
          return (
            <button
              key={t.id}
              type="button"
              className={`ftable ${state}`}
              onClick={() => {
                if (t.order) navigate(`/tab/${t.order.order_id}`)
                else {
                  setGuests(2)
                  setSeating(t)
                }
              }}
            >
              <span className="ftable-top">
                <strong>{t.name}</strong>
                <span className="ftable-zone">{t.zone}</span>
                <i className={`dot ${state}`} />
              </span>
              {t.order ? (
                <>
                  <span className="ftable-meta">
                    {t.order.guest_count ?? '—'} guests · {t.order.minutes_open} min
                    {t.order.unsent_count > 0 ? ` · ${t.order.unsent_count} unsent` : ''}
                  </span>
                  <span className="ftable-total">QAR {fmt(t.order.total)}</span>
                </>
              ) : (
                <span className="ftable-free">Seats {t.seats} — tap to seat</span>
              )}
            </button>
          )
        })}
      </div>

      {managing && (
        <ManageTablesModal storeId={activeStore.id} onClose={() => setManaging(false)} />
      )}

      {seating && (
        <div className="cust-modal" role="dialog" aria-modal="true">
          <div className="card floor-seat">
            <h3>Seat guests at {seating.name}</h3>
            <div className="floor-guests">
              <button type="button" onClick={() => setGuests((g) => Math.max(1, g - 1))}>−</button>
              <span>{guests}</span>
              <button type="button" onClick={() => setGuests((g) => g + 1)}>+</button>
            </div>
            <button type="button" className="btn-primary" disabled={seat.isPending} onClick={() => seat.mutate(seating)}>
              {seat.isPending ? 'Opening tab…' : `Open tab · ${guests} guest${guests === 1 ? '' : 's'}`}
            </button>
            <button type="button" className="btn-secondary" onClick={() => setSeating(null)}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  )
}


/** The owner's floor plan: add, rename, resize and remove tables. */
function ManageTablesModal({ storeId, onClose }: { storeId: string; onClose: () => void }) {
  const queryClient = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<{ id: string; name: string } | null>(null)
  const [draft, setDraft] = useState({ name: '', zone: '', seats: '4' })

  const floorQuery = useQuery({
    queryKey: ['floor', storeId],
    queryFn: () => api<{ data: FloorTable[] }>(`/tables/floor?store_id=${storeId}`),
  })
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['floor'] })
    setError(null)
  }
  const fail = (err: unknown) =>
    setError(err instanceof ApiError ? err.message : 'Could not save — try again.')

  const add = useMutation({
    mutationFn: () =>
      createTable({
        store_id: storeId,
        name: draft.name,
        zone: draft.zone,
        seats: Number(draft.seats) || 0,
      }),
    onSuccess: () => {
      refresh()
      setDraft({ name: '', zone: draft.zone, seats: '4' })
    },
    onError: fail,
  })
  const patch = useMutation({
    mutationFn: ({ id, input }: { id: string; input: { name?: string; zone?: string; seats?: number } }) =>
      updateTable(id, input),
    onSuccess: refresh,
    onError: fail,
  })
  const remove = useMutation({
    mutationFn: (id: string) => deleteTable(id),
    onSuccess: () => {
      refresh()
      setDeleting(null)
    },
    onError: (err) => {
      setDeleting(null)
      fail(err)
    },
  })

  const tablesList = floorQuery.data?.data ?? []

  return (
    <div className="cust-modal" role="dialog" aria-modal="true">
      <div className="card floor-manage">
        <div className="floor-manage-head">
          <h3>Tables — owner only</h3>
          <button type="button" className="btn-secondary" onClick={onClose}>✕</button>
        </div>
        <p className="muted small">
          Rename, resize or remove tables. A table with an open tab cannot be deleted.
        </p>

        <div className="floor-manage-list">
          {tablesList.map((t) => (
            <div key={t.id} className="floor-manage-row">
              <input
                defaultValue={t.name}
                aria-label="Table name"
                onBlur={(e) => {
                  if (e.target.value.trim() && e.target.value !== t.name) {
                    patch.mutate({ id: t.id, input: { name: e.target.value.trim() } })
                  }
                }}
              />
              <input
                defaultValue={t.zone}
                aria-label="Zone"
                onBlur={(e) => {
                  if (e.target.value !== t.zone) patch.mutate({ id: t.id, input: { zone: e.target.value } })
                }}
              />
              <input
                defaultValue={String(t.seats)}
                inputMode="numeric"
                aria-label="Seats"
                className="floor-manage-seats"
                onBlur={(e) => {
                  const n = Number(e.target.value)
                  if (n > 0 && n !== t.seats) patch.mutate({ id: t.id, input: { seats: n } })
                }}
              />
              <span className="floor-manage-state">{t.order ? 'occupied' : 'free'}</span>
              <button
                type="button"
                className="btn-secondary floor-manage-del"
                disabled={!!t.order || remove.isPending}
                title={t.order ? 'Close its open tab first' : 'Delete table'}
                onClick={() => setDeleting({ id: t.id, name: t.name })}
              >
                Delete
              </button>
            </div>
          ))}
        </div>

        <form
          className="floor-manage-add"
          onSubmit={(e) => {
            e.preventDefault()
            if (draft.name.trim()) add.mutate()
          }}
        >
          <input
            placeholder="New table (e.g. T5)"
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
          <input
            placeholder="Zone"
            value={draft.zone}
            onChange={(e) => setDraft({ ...draft, zone: e.target.value })}
          />
          <input
            placeholder="Seats"
            inputMode="numeric"
            className="floor-manage-seats"
            value={draft.seats}
            onChange={(e) => setDraft({ ...draft, seats: e.target.value.replace(/\D/g, '') })}
          />
          <button type="submit" className="btn-primary" disabled={add.isPending || !draft.name.trim()}>
            {add.isPending ? 'Adding…' : '+ Add'}
          </button>
        </form>

        {error && <div className="cust-error">{error}</div>}
      </div>

      {deleting && (
        <ConfirmDialog
          title={`Delete ${deleting.name}?`}
          message="The table disappears from the floor. Past orders keep their receipts."
          confirmLabel="Delete table"
          danger
          busy={remove.isPending}
          onConfirm={() => remove.mutate(deleting.id)}
          onCancel={() => setDeleting(null)}
        />
      )}
    </div>
  )
}
