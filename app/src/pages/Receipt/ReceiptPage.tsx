import { useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { api } from '../../api/client'
import { ReceiptQR, ReceiptView } from './ReceiptView'
import type { ReceiptData } from './ReceiptView'
import './receipt.css'

/** Staff-side receipt: print (80mm stylesheet) + share by link/QR/WhatsApp. */
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

  return (
    <div className="receipt-page">
      <ReceiptView data={data} />
      <aside className="receipt-side">
        <button type="button" className="btn-primary receipt-print" onClick={() => window.print()}>
          Print receipt
        </button>
        <div className="card receipt-share">
          <h4>Share e-receipt</h4>
          <ReceiptQR url={publicUrl} />
          <p className="receipt-share-hint">Customer scans, or send it on WhatsApp — no login needed, the link is the secret.</p>
          <a className="btn-secondary receipt-wa" href={waUrl} target="_blank" rel="noreferrer">
            Share on WhatsApp
          </a>
          <button
            type="button"
            className="btn-secondary receipt-copy"
            onClick={() => navigator.clipboard.writeText(publicUrl)}
          >
            Copy link
          </button>
        </div>
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
