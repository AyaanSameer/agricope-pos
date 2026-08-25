import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../../api/client'
import { ApiError } from '../../api/client'
import { useAuth } from '../../auth/AuthContext'
import { MoneyPad } from '../../components/MoneyPad'
import { fmt, fmtQAR } from '../../lib/money'
import './shifts.css'

interface ShiftReport {
  id: string
  status: 'open' | 'closed'
  opening_float: string
  counted_cash: string | null
  over_short: string | null
  opened_at: string
  closed_at: string | null
  opened_by_name: string
  closed_by_name: string | null
  store_name: string
  cash_sales: string
  cash_refunds: string
  cash_repayments: string
  paid_in: string
  paid_out: string
  live_expected_cash: string
  movements: { id: string; type: 'paid_in' | 'paid_out'; amount: string; reason: string; created_by_name: string; created_at: string }[]
}

function useMoneyEntry() {
  const [value, setValue] = useState('')
  const onKey = (k: string) =>
    setValue((prev) => {
      if (k === '⌫') return prev.slice(0, -1)
      if (k === '.') return prev.includes('.') ? prev : (prev || '0') + '.'
      const next = prev + k
      const [, dec] = next.split('.')
      if (dec && dec.length > 2) return prev
      return next
    })
  return { value, setValue, onKey }
}

