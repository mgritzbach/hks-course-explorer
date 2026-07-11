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

function kvWith(record) {
  return {
    get: vi.fn().mockResolvedValue(JSON.stringify(record)),
    put: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
  }
}

describe('OTP verification worker', () => {
  it('counts a wrong code and keeps a legitimate remaining attempt usable', async () => {
    const expires = Date.now() + 10 * 60 * 1000
    const HKS_KV = kvWith({ otp: '123456', expires, attempts: 0 })
    const env = { HKS_KV, JWT_SECRET: 'a-long-random-jwt-secret-value' }

    const rejected = await onRequestPost({
      request: request({ email: 'student@harvard.edu', otp: '000000' }),
      env,
    })
    expect(rejected.status).toBe(400)
    expect(HKS_KV.put).toHaveBeenCalledWith(
      'otp:student@harvard.edu',
      expect.stringContaining('"attempts":1'),
      expect.objectContaining({ expirationTtl: expect.any(Number) }),
    )

    HKS_KV.get.mockResolvedValueOnce(JSON.stringify({ otp: '123456', expires, attempts: 1 }))
    const accepted = await onRequestPost({
      request: request({ email: 'student@harvard.edu', otp: '123456' }),
      env,
    })
    expect(accepted.status).toBe(200)
    expect(accepted.headers.get('Set-Cookie')).toContain('HttpOnly')
    expect(HKS_KV.delete).toHaveBeenCalledWith('otp:student@harvard.edu')
  })

  it('invalidates a code after five wrong attempts', async () => {
    const HKS_KV = kvWith({ otp: '123456', expires: Date.now() + 10 * 60 * 1000, attempts: 4 })
    const response = await onRequestPost({
      request: request({ email: 'student@harvard.edu', otp: '000000' }),
      env: { HKS_KV, JWT_SECRET: 'a-long-random-jwt-secret-value' },
    })

    expect(response.status).toBe(429)
    await expect(response.json()).resolves.toEqual({
      error: 'Too many incorrect codes. Please request a new one.',
    })
    expect(HKS_KV.delete).toHaveBeenCalledWith('otp:student@harvard.edu')
    expect(HKS_KV.put).not.toHaveBeenCalled()
  })

  it('keeps the KV write valid when an OTP is within its final minute', async () => {
    const HKS_KV = kvWith({ otp: '123456', expires: Date.now() + 1_000, attempts: 0 })
    const response = await onRequestPost({
      request: request({ email: 'student@harvard.edu', otp: '000000' }),
      env: { HKS_KV, JWT_SECRET: 'a-long-random-jwt-secret-value' },
    })

    expect(response.status).toBe(400)
    expect(HKS_KV.put).toHaveBeenCalledWith('otp:student@harvard.edu', expect.any(String), {
      expirationTtl: 60,
    })
  })
})
