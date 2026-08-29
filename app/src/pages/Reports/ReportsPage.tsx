import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import Big from 'big.js'
import { api } from '../../api/client'
import { useAuth } from '../../auth/AuthContext'
import { fmt } from '../../lib/money'
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

interface AgingRow {
  customer_id: string
  name: string
  balance: string
  days: number
  bucket: string
}

const RANGES: { key: Range; label: string; vs: string; items: string }[] = [
  { key: 'today', label: 'Today', vs: 'vs yesterday', items: 'Top items' },
  { key: '7d', label: '7 days', vs: 'vs previous 7 days', items: 'Top items this week' },
  { key: 'month', label: 'Month', vs: 'vs previous 30 days', items: 'Top items this month' },
]

/** Cash carries the structure colour; credit is the one that hurts. */
const METHODS: { key: string; label: string; color: string }[] = [
  { key: 'cash', label: 'Cash', color: 'var(--forest)' },
  { key: 'card', label: 'Card', color: 'var(--leaf)' },
  { key: 'online', label: 'Online', color: 'var(--gold)' },
  { key: 'credit', label: 'Credit', color: 'var(--cta)' },
]

/** Colour only the genuinely overdue buckets. */
const BUCKETS: { key: string; label: string; tone: string }[] = [
  { key: 'current', label: 'Current', tone: 'quiet' },
  { key: '30', label: '30–59 days', tone: 'quiet' },
  { key: '60', label: '60–89 days', tone: 'warn' },
  { key: '90+', label: '90+ days', tone: 'over' },
]

const ORDER_TYPES: { key: string; label: string }[] = [
  { key: 'counter', label: 'Counter' },
  { key: 'dine_in', label: 'Dine-in' },
  { key: 'takeaway', label: 'Takeaway' },
  { key: 'delivery', label: 'Online' },
]

/**
 * A KPI moves either as a rate or as a count. Money rates read as percentages;
 * counts and balances read as the actual change, because "+12 orders" says more
 * than "+5.9%".
 */
type Delta = { text: string; up: boolean } | null

function pctDelta(now: string | number, before: string | number | undefined): Delta {
  if (before === undefined) return null
  const prev = new Big(before)
  if (prev.eq(0)) return null
  const pct = new Big(now).minus(prev).div(prev).times(100).round(1)
  const up = pct.gte(0)
  return { text: `${up ? '+' : '−'}${pct.abs().toFixed(1)}%`, up }
}

function countDelta(now: number, before: number | undefined): Delta {
  if (before === undefined) return null
  const diff = now - before
  if (diff === 0) return { text: '±0', up: true }
  return { text: `${diff > 0 ? '+' : '−'}${Math.abs(diff)}`, up: diff > 0 }
}

function moneyDelta(amount: string): Delta {
  const v = new Big(amount)
  if (v.eq(0)) return { text: '±0', up: true }
  return { text: `${v.gt(0) ? '+' : '−'}${fmt(v.abs().toFixed(2))}`, up: v.gt(0) }
}

