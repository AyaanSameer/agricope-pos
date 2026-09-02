import { useState } from 'react'
import type { FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { checkInStaff, checkOutStaff, createStaff, deleteStaff, listStaff, updateStaff } from '../../api/staff'
import type { StaffInput, StaffMember } from '../../api/staff'
import { listStores } from '../../api/org'
import { ApiError } from '../../api/client'
import { useAuth } from '../../auth/AuthContext'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { shortBranch } from '../../lib/branch'
import './staff.css'

/**
 * The manager's workforce page: who is on the floor right now, check them in
 * and out, add new staff. Distinct from Users — staff here need no login.
 */

type Draft = StaffInput & { id?: string }

function timeOf(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function msToday(s: StaffMember): number {
  let ms = 0
  for (const e of s.today) {
    const end = e.check_out ? new Date(e.check_out).getTime() : Date.now()
    ms += end - new Date(e.check_in).getTime()
  }
  if (s.checked_in_at && !s.today.some((e) => e.check_in === s.checked_in_at)) {
    ms += Date.now() - new Date(s.checked_in_at).getTime()
  }
  return Math.max(0, ms)
}

function duration(ms: number): string {
  if (ms <= 0) return '—'
  const h = Math.floor(ms / 3_600_000)
  const m = Math.round((ms % 3_600_000) / 60_000)
  return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`
}

/** Earliest check-in on the floor today — blank before anyone arrives. */
function firstCheckIn(staff: StaffMember[]): string {
  const times = staff.flatMap((s) => s.today.map((e) => e.check_in))
  for (const s of staff) if (s.checked_in_at) times.push(s.checked_in_at)
  if (times.length === 0) return '—'
  return timeOf(times.reduce((a, b) => (a < b ? a : b)))
}

export function StaffPage() {
  const queryClient = useQueryClient()
  const { activeStore, session } = useAuth()
  const isOwner = session?.user.role === 'owner'
  const [draft, setDraft] = useState<Draft | null>(null)
  const [deleting, setDeleting] = useState<StaffMember | null>(null)
  const [error, setError] = useState<string | null>(null)

  const staffQuery = useQuery({
    queryKey: ['staff', activeStore?.id ?? 'all'],
    queryFn: () => listStaff(activeStore?.id),
  })
  const storesQuery = useQuery({ queryKey: ['stores'], queryFn: listStores })

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['staff'] })

  const checkIn = useMutation({ mutationFn: checkInStaff, onSuccess: invalidate })
  const checkOut = useMutation({ mutationFn: checkOutStaff, onSuccess: invalidate })

  // Deactivate is the reversible step every manager has; it also checks the
  // person out, since an inactive member cannot be on the floor.
  const setActive = useMutation({
    mutationFn: ({ id, is_active }: { id: string; is_active: boolean }) =>
      updateStaff(id, { is_active }),
    onSuccess: invalidate,
    onError: (err) =>
      window.alert(err instanceof ApiError ? err.message : 'Could not update — try again.'),
  })

  // Delete is the owner's second decision, offered only once they are off.
  const remove = useMutation({
    mutationFn: (id: string) => deleteStaff(id),
    onSuccess: () => {
      setDeleting(null)
      invalidate()
    },
    onError: (err) => {
      setDeleting(null)
      window.alert(err instanceof ApiError ? err.message : 'Could not delete — try again.')
    },
  })

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
  const loggedToday = staff.reduce((a, s) => a + msToday(s), 0)

  return (
    <div className="page page-wide">
      <div className="staff-top">
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

      {/* The shift at a glance, before the individual cards. */}
      <div className="staff-stats">
        <div className="staff-stat">
          <span>On the floor</span>
          <strong>{onFloor}</strong>
        </div>
        <div className="staff-stat">
          <span>Off the floor</span>
          <strong>{staff.length - onFloor}</strong>
        </div>
        <div className="staff-stat">
          <span>Hours logged today</span>
          <strong>{duration(loggedToday)}</strong>
        </div>
        <div className="staff-stat">
          <span>First check-in</span>
          <strong>{firstCheckIn(staff)}</strong>
        </div>
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
                  {s.role_title} · {shortBranch(s.store_name) || 'All branches'}
                </div>
              </div>
              <span
                className={
                  !s.is_active
                    ? 'staff-status off'
                    : s.checked_in_at
                      ? 'staff-status in'
                      : 'staff-status out'
                }
              >
                {!s.is_active
                  ? 'Inactive'
                  : s.checked_in_at
                    ? `In since ${timeOf(s.checked_in_at)}`
                    : 'Off floor'}
              </span>
            </div>

            <div className="staff-card-mid">
              <span className="staff-hours">Today · {duration(msToday(s))}</span>
              {s.today.length === 0 && !s.checked_in_at && (
                <span className="staff-log">no entries today</span>
              )}
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
              <button
                type="button"
                className="btn-secondary"
                disabled={setActive.isPending}
                onClick={() => setActive.mutate({ id: s.id, is_active: !s.is_active })}
              >
                {s.is_active ? 'Deactivate' : 'Restore'}
              </button>
              {/* Only the owner removes a person outright, and only once they are off. */}
              {isOwner && !s.is_active && (
                <button
                  type="button"
                  className="btn-secondary staff-danger"
                  onClick={() => setDeleting(s)}
                >
                  Delete
                </button>
              )}
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
            <div className="staff-form-head">
              <div className="staff-form-title">
                <h3>Staff member</h3>
                <p>Staff need no login — this is the attendance record only.</p>
              </div>
              <button
                type="button"
                className="staff-form-close"
                aria-label="Close"
                onClick={() => setDraft(null)}
              >
                ✕
              </button>
            </div>
            <label className="field">
              <span>Name</span>
              <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} required />
            </label>
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
                {save.isPending ? 'Saving…' : 'Save staff member'}
              </button>
            </div>
          </form>
        </div>
      )}

      {deleting && (
        <ConfirmDialog
          title={`Delete ${deleting.name}?`}
          message="Removes them and their attendance record. This cannot be undone."
          confirmLabel={remove.isPending ? 'Deleting…' : 'Delete staff member'}
          danger
          busy={remove.isPending}
          onConfirm={() => remove.mutate(deleting.id)}
          onCancel={() => setDeleting(null)}
        />
      )}
    </div>
  )
}
