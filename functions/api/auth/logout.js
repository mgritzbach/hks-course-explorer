// POST /api/auth/logout
// Clears the auth cookie

import { corsHeaders, handleOptions } from '../../_shared/cors.js'

export async function onRequestPost({ request }) {
  return new Response(
    JSON.stringify({ ok: true }),
    {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Set-Cookie': 'hks_auth=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0; Secure',
        ...corsHeaders(request),
      },
    },
  )
}

export async function onRequestOptions({ request }) {
  return handleOptions(request)
}
