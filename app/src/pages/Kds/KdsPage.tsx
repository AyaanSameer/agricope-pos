import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../../api/client'
import { listStations } from '../../api/catalog'
import './kds.css'

interface Ticket {
  id: string
  order_number: string
  table_name: string | null
  station_id: string
  status: 'new' | 'in_progress' | 'done' | 'cancelled'
  created_at: string
  items: { id: string; product_name: string; quantity: string; note: string | null; cancelled: boolean }[]
}

/** The kitchen display — runs full-screen on a cheap tablet, polls every 5s. */
export function KdsPage() {
  const queryClient = useQueryClient()
  const [stationId, setStationId] = useState<string | null>(null)

  const stationsQuery = useQuery({ queryKey: ['stations'], queryFn: listStations })
  const stations = stationsQuery.data?.data ?? []
  const activeStation = stationId ?? stations[0]?.id ?? null

  const ticketsQuery = useQuery({
    queryKey: ['tickets', activeStation],
    queryFn: () =>
      api<{ data: Ticket[] }>(`/kitchen/tickets?station_id=${activeStation}&status=new,in_progress`),
    enabled: !!activeStation,
    refetchInterval: 5_000, // simple and robust; SSE can come later if it ever feels slow
  })
  const doneQuery = useQuery({
    queryKey: ['tickets-done', activeStation],
    queryFn: () => api<{ data: Ticket[] }>(`/kitchen/tickets?station_id=${activeStation}&status=done`),
    enabled: !!activeStation,
    refetchInterval: 15_000,
  })

  const bump = useMutation({
    mutationFn: ({ ticketId, status }: { ticketId: string; status: Ticket['status'] }) =>
      api(`/kitchen/tickets/${ticketId}`, { method: 'PATCH', body: JSON.stringify({ status }) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tickets'] })
      queryClient.invalidateQueries({ queryKey: ['tickets-done'] })
    },
  })

  function elapsed(t: Ticket): { label: string; cls: string } {
    const mins = (Date.now() - new Date(t.created_at).getTime()) / 60000
    const label = `${Math.floor(mins)}:${String(Math.floor((mins % 1) * 60)).padStart(2, '0')}`
    return { label, cls: mins >= 10 ? 'late' : mins >= 5 ? 'warn' : 'ok' }
  }

  const recent = (doneQuery.data?.data ?? []).slice(-4).reverse()

  return (
    <div className="kds">
      <header className="kds-head">
        <div className="kds-head-top">
          <h2>Kitchen — {stations.find((s) => s.id === activeStation)?.name ?? 'all stations'}</h2>
          <span className="kds-clock">
            {new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
          </span>
        </div>
        <div className="kds-stations">
          {stations.map((s) => (
            <button
              key={s.id}
              type="button"
              className={activeStation === s.id ? 'kds-station active' : 'kds-station'}
              onClick={() => setStationId(s.id)}
            >
              {s.name}
            </button>
          ))}
        </div>
      </header>

      <div className="kds-board">
        {ticketsQuery.data?.data.length === 0 && (
          <div className="kds-quiet">All quiet — tickets appear here the moment a waiter hits Send.</div>
        )}
        {ticketsQuery.data?.data.map((t) => {
          const e = elapsed(t)
          return (
            <div key={t.id} className="kds-ticket">
              <div className="kds-ticket-head">
                <div>
                  <strong>{t.order_number}</strong>
                  <span className="kds-table">{t.table_name ?? ''}</span>
                </div>
                <span className={`kds-elapsed ${e.cls}`}>{e.label}</span>
              </div>
              <div className={`kds-status ${t.status}`}>
                {t.status === 'new' ? 'NEW' : 'IN PROGRESS'}
              </div>
              <div className="kds-items">
                {t.items.map((i) => (
                  <div key={i.id} className={i.cancelled ? 'kds-item cancelled' : 'kds-item'}>
                    <span className="kds-qty">{i.quantity}×</span>
                    <span>{i.product_name}</span>
                    {i.cancelled && <span className="kds-cancel">PULLED</span>}
                  </div>
                ))}
              </div>
              {t.status === 'new' ? (
                <button
                  type="button"
                  className="kds-btn start"
                  onClick={() => bump.mutate({ ticketId: t.id, status: 'in_progress' })}
                >
                  Start
                </button>
              ) : (
                <button
                  type="button"
                  className="kds-btn done"
                  onClick={() => bump.mutate({ ticketId: t.id, status: 'done' })}
                >
                  Mark done
                </button>
              )}
            </div>
          )
        })}

        {recent.length > 0 && (
          <aside className="kds-recent">
            <div className="kds-recent-head">RECENTLY BUMPED</div>
            {recent.map((t) => (
              <div key={t.id} className="kds-recent-row">
                <span className="kds-check">✓</span>
                <span>{t.order_number}</span>
              </div>
            ))}
          </aside>
        )}
      </div>
      <footer className="kds-foot">
        Full-screen on the kitchen tablet · refreshing every 5 s
      </footer>
    </div>
  )
}
