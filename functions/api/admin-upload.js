// POST /api/admin-upload
// Receives only a validated, allow-listed admin import and performs the
// privileged REST insert with server-only Supabase credentials.

import { handleOptions } from '../_shared/cors.js'
import {
  fetchSupabase,
  jsonResponse,
  readBoundedJson,
  serviceRoleConfig,
  validateUploadPayload,
} from '../_shared/adminData.js'
import { requireAdminSession } from '../_shared/adminSession.js'

async function handlePost({ request, env }, fetchImpl = fetch) {
  if (!(await requireAdminSession(request, env))) {
    return jsonResponse(request, 401, { ok: false, error: 'Admin session is invalid or expired.' })
  }

  const config = serviceRoleConfig(env)
  if (!config) {
    return jsonResponse(request, 503, { ok: false, error: 'Admin data service is not configured.' })
  }

  const parsed = await readBoundedJson(request)
  if (!parsed.ok) return jsonResponse(request, parsed.status, { ok: false, error: parsed.error })
  const validated = validateUploadPayload(parsed.value)
  if (!validated.ok)
    return jsonResponse(request, validated.status, { ok: false, error: validated.error })

  try {
    const upstream = await fetchSupabase(
      config.url,
      config.key,
      'rpc/admin_import',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Prefer: 'return=minimal',
        },
        body: JSON.stringify({
          p_type: validated.target.table,
          p_filename: validated.filename,
          p_rows: validated.rows,
        }),
      },
      fetchImpl,
    )
    if (!upstream.ok) {
      console.error('admin upload Supabase request failed', {
        status: upstream.status,
        target: validated.target.table,
      })
      return jsonResponse(request, 502, {
        ok: false,
        error: 'Admin data service rejected the upload.',
      })
    }
  } catch (error) {
    console.error('admin upload Supabase request failed', { name: error?.name })
    return jsonResponse(request, 502, { ok: false, error: 'Admin data service is unavailable.' })
  }

  return jsonResponse(request, 200, { ok: true, uploaded: validated.rows.length })
}

export async function onRequestPost(context) {
  return handlePost(context)
}

export const __test__ = { handlePost }

export async function onRequestOptions({ request }) {
  return handleOptions(request)
}
