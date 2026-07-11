import { describe, expect, it, vi } from 'vitest'
import { onRequestPost, sendOtpEmail } from '../../functions/api/auth/request.js'

function request(email = 'student@harvard.edu') {
  return new Request('https://worker.test/api/auth/request', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://hks-course-explorer.org' },
    body: JSON.stringify({ email }),
  })
}

describe('OTP email request worker', () => {
  it('uses Resend when its configured key is present', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }))

    await expect(
      sendOtpEmail({
        env: { RESEND_API_KEY: 'resend-key' },
        email: 'student@harvard.edu',
        otp: '123456',
        fetchImpl,
      }),
    ).resolves.toMatchObject({ configured: true, ok: true, provider: 'resend' })
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.resend.com/emails',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer resend-key' }),
      }),
    )
  })

  it('retains Brevo delivery as a backwards-compatible fallback', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('{}', { status: 201 }))

    await sendOtpEmail({
      env: { BREVO_API_KEY: 'brevo-key' },
      email: 'student@harvard.edu',
      otp: '123456',
      fetchImpl,
    })
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.brevo.com/v3/smtp/email',
      expect.objectContaining({ headers: expect.objectContaining({ 'api-key': 'brevo-key' }) }),
    )
  })

  it('fails closed before storing an OTP when email delivery is unconfigured', async () => {
    const put = vi.fn()
    const response = await onRequestPost({
      request: request(),
      env: { HKS_KV: { get: vi.fn(), put, delete: vi.fn() } },
    })

    expect(response.status).toBe(503)
    expect(put).not.toHaveBeenCalled()
  })

  it('stores an OTP only after a provider accepts the email request', async () => {
    const put = vi.fn().mockResolvedValue(undefined)
    const originalFetch = globalThis.fetch
    globalThis.fetch = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }))
    try {
      const response = await onRequestPost({
        request: request(),
        env: {
          HKS_KV: { get: vi.fn().mockResolvedValue(null), put, delete: vi.fn() },
          RESEND_API_KEY: 'resend-key',
        },
      })
      expect(response.status).toBe(200)
      expect(put).toHaveBeenCalledWith('otp-request:student@harvard.edu', '1', {
        expirationTtl: 60,
      })
      expect(put).toHaveBeenCalledWith('otp:student@harvard.edu', expect.any(String), {
        expirationTtl: 660,
      })
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('enforces the same 60-second resend cooldown for direct API callers', async () => {
    const get = vi.fn().mockResolvedValue('1')
    const put = vi.fn()
    const response = await onRequestPost({
      request: request(),
      env: { HKS_KV: { get, put, delete: vi.fn() }, RESEND_API_KEY: 'resend-key' },
    })

    expect(response.status).toBe(429)
    await expect(response.json()).resolves.toEqual({
      error: 'Please wait one minute before requesting another code.',
    })
    expect(put).not.toHaveBeenCalled()
  })
})
