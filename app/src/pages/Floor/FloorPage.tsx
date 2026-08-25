import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../../api/client'
import { createOrder } from '../../api/orders'
import { useAuth } from '../../auth/AuthContext'
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
  const { activeStore } = useAuth()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [zone, setZone] = useState<string | null>(null)
  const [seating, setSeating] = useState<FloorTable | null>(null)
  const [guests, setGuests] = useState(2)

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
