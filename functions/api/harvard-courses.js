// GET /api/harvard-courses?q=API-101&term=2026Spring&school=HKS|Non-HKS|All|<code>
// Proxies Harvard ATS Course v2 API; hides API key; normalises & caches 5 min.
// Env var required: HARVARD_API_KEY (set in Cloudflare Pages dashboard)
//
// school=Non-HKS  → fan-out to all non-HKS schools in parallel using the correct
//                   API catalogSchool codes, merge & deduplicate by harvardId.
// Valid catalogSchool values per API docs:
//   FAS, GSAS, GSD, HBSD, HBSM, HDS, HGSE, HKS, HLS, HMS, HSDM, HSPH, NONH

import { corsHeaders, handleOptions } from '../_shared/cors.js'

const UPSTREAM_BASE = 'https://go.apis.huit.harvard.edu/ats/course/v2/search'
const MAX_LIMIT = 50
const MAX_QUERY_CHARS = 120
const MAX_FILTER_VALUE_CHARS = 40
const UPSTREAM_TIMEOUT_MS = 8_000
const UPSTREAM_MAX_ATTEMPTS = 3
const FRESH_CACHE_MAX_AGE_SECONDS = 300
// The last-known-good copy is intentionally short lived. It is only read after
// a fresh Harvard request fails and is explicitly labelled as stale to callers.
const STALE_CACHE_MAX_AGE_SECONDS = 60 * 60
const NON_HKS_CONCURRENCY = 4
// A single cross-registration query must remain interactive even when several
// upstream catalogues are degraded. This applies to the whole fan-out, not
// each school independently.
const NON_HKS_REQUEST_BUDGET_MS = 15_000
const RETRYABLE_STATUS_CODES = new Set([408, 425, 429, 500, 502, 503, 504])

// Correct catalogSchool codes from the Harvard ATS API docs.
// Previous codes (HBS, LAW, GSE, SEAS) were invalid → always returned empty.
// NONH = Non-Harvard (includes MIT cross-registration)
const NON_HKS_SCHOOLS = [
  'FAS',
  'GSAS',
  'GSD',
  'HBSD',
  'HBSM',
  'HDS',
  'HGSE',
  'HLS',
  'HMS',
  'HSDM',
  'HSPH',
  'NONH',
]

function jsonResp(obj, status = 200, req = null) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...(req ? corsHeaders(req) : {}),
    },
  })
}

export function normalise(raw) {
  // Harvard ATS API returns either { results: [] } or { courses: [] }
  const items = Array.isArray(raw?.results)
    ? raw.results
    : Array.isArray(raw?.courses)
      ? raw.courses
      : Array.isArray(raw)
        ? raw
        : []

  return {
    results: items.map((item) => {
      // Harvard's upstream schema is not stable. Treat malformed optional
      // fields as absent instead of allowing one course to fail the request.
      const c = item && typeof item === 'object' ? item : {}
      // Parse meeting times — new format has meetings as object/array on top-level course
      const meetings = parseMeetings(c.meetings ?? c.sections ?? c.classes)
      const courseNum = String(c.courseNumber ?? c.catalog ?? '').trim()
      const subject = String(c.catalogSubject ?? c.subject ?? courseNum.split(' ')[0] ?? '').trim()
      const catalog = String(
        c.classCatalogNumber ?? c.catalogNumber ?? courseNum.split(' ')[1] ?? '',
      ).trim()
      const code = subject && catalog ? `${subject}-${catalog}` : courseNum.replace(/\s+/g, '-')
      return {
        harvardId: String(c.courseID ?? c.id ?? c.classNumber ?? ''),
        courseCode: code,
        title: String(c.courseTitle ?? c.title ?? ''),
        term: String(c.termDescription ?? c.term ?? ''),
        credits: c.classMinUnits ?? c.units ?? null,
        instructors: (Array.isArray(c.publishedInstructors)
          ? c.publishedInstructors
          : Array.isArray(c.instructors)
            ? c.instructors
            : []
        )
          .map((i) => {
            if (typeof i === 'string') return i.trim()
            if (!i || typeof i !== 'object') return ''
            return String(
              i.instructorName ??
                i.displayName ??
                i.name ??
                `${i.firstName ?? ''} ${i.lastName ?? ''}`.trim(),
            )
          })
          .filter(Boolean),
        description: String(c.courseDescription ?? c.description ?? ''),
        location: meetings[0]?.location ?? '',
        sessionCode: String(c.sessionCode ?? ''),
        sessionDescription: String(c.sessionDescription ?? ''),
        crossRegEligible: String(c.crossRegistrationEligibleAttribute ?? ''),
        sections: meetings.length
          ? [
              {
                sectionId: 'main',
                type: 'LEC',
                meetings,
                meeting_days: meetings.map((m) => m.day).join('/'),
                time_start: meetings[0]?.start ?? '',
                time_end: meetings[0]?.end ?? '',
                location: meetings[0]?.location ?? '',
              },
            ]
          : [],
      }
    }),
    total: raw?.total ?? raw?.count ?? items.length,
  }
}

