import { useState } from 'react'
import type { FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  getBusinessSettings,
  listStores,
  updateBusinessSettings,
  updateStore,
} from '../../api/org'
import type { StoreSettingsInput } from '../../api/org'
import { ApiError } from '../../api/client'
import { useAuth } from '../../auth/AuthContext'
import './settings.css'

/**
 * Branch settings, run by the manager — grouped rows, one card per branch:
 * identity, kitchen output, service charge, receipt, approvals. Every control
 * is backed by behaviour the till actually has; nothing here is decorative.
 */
export function SettingsPage() {
  const queryClient = useQueryClient()
  const { activeStore } = useAuth()
  const storesQuery = useQuery({ queryKey: ['stores'], queryFn: listStores })
  const bizQuery = useQuery({ queryKey: ['business-settings'], queryFn: getBusinessSettings })
  const [error, setError] = useState<string | null>(null)

  const saveStore = useMutation({
    mutationFn: ({ id, input }: { id: string; input: StoreSettingsInput }) =>
      updateStore(id, input),
    onSuccess: () => {
      setError(null)
      queryClient.invalidateQueries({ queryKey: ['stores'] })
    },
    onError: (err) =>
      setError(err instanceof ApiError ? err.message : 'Could not save — try again.'),
  })

  const saveBiz = useMutation({
    mutationFn: (input: { receipt_footer?: string; discount_approval_percent?: string }) =>
      updateBusinessSettings(input),
    onSuccess: () => {
      setError(null)
      queryClient.invalidateQueries({ queryKey: ['business-settings'] })
    },
    onError: (err) =>
      setError(err instanceof ApiError ? err.message : 'Could not save — try again.'),
  })

  const stores = storesQuery.data?.data ?? []
  const visible = activeStore ? stores.filter((s) => s.id === activeStore.id) : stores

  return (
    <div className="page settings-page">
      <div className="page-head">
        <div>
          <h2>Settings</h2>
          <p className="page-sub">Branch settings · owner &amp; manager only</p>
        </div>
      </div>

      {error && <div className="settings-error">{error}</div>}

      <div className="settings-list">
        {storesQuery.isPending && <div className="settings-loading">Loading…</div>}
        {visible.map((store) => (
          <div key={store.id} className="card settings-card">
            <div className="settings-store">
              <div className="settings-store-main">
                <div className="settings-store-name">{store.name}</div>
                <div className="settings-store-sub">
                  {store.type === 'retail' ? 'Retail' : 'Restaurant'} · {store.address}
                </div>
              </div>
              <span className="settings-type">
                {store.type === 'retail' ? 'Retail' : 'Restaurant'}
              </span>
            </div>

            {/* ---- Branch identity -------------------------------------- */}
            <IdentityGroup
              key={`id-${store.id}-${store.name}-${store.address}`}
              name={store.name}
              address={store.address ?? ''}
              busy={saveStore.isPending}
              onSave={(name, address) => saveStore.mutate({ id: store.id, input: { name, address } })}
            />

            {/* ---- Kitchen output --------------------------------------- */}
            <div className="settings-block">
              <div className="settings-block-head">
                <div className="settings-block-title">Kitchen output</div>
                <p className="settings-block-sub">
                  Where a sent order lands: the KDS board on the pass, or a printed ticket for
                  kitchens without a screen.
                </p>
              </div>
              <div className="settings-seg" role="radiogroup" aria-label="Kitchen output">
                {(
                  [
                    {
                      mode: 'kds',
                      label: 'KDS board',
                      hint: 'Live tickets on a screen at the pass, bumped by the kitchen.',
                    },
                    {
                      mode: 'printer',
                      label: 'Ticket printer',
                      hint: 'Prints an 80mm ticket on send. The Kitchen screen is hidden on this branch.',
                    },
                  ] as const
                ).map((opt) => (
                  <button
                    key={opt.mode}
                    type="button"
                    role="radio"
                    aria-checked={store.kitchen_mode === opt.mode}
                    className={
                      store.kitchen_mode === opt.mode ? 'settings-opt active' : 'settings-opt'
                    }
                    disabled={saveStore.isPending}
                    onClick={() => saveStore.mutate({ id: store.id, input: { kitchen_mode: opt.mode } })}
                  >
                    <span className="settings-opt-top">
                      <span className="settings-radio" aria-hidden="true" />
                      <span className="settings-opt-label">{opt.label}</span>
                    </span>
                    <span className="settings-opt-hint">{opt.hint}</span>
                  </button>
                ))}
              </div>
              {/* Say what the switch actually changes, before it is made. */}
              <div className="settings-effect">
                <span className="settings-effect-tag">Effect</span>
                <span className="settings-effect-text">
                  {store.kitchen_mode === 'printer'
                    ? 'Kitchen disappears from the hub · “Send to kitchen” opens a printable ticket instead'
                    : 'Kitchen appears on the hub · a sent round lands on the KDS board at the pass'}
                </span>
              </div>
            </div>

            {/* ---- Service charge & tax --------------------------------- */}
            <ServiceGroup
              key={`svc-${store.id}-${store.service_charge_rate}`}
              rate={store.service_charge_rate}
              isRestaurant={store.type === 'restaurant'}
              busy={saveStore.isPending}
              onSave={(rate) =>
                saveStore.mutate({ id: store.id, input: { service_charge_rate: rate } })
              }
            />
          </div>
        ))}

        {/* ---- Business-wide: receipt & approvals — one row, every branch */}
        {bizQuery.data && (
          <div className="card settings-card">
            <div className="settings-store">
              <div className="settings-store-main">
                <div className="settings-store-name">{bizQuery.data.business_name}</div>
                <div className="settings-store-sub">
                  Business-wide — these apply on every branch
                </div>
              </div>
            </div>

            <ReceiptGroup
              key={`rc-${bizQuery.data.receipt_footer}`}
              footer={bizQuery.data.receipt_footer}
              busy={saveBiz.isPending}
              onSave={(receipt_footer) => saveBiz.mutate({ receipt_footer })}
            />

            <ApprovalsGroup
              key={`ap-${bizQuery.data.discount_approval_percent}`}
              percent={bizQuery.data.discount_approval_percent}
              busy={saveBiz.isPending}
              onSave={(discount_approval_percent) => saveBiz.mutate({ discount_approval_percent })}
            />
          </div>
        )}
      </div>
    </div>
  )
}

