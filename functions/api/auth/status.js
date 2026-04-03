// GET /api/auth/status
// Returns { authenticated: true, email } if JWT cookie is valid, else { authenticated: false }

import { verifyJWT } from '../../_shared/jwt.js'
import { corsHeaders, handleOptions } from '../../_shared/cors.js'

function parseCookie(header, name) {
  if (!header) return null
  const match = header.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`))
  return match ? match[1] : null
}

export async function onRequestGet({ request, env }) {
  try {
    const token = parseCookie(request.headers.get('Cookie'), 'hks_auth')
    if (!token) {
      return new Response(
        JSON.stringify({ authenticated: false }),
        { status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders(request) } },
      )
    }

    const payload = await verifyJWT(token, env.JWT_SECRET)
    if (!payload) {
      return new Response(
        JSON.stringify({ authenticated: false }),
        { status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders(request) } },
      )
    }

    return new Response(
      JSON.stringify({ authenticated: true, email: payload.email }),
      { status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders(request) } },
    )
  } catch (err) {
    console.error('status.js error:', err)
    return new Response(
      JSON.stringify({ authenticated: false }),
      { status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders(request) } },
    )
  }
}

export async function onRequestOptions({ request }) {
  return handleOptions(request)
}
