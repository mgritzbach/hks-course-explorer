// POST /api/auth/request
// Body: { email: "user@harvard.edu" }
// Validates domain, generates 6-digit OTP, stores in KV, sends via Brevo

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

// Personal whitelist — add any non-Harvard addresses here
const WHITELIST = ['mic.gritzbach@gmail.com']

function isAllowed(email) {
  if (!email || !email.includes('@')) return false
  email = email.toLowerCase().trim()
  if (WHITELIST.includes(email)) return true
  const domain = email.split('@')[1]
  // Allow exact match OR any subdomain of harvard.edu
  if (ALLOWED_DOMAINS.includes(domain)) return true
  if (domain.endsWith('.harvard.edu')) return true
  return false
}

function generateOTP() {
  const arr = new Uint32Array(1)
  crypto.getRandomValues(arr)
  return String(arr[0] % 1000000).padStart(6, '0')
}

export async function onRequestPost({ request, env }) {
  if (request.method === 'OPTIONS') return handleOptions(request)

  try {
    const { email } = await request.json()

    if (!isAllowed(email)) {
      return new Response(
        JSON.stringify({ error: 'Only Harvard email addresses (or whitelisted emails) are allowed.' }),
        { status: 403, headers: { 'Content-Type': 'application/json', ...corsHeaders(request) } },
      )
    }

    const otp = generateOTP()
    const expires = Date.now() + 10 * 60 * 1000 // 10 minutes

    // Store OTP in KV with 11-minute TTL (slightly longer than expires check)
    await env.HKS_KV.put(
      `otp:${email.toLowerCase().trim()}`,
      JSON.stringify({ otp, expires }),
      { expirationTtl: 660 },
    )

    // Send email via Brevo (no domain verification required — just a verified sender address)
    const brevoRes = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': env.BREVO_API_KEY,
      },
      body: JSON.stringify({
        sender: { name: 'HKS Course Explorer', email: 'mgritzbach@hks.harvard.edu' },
        to: [{ email }],
        subject: 'Your HKS Course Explorer login code',
        htmlContent: `
          <div style="font-family: Georgia, serif; max-width: 480px; margin: 0 auto; padding: 32px; background: #0d0d14; color: #e8e0d8; border-radius: 12px;">
            <p style="color: #a51c30; font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase; margin: 0 0 8px;">Harvard Kennedy School</p>
            <h1 style="font-size: 22px; font-weight: 600; margin: 0 0 20px; color: #fff;">Course Explorer</h1>
            <p style="color: #b8a898; margin: 0 0 24px; line-height: 1.6;">Your one-time login code is:</p>
            <div style="background: #1a1a2e; border: 1px solid rgba(165,28,48,0.3); border-radius: 10px; padding: 20px; text-align: center; margin-bottom: 24px;">
              <span style="font-size: 40px; font-weight: 700; letter-spacing: 0.18em; color: #d4a86a; font-family: monospace;">${otp}</span>
            </div>
            <p style="color: #7a6a5a; font-size: 12px; line-height: 1.6;">This code expires in 10 minutes. If you didn't request this, you can safely ignore it.</p>
            <hr style="border: none; border-top: 1px solid rgba(255,255,255,0.08); margin: 24px 0;">
            <p style="color: #4a3a2a; font-size: 11px;">HKS Course Explorer — Built independently for Harvard Kennedy School students.</p>
          </div>
        `,
      }),
    })

    if (!brevoRes.ok) {
      const errBody = await brevoRes.text()
      console.error('Brevo error:', errBody)
      return new Response(
        JSON.stringify({ error: 'Failed to send email. Please try again.' }),
        { status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders(request) } },
      )
    }

    return new Response(
      JSON.stringify({ ok: true, message: 'Check your inbox for a 6-digit code.' }),
      { status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders(request) } },
    )
  } catch (err) {
    console.error('request.js error:', err)
    return new Response(
      JSON.stringify({ error: 'Internal server error.' }),
      { status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders(request) } },
    )
  }
}

export async function onRequestOptions({ request }) {
  return handleOptions(request)
}
