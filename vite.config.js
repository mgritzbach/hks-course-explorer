import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: '/',
  build: {
    // Keep Vite's private graph away from the public PWA /manifest.json while
    // still giving the CI bundle guard an authoritative import graph.
    manifest: '.vite/manifest.json',
    rollupOptions: {
      output: {
        manualChunks: {
          // Split Plotly (3MB+) into its own chunk so it can be cached independently
          // Use the same factory entry as ScatterPlot. The package root pulls
          // an undeclared plotly.js peer and can silently create a broken
          // browser chunk after a clean install.
          'vendor-plotly': ['react-plotly.js/factory', 'plotly.js-dist-min'],
          // Core React runtime — tiny and frequently reused
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          // Supabase client
          'vendor-supabase': ['@supabase/supabase-js'],
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    exclude: ['tests/e2e/**', 'tests/production/**', 'node_modules/**'],
  },
})
