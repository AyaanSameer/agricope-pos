import { useState } from 'react'
import Big from 'big.js'
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
  const { activeStore } = useAuth()
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
      {shift && (
        <div className="shifts-actions">
          <button type="button" className="shifts-move" onClick={() => setMovementOpen(true)}>
            + Paid in / out
          </button>
          <button type="button" className="btn-primary shifts-close" onClick={() => setClosing(true)}>
            Close shift…
          </button>
          <span className="shifts-state">Shift open</span>
        </div>
      )}

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
            <div className="xreport-head">
              <h3>X report — live drawer math</h3>
              <span className="xreport-when">mid-shift</span>
            </div>
            <XReportRows report={shift} />
          </div>
          <div className="card movements">
            <h3>Cash movements</h3>
            {shift.movements.length === 0 && (
              <p className="muted movements-empty">No paid in / out yet.</p>
            )}
            {shift.movements.map((m) => (
              <div key={m.id} className="movement">
                <span className={`st ${m.type === 'paid_in' ? 'st-done' : 'st-void'}`}>
                  {m.type === 'paid_in' ? 'PAID IN' : 'PAID OUT'}
                </span>
                <div className="movement-info">
                  <span className="movement-reason">{m.reason}</span>
                  <span className="movement-meta">
                    {m.created_by_name} ·{' '}
                    {new Date(m.created_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
                <span className={m.type === 'paid_in' ? 'movement-amt' : 'movement-amt out'}>
                  {m.type === 'paid_in' ? '+' : '−'}
                  {fmt(m.amount)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="card shifts-history">
        <div className="shifts-hrow shifts-hhead">
          <span>Date</span>
          <span>Who</span>
          <span>Open – close</span>
          <span>Outcome</span>
        </div>
        {historyQuery.data?.data.map((s) => (
          <div key={s.id} className="shifts-hrow">
            <span>{new Date(s.opened_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}</span>
            <span className="muted">{s.opened_by_name}</span>
            <span className="shifts-htime">
              {new Date(s.opened_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
              {' – '}
              {s.closed_at
                ? new Date(s.closed_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
                : 'now'}
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

/* Reasons a drawer opens outside a sale. "Other" keeps the free-text path,
   so nothing that used to be recordable stops being recordable. */
const PAID_OUT_REASONS = ['Supplier delivery', 'Petty cash', 'Bought change', 'Staff advance']
const PAID_IN_REASONS = ['Change float top-up', 'Owner deposit', 'Till correction']

function MovementModal({ shiftId, onDone, onClose }: { shiftId: string; onDone: () => void; onClose: () => void }) {
  const { value, setValue, onKey } = useMoneyEntry()
  const [type, setType] = useState<'paid_in' | 'paid_out'>('paid_out')
  const [reason, setReason] = useState(PAID_OUT_REASONS[0])
  const [otherReason, setOtherReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const reasons = type === 'paid_out' ? PAID_OUT_REASONS : PAID_IN_REASONS
  const finalReason = reason === 'Other' ? otherReason.trim() : reason
  const save = useMutation({
    mutationFn: () =>
      api(`/shifts/${shiftId}/movements`, {
        method: 'POST',
        body: JSON.stringify({ type, amount: value, reason: finalReason }),
      }),
    onSuccess: onDone,
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Could not record — try again.'),
  })

  function pickType(next: 'paid_in' | 'paid_out') {
    setType(next)
    setReason((next === 'paid_out' ? PAID_OUT_REASONS : PAID_IN_REASONS)[0])
  }

  return (
    <div className="cust-modal" role="dialog" aria-modal="true">
      <div className="card shift-modal">
        <div className="shift-modal-head">
          <div className="shift-modal-title">
            <h3>Cash paid {type === 'paid_out' ? 'out' : 'in'}</h3>
            <p>Every movement lands on the X report and the Z report.</p>
          </div>
          <button type="button" className="shift-modal-close" aria-label="Close" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="shift-seg" role="radiogroup" aria-label="Direction">
          <button
            type="button"
            role="radio"
            aria-checked={type === 'paid_out'}
            className={type === 'paid_out' ? 'shift-seg-btn active' : 'shift-seg-btn'}
            onClick={() => pickType('paid_out')}
          >
            Paid out
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={type === 'paid_in'}
            className={type === 'paid_in' ? 'shift-seg-btn active' : 'shift-seg-btn'}
            onClick={() => pickType('paid_in')}
          >
            Paid in
          </button>
        </div>

        <label className="shift-field">
          <span>Reason</span>
          <select value={reason} onChange={(e) => setReason(e.target.value)}>
            {reasons.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
            <option value="Other">Other…</option>
          </select>
        </label>
        {reason === 'Other' && (
          <input
            className="shift-other"
            autoFocus
            placeholder="What was the cash for?"
            value={otherReason}
            onChange={(e) => setOtherReason(e.target.value)}
          />
        )}

        <div className="shift-amount">
          <span className="shift-amount-eyebrow">Amount</span>
          <span className="shift-amount-value">{value ? `QAR ${value}` : 'QAR 0.00'}</span>
        </div>

        <div className="shift-quick">
          {['50.00', '100.00', '250.00'].map((v) => (
            <button key={v} type="button" className="shift-quick-btn" onClick={() => setValue(v)}>
              {v}
            </button>
          ))}
        </div>

        <MoneyPad onKey={onKey} disabled={save.isPending} size="fill" />
        {error && <div className="cust-error">{error}</div>}
        <button
          type="button"
          className="btn-primary shift-submit"
          disabled={!value || !finalReason || save.isPending}
          onClick={() => save.mutate()}
        >
          {save.isPending
            ? 'Recording…'
            : `Record paid ${type === 'paid_out' ? 'out' : 'in'} · ${fmtQAR(value || '0')}`}
        </button>
      </div>
    </div>
  )
}

function CloseShiftModal({ shift, onDone, onClose }: { shift: ShiftReport; onDone: (z: ShiftReport) => void; onClose: () => void }) {
  const { value, setValue, onKey } = useMoneyEntry()
  const [error, setError] = useState<string | null>(null)
  const close = useMutation({
    mutationFn: () =>
      api<ShiftReport>(`/shifts/${shift.id}/close`, {
        method: 'POST',
        body: JSON.stringify({ counted_cash: value || '0' }),
      }),
    onSuccess: onDone,
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Could not close — try again.'),
  })
  const expected = new Big(shift.live_expected_cash)
  const overShort = value !== '' ? new Big(value).minus(expected).toFixed(2) : null
  // Expected, then the two round figures either side of it a drawer usually
  // lands on — so the common counts are one tap rather than six.
  const down50 = expected.minus(expected.mod(50)).toFixed(2)
  const down100 = expected.minus(expected.mod(100)).toFixed(2)

  return (
    <div className="cust-modal" role="dialog" aria-modal="true">
      <div className="card shift-modal">
        <div className="shift-modal-head">
          <div className="shift-modal-title">
            <h3>Close the shift</h3>
            <p>
              Expected in drawer {fmtQAR(shift.live_expected_cash)} — count the cash and enter what
              is actually there.
            </p>
          </div>
          <button type="button" className="shift-modal-close" aria-label="Close" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="shift-amount">
          <span className="shift-amount-eyebrow">Counted</span>
          <span className="shift-amount-value">{value ? `QAR ${value}` : 'QAR 0.00'}</span>
        </div>

        <div className="shift-quick">
          <button
            type="button"
            className="shift-quick-btn"
            onClick={() => setValue(expected.toFixed(2))}
          >
            Expected
          </button>
          <button type="button" className="shift-quick-btn" onClick={() => setValue(down50)}>
            {fmt(down50)}
          </button>
          <button type="button" className="shift-quick-btn" onClick={() => setValue(down100)}>
            {fmt(down100)}
          </button>
        </div>

        {overShort !== null && (
          <div className={Number(overShort) === 0 ? 'overshort ok-bg' : 'overshort bad-bg'}>
            {Number(overShort) === 0
              ? 'Drawer balances exactly'
              : `${Number(overShort) > 0 ? 'Over' : 'Short'} ${fmtQAR(Math.abs(Number(overShort)).toFixed(2))}`}
          </div>
        )}

        <MoneyPad onKey={onKey} disabled={close.isPending} size="fill" />
        {error && <div className="cust-error">{error}</div>}
        <button
          type="button"
          className="btn-primary shift-submit"
          disabled={value === '' || close.isPending}
          onClick={() => close.mutate()}
        >
          {close.isPending ? 'Closing…' : 'Close shift & produce Z report'}
        </button>
        <p className="shift-note">
          Closing is permanent — the Z report becomes the record of this drawer.
        </p>
      </div>
    </div>
  )
}
