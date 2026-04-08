// POST /api/auth/verify
// Body: { email: "user@harvard.edu", otp: "123456" }
// Verifies OTP, issues 30-day JWT as httpOnly cookie

import { signJWT } from '../../_shared/jwt.js'
import { corsHeaders, handleOptions } from '../../_shared/cors.js'

const THIRTY_DAYS_SEC = 30 * 24 * 60 * 60

export async function onRequestPost({ request, env }) {
  if (request.method === 'OPTIONS') return handleOptions(request)

  try {
    const { email, otp } = await request.json()

    if (!email || !otp) {
      return new Response(
        JSON.stringify({ error: 'Email and OTP are required.' }),
        { status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders(request) } },
      )
    }

    const key = `otp:${email.toLowerCase().trim()}`
    const stored = await env.HKS_KV.get(key)

    if (!stored) {
      return new Response(
        JSON.stringify({ error: 'Code expired or not found. Please request a new one.' }),
        { status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders(request) } },
      )
    }

    const { otp: storedOtp, expires } = JSON.parse(stored)

    if (Date.now() > expires) {
      await env.HKS_KV.delete(key)
      return new Response(
        JSON.stringify({ error: 'Code has expired. Please request a new one.' }),
        { status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders(request) } },
      )
    }

    if (otp.trim() !== storedOtp) {
      return new Response(
        JSON.stringify({ error: 'Incorrect code. Please try again.' }),
        { status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders(request) } },
      )
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

    return new Response(
      JSON.stringify({ ok: true, email: payload.email }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Set-Cookie': cookieOptions,
          ...corsHeaders(request),
        },
      },
    )
  } catch (err) {
    console.error('verify.js error:', err)
    return new Response(
      JSON.stringify({ error: 'Internal server error.' }),
      { status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders(request) } },
    )
  }
}

export async function onRequestOptions({ request }) {
  return handleOptions(request)
}
