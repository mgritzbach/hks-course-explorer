const url = (process.env.VITE_SUPABASE_URL || '').trim()
const anonKey = (process.env.VITE_SUPABASE_ANON_KEY || '').trim()
const placeholderHosts = new Set([
  'your-project-ref.supabase.co',
  'your-project.supabase.co',
  'example.supabase.co',
])

function fail(message) {
  process.stderr.write(`Supabase browser configuration error: ${message}\n`)
  process.exit(1)
}

if (!url || !anonKey) {
  fail('DEPLOY_VITE_SUPABASE_URL and DEPLOY_VITE_SUPABASE_ANON_KEY must both be supplied.')
}

try {
  const parsed = new URL(url)
  if (
    parsed.protocol !== 'https:' ||
    !parsed.hostname.endsWith('.supabase.co') ||
    placeholderHosts.has(parsed.hostname)
  ) {
    fail('VITE_SUPABASE_URL must be a non-placeholder HTTPS *.supabase.co project endpoint.')
  }
} catch {
  fail('VITE_SUPABASE_URL must be a valid non-placeholder HTTPS *.supabase.co project endpoint.')
}

process.stdout.write('Supabase browser configuration is structurally valid.\n')
