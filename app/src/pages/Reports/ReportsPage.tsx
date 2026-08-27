import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import Big from 'big.js'
import { api } from '../../api/client'
import { useAuth } from '../../auth/AuthContext'
import { fmt, fmtQAR } from '../../lib/money'
import './reports.css'

type Range = 'today' | '7d' | 'month'

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
  /** same-length window immediately before — absent on backends that don't send it */
  previous?: {
    gross_sales: string
    order_count: number
    average_order: string
    discount_total: string
  }
}

const RANGES: { key: Range; label: string; vs: string; items: string }[] = [
  { key: 'today', label: 'Today', vs: 'vs yesterday', items: 'today' },
  { key: '7d', label: '7 days', vs: 'vs previous 7 days', items: 'this week' },
  { key: 'month', label: 'Month', vs: 'vs previous 30 days', items: 'this month' },
]

/** Cash carries the structure colour; credit is the one that hurts. */
const METHODS: { key: string; label: string; color: string }[] = [
  { key: 'cash', label: 'Cash', color: 'var(--forest)' },
  { key: 'card', label: 'Card', color: 'var(--leaf)' },
  { key: 'online', label: 'Online', color: 'var(--gold)' },
  { key: 'credit', label: 'Credit', color: 'var(--cta)' },
]

/** Only the genuinely overdue bucket gets colour. */
const BUCKETS: { key: string; label: string; tone: string }[] = [
  { key: 'current', label: 'Current', tone: 'ok' },
  { key: '30', label: '30–59 days', tone: 'quiet' },
  { key: '60', label: '60–89 days', tone: 'warn' },
  { key: '90+', label: '90+ days', tone: 'over' },
]

/** Percent movement against the previous window — null when there is nothing to compare. */
function movement(now: string | number, before: string | number | undefined): number | null {
  if (before === undefined) return null
  const prev = new Big(before)
  if (prev.eq(0)) return null
  return new Big(now).minus(prev).div(prev).times(100).round(1).toNumber()
}

function Delta({ pct, vs }: { pct: number | null; vs: string }) {
  if (pct === null) return <span className="rp-delta none">no comparison {vs}</span>
  const up = pct >= 0
  return (
    <span className={up ? 'rp-delta up' : 'rp-delta down'}>
      {up ? '▲' : '▼'} {Math.abs(pct).toFixed(1)}% <em>{vs}</em>
    </span>
  )
}

