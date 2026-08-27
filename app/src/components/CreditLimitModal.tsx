import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { updateCustomer } from '../api/customers'
import { ApiError } from '../api/client'
import { MoneyPad } from './MoneyPad'
import { ApprovalPinModal } from './ApprovalPinModal'
import { fmt, fmtQAR } from '../lib/money'
import './creditlimit.css'

/**
 * Customers exist for CRM first — most have no credit facility. When one asks
 * to put a sale on account mid-charge, a manager can open (or raise) their
 * limit right here rather than sending the cashier to the back office. The
 * amount is chosen first, then the PIN authorises it: granting credit is a
 * money decision, so the server refuses it without an approver's PIN.
 */
export function CreditLimitModal({
  customerId,
  customerName,
  currentLimit,
  balance,
  suggested,
  onDone,
  onClose,
}: {
  customerId: string
  customerName: string
  /** null = no credit facility yet */
  currentLimit: string | null
  balance: string
  /** the amount that needs to fit — usually the order's remaining due */
  suggested: string
  onDone: (newLimit: string) => void
  onClose: () => void
}) {
  const [amount, setAmount] = useState('')
  const [askingPin, setAskingPin] = useState(false)
  const [pinError, setPinError] = useState<string | null>(null)

  const save = useMutation({
    mutationFn: (pin: string) => updateCustomer(customerId, { credit_limit: amount }, pin),
    onSuccess: (c) => onDone(c.credit_limit ?? '0.00'),
    onError: (err) =>
      setPinError(
        err instanceof ApiError ? err.message : 'Could not set the limit — try again.',
      ),
  })

  function onKey(k: string) {
    setAmount((prev) => {
      if (k === '⌫') return prev.slice(0, -1)
      if (k === '.') return prev.includes('.') ? prev : (prev || '0') + '.'
      const next = prev + k
      const [, dec] = next.split('.')
      if (dec && dec.length > 2) return prev
      return next
    })
  }

  if (askingPin) {
    return (
      <ApprovalPinModal
        title={currentLimit === null ? 'Approve new credit line' : 'Approve higher limit'}
        message={`${customerName} — QAR ${fmt(amount)} limit. Manager or owner PIN.`}
        busy={save.isPending}
        error={pinError}
        onSubmit={(pin) => save.mutate(pin)}
        onClose={() => setAskingPin(false)}
      />
    )
  }

  const enough = amount !== '' && Number(amount) >= Number(balance) + Number(suggested)

  return (
    <div className="climit" role="dialog" aria-modal="true">
      <div className="card climit-card">
        <h3>{currentLimit === null ? 'Give credit to' : 'Raise credit limit —'} {customerName}</h3>
        <p className="climit-sub">
          {currentLimit === null
            ? 'This customer has no credit facility yet.'
            : `Current limit ${fmtQAR(currentLimit)}.`}{' '}
          They owe {fmtQAR(balance)} and this sale needs {fmtQAR(suggested)}.
        </p>

        <div className="climit-amount">
          <span>New limit</span>
          <strong>{amount ? `QAR ${amount}` : 'QAR 0.00'}</strong>
        </div>

        <div className="climit-chips">
          {[
            (Number(balance) + Number(suggested)).toFixed(2),
            '500.00',
            '1000.00',
            '2000.00',
          ]
            .filter((v, i, arr) => arr.indexOf(v) === i && Number(v) > 0)
            .map((v, i) => (
              <button key={v} type="button" className="chip" onClick={() => setAmount(v)}>
                {i === 0 ? `Just enough · ${fmt(v)}` : fmt(v)}
              </button>
            ))}
        </div>

        <MoneyPad onKey={onKey} />

        {amount !== '' && !enough && (
          <div className="climit-warn">
            That is below what this sale needs — credit will still be refused.
          </div>
        )}

        <button
          type="button"
          className="btn-primary"
          disabled={amount === '' || Number(amount) <= 0}
          onClick={() => {
            setPinError(null)
            setAskingPin(true)
          }}
        >
          Continue — needs manager PIN
        </button>
        <button type="button" className="btn-secondary" onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>
  )
}
