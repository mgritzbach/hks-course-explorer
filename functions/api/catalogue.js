// GET /api/catalogue?term=2026%20Fall&school=HKS&q=API-101&limit=50
//
// The versioned catalogue stays private in Supabase. This Pages Function is
// the only planned public read boundary and is intentionally disabled until a
// parity run has accepted a promoted snapshot. It must never fall back to the
// legacy browser-table reads or the live Harvard search API.

import { corsHeaders, handleOptions } from '../_shared/cors.js'

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 100
const PUBLIC_COLUMNS = [
  'offering_id',
  'course_code',
  'course_code_base',
  'term',
  'school',
  'title',
  'instructors',
  'current_offering',
  'canonical_course_code',
  'current_instructor_keys',
  'match_status',
  'match_method',
  'historical_course_codes',
  'evaluation_summary',
  'course_history_summary',
  'review_candidates',
  'source_snapshot_at',
  'promoted_at',
  'alias_registry_version',
].join(',')

function jsonResponse(body, status, request) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      ...corsHeaders(request),
    },
  })
}

function configured(env) {
  return (
    env?.CATALOGUE_API_ENABLED === 'true' &&
    /^https:\/\/[^/]+\.supabase\.co\/?$/i.test(env?.SUPABASE_URL || '') &&
    typeof env?.SUPABASE_SERVICE_ROLE_KEY === 'string' &&
    env.SUPABASE_SERVICE_ROLE_KEY.length > 0
  )
}

function validSearch(value) {
  return /^[A-Za-z0-9 '\-]{2,80}$/.test(value)
}

function validTerm(value) {
  return /^\d{4} (Spring|Summer|Fall|January)$/.test(value)
}

function validSchool(value) {
  return /^[A-Z0-9-]{1,16}$/.test(value)
}

export function buildCatalogueRequestUrl(requestUrl) {
  const request = new URL(requestUrl)
  const query = new URLSearchParams({
    select: PUBLIC_COLUMNS,
    order: 'term.desc,offering_id.asc',
  })
  const term = request.searchParams.get('term')?.trim() || ''
  const school = request.searchParams.get('school')?.trim().toUpperCase() || ''
  const search = request.searchParams.get('q')?.trim() || ''
  const suppliedLimit = Number(request.searchParams.get('limit') || DEFAULT_LIMIT)

  if (term && !validTerm(term)) return { error: 'term must use the format YYYY Semester.' }
  if (school && !validSchool(school)) return { error: 'school is invalid.' }
  if (search && !validSearch(search)) return { error: 'q contains unsupported characters.' }
  if (!Number.isInteger(suppliedLimit) || suppliedLimit < 1 || suppliedLimit > MAX_LIMIT) {
    return { error: `limit must be an integer from 1 to ${MAX_LIMIT}.` }
  }

  if (term) query.set('term', `eq.${term}`)
  if (school) query.set('school', `eq.${school}`)
  if (search) {
    const escaped = search.replace(/'/g, "''")
    query.set('or', `(course_code.ilike.*${escaped}*,title.ilike.*${escaped}*)`)
  }
  query.set('limit', String(suppliedLimit))

  return { query }
}

export async function handleGet({ request, env }, fetchImpl = fetch) {
  // Disabled by default. A missing promoted snapshot is an operator condition,
  // not an empty course catalogue and must not look successful to clients.
  if (env?.CATALOGUE_API_ENABLED !== 'true') {
    return jsonResponse(
      { error: 'The unified catalogue is not enabled.', code: 'CATALOGUE_NOT_READY' },
      503,
      request,
    )
  }
  if (!configured(env)) {
    return jsonResponse(
      { error: 'The unified catalogue is not configured.', code: 'CATALOGUE_NOT_CONFIGURED' },
      503,
      request,
    )
  }

  const built = buildCatalogueRequestUrl(request.url)
  if (built.error)
    return jsonResponse({ error: built.error, code: 'INVALID_CATALOGUE_QUERY' }, 400, request)

  const endpoint = `${env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/catalogue_current_v1?${built.query}`
  try {
    const response = await fetchImpl(endpoint, {
      method: 'GET',
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        Accept: 'application/json',
      },
    })
    if (!response.ok) {
      console.error('Unified catalogue read failed', { status: response.status })
      return jsonResponse(
        {
          error: 'The unified catalogue is temporarily unavailable.',
          code: 'CATALOGUE_UNAVAILABLE',
        },
        502,
        request,
      )
    }
    const rows = await response.json()
    if (!Array.isArray(rows)) {
      console.error('Unified catalogue returned a malformed payload')
      return jsonResponse(
        {
          error: 'The unified catalogue returned an invalid response.',
          code: 'CATALOGUE_INVALID_RESPONSE',
        },
        502,
        request,
      )
    }
    return jsonResponse({ rows, count: rows.length }, 200, request)
  } catch (error) {
    console.error('Unified catalogue read failed', { error: String(error) })
    return jsonResponse(
      { error: 'The unified catalogue is temporarily unavailable.', code: 'CATALOGUE_UNAVAILABLE' },
      502,
      request,
    )
  }
}

export async function onRequestGet(context) {
  return handleGet(context)
}

export async function onRequestOptions({ request }) {
  return handleOptions(request)
}

export const __test__ = { buildCatalogueRequestUrl, handleGet }