export function ShiftsPage() {
  const { activeStore, session } = useAuth()
  const queryClient = useQueryClient()
  const [movementOpen, setMovementOpen] = useState(false)
  const [closing, setClosing] = useState(false)
  const [lastZ, setLastZ] = useState<ShiftReport | null>(null)

  const currentQuery = useQuery({
    queryKey: ['shift-current', activeStore?.id],
    queryFn: () => api<{ shift: ShiftReport | null }>(`/shifts/current?store_id=${activeStore!.id}`),
    enabled: !!activeStore,
  })
  const historyQuery = useQuery({
    queryKey: ['shifts', activeStore?.id],
    queryFn: () => api<{ data: ShiftReport[] }>(`/shifts?store_id=${activeStore!.id}`),
    enabled: !!activeStore,
  })

  if (!activeStore) {
    return <div className="card shifts-empty">Pick a store first — the drawer lives in one till.</div>
  }
  const shift = currentQuery.data?.shift ?? null

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['shift-current'] })
    queryClient.invalidateQueries({ queryKey: ['shifts'] })
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h2>Shift &amp; cash drawer — {activeStore.name}</h2>
          <p className="page-sub">
            {shift
              ? `Open since ${new Date(shift.opened_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })} · ${shift.opened_by_name}`
              : 'No open shift — cash is locked until one opens'}
          </p>
        </div>
        {shift && (
          <div className="shifts-actions">
            <button type="button" className="btn-secondary" onClick={() => setMovementOpen(true)}>
              + Paid in / out
            </button>
            <button type="button" className="btn-primary shifts-close" onClick={() => setClosing(true)}>
              Close shift…
            </button>
          </div>
        )}
      </div>

      {!shift && !lastZ && <OpenShiftCard storeId={activeStore.id} onDone={refresh} />}

      {lastZ && !shift && (
        <div className="card zreport">
          <div className="zreport-head">
            <h3>Z report — drawer closed</h3>
            <span className={Number(lastZ.over_short) === 0 ? 'st st-done' : 'st st-void'}>
              {Number(lastZ.over_short) === 0
                ? 'BALANCED'
                : `${Number(lastZ.over_short) > 0 ? 'OVER' : 'SHORT'} ${fmt(lastZ.over_short!)}`}
            </span>
          </div>
          <XReportRows report={lastZ} closed />
          <button type="button" className="btn-secondary" onClick={() => setLastZ(null)}>
            Done
          </button>
        </div>
      )}

      {shift && (
        <div className="shifts-grid">
          <div className="card xreport">
            <h3>X report — live drawer math</h3>
            <XReportRows report={shift} />
          </div>
          <div className="card movements">
            <h3>Cash movements</h3>
            {shift.movements.length === 0 && <p className="muted">No paid in / out yet.</p>}
            {shift.movements.map((m) => (
              <div key={m.id} className="movement">
                <span className={`st ${m.type === 'paid_in' ? 'st-done' : 'st-void'}`}>
                  {m.type === 'paid_in' ? 'PAID IN' : 'PAID OUT'}
                </span>
                <div className="movement-info">
                  <span>{m.reason}</span>
                  <span className="muted small">
                    {new Date(m.created_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })} · {m.created_by_name}
                  </span>
                </div>
                <span className="strong">{m.type === 'paid_in' ? '+' : '−'}{fmt(m.amount)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="card shifts-history">
        <div className="shifts-history-head">Shift history</div>
        {historyQuery.data?.data.map((s) => (
          <div key={s.id} className="shifts-hrow">
            <span>{new Date(s.opened_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}</span>
            <span className="muted">{s.opened_by_name}</span>
            <span className="muted">
              {new Date(s.opened_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
              {' — '}
              {s.closed_at ? new Date(s.closed_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : 'open'}
            </span>
            <span>
              {s.status === 'open' ? (
                <span className="st st-gold">OPEN</span>
              ) : Number(s.over_short) === 0 ? (
                <span className="st st-done">BALANCED</span>
              ) : (
                <span className="st st-void">{Number(s.over_short!) > 0 ? 'OVER' : 'SHORT'} {fmt(s.over_short!)}</span>
              )}
            </span>
          </div>
        ))}
      </div>

      {movementOpen && shift && (
        <MovementModal shiftId={shift.id} onDone={() => { setMovementOpen(false); refresh() }} onClose={() => setMovementOpen(false)} />
      )}
      {closing && shift && (
        <CloseShiftModal
          shift={shift}
          onDone={(z) => { setClosing(false); setLastZ(z); refresh() }}
          onClose={() => setClosing(false)}
        />
      )}
    </div>
  )
}

function XReportRows({ report, closed = false }: { report: ShiftReport; closed?: boolean }) {
  return (
    <div className="xrows">
      <div className="xrow"><span className="xsign"> </span><span>Opening float</span><span>{fmt(report.opening_float)}</span></div>
      <div className="xrow"><span className="xsign plus">+</span><span>Cash sales</span><span>{fmt(report.cash_sales)}</span></div>
      <div className="xrow"><span className="xsign plus">+</span><span>Cash credit repayments</span><span>{fmt(report.cash_repayments)}</span></div>
      <div className="xrow"><span className="xsign plus">+</span><span>Paid in</span><span>{fmt(report.paid_in)}</span></div>
      <div className="xrow"><span className="xsign minus">−</span><span>Paid out</span><span>{fmt(report.paid_out)}</span></div>
      <div className="xrow"><span className="xsign minus">−</span><span>Cash refunds</span><span>{fmt(report.cash_refunds)}</span></div>
      <div className="xrow xtotal">
        <span className="xsign eq">=</span>
        <span>Expected in drawer</span>
        <span>{fmtQAR(report.live_expected_cash)}</span>
      </div>
      {closed && report.counted_cash && (
        <div className="xrow xtotal counted">
          <span className="xsign eq">✓</span>
          <span>Counted</span>
          <span>{fmtQAR(report.counted_cash)}</span>
        </div>
      )}
    </div>
  )
}

function OpenShiftCard({ storeId, onDone }: { storeId: string; onDone: () => void }) {
  const { value, onKey } = useMoneyEntry()
  const [error, setError] = useState<string | null>(null)
  const open = useMutation({
    mutationFn: () => api('/shifts', { method: 'POST', body: JSON.stringify({ store_id: storeId, opening_float: value || '0' }) }),
    onSuccess: onDone,
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Could not open — try again.'),
  })
  return (
    <div className="card openshift">
      <h3>Open a shift</h3>
      <p className="muted">Count the cash you're starting with — the float. Every cash movement from here on is accounted for until close.</p>
      <div className="cust-repay-amount">
        <span>Opening float</span>
        <strong>{value ? `QAR ${value}` : 'QAR 0.00'}</strong>
      </div>
      <div className="openshift-pad"><MoneyPad onKey={onKey} disabled={open.isPending} /></div>
      {error && <div className="cust-error">{error}</div>}
      <button type="button" className="btn-primary" disabled={open.isPending} onClick={() => open.mutate()}>
        {open.isPending ? 'Opening…' : `Open shift with ${value ? `QAR ${value}` : 'QAR 0.00'}`}
      </button>
    </div>
  )
}

function MovementModal({ shiftId, onDone, onClose }: { shiftId: string; onDone: () => void; onClose: () => void }) {
  const { value, onKey } = useMoneyEntry()
  const [type, setType] = useState<'paid_in' | 'paid_out'>('paid_out')
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const save = useMutation({
    mutationFn: () => api(`/shifts/${shiftId}/movements`, { method: 'POST', body: JSON.stringify({ type, amount: value, reason }) }),
    onSuccess: onDone,
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Could not record — try again.'),
  })
  return (
    <div className="cust-modal" role="dialog" aria-modal="true">
      <div className="card cust-repay">
        <h3>Cash in / out</h3>
        <div className="cust-repay-methods">
          <button type="button" className={type === 'paid_out' ? 'method active' : 'method'} onClick={() => setType('paid_out')}>Paid out</button>
          <button type="button" className={type === 'paid_in' ? 'method active' : 'method'} onClick={() => setType('paid_in')}>Paid in</button>
        </div>
        <input placeholder="Reason — e.g. bought change, petty cash" value={reason} onChange={(e) => setReason(e.target.value)} />
        <div className="cust-repay-amount"><span>Amount</span><strong>{value ? `QAR ${value}` : 'QAR 0.00'}</strong></div>
        <MoneyPad onKey={onKey} disabled={save.isPending} />
        {error && <div className="cust-error">{error}</div>}
        <button type="button" className="btn-primary" disabled={!value || !reason.trim() || save.isPending} onClick={() => save.mutate()}>
          Record
        </button>
        <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
      </div>
    </div>
  )
}

function CloseShiftModal({ shift, onDone, onClose }: { shift: ShiftReport; onDone: (z: ShiftReport) => void; onClose: () => void }) {
  const { value, onKey } = useMoneyEntry()
  const [error, setError] = useState<string | null>(null)
  const close = useMutation({
    mutationFn: () => api<ShiftReport>(`/shifts/${shift.id}/close`, { method: 'POST', body: JSON.stringify({ counted_cash: value || '0' }) }),
    onSuccess: onDone,
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Could not close — try again.'),
  })
  const overShort =
    value !== '' ? (Number(value) - Number(shift.live_expected_cash)).toFixed(2) : null
  return (
    <div className="cust-modal" role="dialog" aria-modal="true">
      <div className="card cust-repay">
        <h3>Close shift — count the drawer</h3>
        <p className="muted small">Expected: {fmtQAR(shift.live_expected_cash)} (server-computed)</p>
        <div className="cust-repay-amount"><span>Counted</span><strong>{value ? `QAR ${value}` : 'QAR 0.00'}</strong></div>
        {overShort !== null && (
          <div className={Number(overShort) === 0 ? 'overshort ok-bg' : 'overshort bad-bg'}>
            {Number(overShort) === 0 ? 'Drawer balances exactly' : `${Number(overShort) > 0 ? 'Over' : 'Short'} QAR ${Math.abs(Number(overShort)).toFixed(2)}`}
          </div>
        )}
        <MoneyPad onKey={onKey} disabled={close.isPending} />
        {error && <div className="cust-error">{error}</div>}
        <button type="button" className="btn-primary" disabled={value === '' || close.isPending} onClick={() => close.mutate()}>
          {close.isPending ? 'Closing…' : 'Close shift & produce Z report'}
        </button>
        <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
        <p className="muted tiny">Closing is permanent — the Z report becomes the record of this drawer.</p>
      </div>
    </div>
  )
}
