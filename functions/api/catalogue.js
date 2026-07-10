// GET /api/catalogue?school=HKS&term=2026%20Fall&q=policy
//
// The UI does not call this endpoint until the staged unified catalogue has
// passed parity checks. It exposes only the single promoted snapshot and uses
// the server-only Supabase service-role key, never the browser anon key.

import { corsHeaders, handleOptions } from '../_shared/cors.js'

const MAX_ITEMS = 2000
const MAX_QUERY_LENGTH = 100

function response(request, status, body, cacheControl = 'no-store') {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': cacheControl,
      ...corsHeaders(request),
    },
  })
}

function readFilter(value, maxLength = MAX_QUERY_LENGTH) {
  if (typeof value !== 'string') return ''
  return value.trim().slice(0, maxLength)
}

function matches(row, { school, term, query }) {
  if (school && row.school !== school) return false
  if (term && row.term !== term) return false
  if (!query) return true

  const haystack = [
    row.course_code,
    row.course_code_base,
    row.title,
    ...(Array.isArray(row.instructors) ? row.instructors : []),
  ]
    .filter((value) => typeof value === 'string')
    .join(' ')
    .toLocaleLowerCase()
  return haystack.includes(query.toLocaleLowerCase())
}

export async function onRequestGet({ request, env, fetch: fetchImpl = fetch }) {
  const url = new URL(request.url)
  const filters = {
    school: readFilter(url.searchParams.get('school'), 24).toUpperCase(),
    term: readFilter(url.searchParams.get('term'), 64),
    query: readFilter(url.searchParams.get('q')),
  }
  const baseUrl = typeof env?.SUPABASE_URL === 'string' ? env.SUPABASE_URL.replace(/\/+$/, '') : ''
  const key =
    typeof env?.SUPABASE_SERVICE_ROLE_KEY === 'string' ? env.SUPABASE_SERVICE_ROLE_KEY : ''

  if (!baseUrl || !key) {
    return response(request, 503, { ok: false, error: 'Catalogue is not configured.' })
  }

  let upstream
  try {
    upstream = await fetchImpl(
      `${baseUrl}/rest/v1/catalogue_current_v1?select=*&limit=${MAX_ITEMS}`,
      {
        headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: 'application/json' },
      },
    )
  } catch {
    return response(request, 502, { ok: false, error: 'Catalogue is temporarily unavailable.' })
  }

  if (!upstream.ok) {
    return response(request, 502, { ok: false, error: 'Catalogue is temporarily unavailable.' })
  }

  let rows
  try {
    rows = await upstream.json()
  } catch {
    return response(request, 502, { ok: false, error: 'Catalogue returned an invalid response.' })
  }
  if (!Array.isArray(rows)) {
    return response(request, 502, { ok: false, error: 'Catalogue returned an invalid response.' })
  }

  const items = rows.filter((row) => row && typeof row === 'object' && matches(row, filters))
  return response(
    request,
    200,
    {
      ok: true,
      items,
      sourceSnapshotAt: items[0]?.source_snapshot_at || null,
      promotedAt: items[0]?.promoted_at || null,
    },
    'public, max-age=60, s-maxage=300',
  )
}

export async function onRequestOptions({ request }) {
  return handleOptions(request)
}
