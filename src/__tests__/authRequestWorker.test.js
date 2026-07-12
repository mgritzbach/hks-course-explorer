import { afterEach, describe, expect, it, vi } from 'vitest'
import { onRequestPost, sendOtpEmail } from '../../functions/api/auth/request.js'

function request(body = { email: 'student@harvard.edu' }) {
  return new Request('https://worker.test/api/auth/request', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://hks-course-explorer.org' },
    body: JSON.stringify(body),
  })
}

function otpState(overrides = {}) {
  return {
    startOtpRequest: vi.fn().mockResolvedValue({ allowed: true, retryAfterMs: 0 }),
    confirmOtpRequest: vi.fn().mockResolvedValue({ confirmed: true }),
    cancelOtpRequest: vi.fn().mockResolvedValue({ cancelled: true }),
    ...overrides,
  }
}

function otpEnv(state, extra = {}) {
  return {
    RESEND_API_KEY: 'resend-key',
    CHAT_RATE_LIMITER: { getByName: vi.fn().mockReturnValue(state) },
    ...extra,
  }
}

afterEach(() => vi.unstubAllGlobals())

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

  it('fails closed before admission when email delivery is unconfigured', async () => {
    const response = await onRequestPost({ request: request(), env: {} })

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({ error: 'Email delivery is not configured.' })
  })

  it('atomically reserves delivery and confirms a code only after provider acceptance', async () => {
    const state = otpState()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 200 })))

    const response = await onRequestPost({ request: request(), env: otpEnv(state) })

    expect(response.status).toBe(200)
    expect(state.startOtpRequest).toHaveBeenCalledWith(
      expect.any(Number),
      expect.any(String),
      60_000,
    )
    expect(state.confirmOtpRequest).toHaveBeenCalledWith(
      expect.any(Number),
      expect.any(String),
      expect.stringMatching(/^[0-9a-f]{64}$/),
      600_000,
    )
    expect(state.cancelOtpRequest).not.toHaveBeenCalled()
  })

  it('uses the Durable Object cooldown for direct API callers', async () => {
    const state = otpState({ startOtpRequest: vi.fn().mockResolvedValue({ allowed: false }) })
    const response = await onRequestPost({ request: request(), env: otpEnv(state) })

    expect(response.status).toBe(429)
    await expect(response.json()).resolves.toEqual({
      error: 'Please wait one minute before requesting another code.',
    })
    expect(state.confirmOtpRequest).not.toHaveBeenCalled()
  })

  it('releases only the pending admission when delivery fails', async () => {
    const state = otpState()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 503 })))

    const response = await onRequestPost({ request: request(), env: otpEnv(state) })

    expect(response.status).toBe(502)
    expect(state.cancelOtpRequest).toHaveBeenCalledWith(state.startOtpRequest.mock.calls[0][1])
    expect(state.confirmOtpRequest).not.toHaveBeenCalled()
  })

  it('rejects an oversized chunked request before Durable Object admission', async () => {
    const state = otpState()
    const response = await onRequestPost({
      request: request({ email: 'student@harvard.edu', padding: 'x'.repeat(4_096) }),
      env: otpEnv(state),
    })

    expect(response.status).toBe(413)
    expect(state.startOtpRequest).not.toHaveBeenCalled()
  })
})
