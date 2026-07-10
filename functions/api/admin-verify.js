// POST /api/admin-verify
// Body: { "password": "..." }
// Returns: { "ok": true, "session": "..." } on success
// Env vars required: ADMIN_PASSWORD and ADMIN_SESSION_SECRET (set in
// Cloudflare Pages dashboard). The session is short-lived and only grants the
// admin data scope; the browser holds it in memory, never storage/cookies.

import { corsHeaders, handleOptions } from '../_shared/cors.js'
import { issueAdminSession, passwordMatches } from '../_shared/adminSession.js'
import { readBoundedJson } from '../_shared/adminData.js'

const MAX_PASSWORD_LENGTH = 256

function response(request, status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...corsHeaders(request),
    },
  })
}

export async function onRequestPost({ request, env }) {
  const parsed = await readBoundedJson(request, 4 * 1024)
  if (!parsed.ok) return response(request, parsed.status, { ok: false, error: parsed.error })

  const { password } = parsed.value ?? {}
  const adminPassword = env?.ADMIN_PASSWORD

  if (!adminPassword || !env?.ADMIN_SESSION_SECRET) {
    return response(request, 503, { ok: false, error: 'Admin not configured' })
  }

  if (
    typeof password !== 'string' ||
    password.length < 1 ||
    password.length > MAX_PASSWORD_LENGTH ||
    !(await passwordMatches(password, adminPassword))
  ) {
    return response(request, 401, { ok: false })
  }

  const session = await issueAdminSession(env)
  if (!session) return response(request, 503, { ok: false, error: 'Admin not configured' })
  return response(request, 200, { ok: true, session })
}

export async function onRequestOptions({ request }) {
  return handleOptions(request)
}
