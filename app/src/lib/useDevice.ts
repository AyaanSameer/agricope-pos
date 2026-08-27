import { useEffect, useState } from 'react'

/**
 * The density switch from the design spec: under 1024 the layout goes dense —
 * drill-down instead of side-by-side, bottom sheets instead of drawers.
 * Phone (under 768) additionally refuses the two screens that need a canvas.
 */
function useMedia(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window === 'undefined' ? false : window.matchMedia(query).matches,
  )
  useEffect(() => {
    const mql = window.matchMedia(query)
    const onChange = () => setMatches(mql.matches)
    onChange()
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [query])
  return matches
}

export function useDevice() {
  const dense = useMedia('(max-width: 1023px)')
  const phone = useMedia('(max-width: 767px)')
  return { dense, phone, roomy: !dense }
}
