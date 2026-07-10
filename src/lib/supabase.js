import { createClient } from '@supabase/supabase-js'

// Browser configuration must be supplied by the target environment. A
// project-specific fallback would make an incorrectly configured deployment
// read from or write to somebody else's database. The placeholder only keeps
// module imports deterministic; application code checks the exported flag
// before making a data request.
function isValidSupabaseUrl(url) {
  try {
    const parsed = new URL(url)
    const placeholderHosts = new Set([
      'your-project-ref.supabase.co',
      'your-project.supabase.co',
      'example.supabase.co',
    ])
    return (
      parsed.protocol === 'https:' &&
      parsed.hostname.endsWith('.supabase.co') &&
      !placeholderHosts.has(parsed.hostname)
    )
  } catch {
    return false
  }
}

export function readSupabaseConfig(environment = import.meta.env) {
  const url =
    typeof environment?.VITE_SUPABASE_URL === 'string' ? environment.VITE_SUPABASE_URL.trim() : ''
  const anonKey =
    typeof environment?.VITE_SUPABASE_ANON_KEY === 'string'
      ? environment.VITE_SUPABASE_ANON_KEY.trim()
      : ''

  return { url, anonKey, configured: Boolean(anonKey && isValidSupabaseUrl(url)) }
}

const { url: SUPABASE_URL, anonKey: SUPABASE_ANON_KEY, configured } = readSupabaseConfig()

export const isSupabaseConfigured = configured

export const supabase = createClient(
  SUPABASE_URL || 'https://supabase-unconfigured.invalid',
  SUPABASE_ANON_KEY || 'unconfigured-public-anon-key',
)
