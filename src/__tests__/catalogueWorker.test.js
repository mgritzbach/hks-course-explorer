import { describe, expect, it } from 'vitest'
import { onRequestGet } from '../../functions/api/catalogue.js'

const env = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'server-only-key',
}

function request(url = 'https://worker.test/api/catalogue') {
  return new Request(url, { headers: { Origin: 'https://hks-course-explorer.org' } })
}

describe('catalogue worker', () => {
  it('returns only rows from the promoted snapshot view and filters them safely', async () => {
    const fetchImpl = async (url, init) => {
      expect(url).toBe(
        'https://example.supabase.co/rest/v1/catalogue_current_v1?select=*&limit=2000',
      )
      expect(init.headers.apikey).toBe(env.SUPABASE_SERVICE_ROLE_KEY)
      return new Response(
        JSON.stringify([
          { course_code: 'API-101', title: 'Policy Analysis', school: 'HKS', term: '2026 Fall' },
          { course_code: 'GEN-1', title: 'General Studies', school: 'FAS', term: '2026 Fall' },
        ]),
        { status: 200 },
      )
    }

    const response = await onRequestGet({
      request: request('https://worker.test/api/catalogue?school=HKS&q=policy'),
      env,
      fetch: fetchImpl,
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      items: [expect.objectContaining({ course_code: 'API-101' })],
    })
  })

  it('fails closed when the server-only configuration is absent', async () => {
    const response = await onRequestGet({ request: request(), env: {}, fetch: () => null })

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: 'Catalogue is not configured.',
    })
  })

  it('does not expose an upstream failure as an empty catalogue', async () => {
    const response = await onRequestGet({
      request: request(),
      env,
      fetch: async () => new Response('failure', { status: 500 }),
    })

    expect(response.status).toBe(502)
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: 'Catalogue is temporarily unavailable.',
    })
  })
})
