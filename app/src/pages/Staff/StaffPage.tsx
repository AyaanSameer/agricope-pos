import { useState } from 'react'
import type { FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { checkInStaff, checkOutStaff, createStaff, listStaff, updateStaff } from '../../api/staff'
import type { StaffInput, StaffMember } from '../../api/staff'
import { listStores } from '../../api/org'
import { ApiError } from '../../api/client'
import { useAuth } from '../../auth/AuthContext'
import './staff.css'

/**
 * The manager's workforce page: who is on the floor right now, check them in
 * and out, add new staff. Distinct from Users — staff here need no login.
 */

type Draft = StaffInput & { id?: string }

function timeOf(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function hoursToday(s: StaffMember): string {
  let ms = 0
  for (const e of s.today) {
    const end = e.check_out ? new Date(e.check_out).getTime() : Date.now()
    ms += end - new Date(e.check_in).getTime()
  }
  if (s.checked_in_at && !s.today.some((e) => e.check_in === s.checked_in_at)) {
    ms += Date.now() - new Date(s.checked_in_at).getTime()
  }
  if (ms <= 0) return '—'
  const h = Math.floor(ms / 3_600_000)
  const m = Math.round((ms % 3_600_000) / 60_000)
  return h ? `${h}h ${m}m` : `${m}m`
}

export function StaffPage() {
  const queryClient = useQueryClient()
  const { activeStore } = useAuth()
  const [draft, setDraft] = useState<Draft | null>(null)
  const [error, setError] = useState<string | null>(null)

  const staffQuery = useQuery({
    queryKey: ['staff', activeStore?.id ?? 'all'],
    queryFn: () => listStaff(activeStore?.id),
  })
  const storesQuery = useQuery({ queryKey: ['stores'], queryFn: listStores })

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['staff'] })

  const checkIn = useMutation({ mutationFn: checkInStaff, onSuccess: invalidate })
  const checkOut = useMutation({ mutationFn: checkOutStaff, onSuccess: invalidate })

  const save = useMutation({
    mutationFn: (d: Draft) => {
      const input: StaffInput = {
        name: d.name,
        role_title: d.role_title,
        store_id: d.store_id,
        is_active: d.is_active,
      }
      return d.id ? updateStaff(d.id, input) : createStaff(input)
    },
    onSuccess: () => {
      invalidate()
      setDraft(null)
      setError(null)
    },
    onError: (err) =>
      setError(err instanceof ApiError ? err.message : 'Could not save — try again.'),
  })

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (draft) save.mutate(draft)
  }

  const stores = storesQuery.data?.data ?? []
  const staff = staffQuery.data?.data ?? []
  const onFloor = staff.filter((s) => s.checked_in_at).length

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h2>Staff</h2>
          <p className="page-sub">
            {activeStore ? activeStore.name : 'All branches'} · {onFloor} on the floor now ·
            check-ins write the attendance log
          </p>
        </div>
        <button
          type="button"
          className="btn-primary staff-add"
          onClick={() => {
            setError(null)
            setDraft({ name: '', role_title: '', store_id: activeStore?.id ?? null, is_active: true })
          }}
        >
          + Add staff
        </button>
      </div>

      <div className="staff-grid">
        {staffQuery.isPending && <div className="staff-loading">Loading…</div>}
        {staff.map((s) => (
          <div key={s.id} className={s.is_active ? 'card staff-card' : 'card staff-card inactive'}>
            <div className="staff-card-top">
              <div className="staff-avatar">
                {s.name
                  .split(' ')
                  .map((w) => w[0])
                  .slice(0, 2)
                  .join('')}
              </div>
              <div className="staff-id">
                <div className="staff-name">{s.name}</div>
                <div className="staff-role">
                  {s.role_title} · {s.store_name ?? 'All branches'}
                </div>
              </div>
              <span className={s.checked_in_at ? 'staff-status in' : 'staff-status out'}>
                {s.checked_in_at ? `In since ${timeOf(s.checked_in_at)}` : 'Off the floor'}
              </span>
            </div>

            <div className="staff-card-mid">
              <span className="staff-hours">Today: {hoursToday(s)}</span>
              {s.today.length > 0 && (
                <span className="staff-log">
                  {s.today
                    .map((e) => `${timeOf(e.check_in)}–${e.check_out ? timeOf(e.check_out) : 'now'}`)
                    .join(' · ')}
                </span>
              )}
            </div>

            <div className="staff-card-actions">
              {s.checked_in_at ? (
                <button
                  type="button"
                  className="btn-secondary staff-out"
                  disabled={checkOut.isPending}
                  onClick={() => checkOut.mutate(s.id)}
                >
                  Check out
                </button>
              ) : (
                <button
                  type="button"
                  className="btn-primary"
                  disabled={checkIn.isPending || !s.is_active}
                  onClick={() => checkIn.mutate(s.id)}
                >
                  Check in
                </button>
              )}
              <button
                type="button"
                className="btn-secondary"
                onClick={() => {
                  setError(null)
                  setDraft({
                    id: s.id,
                    name: s.name,
                    role_title: s.role_title,
                    store_id: s.store_id,
                    is_active: s.is_active,
                  })
                }}
              >
                Edit
              </button>
            </div>
          </div>
        ))}
        {staffQuery.data && staff.length === 0 && (
          <div className="staff-loading">No staff yet — add your first.</div>
        )}
      </div>

      {draft && (
        <div className="staff-modal" role="dialog" aria-modal="true">
          <form className="staff-form card" onSubmit={onSubmit}>
            <h3>{draft.id ? 'Edit staff member' : 'New staff member'}</h3>
            <label className="field">
              <span>Name</span>
              <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} required />
            </label>
            <div className="staff-form-row">
              <label className="field">
                <span>Role</span>
                <input
                  placeholder="Fry cook, Counter, Cleaner…"
                  value={draft.role_title}
                  onChange={(e) => setDraft({ ...draft, role_title: e.target.value })}
                  required
                />
              </label>
              <label className="field">
                <span>Branch</span>
                <select
                  value={draft.store_id ?? ''}
                  onChange={(e) => setDraft({ ...draft, store_id: e.target.value || null })}
                >
                  <option value="">All branches</option>
                  {stores.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </label>
            </div>
            <label className="staff-check">
              <input
                type="checkbox"
                checked={draft.is_active ?? true}
                onChange={(e) => setDraft({ ...draft, is_active: e.target.checked })}
              />
              Active — can be checked in
            </label>
            {error && <div className="staff-error">{error}</div>}
            <div className="staff-form-actions">
              <button type="button" className="btn-secondary" onClick={() => setDraft(null)}>
                Cancel
              </button>
              <button type="submit" className="btn-primary" disabled={save.isPending}>
                {save.isPending ? 'Saving…' : 'Save staff'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
