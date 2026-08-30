import { useEffect, useRef } from 'react'
import QRCode from 'qrcode'
import type { Order } from '../../api/orders'
import { Logomark } from '../../components/Logomark'
import { fmt, fmtQAR } from '../../lib/money'
import './receipt.css'

export interface ReceiptData {
  business: { name: string; footer: string }
  store: { name: string; address: string }
  order: Order
  credit: { customer_name: string; balance: string } | null
}

/** 80mm-thermal-shaped receipt — @media print rules make it printer-real. */
export function ReceiptView({ data, qrUrl }: { data: ReceiptData; qrUrl?: string }) {
  const { business, store, order, credit } = data
  return (
    <div className="receipt-paper" id="receipt">
      <div className="receipt-center receipt-head">
        <Logomark height={34} tone="colour" />
        <div className="receipt-biz">{business.name}</div>
        <div className="receipt-addr">
          {store.name} · {store.address}
        </div>
      </div>
      <div className="receipt-sep" />
      <div className="receipt-meta"><span>Order</span><span>{order.order_number}</span></div>
      <div className="receipt-meta">
        <span>Date</span>
        <span>
          {new Date(order.created_at).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
        </span>
      </div>
      <div className="receipt-meta"><span>Cashier</span><span>{order.cashier_name.split(' ')[0]}</span></div>
      <div className="receipt-meta">
        <span>Type</span>
        <span className="cap">
          {order.order_type.replace('_', '-')}
          {order.table_name ? ` · ${order.table_name}` : ''}
        </span>
      </div>
      {order.customer_name && (
        <div className="receipt-meta"><span>Customer</span><span>{order.customer_name}</span></div>
      )}
      <div className="receipt-sep" />
      {order.items.map((i) => (
        <div key={i.id} className="receipt-line">
          <span className="receipt-qty">{i.quantity}×</span>
          <span className="receipt-name">
            {i.product_name}
            {i.options.length > 0 && <span className="receipt-opts">{i.options.join(' · ')}</span>}
          </span>
          <span className="receipt-amt">{fmt(i.line_total)}</span>
        </div>
      ))}
      <div className="receipt-sep" />
      <div className="receipt-line"><span className="receipt-name">Subtotal</span><span className="receipt-amt">{fmt(order.subtotal)}</span></div>
      {Number(order.discount_total) > 0 && (
        <div className="receipt-line"><span className="receipt-name">Discount</span><span className="receipt-amt">−{fmt(order.discount_total)}</span></div>
      )}
      {Number(order.service_charge_total) > 0 && (
        <div className="receipt-line"><span className="receipt-name">Service charge</span><span className="receipt-amt">{fmt(order.service_charge_total)}</span></div>
      )}
      {Number(order.tax_total) > 0 && (
        <div className="receipt-line"><span className="receipt-name">Incl. tax</span><span className="receipt-amt">{fmt(order.tax_total)}</span></div>
      )}
      <div className="receipt-line receipt-total"><span className="receipt-name">TOTAL</span><span className="receipt-amt">{fmtQAR(order.total)}</span></div>
      <div className="receipt-sep" />
      {order.payments.map((p) => (
        <div key={p.id} className="receipt-line">
          <span className="receipt-name cap">
            {Number(p.amount) < 0 ? 'Refund — ' : ''}{p.method}
            {p.tendered && Number(p.change_given) > 0 ? ` (tendered ${fmt(p.tendered)}, change ${fmt(p.change_given!)})` : ''}
          </span>
          <span className="receipt-amt">{fmt(p.amount)}</span>
        </div>
      ))}
      {credit && (
        <>
          <div className="receipt-sep" />
          <div className="receipt-line">
            <span className="receipt-name">Account balance — {credit.customer_name}</span>
            <span className="receipt-amt">{fmt(credit.balance)}</span>
          </div>
        </>
      )}
      {order.status !== 'completed' && (
        <div className="receipt-center receipt-status">*** {order.status.toUpperCase()} ***</div>
      )}
      <div className="receipt-sep" />
      <div className="receipt-center receipt-footer">{business.footer}</div>
      {qrUrl && (
        <>
          <div className="receipt-sep" />
          <div className="receipt-center receipt-qr-block">
            <ReceiptQR url={qrUrl} />
            <div className="receipt-qr-note">Scan for your e-receipt</div>
            <div className="receipt-qr-url">{qrUrl.replace(/^https?:\/\//, '')}</div>
          </div>
        </>
      )}
    </div>
  )
}

export function ReceiptQR({ url }: { url: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    if (canvasRef.current) {
      QRCode.toCanvas(canvasRef.current, url, { width: 152, margin: 1, color: { dark: '#0a5038' } })
    }
  }, [url])
  return <canvas ref={canvasRef} className="receipt-qr" />
}
