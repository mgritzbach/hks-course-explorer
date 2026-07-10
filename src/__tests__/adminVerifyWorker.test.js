import { describe, expect, it } from 'vitest'
import { onRequestOptions, onRequestPost } from '../../functions/api/admin-verify.js'
import { requireAdminSession } from '../../functions/_shared/adminSession.js'

const env = {
  ADMIN_PASSWORD: 'configured password',
  ADMIN_SESSION_SECRET: 'a-long-random-admin-session-secret-value',
}

const endpoint = 'https://hks-course-explorer.pages.dev/api/admin-verify'

function adminRequest(body, origin = 'https://hks-course-explorer.pages.dev') {
  return new Request(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin },
    body: JSON.stringify(body),
  })
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
    const protectedRequest = new Request(
      'https://hks-course-explorer.pages.dev/api/admin-history',
      {
        headers: { 'X-Admin-Session': payload.session },
      },
    )
    await expect(requireAdminSession(protectedRequest, env)).resolves.toEqual(
      expect.objectContaining({ scope: 'admin:data' }),
    )
  })

  it('rejects invalid JSON and keeps untrusted origins out of the CORS allow-list', async () => {
    const malformed = await onRequestPost({
      request: new Request(endpoint, {
        method: 'POST',
        headers: { Origin: 'https://untrusted.example' },
        body: 'not json',
      }),
      env,
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