function Kpi({ label, value, delta, vs }: { label: string; value: string; delta: Delta; vs: string }) {
  return (
    <div className="rp-kpi">
      <span className="rp-kpi-label">{label}</span>
      <strong className="rp-kpi-value">{value}</strong>
      {delta ? (
        <span className="rp-kpi-move">
          <span className={delta.up ? 'rp-pill up' : 'rp-pill down'}>{delta.text}</span>
          <em>{vs}</em>
        </span>
      ) : (
        <span className="rp-kpi-move">
          <em>no comparison</em>
        </span>
      )}
    </div>
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
      api<{ data: AgingRow[]; buckets: Record<string, string> }>('/reports/credit-aging'),
  })

  const s = summaryQuery.data

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
          pct: methodTotal.gt(0) ? amount.div(methodTotal).times(100).toNumber() : 0,
        }
      })
    : []

  const typeTotal = s
    ? Object.values(s.by_type).reduce((a, v) => a.plus(v), new Big(0))
    : new Big(0)
  const split = s
    ? ORDER_TYPES.map((t) => ({
        ...t,
        amount: new Big(s.by_type[t.key] ?? '0'),
      })).filter((t) => t.amount.gt(0))
    : []

  const items = topQuery.data?.data ?? []
  const buckets = agingQuery.data?.buckets ?? {}
  const owing = (agingQuery.data?.data ?? []).slice(0, 5)

  // Credit outstanding has no `previous` — but the window's own movement is the
  // delta. With nothing owed there is nothing to compare, so the pill goes away
  // rather than claiming a change against a zero balance.
  const creditMove = s ? new Big(s.credit_charged).minus(s.credit_repaid).toFixed(2) : '0.00'
  const creditDelta = s && new Big(s.credit_outstanding).eq(0) ? null : moneyDelta(creditMove)

  return (
    <div className="page page-wide">
      <div className="page-head">
        <div />
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
            <Kpi label="Gross sales" value={`QAR ${fmt(s.gross_sales)}`}
              delta={pctDelta(s.gross_sales, s.previous?.gross_sales)} vs={meta.vs} />
            <Kpi label="Orders" value={String(s.order_count)}
              delta={countDelta(s.order_count, s.previous?.order_count)} vs={meta.vs} />
            <Kpi label="Average order" value={`QAR ${fmt(s.average_order)}`}
              delta={pctDelta(s.average_order, s.previous?.average_order)} vs={meta.vs} />
            <Kpi label="Discounts given" value={`QAR ${fmt(s.discount_total)}`}
              delta={pctDelta(s.discount_total, s.previous?.discount_total)} vs={meta.vs} />
            <Kpi label="Credit outstanding" value={`QAR ${fmt(s.credit_outstanding)}`}
              delta={creditDelta} vs={meta.vs} />
          </div>

          <div className="rp-grid">
            <section className="rp-card rp-hours">
              <header className="rp-card-head">
                <h3>Sales by hour</h3>
                {peak && peak.value.gt(0) && (
                  <span className="rp-peak">
                    Peak {String(peak.hour).padStart(2, '0')}:00
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

            <section className="rp-card">
              <header className="rp-card-head">
                <h3>Payment mix</h3>
              </header>
              <div className="rp-mix">
                {mix.map((m) => (
                  <div key={m.key} className="rp-mix-row">
                    <div className="rp-mix-top">
                      <span className="rp-mix-name">{m.label}</span>
                      <span className="rp-mix-amount">{fmt(m.amount.toFixed(2))}</span>
                    </div>
                    <span className="rp-track">
                      <span
                        className="rp-track-fill"
                        style={{ width: `${m.pct}%`, background: m.color }}
                      />
                    </span>
                  </div>
                ))}
              </div>
            </section>

            <section className="rp-card">
              <header className="rp-card-head">
                <h3>{meta.items}</h3>
              </header>
              {items.length === 0 && <p className="rp-empty">Nothing sold yet.</p>}
              <div className="rp-items">
                {items.map((item, i) => (
                  <div key={item.name} className="rp-item">
                    <span className="rp-rank">{i + 1}</span>
                    <span className="rp-item-name">{item.name}</span>
                    <span className="rp-item-qty">×{item.quantity}</span>
                    <span className="rp-item-revenue">{fmt(item.revenue)}</span>
                  </div>
                ))}
              </div>
            </section>

            <section className="rp-card rp-aging">
              <header className="rp-card-head">
                <h3>Credit ageing</h3>
                <span className="rp-out">
                  QAR {fmt(s.credit_outstanding)}
                  <em>out</em>
                </span>
              </header>
              <div className="rp-buckets">
                {BUCKETS.map((b) => (
                  <div key={b.key} className={`rp-bucket ${b.tone}`}>
                    <span>{b.label}</span>
                    <strong>{fmt(buckets[b.key] ?? '0.00')}</strong>
                  </div>
                ))}
              </div>
              {owing.length > 0 && (
                <>
                  <div className="rp-subhead">Who owes it</div>
                  <div className="rp-owing">
                    {owing.map((r) => (
                      <div key={r.customer_id} className="rp-owing-row">
                        <span className="rp-owing-name">{r.name}</span>
                        <span className="rp-owing-days">{r.days} days</span>
                        <span className={r.days >= 60 ? 'rp-owing-amount late' : 'rp-owing-amount'}>
                          {fmt(r.balance)}
                        </span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </section>

            <section className="rp-card rp-split">
              <header className="rp-card-head">
                <h3>Order-type split</h3>
              </header>
              {split.length === 0 && <p className="rp-empty">No completed orders yet.</p>}
              <div className="rp-split-rows">
                {split.map((t) => (
                  <div key={t.key} className="rp-split-row">
                    <span className="rp-split-label">{t.label}</span>
                    <strong className="rp-split-amount">{fmt(t.amount.toFixed(2))}</strong>
                    <span className="rp-split-pct">
                      {typeTotal.gt(0)
                        ? `${t.amount.div(typeTotal).times(100).round(0).toString()}%`
                        : '0%'}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          </div>

          <p className="rp-note">
            Payments settle the oldest charge first, so the 90+ bucket only clears when the debt
            genuinely does.
          </p>
        </>
      )}
    </div>
  )
}