/* ---- Groups. Each is title + sub, controls, and a Save that only appears
   once something differs from what the server holds. ----------------------- */

/* The group components re-mount via key when the server value changes, so a
   plain useState stays in sync without an effect. */
function useDirty<T>(initial: T) {
  const [value, setValue] = useState(initial)
  return [value, setValue, value !== initial] as const
}

function IdentityGroup({
  name,
  address,
  busy,
  onSave,
}: {
  name: string
  address: string
  busy: boolean
  onSave: (name: string, address: string) => void
}) {
  const [draftName, setDraftName] = useState(name)
  const [draftAddr, setDraftAddr] = useState(address)
  const dirty = draftName !== name || draftAddr !== address

  function submit(e: FormEvent) {
    e.preventDefault()
    if (dirty && draftName.trim()) onSave(draftName, draftAddr)
  }

  return (
    <form className="settings-block" onSubmit={submit}>
      <div className="settings-block-head">
        <div className="settings-block-title">Branch identity</div>
        <p className="settings-block-sub">
          The name on the topbar, the hub and every receipt this branch prints.
        </p>
      </div>
      <div className="settings-fields">
        <label className="settings-field">
          <span>Branch name</span>
          <input value={draftName} onChange={(e) => setDraftName(e.target.value)} required />
        </label>
        <label className="settings-field">
          <span>Address</span>
          <input value={draftAddr} onChange={(e) => setDraftAddr(e.target.value)} />
        </label>
      </div>
      {dirty && (
        <div className="settings-save-row">
          <button type="submit" className="btn-primary settings-save" disabled={busy}>
            {busy ? 'Saving…' : 'Save identity'}
          </button>
        </div>
      )}
    </form>
  )
}

