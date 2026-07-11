// POST /api/auth/verify
// Body: { email: "user@harvard.edu", otp: "123456" }
// Verifies OTP, issues 30-day JWT as httpOnly cookie

import { signJWT } from '../../_shared/jwt.js'
import { corsHeaders, handleOptions } from '../../_shared/cors.js'

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

    if (typeof email !== 'string' || typeof otp !== 'string' || !email || !otp)
      return response(request, 400, { error: 'Email and OTP are required.' })

    if (!env?.HKS_KV?.get || !env.HKS_KV?.put || !env.HKS_KV?.delete)
      return response(request, 503, { error: 'Login storage is not configured.' })

    const key = `otp:${email.toLowerCase().trim()}`
    const stored = await env.HKS_KV.get(key)

    if (!stored) {
      return response(request, 400, {
        error: 'Code expired or not found. Please request a new one.',
      })
    }

    const { otp: storedOtp, expires, attempts = 0 } = JSON.parse(stored)

    if (Date.now() > expires) {
      await env.HKS_KV.delete(key)
      return response(request, 400, { error: 'Code has expired. Please request a new one.' })
    }

    if (otp.trim() !== storedOtp) {
      const nextAttempts = Number.isInteger(attempts) && attempts >= 0 ? attempts + 1 : 1
      if (nextAttempts >= OTP_ATTEMPT_LIMIT) {
        await env.HKS_KV.delete(key)
        return response(request, 429, {
          error: 'Too many incorrect codes. Please request a new one.',
        })
      }

      // Workers KV rejects TTLs below one minute. The separately stored
      // expiration still makes the OTP fail closed at its actual deadline.
      const remainingTtl = Math.max(60, Math.ceil((expires - Date.now()) / 1000))
      await env.HKS_KV.put(
        key,
        JSON.stringify({ otp: storedOtp, expires, attempts: nextAttempts }),
        {
          expirationTtl: remainingTtl,
        },
      )
      return response(request, 400, { error: 'Incorrect code. Please try again.' })
    }

    // OTP valid — delete it (single-use)
    await env.HKS_KV.delete(key)

    // Issue JWT
    const now = Math.floor(Date.now() / 1000)
    const payload = {
      email: email.toLowerCase().trim(),
      iat: now,
      exp: now + THIRTY_DAYS_SEC,
    }
    const token = await signJWT(payload, env.JWT_SECRET)

    // Set as httpOnly cookie
    const cookieOptions = [
      `hks_auth=${token}`,
      'HttpOnly',
      'SameSite=Lax',
      'Path=/',
      `Max-Age=${THIRTY_DAYS_SEC}`,
      // Secure only in production (Pages deploys over HTTPS)
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
  } catch (err) {
    console.error('verify.js error:', err)
    return response(request, 500, { error: 'Internal server error.' })
  }
}

export async function onRequestOptions({ request }) {
  return handleOptions(request)
}
