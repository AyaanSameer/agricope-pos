import { useQuery } from '@tanstack/react-query'
import Big from 'big.js'
import { api } from '../../api/client'
import { useAuth } from '../../auth/AuthContext'
import { fmt, fmtQAR } from '../../lib/money'
import './reports.css'

interface Summary {
  gross_sales: string
  order_count: number
  average_order: string
  refund_count: number
  void_count: number
  by_method: Record<string, string>
  by_type: Record<string, string>
  by_hour: Record<string, string>
  discount_total: string
  service_charge_total: string
  credit_charged: string
  credit_repaid: string
  credit_outstanding: string
}

const METHOD_COLORS: Record<string, string> = {
  cash: 'var(--forest)',
  card: '#d94720',
  online: '#06b6d4',
  credit: '#d97706',
}

/** The day, visualized — every number comes from endpoints over data that already exists. */
export function ReportsPage() {
  const { activeStore } = useAuth()
  const storeParam = activeStore ? `?store_id=${activeStore.id}` : ''

  const summaryQuery = useQuery({
    queryKey: ['summary', activeStore?.id],
    queryFn: () => api<Summary>(`/reports/summary${storeParam}`),
  })
  const topQuery = useQuery({
    queryKey: ['top-items', activeStore?.id],
    queryFn: () => api<{ data: { name: string; quantity: string; revenue: string }[] }>(`/reports/top-items${storeParam}`),
  })
  const agingQuery = useQuery({
    queryKey: ['credit-aging'],
    queryFn: () => api<{ data: { name: string; balance: string; days: number; bucket: string }[]; buckets: Record<string, string> }>('/reports/credit-aging'),
  })

  const s = summaryQuery.data
  if (!s) return <div className="reports-loading">Crunching today's numbers…</div>

  const hours = Object.entries(s.by_hour).sort(([a], [b]) => Number(a) - Number(b))
  const maxHour = hours.reduce((m, [, v]) => Math.max(m, Number(v)), 1)
  const methodTotal = Object.values(s.by_method).reduce((a, v) => a.plus(v), new Big(0))
  const buckets = agingQuery.data?.buckets ?? {}
  const bucketMax = Object.values(buckets).reduce((m, v) => Math.max(m, Number(v)), 1)
  const BUCKET_LABELS: [string, string, string][] = [
    ['current', 'Current', 'var(--forest)'],
    ['30', '30+ days', '#d97706'],
    ['60', '60+ days', '#c1451f'],
    ['90+', '90+ days', '#d94720'],
  ]

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h2>Dashboard — today{activeStore ? ` · ${activeStore.name}` : ' · all stores'}</h2>
          <p className="page-sub">Owners see every store; managers see theirs</p>
        </div>
      </div>

      <div className="rp-kpis">
        <div className="card rp-kpi">
          <span>Gross sales</span>
          <strong>{fmtQAR(s.gross_sales)}</strong>
          <em>{s.order_count} completed orders</em>
        </div>
        <div className="card rp-kpi">
          <span>Average order</span>
          <strong>{fmtQAR(s.average_order)}</strong>
          <em>{s.void_count} void · {s.refund_count} refunded</em>
        </div>
        <div className="card rp-kpi">
          <span>Discounts given</span>
          <strong>{fmtQAR(s.discount_total)}</strong>
          <em>service charge {fmt(s.service_charge_total)}</em>
        </div>
        <div className="card rp-kpi">
          <span>Credit outstanding</span>
          <strong className="warn-text">{fmtQAR(s.credit_outstanding)}</strong>
          <em>today: +{fmt(s.credit_charged)} charged · −{fmt(s.credit_repaid)} repaid</em>
        </div>
      </div>

      <div className="rp-row">
        <div className="card rp-chart">
          <h3>Sales by hour</h3>
          <div className="rp-bars">
            {hours.length === 0 && <p className="muted">No sales yet today.</p>}
            {hours.map(([h, v]) => (
              <div key={h} className="rp-barcol" title={`${h}:00 — QAR ${fmt(v)}`}>
                <div className="rp-bar" style={{ height: `${Math.max(6, (Number(v) / maxHour) * 130)}px` }} />
                <span>{h}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="card rp-methods">
          <h3>Payment methods</h3>
          {Object.entries(s.by_method).map(([m, v]) => {
            const pct = methodTotal.gt(0) ? new Big(v).div(methodTotal).times(100).round(0).toNumber() : 0
            return (
              <div key={m} className="rp-method">
                <div className="rp-method-label">
                  <span className="cap">{m} · {pct}%</span>
                  <span className="strong">{fmt(v)}</span>
                </div>
                <div className="rp-track">
                  <div className="rp-fill" style={{ width: `${pct}%`, background: METHOD_COLORS[m] }} />
                </div>
              </div>
            )
          })}
          <div className="rp-types">
            {Object.entries(s.by_type).map(([t, v]) => (
              <span key={t} className="rp-type">{t.replace('_', '-')} · {fmt(v)}</span>
            ))}
          </div>
        </div>
      </div>

      <div className="rp-row">
        <div className="card rp-list">
          <h3>Top items</h3>
          {topQuery.data?.data.map((item, i) => (
            <div key={item.name} className="rp-item">
              <span className="rp-rank">{i + 1}</span>
              <div className="rp-item-info">
                <span>{item.name}</span>
                <span className="muted small">{item.quantity} sold</span>
              </div>
              <span className="strong">{fmt(item.revenue)}</span>
            </div>
          ))}
          {topQuery.data?.data.length === 0 && <p className="muted">Nothing sold yet.</p>}
        </div>
        <div className="card rp-list">
          <h3>Credit aging — who owes, for how long</h3>
          {BUCKET_LABELS.map(([key, label, color]) => (
            <div key={key} className="rp-method">
              <div className="rp-method-label">
                <span>{label}</span>
                <span className="strong">{fmt(buckets[key] ?? '0.00')}</span>
              </div>
              <div className="rp-track">
                <div
                  className="rp-fill"
                  style={{ width: `${(Number(buckets[key] ?? 0) / bucketMax) * 100}%`, background: color }}
                />
              </div>
            </div>
          ))}
          <div className="rp-aging-rows">
            {agingQuery.data?.data.slice(0, 4).map((r) => (
              <div key={r.name} className="rp-aging-row">
                <span>{r.name}</span>
                <span className="muted small">{r.days}d</span>
                <span className="strong">{fmt(r.balance)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
