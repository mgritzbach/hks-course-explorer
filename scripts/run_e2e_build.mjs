import { spawnSync } from 'node:child_process'

// Browser tests mock every Supabase request, but the client still needs a
// syntactically valid configuration to reach the rendered application. Supply
// inert CI defaults only when a caller has not already provided target values.
const env = {
  ...process.env,
  VITE_SUPABASE_URL: process.env.VITE_SUPABASE_URL || 'https://ci.supabase.co',
  VITE_SUPABASE_ANON_KEY: process.env.VITE_SUPABASE_ANON_KEY || 'ci-public-anon-key',
}

const useWindowsShell = process.platform === 'win32'

for (const args of [
  ['run', 'build'],
  ['run', 'test:e2e'],
]) {
  const result = spawnSync('npm', args, { env, shell: useWindowsShell, stdio: 'inherit' })
  if (result.status !== 0) process.exit(result.status ?? 1)
}