/** The day, visualized — every number comes from data that already exists. */
export function ReportsPage() {
  const { activeStore } = useAuth()
  const [range, setRange] = useState<Range>('today')
  const meta = RANGES.find((r) => r.key === range)!

  const params = new URLSearchParams({ range })
  if (activeStore) params.set('store_id', activeStore.id)
  const qs = `?${params.toString()}`

  const summaryQuery = useQuery({
    queryKey: ['summary', activeStore?.id, range],
    queryFn: () => api<Summary>(`/reports/summary${qs}`),
  })
  const topQuery = useQuery({
    queryKey: ['top-items', activeStore?.id, range],
    queryFn: () =>
      api<{ data: { name: string; quantity: string; revenue: string }[] }>(
        `/reports/top-items${qs}`,
      ),
  })
  const agingQuery = useQuery({
    queryKey: ['credit-aging'],
    queryFn: () =>
      api<{ buckets: Record<string, string> }>('/reports/credit-aging'),
  })

  const s = summaryQuery.data

  const today = new Date().toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })

  const hours = s
    ? Object.entries(s.by_hour)
        .map(([h, v]) => ({ hour: Number(h), value: new Big(v) }))
        .sort((a, b) => a.hour - b.hour)
    : []
  const peak = hours.reduce<(typeof hours)[number] | null>(
    (m, h) => (m === null || h.value.gt(m.value) ? h : m),
    null,
  )
  const maxHour = peak ? peak.value : new Big(0)

  const methodTotal = s
    ? Object.values(s.by_method).reduce((a, v) => a.plus(v), new Big(0))
    : new Big(0)
  const mix = s
    ? METHODS.map((m) => {
        const amount = new Big(s.by_method[m.key] ?? '0')
        return {
          ...m,
          amount,
          pct: methodTotal.gt(0) ? amount.div(methodTotal).times(100).round(0).toNumber() : 0,
        }
      })
    : []

  const items = topQuery.data?.data ?? []
  const topRevenue = items.reduce((m, i) => (new Big(i.revenue).gt(m) ? new Big(i.revenue) : m), new Big(0))
  const buckets = agingQuery.data?.buckets ?? {}

  return (
    <div className="page page-wide">
      <div className="page-head">
        <div>
          <h2>Reports</h2>
          <p className="page-sub">
            {activeStore ? activeStore.name : 'All branches'} · {today}
          </p>
        </div>
        <div className="rp-range" role="tablist" aria-label="Reporting period">
          {RANGES.map((r) => (
            <button
              key={r.key}
              type="button"
              role="tab"
              aria-selected={range === r.key}
              className={range === r.key ? 'rp-range-opt active' : 'rp-range-opt'}
              onClick={() => setRange(r.key)}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {!s ? (
        <div className="rp-loading">Crunching the numbers…</div>
      ) : (
        <>
          <div className="rp-kpis">
            <div className="rp-kpi">
              <span className="rp-kpi-label">Gross sales</span>
              <strong className="rp-kpi-value">{fmtQAR(s.gross_sales)}</strong>
              <Delta pct={movement(s.gross_sales, s.previous?.gross_sales)} vs={meta.vs} />
            </div>
            <div className="rp-kpi">
              <span className="rp-kpi-label">Orders</span>
              <strong className="rp-kpi-value">{s.order_count}</strong>
              <Delta pct={movement(s.order_count, s.previous?.order_count)} vs={meta.vs} />
            </div>
            <div className="rp-kpi">
              <span className="rp-kpi-label">Average order</span>
              <strong className="rp-kpi-value">{fmtQAR(s.average_order)}</strong>
              <Delta pct={movement(s.average_order, s.previous?.average_order)} vs={meta.vs} />
            </div>
            <div className="rp-kpi">
              <span className="rp-kpi-label">Discounts given</span>
              <strong className="rp-kpi-value">{fmtQAR(s.discount_total)}</strong>
              <Delta pct={movement(s.discount_total, s.previous?.discount_total)} vs={meta.vs} />
            </div>
          </div>

          <div className="rp-grid">
            <section className="rp-card rp-hours">
              <header className="rp-card-head">
                <h3>Sales by hour</h3>
                {peak && peak.value.gt(0) && (
                  <span className="rp-peak">
                    Peak {String(peak.hour).padStart(2, '0')}:00 · QAR {fmt(peak.value.toFixed(2))}
                  </span>
                )}
              </header>
              <div className="rp-bars">
                {hours.length === 0 && <p className="rp-empty">No sales in this period yet.</p>}
                {hours.map((h) => (
                  <div key={h.hour} className="rp-barcol">
                    <div
                      className={peak && h.hour === peak.hour ? 'rp-bar peak' : 'rp-bar'}
                      style={{
                        height: maxHour.gt(0)
                          ? `${Math.max(4, h.value.div(maxHour).times(100).toNumber())}%`
                          : '4%',
                      }}
                      title={`${String(h.hour).padStart(2, '0')}:00 — QAR ${fmt(h.value.toFixed(2))}`}
                    />
                    <span className="rp-bar-label">{String(h.hour).padStart(2, '0')}</span>
                  </div>
                ))}
              </div>
            </section>

            <section className="rp-card rp-mix">
              <header className="rp-card-head">
                <h3>Payment mix</h3>
              </header>
              <div className="rp-stack" aria-hidden="true">
                {mix
                  .filter((m) => m.amount.gt(0))
                  .map((m) => (
                    <span
                      key={m.key}
                      className="rp-stack-seg"
                      style={{ width: `${m.pct}%`, background: m.color }}
                    />
                  ))}
                {methodTotal.eq(0) && <span className="rp-stack-empty" />}
              </div>
              <div className="rp-mix-rows">
                {mix.map((m) => (
                  <div key={m.key} className="rp-mix-row">
                    <span className="rp-dot" style={{ background: m.color }} />
                    <span className="rp-mix-name">{m.label}</span>
                    <span className="rp-mix-amount">{fmt(m.amount.toFixed(2))}</span>
                    <span className="rp-mix-pct">{m.pct}%</span>
                  </div>
                ))}
              </div>
            </section>

            <section className="rp-card rp-top">
              <header className="rp-card-head">
                <h3>Top items {meta.items}</h3>
              </header>
              {items.length === 0 && <p className="rp-empty">Nothing sold yet.</p>}
              {items.map((item, i) => (
                <div key={item.name} className="rp-item">
                  <span className="rp-rank">{i + 1}</span>
                  <div className="rp-item-main">
                    <span className="rp-item-name">{item.name}</span>
                    <span className="rp-share">
                      <span
                        className="rp-share-fill"
                        style={{
                          width: topRevenue.gt(0)
                            ? `${new Big(item.revenue).div(topRevenue).times(100).toNumber()}%`
                            : '0%',
                        }}
                      />
                    </span>
                  </div>
                  <div className="rp-item-figures">
                    <span className="rp-item-revenue">{fmt(item.revenue)}</span>
                    <span className="rp-item-qty">{item.quantity} sold</span>
                  </div>
                </div>
              ))}
            </section>

            <section className="rp-card rp-aging">
              <header className="rp-card-head">
                <h3>Credit ageing</h3>
                <span className="rp-tag">FIFO</span>
              </header>
              {BUCKETS.map((b) => (
                <div key={b.key} className={`rp-bucket ${b.tone}`}>
                  <span className="rp-bucket-label">{b.label}</span>
                  <span className="rp-bucket-amount">{fmt(buckets[b.key] ?? '0.00')}</span>
                </div>
              ))}
              <p className="rp-note">
                Payments settle the oldest charge first, so the 90+ bucket only clears when the
                debt genuinely does.
              </p>
            </section>
          </div>
        </>
      )}
    </div>
  )
}
