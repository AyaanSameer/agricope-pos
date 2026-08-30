import { useEffect, useState } from 'react'

/**
 * A clock the render can read. Elapsed time — how long a table has been
 * sitting, how long a ticket has waited — is a value that changes on its own,
 * so it comes from state on an interval rather than a `Date.now()` read
 * during render, which would be a different number every time React looked.
 */
export function useNow(everyMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), everyMs)
    return () => clearInterval(id)
  }, [everyMs])
  return now
}
