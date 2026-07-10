import { describe, expect, it, vi } from 'vitest'
import { verifyAdminPassword } from '../lib/adminAuth.js'

describe('verifyAdminPassword', () => {
  it('accepts only the explicit server success contract', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ ok: true, session: 'signed-session' }), { status: 200 }),
      )

    await expect(verifyAdminPassword('configured password', { fetchImpl })).resolves.toBe(
      'signed-session',
    )
    expect(fetchImpl).toHaveBeenCalledWith(
      '/api/admin-verify',
      expect.objectContaining({
        method: 'POST',
        credentials: 'same-origin',
        body: JSON.stringify({ password: 'configured password' }),
      }),
    )
  })

  it('distinguishes rejection from missing server configuration', async () => {
    await expect(
      verifyAdminPassword('wrong', {
        fetchImpl: vi
          .fn()
          .mockResolvedValue(new Response(JSON.stringify({ ok: false }), { status: 401 })),
      }),
    ).rejects.toThrow('Incorrect password')

    await expect(
      verifyAdminPassword('configured password', {
        fetchImpl: vi
          .fn()
          .mockResolvedValue(new Response(JSON.stringify({ ok: false }), { status: 503 })),
      }),
    ).rejects.toThrow('not configured')
  })

  it('fails closed for malformed verification responses', async () => {
    await expect(
      verifyAdminPassword('configured password', {
        fetchImpl: vi
          .fn()
          .mockResolvedValue(
            new Response(JSON.stringify({ ok: true, token: 'unexpected' }), { status: 200 }),
          ),
      }),
    ).rejects.toThrow('invalid response')

    await expect(
      verifyAdminPassword('configured password', {
        fetchImpl: vi
          .fn()
          .mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 })),
      }),
    ).rejects.toThrow('invalid response')

    await expect(
      verifyAdminPassword('configured password', {
        fetchImpl: vi.fn().mockResolvedValue(new Response('not json', { status: 200 })),
      }),
    ).rejects.toThrow('invalid response')
  })

  it('fails closed when the verification endpoint cannot be reached', async () => {
    await expect(
      verifyAdminPassword('configured password', {
        fetchImpl: vi.fn().mockRejectedValue(new TypeError('network down')),
      }),
    ).rejects.toThrow('unavailable')
  })
})
