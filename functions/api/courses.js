// GET /api/courses
// Returns courses.json from KV — only if JWT cookie is valid

import { verifyJWT } from '../_shared/jwt.js'
import { corsHeaders, handleOptions } from '../_shared/cors.js'

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
        JSON.stringify({ error: 'Authentication required.' }),
        { status: 401, headers: { 'Content-Type': 'application/json', ...corsHeaders(request) } },
      )
    }

    const payload = await verifyJWT(token, env.JWT_SECRET)
    if (!payload) {
      return new Response(
        JSON.stringify({ error: 'Session expired. Please log in again.' }),
        { status: 401, headers: { 'Content-Type': 'application/json', ...corsHeaders(request) } },
      )
    }

    // Fetch course data from KV
    const coursesJson = await env.HKS_KV.get('courses_data', { type: 'text' })
    if (!coursesJson) {
      return new Response(
        JSON.stringify({ error: 'Course data not found. Please contact the administrator.' }),
        { status: 404, headers: { 'Content-Type': 'application/json', ...corsHeaders(request) } },
      )
    }

    return new Response(coursesJson, {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'private, max-age=300', // 5 min client-side cache
        ...corsHeaders(request),
      },
    })
  } catch (err) {
    console.error('courses.js error:', err)
    return new Response(
      JSON.stringify({ error: 'Internal server error.' }),
      { status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders(request) } },
    )
  }
}

export async function onRequestOptions({ request }) {
  return handleOptions(request)
}
