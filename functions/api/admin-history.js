// GET /api/admin-history
// Reads a bounded, display-only projection of existing upload history through
// a server-side service-role call. It intentionally does not create or alter
// schema; the platform team must verify the documented `uploads` contract.

import { handleOptions } from '../_shared/cors.js'
import {
  fetchSupabase,
  jsonResponse,
  serviceRoleConfig,
  UPLOAD_HISTORY_COLUMNS,
} from '../_shared/adminData.js'
import { requireAdminSession } from '../_shared/adminSession.js'

function sanitizeHistory(rows) {
  if (!Array.isArray(rows)) return null
  return rows.slice(0, 10).map((row) => ({
    id: typeof row?.id === 'string' || typeof row?.id === 'number' ? row.id : null,
    type: typeof row?.upload_type === 'string' ? row.upload_type : null,
    filename: typeof row?.filename === 'string' ? row.filename : null,
    row_count: Number.isFinite(row?.row_count) ? row.row_count : null,
    status: typeof row?.status === 'string' ? row.status : null,
    created_at: typeof row?.uploaded_at === 'string' ? row.uploaded_at : null,
  }))
}

async function handleGet({ request, env }, fetchImpl = fetch) {
  if (!(await requireAdminSession(request, env))) {
    return jsonResponse(request, 401, { ok: false, error: 'Admin session is invalid or expired.' })
  }
  const config = serviceRoleConfig(env)
  if (!config)
    return jsonResponse(request, 503, { ok: false, error: 'Admin data service is not configured.' })

  try {
    const path = `uploads?select=${encodeURIComponent(UPLOAD_HISTORY_COLUMNS)}&order=uploaded_at.desc&limit=10`
    const upstream = await fetchSupabase(config.url, config.key, path, { method: 'GET' }, fetchImpl)
    if (!upstream.ok) {
      console.error('admin history Supabase request failed', { status: upstream.status })
      return jsonResponse(request, 502, {
        ok: false,
        error: 'Admin data service rejected the history request.',
      })
    }
    const rows = sanitizeHistory(await upstream.json())
    if (!rows)
      return jsonResponse(request, 502, {
        ok: false,
        error: 'Admin data service returned an invalid history response.',
      })
    return jsonResponse(request, 200, { ok: true, uploads: rows })
  } catch (error) {
    console.error('admin history Supabase request failed', { name: error?.name })
    return jsonResponse(request, 502, { ok: false, error: 'Admin data service is unavailable.' })
  }
}

export async function onRequestGet(context) {
  return handleGet(context)
}

export const __test__ = { handleGet, sanitizeHistory }

export async function onRequestOptions({ request }) {
  return handleOptions(request)
}
