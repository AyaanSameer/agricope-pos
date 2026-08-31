import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  // GitHub Pages serves a project site from /<repo>/, not from the domain root,
  // so every asset URL has to carry that prefix. The deploy workflow sets
  // VITE_BASE from the repository name; locally it stays '/'.
  base: process.env.VITE_BASE ?? '/',
  plugins: [react()],
})