function ServiceGroup({
  rate,
  isRestaurant,
  busy,
  onSave,
}: {
  rate: string
  isRestaurant: boolean
  busy: boolean
  onSave: (rate: string) => void
}) {
  const [draft, setDraft, dirty] = useDirty(rate)
  function submit(e: FormEvent) {
    e.preventDefault()
    if (dirty) onSave(draft)
  }
  return (
    <form className="settings-block" onSubmit={submit}>
      <div className="settings-block-head">
        <div className="settings-block-title">Service charge &amp; tax</div>
        <p className="settings-block-sub">
          All prices include tax — Qatar levies no VAT on these sales, so the included rate is 0.
          {isRestaurant && ' The service charge applies to dine-in tabs only.'}
        </p>
      </div>
      {isRestaurant ? (
        <>
          <div className="settings-fields">
            <label className="settings-field settings-field-narrow">
              <span>Dine-in service charge %</span>
              <input
                inputMode="decimal"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
              />
            </label>
          </div>
          <div className="settings-effect">
            <span className="settings-effect-tag">Effect</span>
            <span className="settings-effect-text">
              Open tabs pick the new rate up on their next change · completed orders keep the rate
              they were rung up with
            </span>
          </div>
          {dirty && (
            <div className="settings-save-row">
              <button type="submit" className="btn-primary settings-save" disabled={busy}>
                {busy ? 'Saving…' : 'Save service charge'}
              </button>
            </div>
          )}
        </>
      ) : (
        <div className="settings-effect">
          <span className="settings-effect-tag">Retail</span>
          <span className="settings-effect-text">No service charge — retail sales never carry one.</span>
        </div>
      )}
    </form>
  )
}

function ReceiptGroup({
  footer,
  busy,
  onSave,
}: {
  footer: string
  busy: boolean
  onSave: (footer: string) => void
}) {
  const [draft, setDraft, dirty] = useDirty(footer)
  function submit(e: FormEvent) {
    e.preventDefault()
    if (dirty) onSave(draft)
  }
  return (
    <form className="settings-block" onSubmit={submit}>
      <div className="settings-block-head">
        <div className="settings-block-title">Receipt &amp; printing</div>
        <p className="settings-block-sub">
          Receipts print at 80mm on the till's thermal printer. The footer line closes every one.
        </p>
      </div>
      <div className="settings-fields">
        <label className="settings-field">
          <span>Receipt footer</span>
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Thank you — see you tomorrow!"
          />
        </label>
      </div>
      <div className="settings-effect">
        <span className="settings-effect-tag">Effect</span>
        <span className="settings-effect-text">
          Printed and shared receipts end with this line · receipts already issued keep theirs
        </span>
      </div>
      {dirty && (
        <div className="settings-save-row">
          <button type="submit" className="btn-primary settings-save" disabled={busy}>
            {busy ? 'Saving…' : 'Save receipt'}
          </button>
        </div>
      )}
    </form>
  )
}

function ApprovalsGroup({
  percent,
  busy,
  onSave,
}: {
  percent: string
  busy: boolean
  onSave: (percent: string) => void
}) {
  const [draft, setDraft, dirty] = useDirty(percent)
  function submit(e: FormEvent) {
    e.preventDefault()
    if (dirty) onSave(draft)
  }
  return (
    <form className="settings-block" onSubmit={submit}>
      <div className="settings-block-head">
        <div className="settings-block-title">Approvals</div>
        <p className="settings-block-sub">
          Order discounts above this need a manager's PIN at the till. Voids and refunds always do.
        </p>
      </div>
      <div className="settings-fields">
        <label className="settings-field settings-field-narrow">
          <span>Approval threshold %</span>
          <input inputMode="decimal" value={draft} onChange={(e) => setDraft(e.target.value)} />
        </label>
      </div>
      <div className="settings-effect">
        <span className="settings-effect-tag">Effect</span>
        <span className="settings-effect-text">
          A cashier can give up to {Number(draft) || 0}% off on their own · anything above asks
          for the manager PIN
        </span>
      </div>
      {dirty && (
        <div className="settings-save-row">
          <button type="submit" className="btn-primary settings-save" disabled={busy}>
            {busy ? 'Saving…' : 'Save approvals'}
          </button>
        </div>
      )}
    </form>
  )
}
