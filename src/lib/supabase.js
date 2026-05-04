import { createClient } from '@supabase/supabase-js'

// Prefer env vars (set in .env locally, Cloudflare Pages dashboard in production).
// Fall back to hardcoded values so the app works even if env vars are missing —
// the anon key is public and protected by Row Level Security, so this is safe.
const SUPABASE_URL =
  import.meta.env.VITE_SUPABASE_URL ||
  'https://cbtroatixvydpwoviezf.supabase.co'

const SUPABASE_ANON_KEY =
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNidHJvYXRpeHZ5ZHB3b3ZpZXpmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA3NDIyNTAsImV4cCI6MjA4NjMxODI1MH0.Lmegn_0huwUfwPFDANFdeO9hkdu3FiAE2yPEOIDQqCs'

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