const DAY_MAP = {
  M: 'MON',
  MON: 'MON',
  MONDAY: 'MON',
  T: 'TUE',
  TUE: 'TUE',
  TUESDAY: 'TUE',
  W: 'WED',
  WED: 'WED',
  WEDNESDAY: 'WED',
  R: 'THU',
  TH: 'THU',
  THU: 'THU',
  THURSDAY: 'THU',
  F: 'FRI',
  FRI: 'FRI',
  FRIDAY: 'FRI',
  S: 'SAT',
  SA: 'SAT',
  SAT: 'SAT',
  SATURDAY: 'SAT',
  SU: 'SUN',
  SUN: 'SUN',
  SUNDAY: 'SUN',
}
function normDay(d) {
  return DAY_MAP[String(d).toUpperCase().trim()] ?? String(d).toUpperCase().trim()
}

/** Parse the Harvard API meetings field (string | object | array) into [{day,start,end,location}] */
function parseMeetings(raw) {
  if (!raw || raw === 'TBA') return []
  const items = Array.isArray(raw) ? raw : [raw]
  const result = []
  for (const m of items) {
    if (!m || typeof m !== 'object') continue
    const days = Array.isArray(m.daysOfWeek) ? m.daysOfWeek : []
    const start = normTime(m.startTime ?? m.start ?? '')
    const end = normTime(m.endTime ?? m.end ?? '')
    const loc = String(m.location ?? '').trim()
    for (const day of days) {
      const d = normDay(day)
      if (d && start) result.push({ day: d, start, end, location: loc })
    }
    // Also handle old flat format: { day, startTime, endTime }
    if (!days.length && (m.day || m.meetingDay)) {
      const d = normDay(m.day ?? m.meetingDay ?? '')
      const s = normTime(m.startTime ?? m.start ?? '')
      if (d && s)
        result.push({
          day: d,
          start: s,
          end: normTime(m.endTime ?? m.end ?? ''),
          location: String(m.location ?? '').trim(),
        })
    }
  }
  return result
}

function normTime(t) {
  if (!t) return ''
  const s = String(t).trim().toLowerCase()
  const m = s.match(/^(\d{1,2}):(\d{2})\s*(am|pm)?$/)
  if (!m) return s
  let h = parseInt(m[1]),
    mn = parseInt(m[2])
  if (m[3] === 'am' && h === 12) h = 0
  if (m[3] === 'pm' && h !== 12) h += 12
  return `${String(h).padStart(2, '0')}:${String(mn).padStart(2, '0')}`
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function retryDelayMs(attempt) {
  // A short bounded backoff absorbs transient Harvard/edge failures without
  // making an interactive catalogue search feel stalled.
  return 150 * 2 ** attempt
}

/**
 * Fetch Harvard with a timeout and bounded retries for transient failures.
 * The structured result lets the caller distinguish an empty catalogue result
 * from an unavailable upstream service.
 */
export async function fetchFromHarvard(
  url,
  apiKey,
  { fetchImpl = fetch, sleepImpl = sleep, deadlineAt = null, now = Date.now } = {},
) {
  let lastStatus = 0
  let lastError = null
  let attempts = 0

  for (let attempt = 0; attempt < UPSTREAM_MAX_ATTEMPTS; attempt += 1) {
    const remainingMs = deadlineAt == null ? UPSTREAM_TIMEOUT_MS : deadlineAt - now()
    if (remainingMs <= 0) break
    attempts += 1
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), Math.min(UPSTREAM_TIMEOUT_MS, remainingMs))
    try {
      const response = await fetchImpl(url, {
        headers: {
          'x-api-key': apiKey,
          Accept: 'application/json',
          'User-Agent': 'HKS-Course-Explorer/2.0',
        },
        signal: controller.signal,
      })
      lastStatus = response.status
      if (
        response.ok ||
        !RETRYABLE_STATUS_CODES.has(response.status) ||
        attempt === UPSTREAM_MAX_ATTEMPTS - 1
      ) {
        return { ok: response.ok, response, status: response.status, attempts }
      }
    } catch (error) {
      lastError = error
      if (attempt === UPSTREAM_MAX_ATTEMPTS - 1) break
    } finally {
      clearTimeout(timeout)
    }

    const retryDelay = retryDelayMs(attempt)
    const remainingBeforeRetry = deadlineAt == null ? retryDelay : deadlineAt - now()
    if (remainingBeforeRetry <= 0) break
    await sleepImpl(Math.min(retryDelay, remainingBeforeRetry))
  }

  return { ok: false, status: lastStatus, error: lastError, attempts }
}

