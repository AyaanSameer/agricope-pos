import { useEffect, useRef } from 'react'

/**
 * USB barcode scanners behave like very fast keyboards that finish with
 * Enter. Collect rapid digit bursts globally; ignore human-speed typing and
 * anything focused on an input.
 */
export function useBarcodeScanner(onScan: (code: string) => void) {
  const buffer = useRef('')
  const lastKey = useRef(0)

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return
      const now = Date.now()
      if (now - lastKey.current > 80) buffer.current = '' // humans are slower than scanners
      lastKey.current = now
      if (e.key === 'Enter') {
        if (buffer.current.length >= 6) onScan(buffer.current)
        buffer.current = ''
      } else if (/^\d$/.test(e.key)) {
        buffer.current += e.key
      } else {
        buffer.current = ''
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onScan])
}
