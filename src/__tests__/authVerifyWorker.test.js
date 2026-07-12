import { describe, expect, it, vi } from 'vitest'
import { onRequestPost } from '../../functions/api/auth/verify.js'

const endpoint = 'https://worker.test/api/auth/verify'

function request(body) {
  return new Request(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://worker.test' },
    body: JSON.stringify(body),
  })
}

function otpEnv(status) {
  const verifyOtp = vi.fn().mockResolvedValue({ status })
  return {
    env: {
      CHAT_RATE_LIMITER: { getByName: vi.fn().mockReturnValue({ verifyOtp }) },
      JWT_SECRET: 'a-long-random-jwt-secret-value',
    },
    verifyOtp,
  }
}

describe('OTP verification worker', () => {
  it('returns an ordinary wrong-code response after one atomic state transition', async () => {
    const { env, verifyOtp } = otpEnv('incorrect')
    const rejected = await onRequestPost({
      request: request({ email: 'student@harvard.edu', otp: '000000' }),
      env,
    })

    expect(rejected.status).toBe(400)
    await expect(rejected.json()).resolves.toEqual({ error: 'Incorrect code. Please try again.' })
    expect(verifyOtp).toHaveBeenCalledWith(
      expect.any(Number),
      expect.stringMatching(/^[0-9a-f]{64}$/),
      5,
    )
  })

  it('rejects a code once the atomic attempt ceiling locks it', async () => {
    const { env } = otpEnv('locked')
    const response = await onRequestPost({
      request: request({ email: 'student@harvard.edu', otp: '000000' }),
      env,
    })

    expect(response.status).toBe(429)
    await expect(response.json()).resolves.toEqual({
      error: 'Too many incorrect codes. Please request a new one.',
    })
  })

  it('issues the existing secure JWT cookie only after atomic single-use acceptance', async () => {
    const { env, verifyOtp } = otpEnv('valid')
    const accepted = await onRequestPost({
      request: request({ email: 'student@harvard.edu', otp: '123456' }),
      env,
    })

    expect(accepted.status).toBe(200)
    expect(accepted.headers.get('Set-Cookie')).toContain('HttpOnly')
    await expect(accepted.json()).resolves.toEqual({ ok: true, email: 'student@harvard.edu' })
    expect(verifyOtp).toHaveBeenCalledTimes(1)
  })

  it('fails closed when the atomic login-state binding is absent', async () => {
    const response = await onRequestPost({
      request: request({ email: 'student@harvard.edu', otp: '123456' }),
      env: { JWT_SECRET: 'a-long-random-jwt-secret-value' },
    })

    expect(response.status).toBe(503)
  })
})
