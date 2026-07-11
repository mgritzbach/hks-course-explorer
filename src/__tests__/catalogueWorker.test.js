import { describe, expect, it, vi } from 'vitest'
import { __test__ as catalogue } from '../../functions/api/catalogue.js'

const env = {
  CATALOGUE_API_ENABLED: 'true',
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'server-only-service-role-key',
}

describe('unified catalogue Pages Function', () => {
  it('fails closed before contacting Supabase until the parity switch is explicitly enabled', async () => {
    const fetchImpl = vi.fn()
    const response = await catalogue.handleGet(
      { request: new Request('https://app.example/api/catalogue'), env: {} },
      fetchImpl,
    )

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toMatchObject({ code: 'CATALOGUE_NOT_READY' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('uses a fixed promoted-snapshot view and never exposes the service credential', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify([{ offering_id: 'harvard-1', match_status: 'verified' }]), {
        status: 200,
      }),
    )
    const response = await catalogue.handleGet(
      {
        request: new Request(
          'https://app.example/api/catalogue?term=2026%20Fall&school=hks&q=API-101&limit=25',
        ),
        env,
      },
      fetchImpl,
    )

    expect(response.status).toBe(200)
    expect(await response.clone().text()).not.toContain(env.SUPABASE_SERVICE_ROLE_KEY)
    await expect(response.json()).resolves.toEqual({
      rows: [{ offering_id: 'harvard-1', match_status: 'verified' }],
      count: 1,
    })
    expect(fetchImpl).toHaveBeenCalledWith(
      expect.stringContaining('/rest/v1/catalogue_current_v1?'),
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          apikey: env.SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        }),
      }),
    )
    expect(fetchImpl.mock.calls[0][0]).toContain('term=eq.2026+Fall')
    expect(fetchImpl.mock.calls[0][0]).toContain('school=eq.HKS')
    expect(fetchImpl.mock.calls[0][0]).toContain('course_code.ilike')
  })

  it('rejects unsafe filters before Supabase and reports an upstream failure without leaking details', async () => {
    const fetchImpl = vi.fn()
    const invalid = await catalogue.handleGet(
      { request: new Request('https://app.example/api/catalogue?q=API-101,drop'), env },
      fetchImpl,
    )
    expect(invalid.status).toBe(400)
    expect(fetchImpl).not.toHaveBeenCalled()

    const unavailable = await catalogue.handleGet(
      { request: new Request('https://app.example/api/catalogue'), env },
      vi.fn().mockResolvedValue(new Response('database detail', { status: 500 })),
    )
    expect(unavailable.status).toBe(502)
    await expect(unavailable.json()).resolves.toMatchObject({ code: 'CATALOGUE_UNAVAILABLE' })
  })
})
