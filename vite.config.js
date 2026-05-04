import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: '/',
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          // Split Plotly (3MB+) into its own chunk so it can be cached independently
          'vendor-plotly': ['react-plotly.js', 'plotly.js-dist-min'],
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
  },
})
