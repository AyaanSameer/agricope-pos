import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  // GitHub Pages serves a project site from /<repo>/, not from the domain root,
  // so every asset URL has to carry that prefix. The deploy workflow sets
  // VITE_BASE from the repository name; locally it stays '/'.
  base: process.env.VITE_BASE ?? '/',
  plugins: [react()],
  server: {
    // With VITE_USE_MOCKS=false the SPA talks to the real API here. In mock
    // mode MSW answers inside the browser and this proxy never sees a request.
    proxy: { '/api': { target: process.env.VITE_API_URL ?? 'http://localhost:3000', changeOrigin: true } },
  },
})