/**
 * Apply an async mapper with bounded parallelism while retaining input order.
 * A Non-HKS request fans out to 12 catalogues; capping this avoids turning one
 * browser search into an uncontrolled burst against Harvard's API.
 */
export async function mapWithConcurrency(
  items,
  concurrency,
  mapper,
  { deadlineAt = null, now = Date.now, deadlineResult = null } = {},
) {
  const results = new Array(items.length)
  let nextIndex = 0
  const workerCount = Math.min(Math.max(1, concurrency), items.length)

  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex
      nextIndex += 1
      if (deadlineAt != null && now() >= deadlineAt) {
        results[index] = deadlineResult ? deadlineResult(items[index], index) : undefined
        continue
      }
      results[index] = await mapper(items[index], index)
    }
  }

  await Promise.all(Array.from({ length: workerCount }, worker))
  return results
}

function staleCacheKey(cacheKey) {
  const url = new URL(cacheKey.url)
  url.searchParams.set('__hks_cache_variant', 'last-known-good')
  return new Request(url.toString(), { headers: { Accept: 'application/json' } })
}

async function readCachedJson(cache, cacheKey, label) {
  try {
    const cached = await cache.match(cacheKey)
    if (!cached) return null
    try {
      return await cached.json()
    } catch {
      // Cache corruption should never be mistaken for an empty course result.
      await cache.delete(cacheKey)
      console.warn('Deleted corrupt Harvard cache entry', { label })
      return null
    }
  } catch (error) {
    // A cache outage must not prevent an otherwise successful upstream search.
    console.warn('Harvard cache read failed', { label, error: String(error) })
    return null
  }
}

async function writeCachedJson(cache, cacheKey, raw, maxAge, label) {
  try {
    await cache.put(
      cacheKey,
      new Response(JSON.stringify(raw), {
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': `public, max-age=${maxAge}`,
        },
      }),
    )
  } catch (error) {
    // Caching is an optimisation, never a reason to fail an available search.
    console.warn('Harvard cache write failed', { label, error: String(error) })
  }
}

async function cacheLastKnownGood(cache, cacheKey, raw, label) {
  await Promise.all([
    writeCachedJson(cache, cacheKey, raw, FRESH_CACHE_MAX_AGE_SECONDS, label),
    writeCachedJson(
      cache,
      staleCacheKey(cacheKey),
      raw,
      STALE_CACHE_MAX_AGE_SECONDS,
      `${label}:stale`,
    ),
  ])
}

