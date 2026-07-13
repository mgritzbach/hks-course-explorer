import { corsHeaders } from '../_shared/cors.js'

// Keep unknown and retired API routes out of the SPA fallback. This includes
// the removed visitor OTP/login and protected-KV catalogue endpoints.
export function onRequest({ request }) {
  return new Response(JSON.stringify({ error: 'Not found' }), {
    status: 404,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...corsHeaders(request),
    },
  })
}
