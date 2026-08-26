import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { listProducts, listStations } from '../api/catalog'
import type { OrderItem } from '../api/orders'
import './kitchenticket.css'

/**
 * The printed kitchen ticket — for branches whose settings say "printer"
 * instead of a KDS. Opens right after a send with only the just-fired items,
 * grouped by station the way separate KDS screens would split them.
 */
export function KitchenTicketPrint({
  orderNumber,
  tableName,
  items,
  onClose,
}: {
  orderNumber: string
  tableName: string | null
  items: OrderItem[]
  onClose: () => void
}) {
  const productsQuery = useQuery({
    queryKey: ['products', { forTicket: true }],
    queryFn: () => listProducts({ include_inactive: true }),
  })
  const stationsQuery = useQuery({ queryKey: ['stations'], queryFn: listStations })

  const groups = useMemo(() => {
    const stationOf = new Map(
      (productsQuery.data?.data ?? []).map((p) => [p.id, p.kitchen_station_id]),
    )
    const names = new Map((stationsQuery.data?.data ?? []).map((s) => [s.id, s.name]))
    const byStation = new Map<string, OrderItem[]>()
    for (const item of items) {
      const stationId = stationOf.get(item.product_id)
      if (!stationId) continue // retail goods never make kitchen work
      const key = names.get(stationId) ?? 'Kitchen'
      byStation.set(key, [...(byStation.get(key) ?? []), item])
    }
    return [...byStation.entries()]
  }, [items, productsQuery.data, stationsQuery.data])

  const now = new Date()

  return (
    <div className="kticket-overlay" role="dialog" aria-modal="true" aria-label="Kitchen ticket">
      <div className="kticket-frame">
        <div className="kticket" id="kitchen-ticket">
          <div className="kticket-head">
            <div className="kticket-order">{orderNumber}</div>
            <div className="kticket-meta">
              {tableName ? `Table ${tableName}` : 'Counter'} ·{' '}
              {now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </div>
          </div>
          {groups.length === 0 && (
            <div className="kticket-empty">Nothing routed to a station.</div>
          )}
          {groups.map(([station, list]) => (
            <div key={station} className="kticket-station">
              <div className="kticket-station-name">— {station} —</div>
              {list.map((i) => (
                <div key={i.id} className="kticket-line">
                  <span className="kticket-qty">{i.quantity}×</span>
                  <span className="kticket-item">
                    {i.product_name}
                    {i.options.length > 0 && (
                      <span className="kticket-opts">{i.options.join(' · ')}</span>
                    )}
                  </span>
                </div>
              ))}
            </div>
          ))}
          <div className="kticket-foot">· · ·</div>
        </div>

        <div className="kticket-actions">
          <button type="button" className="btn-secondary" onClick={onClose}>
            Done
          </button>
          <button type="button" className="btn-primary" onClick={() => window.print()}>
            Print ticket
          </button>
        </div>
      </div>
    </div>
  )
}
