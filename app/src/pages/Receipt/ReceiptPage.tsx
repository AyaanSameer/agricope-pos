import { Link, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import Big from 'big.js'
import { api } from '../../api/client'
import { fmt, fmtQAR } from '../../lib/money'
import { ReceiptView } from './ReceiptView'
import type { ReceiptData } from './ReceiptView'
import './receipt.css'

/** Staff-side receipt: print (80mm stylesheet), or send it on WhatsApp. */
export function ReceiptPage() {
  const { id } = useParams<{ id: string }>()
  const receiptQuery = useQuery({
    queryKey: ['receipt', id],
    queryFn: () => api<ReceiptData>(`/orders/${id}/receipt`),
    enabled: !!id,
  })
  const data = receiptQuery.data
  if (receiptQuery.isPending) return <div className="receipt-loading">Loading receipt…</div>
  if (!data) return <div className="receipt-loading">Receipt not found.</div>

  const publicUrl = `${window.location.origin}/r/${data.order.receipt_token}`
  const waUrl = `https://wa.me/?text=${encodeURIComponent(`Your receipt from ${data.business.name}: ${publicUrl}`)}`
  const { order } = data

  // What the panel says about the money, from the order rather than a guess.
  const paid = order.payments.reduce((a, p) => a.plus(p.amount), new Big(0))
  const due = new Big(order.total).minus(paid)
  const methods = order.payments
    .map((p) => `${p.method[0].toUpperCase()}${p.method.slice(1)} ${fmt(p.amount)}`)
    .join(' · ')
  const state =
    order.status === 'void' || order.status === 'refunded'
      ? {
          tone: 'void' as const,
          title: order.status === 'void' ? 'Voided' : 'Refunded',
          note: 'This order is read-only. The receipt still prints and shares.',
        }
      : due.lte(0.004)
        ? {
            tone: 'paid' as const,
            title: 'Paid in full',
            note: `${methods} — the order closed the moment payments covered the total.`,
          }
        : {
            tone: 'due' as const,
            title: `${fmtQAR(due.toFixed(2))} still due`,
            note: methods
              ? `${methods} taken so far.`
              : 'Nothing has been paid on this order yet.',
          }

  return (
    <div className="receipt-page">
      <ReceiptView data={data} qrUrl={publicUrl} />
      <aside className="receipt-side">
        <div className={`receipt-state tone-${state.tone}`}>
          <strong>{state.title}</strong>
          <span>{state.note}</span>
        </div>

        {/* The paper is what gets handed over — printing is the one big button. */}
        <button type="button" className="receipt-act primary" onClick={() => window.print()}>
          Print 80 mm receipt
        </button>
        <a className="receipt-act" href={waUrl} target="_blank" rel="noreferrer">
          Send on WhatsApp
        </a>
        <Link className="receipt-act" to="/register">
          New sale
        </Link>
      </aside>
    </div>
  )
}

/** The public, unauthenticated e-receipt — what the customer's phone opens. */
export function PublicReceiptPage() {
  const { token } = useParams<{ token: string }>()
  const receiptQuery = useQuery({
    queryKey: ['public-receipt', token],
    queryFn: () => api<ReceiptData>(`/r/${token}`),
    enabled: !!token,
    retry: false,
  })
  if (receiptQuery.isPending) return <div className="receipt-loading">Loading receipt…</div>
  if (!receiptQuery.data) {
    return <div className="receipt-loading">This receipt link is not valid.</div>
  }
  return (
    <div className="receipt-public">
      <ReceiptView data={receiptQuery.data} />
    </div>
  )
}
