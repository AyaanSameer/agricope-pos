import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import './chiprail.css'

/**
 * One scrolling row of chips with its own arrows.
 *
 * The category list runs past the edge on every canvas, and a till is a
 * touchscreen at arm's length — dragging a row sideways is fiddly with a
 * scanner in the other hand, so the row gets buttons. Wheel, trackpad, touch
 * and keyboard still scroll the track; the arrows disable at each end, and
 * both disappear when everything already fits.
 */
export function ChipRail({ label, children }: { label: string; children: ReactNode }) {
  const trackRef = useRef<HTMLDivElement>(null)
  const [inner, setInner] = useState<HTMLDivElement | null>(null)
  const [atStart, setAtStart] = useState(true)
  const [atEnd, setAtEnd] = useState(true)

  const sync = useCallback(() => {
    const el = trackRef.current
    if (!el) return
    const max = el.scrollWidth - el.clientWidth
    setAtStart(el.scrollLeft <= 1)
    setAtEnd(el.scrollLeft >= max - 1)
  }, [])

  // Measure before paint, after every render — chips arrive from a query, so
  // the row's width changes without the track's own box changing, and waiting
  // on the observer alone would leave the arrows missing until it fired.
  // setState with an unchanged value bails out, so this settles in one pass.
  useLayoutEffect(sync)

  // Then keep watching: the track's own width for canvas changes, the inner
  // row's for chips arriving after the first paint.
  useEffect(() => {
    const track = trackRef.current
    if (!track || !inner) return
    const ro = new ResizeObserver(sync)
    ro.observe(track)
    ro.observe(inner)
    return () => ro.disconnect()
  }, [inner, sync])

  function nudge(direction: -1 | 1) {
    const el = trackRef.current
    if (!el) return
    el.scrollBy({ left: direction * Math.max(180, el.clientWidth * 0.75), behavior: 'smooth' })
  }

  const fits = atStart && atEnd

  return (
    <div className="chiprail">
      {!fits && (
        <button
          type="button"
          className="chiprail-arrow"
          aria-label={`Scroll ${label} left`}
          disabled={atStart}
          onClick={() => nudge(-1)}
        >
          ‹
        </button>
      )}
      <div className="chiprail-track" ref={trackRef} onScroll={sync}>
        <div className="chiprail-inner" ref={setInner}>
          {children}
        </div>
      </div>
      {!fits && (
        <button
          type="button"
          className="chiprail-arrow"
          aria-label={`Scroll ${label} right`}
          disabled={atEnd}
          onClick={() => nudge(1)}
        >
          ›
        </button>
      )}
    </div>
  )
}
