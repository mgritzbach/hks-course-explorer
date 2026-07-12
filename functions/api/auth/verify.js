// POST /api/auth/verify
// Body: { email: "user@harvard.edu", otp: "123456" }
// Verifies a single-use OTP through a per-email Durable Object and issues a
// 30-day JWT as an httpOnly cookie.

import { signJWT } from '../../_shared/jwt.js'
import { corsHeaders, handleOptions } from '../../_shared/cors.js'
import { hashedLimiterKey, limiterStub } from '../../_shared/rateLimit.js'

const THIRTY_DAYS_SEC = 30 * 24 * 60 * 60
const OTP_ATTEMPT_LIMIT = 5

function response(request, status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      ...corsHeaders(request),
    },
  })
}

export async function onRequestPost({ request, env }) {
  if (request.method === 'OPTIONS') return handleOptions(request)

  try {
    const { email, otp } = await request.json()
    if (typeof email !== 'string' || typeof otp !== 'string' || !email || !otp) {
      return response(request, 400, { error: 'Email and OTP are required.' })
    }

    const normalizedEmail = email.toLowerCase().trim()
    const otpState = await limiterStub(env, 'otp', normalizedEmail)
    if (!otpState) return response(request, 503, { error: 'Login storage is not configured.' })

    const decision = await otpState.verifyOtp(
      Date.now(),
      await hashedLimiterKey(otp.trim()),
      OTP_ATTEMPT_LIMIT,
    )
    if (!decision || typeof decision.status !== 'string') {
      return response(request, 503, { error: 'Login storage is not configured.' })
    }
    if (decision.status === 'missing') {
      return response(request, 400, {
        error: 'Code expired or not found. Please request a new one.',
      })
    }
    if (decision.status === 'locked') {
      return response(request, 429, {
        error: 'Too many incorrect codes. Please request a new one.',
      })
    }
    if (decision.status === 'incorrect') {
      return response(request, 400, { error: 'Incorrect code. Please try again.' })
    }
    if (decision.status !== 'valid') {
      return response(request, 503, { error: 'Login storage is not configured.' })
    }

    const now = Math.floor(Date.now() / 1000)
    const payload = {
      email: normalizedEmail,
      iat: now,
      exp: now + THIRTY_DAYS_SEC,
    }
    const token = await signJWT(payload, env.JWT_SECRET)
    const cookieOptions = [
      `hks_auth=${token}`,
      'HttpOnly',
      'SameSite=Lax',
      'Path=/',
      `Max-Age=${THIRTY_DAYS_SEC}`,
      'Secure',
    ].join('; ')

    return new Response(JSON.stringify({ ok: true, email: payload.email }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
        'Set-Cookie': cookieOptions,
        ...corsHeaders(request),
      },
    })
  } catch (error) {
    console.error(
      'OTP verification failed:',
      error instanceof Error ? error.message : 'unknown error',
    )
    return response(request, 500, { error: 'Internal server error.' })
  }
}

export async function onRequestOptions({ request }) {
  return handleOptions(request)
}
