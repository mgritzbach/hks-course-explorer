// POST /api/auth/request
// Body: { email: "user@harvard.edu" }
// Validates domain, generates a six-digit OTP, stores it in KV, and sends it
// through the configured transactional email provider.

import { corsHeaders, handleOptions } from '../../_shared/cors.js'
import { hashedLimiterKey, limiterStub } from '../../_shared/rateLimit.js'
import { readBoundedJson } from '../../_shared/adminData.js'

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
const MAX_OTP_REQUEST_BYTES = 4 * 1024

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
    const parsed = await readBoundedJson(request, MAX_OTP_REQUEST_BYTES)
    if (!parsed.ok) return json(request, parsed.status, { error: parsed.error })

    const { email } = parsed.value ?? {}
    if (!isAllowed(email)) {
      return json(request, 403, {
        error: 'Only Harvard email addresses (or whitelisted emails) are allowed.',
      })
    }
    if (!emailProvider(env))
      return json(request, 503, { error: 'Email delivery is not configured.' })
    const normalizedEmail = email.toLowerCase().trim()
    const otpState = await limiterStub(env, 'otp', normalizedEmail)
    if (!otpState) return json(request, 503, { error: 'Login storage is not configured.' })

    const now = Date.now()
    const requestId = crypto.randomUUID()
    const admission = await otpState.startOtpRequest(
      now,
      requestId,
      OTP_REQUEST_COOLDOWN_SECONDS * 1000,
    )
    if (!admission || typeof admission.allowed !== 'boolean') {
      return json(request, 503, { error: 'Login storage is not configured.' })
    }
    if (!admission.allowed) {
      return json(request, 429, {
        error: 'Please wait one minute before requesting another code.',
      })
    }

    const otp = generateOTP()
    const delivery = await sendOtpEmail({ env, email: normalizedEmail, otp })
    if (!delivery.ok) {
      await otpState.cancelOtpRequest(requestId)
      console.error('OTP email delivery failed:', delivery.provider || 'unconfigured')
      return json(request, 502, { error: 'Failed to send email. Please try again.' })
    }

    const confirmed = await otpState.confirmOtpRequest(
      Date.now(),
      requestId,
      await hashedLimiterKey(otp),
      OTP_TTL_SECONDS * 1000,
    )
    if (!confirmed?.confirmed) {
      return json(request, 503, { error: 'Failed to store login code. Please try again.' })
    }
    return json(request, 200, { ok: true, message: 'Check your inbox for a 6-digit code.' })
  } catch (error) {
    console.error('OTP request failed:', error instanceof Error ? error.message : 'unknown error')
    return json(request, 500, { error: 'Internal server error.' })
  }
}

export async function onRequestOptions({ request }) {
  return handleOptions(request)
}
