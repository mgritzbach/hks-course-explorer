import { describe, expect, it } from 'vitest'
import { readSupabaseConfig } from '../lib/supabase.js'

describe('Supabase browser configuration contract', () => {
  it('requires both explicitly supplied browser values', () => {
    expect(readSupabaseConfig({})).toMatchObject({ configured: false, url: '', anonKey: '' })
    expect(readSupabaseConfig({ VITE_SUPABASE_URL: 'https://example.supabase.co' })).toMatchObject({
      configured: false,
    })
    expect(readSupabaseConfig({ VITE_SUPABASE_ANON_KEY: 'public-key' })).toMatchObject({
      configured: false,
    })
    expect(
      readSupabaseConfig({
        VITE_SUPABASE_URL: 'https://supabase-unconfigured.invalid',
        VITE_SUPABASE_ANON_KEY: 'public-key',
      }),
    ).toMatchObject({ configured: false })
    expect(
      readSupabaseConfig({
        VITE_SUPABASE_URL: 'http://example.supabase.co',
        VITE_SUPABASE_ANON_KEY: 'public-key',
      }),
    ).toMatchObject({ configured: false })
    expect(
      readSupabaseConfig({
        VITE_SUPABASE_URL: 'https://your-project-ref.supabase.co',
        VITE_SUPABASE_ANON_KEY: 'public-key',
      }),
    ).toMatchObject({ configured: false })
    expect(
      readSupabaseConfig({
        VITE_SUPABASE_URL: 'https://your-project.supabase.co',
        VITE_SUPABASE_ANON_KEY: 'public-key',
      }),
    ).toMatchObject({ configured: false })
  })

  it('trims and accepts a complete target-specific configuration', () => {
    expect(
      readSupabaseConfig({
        VITE_SUPABASE_URL: ' https://valid-test-project.supabase.co ',
        VITE_SUPABASE_ANON_KEY: ' public-key ',
      }),
    ).toEqual({
      url: 'https://valid-test-project.supabase.co',
      anonKey: 'public-key',
      configured: true,
    })
  })
})
