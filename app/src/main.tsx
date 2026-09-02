import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider } from './auth/AuthContext'
import { CartProvider } from './cart/CartContext'
import App from './App'
import './styles/global.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
    },
  },
})

/**
 * Everything the app is served under. '/' in development, '/<repo>/' on a
 * GitHub Pages project site. The service worker and the router each need it:
 * the worker script is fetched by URL, and the router has to strip the prefix
 * before matching a path.
 */
const BASE = import.meta.env.BASE_URL
const ROUTER_BASE = BASE.replace(/\/$/, '') || '/'

async function enableMocking() {
  // The app runs against MSW until the real API is ready.
  // Flip VITE_USE_MOCKS=false in .env.local to point at the backend.
  if (import.meta.env.VITE_USE_MOCKS === 'false') return
  const { worker } = await import('./mocks/browser')
  return worker.start({
    serviceWorker: { url: `${BASE}mockServiceWorker.js` },
    onUnhandledRequest: 'bypass',
  })
}

enableMocking()
  .catch((err: unknown) => {
    // A till whose service worker will not register should still show the
    // app — requests then fail loudly, rather than the screen staying blank.
    console.error('[mocks] service worker unavailable — running without mocks', err)
  })
  .then(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <CartProvider>
            <BrowserRouter basename={ROUTER_BASE}>
              <App />
            </BrowserRouter>
          </CartProvider>
        </AuthProvider>
      </QueryClientProvider>
    </StrictMode>,
  )
})
