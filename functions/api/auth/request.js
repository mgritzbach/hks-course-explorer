// POST /api/auth/request
// Body: { email: "user@harvard.edu" }
// Validates domain, generates a six-digit OTP, stores it in KV, and sends it
// through the configured transactional email provider.

import { corsHeaders, handleOptions } from '../../_shared/cors.js'

const ALLOWED_DOMAINS = [
  'harvard.edu',
  'hks.harvard.edu',
  'college.harvard.edu',
  'hms.harvard.edu',
  'fas.harvard.edu',
  'gsd.harvard.edu',
  'hbs.edu',
  'law.harvard.edu',
  'hsph.harvard.edu',
  'seas.harvard.edu',
  'divinity.harvard.edu',
  'extension.harvard.edu',
]

const WHITELIST = ['mic.gritzbach@gmail.com']
const DEFAULT_FROM = 'HKS Course Explorer <mgritzbach@hks.harvard.edu>'
const OTP_TTL_SECONDS = 10 * 60
const OTP_REQUEST_COOLDOWN_SECONDS = 60

function json(request, status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(request) },
  })
}

function isAllowed(email) {
  if (!email || !email.includes('@')) return false
  const normalized = email.toLowerCase().trim()
  if (WHITELIST.includes(normalized)) return true
  const domain = normalized.split('@')[1]
  return ALLOWED_DOMAINS.includes(domain) || domain.endsWith('.harvard.edu')
}

function generateOTP() {
  const values = new Uint32Array(1)
  crypto.getRandomValues(values)
  return String(values[0] % 1000000).padStart(6, '0')
}

function emailProvider(env) {
  if (typeof env?.RESEND_API_KEY === 'string' && env.RESEND_API_KEY.trim()) return 'resend'
  if (typeof env?.BREVO_API_KEY === 'string' && env.BREVO_API_KEY.trim()) return 'brevo'
  return null
}

function messageHtml(otp) {
  return `<div style="font-family:Georgia,serif;max-width:480px;margin:0 auto;padding:32px;background:#0d0d14;color:#e8e0d8;border-radius:12px">
    <h1 style="font-size:22px;margin:0 0 20px;color:#fff">Course Explorer</h1>
    <p>Your one-time login code is:</p>
    <p style="font-family:monospace;font-size:40px;letter-spacing:.18em;color:#d4a86a">${otp}</p>
    <p style="font-size:12px">This code expires in 10 minutes. If you did not request it, you can safely ignore this email.</p>
  </div>`
}

export async function sendOtpEmail({ env, email, otp, fetchImpl = fetch }) {
  const provider = emailProvider(env)
  if (!provider) return { configured: false, ok: false }

  const from =
    typeof env?.AUTH_FROM_EMAIL === 'string' && env.AUTH_FROM_EMAIL.trim()
      ? env.AUTH_FROM_EMAIL.trim()
      : DEFAULT_FROM
  const subject = 'Your HKS Course Explorer login code'
  const html = messageHtml(otp)
  const response =
    provider === 'resend'
      ? await fetchImpl('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${env.RESEND_API_KEY}`,
          },
          body: JSON.stringify({ from, to: [email], subject, html }),
        })
      : await fetchImpl('https://api.brevo.com/v3/smtp/email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'api-key': env.BREVO_API_KEY },
          body: JSON.stringify({
            sender: { name: 'HKS Course Explorer', email: from.match(/<(.+)>/)?.[1] || from },
            to: [{ email }],
            subject,
            htmlContent: html,
          }),
        })

  return { configured: true, ok: response.ok, provider }
}

export async function onRequestPost({ request, env }) {
  try {
    const { email } = await request.json()
    if (!isAllowed(email)) {
      return json(request, 403, {
        error: 'Only Harvard email addresses (or whitelisted emails) are allowed.',
      })
    }
    if (!emailProvider(env))
      return json(request, 503, { error: 'Email delivery is not configured.' })
    if (!env?.HKS_KV?.get || !env.HKS_KV?.put || !env.HKS_KV?.delete)
      return json(request, 503, { error: 'Login storage is not configured.' })

    const normalizedEmail = email.toLowerCase().trim()
    const cooldownKey = `otp-request:${normalizedEmail}`
    if (await env.HKS_KV.get(cooldownKey)) {
      return json(request, 429, {
        error: 'Please wait one minute before requesting another code.',
      })
    }

    // This mirrors the client resend countdown at the enforcement boundary so
    // direct API callers cannot repeatedly send mail or replace a valid code.
    await env.HKS_KV.put(cooldownKey, '1', { expirationTtl: OTP_REQUEST_COOLDOWN_SECONDS })
    const otp = generateOTP()
    const expires = Date.now() + OTP_TTL_SECONDS * 1000
    const delivery = await sendOtpEmail({ env, email: normalizedEmail, otp })
    if (!delivery.ok) {
      await env.HKS_KV.delete(cooldownKey)
      console.error('OTP email delivery failed:', delivery.provider || 'unconfigured')
      return json(request, 502, { error: 'Failed to send email. Please try again.' })
    }

    await env.HKS_KV.put(`otp:${normalizedEmail}`, JSON.stringify({ otp, expires, attempts: 0 }), {
      expirationTtl: OTP_TTL_SECONDS + 60,
    })
    return json(request, 200, { ok: true, message: 'Check your inbox for a 6-digit code.' })
  } catch (error) {
    console.error('OTP request failed:', error instanceof Error ? error.message : 'unknown error')
    return json(request, 500, { error: 'Internal server error.' })
  }
}

export async function onRequestOptions({ request }) {
  return handleOptions(request)
}
