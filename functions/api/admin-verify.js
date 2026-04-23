// POST /api/admin-verify
// Body: { "password": "..." }
// Returns: { "ok": true, "token": "<ts>.<hmac>" } on success
// Env var required: ADMIN_PASSWORD (set in Cloudflare Pages dashboard)

import { corsHeaders, handleOptions } from '../_shared/cors.js'

async function hmacSign(secret, data) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data))
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('')
}

export async function onRequestPost({ request, env }) {
  let body
  try {
    body = await request.json()
  } catch {
    return new Response(JSON.stringify({ ok: false, error: 'Invalid JSON' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', ...corsHeaders(request) },
    })
  }

  const { password } = body ?? {}
  const adminPassword = env?.ADMIN_PASSWORD

  if (!adminPassword) {
    // Env var not set — fail closed
    return new Response(JSON.stringify({ ok: false, error: 'Admin not configured' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json', ...corsHeaders(request) },
    })
  }

  if (!password || password !== adminPassword) {
    return new Response(JSON.stringify({ ok: false }), {
      status: 401,
      headers: { 'Content-Type': 'application/json', ...corsHeaders(request) },
    })
  }

  // Issue a short-lived HMAC token: "<timestamp>.<signature>"
  // Client stores in sessionStorage — cleared on tab close
  const ts = String(Date.now())
  const sig = await hmacSign(adminPassword, ts)
  const token = `${ts}.${sig}`

  return new Response(JSON.stringify({ ok: true, token }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(request) },
  })
}

export async function onRequestOptions({ request }) {
  return handleOptions(request)
}
