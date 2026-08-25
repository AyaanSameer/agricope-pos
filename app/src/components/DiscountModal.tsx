import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { applyDiscount, removeDiscount } from '../api/orders'
import type { Order } from '../api/orders'
import { ApiError } from '../api/client'
import { ApprovalPinModal } from './ApprovalPinModal'
import './discount.css'

/**
 * Small discounts sail through; past the business threshold the API answers
 * 403 APPROVAL_REQUIRED and we retry with a manager PIN — the mechanic the
 * design says to build once and reuse.
 */
export function DiscountModal({ order, onClose }: { order: Order; onClose: () => void }) {
  const queryClient = useQueryClient()
  const [type, setType] = useState<'percent' | 'fixed'>('percent')
  const [value, setValue] = useState('')
  const [reason, setReason] = useState('')
  const [needsPin, setNeedsPin] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pinError, setPinError] = useState<string | null>(null)

  const apply = useMutation({
    mutationFn: (pin?: string) => applyDiscount(order.id, { type, value, reason }, pin),
    onSuccess: (updated) => {
      queryClient.setQueryData(['order', order.id], updated)
      queryClient.invalidateQueries({ queryKey: ['orders'] })
      onClose()
    },
    onError: (err, pin) => {
      if (err instanceof ApiError && err.code === 'APPROVAL_REQUIRED' && !pin) {
        setNeedsPin(true)
        setPinError(null)
      } else if (pin) {
        setPinError(err instanceof ApiError ? err.message : 'Could not apply — try again.')
      } else {
        setError(err instanceof ApiError ? err.message : 'Could not apply — try again.')
      }
    },
  })

  const clear = useMutation({
    mutationFn: () => removeDiscount(order.id),
    onSuccess: (updated) => {
      queryClient.setQueryData(['order', order.id], updated)
      onClose()
    },
  })

  if (needsPin) {
    return (
      <ApprovalPinModal
        title="Approve discount"
        message={`${type === 'percent' ? `${value}%` : `QAR ${value}`} is above the approval threshold — manager PIN required.`}
        busy={apply.isPending}
        error={pinError}
        onSubmit={(pin) => apply.mutate(pin)}
        onClose={() => setNeedsPin(false)}
      />
    )
  }

  return (
    <div className="disc-modal" role="dialog" aria-modal="true">
      <div className="card disc-card">
        <h3>Order discount</h3>
        <div className="disc-type">
          <button type="button" className={type === 'percent' ? 'method active' : 'method'} onClick={() => setType('percent')}>Percent %</button>
          <button type="button" className={type === 'fixed' ? 'method active' : 'method'} onClick={() => setType('fixed')}>Fixed QAR</button>
        </div>
        <input
          inputMode="decimal"
          placeholder={type === 'percent' ? '10' : '25.00'}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          autoFocus
        />
        <input
          placeholder="Reason — the audit log will keep it"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        {error && <div className="disc-error">{error}</div>}
        <div className="disc-actions">
          {order.discount_type && (
            <button type="button" className="btn-secondary disc-remove" onClick={() => clear.mutate()}>
              Remove discount
            </button>
          )}
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button
            type="button"
            className="btn-primary"
            disabled={!value || Number(value) <= 0 || !reason.trim() || apply.isPending}
            onClick={() => apply.mutate(undefined)}
          >
            Apply
          </button>
        </div>
        <p className="muted tiny">Discounts above the business threshold need a manager PIN and are audit-logged.</p>
      </div>
    </div>
  )
}
