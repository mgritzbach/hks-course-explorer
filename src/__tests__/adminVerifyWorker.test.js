import { describe, expect, it, vi } from 'vitest'
import { onRequestOptions, onRequestPost } from '../../functions/api/admin-verify.js'
import { requireAdminSession } from '../../functions/_shared/adminSession.js'

const endpoint = 'https://hks-course-explorer.pages.dev/api/admin-verify'

function adminRequest(body, origin = 'https://hks-course-explorer.pages.dev') {
  return new Request(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: origin,
      'CF-Connecting-IP': '203.0.113.7',
    },
    body: JSON.stringify(body),
  })
}

function adminEnv(admission = { allowed: true }) {
  const attempts = {
    recordAdminAttempt: vi.fn().mockResolvedValue(admission),
    resetAdminAttempts: vi.fn().mockResolvedValue(undefined),
  }
  return {
    attempts,
    env: {
      ADMIN_PASSWORD: 'configured password',
      ADMIN_SESSION_SECRET: 'a-long-random-admin-session-secret-value',
      CHAT_RATE_LIMITER: { getByName: vi.fn().mockReturnValue(attempts) },
    },
  }
}

describe('admin verification Pages Function', () => {
  it('fails closed when the configured secret is missing', async () => {
    const response = await onRequestPost({
      request: adminRequest({ password: 'attempt' }),
      env: {},
    })

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({ ok: false, error: 'Admin not configured' })
  })

  it('rejects an incorrect password and returns only the success contract', async () => {
    const { env, attempts } = adminEnv()
    const rejected = await onRequestPost({ request: adminRequest({ password: 'wrong' }), env })
    expect(rejected.status).toBe(401)
    await expect(rejected.json()).resolves.toEqual({ ok: false })

    const accepted = await onRequestPost({
      request: adminRequest({ password: 'configured password' }),
      env,
    })
    expect(accepted.status).toBe(200)
    const payload = await accepted.json()
    expect(payload).toEqual({ ok: true, session: expect.any(String) })
    await expect(
      requireAdminSession(
        new Request('https://hks-course-explorer.pages.dev/api/admin-history', {
          headers: { 'X-Admin-Session': payload.session },
        }),
        env,
      ),
    ).resolves.toEqual(expect.objectContaining({ scope: 'admin:data' }))
    expect(attempts.resetAdminAttempts).toHaveBeenCalledTimes(1)
  })

  it('rejects a client after the atomic attempt window is exhausted', async () => {
    const { env, attempts } = adminEnv({ allowed: false, retryAfterMs: 1 })
    const response = await onRequestPost({ request: adminRequest({ password: 'wrong' }), env })

    expect(response.status).toBe(429)
    await expect(response.json()).resolves.toEqual({ ok: false })
    expect(attempts.resetAdminAttempts).not.toHaveBeenCalled()
  })

  it('rejects invalid JSON and keeps untrusted origins out of the CORS allow-list', async () => {
    const malformed = await onRequestPost({
      request: new Request(endpoint, {
        method: 'POST',
        headers: { Origin: 'https://untrusted.example' },
        body: 'not json',
      }),
      env: adminEnv().env,
    })

    expect(malformed.status).toBe(400)
    await expect(malformed.json()).resolves.toEqual({ ok: false, error: 'Invalid JSON.' })
    expect(malformed.headers.get('Access-Control-Allow-Origin')).toBeNull()
    expect(malformed.headers.get('Vary')).toBe('Origin')

    const preflight = await onRequestOptions({
      request: new Request(endpoint, {
        method: 'OPTIONS',
        headers: { Origin: 'http://localhost:5173' },
      }),
    })
    expect(preflight.status).toBe(204)
    expect(preflight.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:5173')
  })
})