/** Fetch one upstream school, normalise, and preserve its failure state. */
async function fetchOneSchool(schoolCode, q, limit, passThrough, apiKey, cache, deadlineAt = null) {
  if (deadlineAt != null && Date.now() >= deadlineAt) {
    return { ok: false, results: [], status: 504, deadlineExceeded: true }
  }
  const upstream = new URL(UPSTREAM_BASE)
  upstream.searchParams.set('q', q)
  upstream.searchParams.set('catalogSchool', schoolCode)
  upstream.searchParams.set('limit', String(limit))
  for (const [key, val] of Object.entries(passThrough)) {
    if (val != null && val !== '') upstream.searchParams.set(key, val)
  }

  // Check edge cache per school+query combo
  const cacheKey = new Request(upstream.toString(), { headers: { Accept: 'application/json' } })
  const cached = await readCachedJson(cache, cacheKey, `school:${schoolCode}`)
  if (cached) return { ok: true, results: normalise(cached).results, source: 'cache' }

  const upstreamResult = await fetchFromHarvard(upstream.toString(), apiKey, { deadlineAt })
  if (!upstreamResult.ok) {
    console.warn('Harvard API school request failed', {
      schoolCode,
      status: upstreamResult.status,
      attempts: upstreamResult.attempts,
    })
    const stale = await readCachedJson(cache, staleCacheKey(cacheKey), `school:${schoolCode}:stale`)
    if (stale) return { ok: true, stale: true, results: normalise(stale).results, source: 'stale' }
    return { ok: false, results: [], status: upstreamResult.status }
  }

  try {
    const raw = await upstreamResult.response.json()
    const normalised = normalise(raw)
    await cacheLastKnownGood(cache, cacheKey, raw, `school:${schoolCode}`)
    return { ok: true, results: normalised.results, source: 'upstream' }
  } catch (error) {
    console.warn('Harvard API school response was not valid JSON', {
      schoolCode,
      error: String(error),
    })
    const stale = await readCachedJson(cache, staleCacheKey(cacheKey), `school:${schoolCode}:stale`)
    if (stale) return { ok: true, stale: true, results: normalise(stale).results, source: 'stale' }
    return { ok: false, results: [], status: 502 }
  }
}

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url)
  const q = url.searchParams.get('q')?.trim() ?? ''
  const requestedLimit = Number(url.searchParams.get('limit') ?? 25)
  const limit =
    Number.isInteger(requestedLimit) && requestedLimit > 0
      ? Math.min(requestedLimit, MAX_LIMIT)
      : 25

  // Allow single-char queries (needed for Non-HKS browse mode: q='a')
  if (!q || q.length < 1) {
    return jsonResp({ error: 'q must be at least 1 character', results: [] }, 400, request)
  }
  if (q.length > MAX_QUERY_CHARS) {
    return jsonResp(
      { error: `q must not exceed ${MAX_QUERY_CHARS} characters`, results: [] },
      400,
      request,
    )
  }

  // Check for API key
  const apiKey = env?.HARVARD_API_KEY
  if (!apiKey) {
    console.warn('HARVARD_API_KEY not configured')
    return jsonResp(
      {
        error: 'Live catalogue search is not configured',
        code: 'HARVARD_API_NOT_CONFIGURED',
        results: [],
      },
      503,
      request,
    )
  }

  const schoolParam = url.searchParams.get('school') ?? 'HKS'
  const allowedSchools = new Set(['HKS', 'Non-HKS', 'All', '', ...NON_HKS_SCHOOLS])
  if (!allowedSchools.has(schoolParam)) {
    return jsonResp({ error: 'Unsupported school filter', results: [] }, 400, request)
  }
  const PASS_THROUGH_KEYS = [
    'term',
    'session',
    'day',
    'crossreg',
    'instructionMode',
    'unitsMin',
    'unitsMax',
  ]
  const passThrough = {}
  for (const key of PASS_THROUGH_KEYS) {
    const val = url.searchParams.get(key)
    if (val != null && val !== '') {
      if (val.length > MAX_FILTER_VALUE_CHARS) {
        return jsonResp({ error: `${key} filter is too long`, results: [] }, 400, request)
      }
      passThrough[key] = val
    }
  }

  const cache = caches.default

  // ── Non-HKS: fan-out to multiple schools in parallel ──────────────────────
  if (schoolParam === 'Non-HKS') {
    // Per-school limit: fetch more per school so merged result has enough variety
    const perSchoolLimit = Math.min(Math.ceil(limit * 1.5), MAX_LIMIT)
    const deadlineAt = Date.now() + NON_HKS_REQUEST_BUDGET_MS
    const schoolResults = await mapWithConcurrency(
      NON_HKS_SCHOOLS,
      NON_HKS_CONCURRENCY,
      (sc) => fetchOneSchool(sc, q, perSchoolLimit, passThrough, apiKey, cache, deadlineAt),
      {
        deadlineAt,
        deadlineResult: () => ({ ok: false, results: [], status: 504, deadlineExceeded: true }),
      },
    )
    const failures = schoolResults.filter((result) => !result.ok)
    const staleResults = schoolResults.filter((result) => result.stale)
    if (failures.length === schoolResults.length) {
      console.error('All Harvard non-HKS school requests failed', {
        failedSchools: NON_HKS_SCHOOLS,
      })
      return jsonResp(
        {
          error: 'Harvard catalogue is temporarily unavailable',
          code: 'HARVARD_API_UNAVAILABLE',
          results: [],
        },
        502,
        request,
      )
    }
    // Merge + deduplicate by harvardId (fallback: courseCode)
    const seen = new Set()
    const merged = []
    for (const schoolResult of schoolResults) {
      for (const item of schoolResult.results) {
        const key = item.harvardId || item.courseCode
        if (key && seen.has(key)) continue
        if (key) seen.add(key)
        merged.push(item)
        if (merged.length >= limit) break
      }
      if (merged.length >= limit) break
    }
    // Partial results are still useful to a user, but must be visible to
    // monitoring and clients rather than silently looking complete.
    const body = JSON.stringify({
      results: merged,
      total: merged.length,
      partial: failures.length > 0,
      stale: staleResults.length > 0,
    })
    return new Response(body, {
      headers: {
        'Content-Type': 'application/json',
        'CF-Cache-Status': staleResults.length > 0 ? 'STALE' : 'MISS',
        ...(failures.length > 0 ? { 'X-Harvard-Partial-Result': 'true' } : {}),
        ...(staleResults.length > 0
          ? { 'X-Harvard-Stale-Result': 'true', 'Cache-Control': 'no-store' }
          : {}),
        ...(request ? corsHeaders(request) : {}),
      },
    })
  }

  // ── Single school (HKS default, or explicit code) ─────────────────────────
  const upstream = new URL(UPSTREAM_BASE)
  upstream.searchParams.set('q', q)
  if (schoolParam === 'HKS') {
    upstream.searchParams.set('catalogSchool', 'HKS')
  } else if (schoolParam !== 'All' && schoolParam !== '') {
    upstream.searchParams.set('catalogSchool', schoolParam)
  }
  upstream.searchParams.set('limit', String(limit))
  for (const [key, val] of Object.entries(passThrough)) {
    upstream.searchParams.set(key, val)
  }

  // Try edge cache first
  const cacheKey = new Request(upstream.toString(), { headers: { Accept: 'application/json' } })
  const cached = await readCachedJson(cache, cacheKey, 'single-school')
  if (cached && Array.isArray(cached.results)) {
    const body = JSON.stringify(cached)
    return new Response(body, {
      headers: {
        'Content-Type': 'application/json',
        'CF-Cache-Status': 'HIT',
        ...(request ? corsHeaders(request) : {}),
      },
    })
  }

  // Fetch from Harvard
  const upstreamResult = await fetchFromHarvard(upstream.toString(), apiKey)
  if (!upstreamResult.ok) {
    console.error('Harvard API request failed', {
      status: upstreamResult.status,
      attempts: upstreamResult.attempts,
      error: String(upstreamResult.error ?? ''),
    })
    const stale = await readCachedJson(cache, staleCacheKey(cacheKey), 'single-school:stale')
    if (stale && Array.isArray(stale.results)) {
      return new Response(JSON.stringify({ ...stale, stale: true }), {
        headers: {
          'Content-Type': 'application/json',
          'CF-Cache-Status': 'STALE',
          'X-Harvard-Stale-Result': 'true',
          'Cache-Control': 'no-store',
          ...(request ? corsHeaders(request) : {}),
        },
      })
    }
    return jsonResp(
      {
        error: 'Harvard catalogue is temporarily unavailable',
        code: 'HARVARD_API_UNAVAILABLE',
        results: [],
      },
      502,
      request,
    )
  }

  let raw
  try {
    raw = await upstreamResult.response.json()
  } catch (error) {
    console.error('Harvard API returned invalid JSON', { error: String(error) })
    const stale = await readCachedJson(cache, staleCacheKey(cacheKey), 'single-school:stale')
    if (stale && Array.isArray(stale.results)) {
      return new Response(JSON.stringify({ ...stale, stale: true }), {
        headers: {
          'Content-Type': 'application/json',
          'CF-Cache-Status': 'STALE',
          'X-Harvard-Stale-Result': 'true',
          'Cache-Control': 'no-store',
          ...(request ? corsHeaders(request) : {}),
        },
      })
    }
    return jsonResp(
      {
        error: 'Harvard catalogue returned an invalid response',
        code: 'HARVARD_API_INVALID_RESPONSE',
        results: [],
      },
      502,
      request,
    )
  }
  let normalised
  try {
    normalised = normalise(raw)
  } catch (error) {
    console.error('Harvard API response could not be normalised', { error: String(error) })
    return jsonResp(
      {
        error: 'Harvard catalogue returned an invalid response',
        code: 'HARVARD_API_INVALID_RESPONSE',
        results: [],
      },
      502,
      request,
    )
  }
  const body = JSON.stringify(normalised)

  // Cache a fresh and a separately-addressed last-known-good copy. The latter
  // is never returned on a normal cache hit, only after an upstream failure.
  await cacheLastKnownGood(cache, cacheKey, normalised, 'single-school')

  return new Response(body, {
    headers: {
      'Content-Type': 'application/json',
      'CF-Cache-Status': 'MISS',
      ...(request ? corsHeaders(request) : {}),
    },
  })
}

export async function onRequestOptions({ request }) {
  return handleOptions(request)
}
