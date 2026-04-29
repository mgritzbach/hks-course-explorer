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

// Correct catalogSchool codes from the Harvard ATS API docs.
// Previous codes (HBS, LAW, GSE, SEAS) were invalid → always returned empty.
// NONH = Non-Harvard (includes MIT cross-registration)
const NON_HKS_SCHOOLS = ['FAS', 'GSAS', 'GSD', 'HBSD', 'HBSM', 'HDS', 'HGSE', 'HLS', 'HMS', 'HSDM', 'HSPH', 'NONH']

function jsonResp(obj, status = 200, req = null) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...(req ? corsHeaders(req) : {}),
    },
  })
}

function normalise(raw) {
  // Harvard ATS API returns either { results: [] } or { courses: [] }
  const items = Array.isArray(raw?.results) ? raw.results
    : Array.isArray(raw?.courses) ? raw.courses
    : Array.isArray(raw) ? raw
    : []

  return {
    results: items.map(c => {
      // Parse meeting times — new format has meetings as object/array on top-level course
      const meetings = parseMeetings(c.meetings ?? c.sections ?? c.classes)
      const courseNum = String(c.courseNumber ?? c.catalog ?? '').trim()
      const subject   = String(c.catalogSubject ?? c.subject ?? courseNum.split(' ')[0] ?? '').trim()
      const catalog   = String(c.classCatalogNumber ?? c.catalogNumber ?? courseNum.split(' ')[1] ?? '').trim()
      const code = subject && catalog ? `${subject}-${catalog}` : courseNum.replace(/\s+/g, '-')
      return {
        harvardId:          String(c.courseID ?? c.id ?? c.classNumber ?? ''),
        courseCode:         code,
        title:              String(c.courseTitle ?? c.title ?? ''),
        term:               String(c.termDescription ?? c.term ?? ''),
        credits:            c.classMinUnits ?? c.units ?? null,
        instructors:        (c.publishedInstructors ?? c.instructors ?? []).map(i =>
          String(i.instructorName ?? i.displayName ?? i.name ?? `${i.firstName ?? ''} ${i.lastName ?? ''}`.trim())
        ).filter(Boolean),
        description:        String(c.courseDescription ?? c.description ?? ''),
        location:           meetings[0]?.location ?? '',
        sessionCode:        String(c.sessionCode ?? ''),
        sessionDescription: String(c.sessionDescription ?? ''),
        crossRegEligible:   String(c.crossRegistrationEligibleAttribute ?? ''),
        sections: meetings.length ? [{
          sectionId: 'main',
          type: 'LEC',
          meetings,
          meeting_days: meetings.map(m => m.day).join('/'),
          time_start:   meetings[0]?.start ?? '',
          time_end:     meetings[0]?.end ?? '',
          location:     meetings[0]?.location ?? '',
        }] : [],
      }
    }),
    total: raw?.total ?? raw?.count ?? items.length,
  }
}

const DAY_MAP = {
  M: 'MON', MON: 'MON', MONDAY: 'MON',
  T: 'TUE', TUE: 'TUE', TUESDAY: 'TUE',
  W: 'WED', WED: 'WED', WEDNESDAY: 'WED',
  R: 'THU', TH: 'THU', THU: 'THU', THURSDAY: 'THU',
  F: 'FRI', FRI: 'FRI', FRIDAY: 'FRI',
  S: 'SAT', SA: 'SAT', SAT: 'SAT', SATURDAY: 'SAT',
  SU: 'SUN', SUN: 'SUN', SUNDAY: 'SUN',
}
function normDay(d) { return DAY_MAP[String(d).toUpperCase().trim()] ?? String(d).toUpperCase().trim() }

/** Parse the Harvard API meetings field (string | object | array) into [{day,start,end,location}] */
function parseMeetings(raw) {
  if (!raw || raw === 'TBA') return []
  const items = Array.isArray(raw) ? raw : [raw]
  const result = []
  for (const m of items) {
    if (typeof m !== 'object') continue
    const days = Array.isArray(m.daysOfWeek) ? m.daysOfWeek : []
    const start = normTime(m.startTime ?? m.start ?? '')
    const end   = normTime(m.endTime ?? m.end ?? '')
    const loc   = (m.location ?? '').trim()
    for (const day of days) {
      const d = normDay(day)
      if (d && start) result.push({ day: d, start, end, location: loc })
    }
    // Also handle old flat format: { day, startTime, endTime }
    if (!days.length && (m.day || m.meetingDay)) {
      const d = normDay(m.day ?? m.meetingDay ?? '')
      const s = normTime(m.startTime ?? m.start ?? '')
      if (d && s) result.push({ day: d, start: s, end: normTime(m.endTime ?? m.end ?? ''), location: (m.location ?? '').trim() })
    }
  }
  return result
}

function normTime(t) {
  if (!t) return ''
  const s = String(t).trim().toLowerCase()
  const m = s.match(/^(\d{1,2}):(\d{2})\s*(am|pm)?$/)
  if (!m) return s
  let h = parseInt(m[1]), mn = parseInt(m[2])
  if (m[3] === 'am' && h === 12) h = 0
  if (m[3] === 'pm' && h !== 12) h += 12
  return `${String(h).padStart(2,'0')}:${String(mn).padStart(2,'0')}`
}

/** Fetch one upstream school, normalise, return results array. Never throws. */
async function fetchOneSchool(schoolCode, q, limit, passThrough, apiKey, cache) {
  const upstream = new URL(UPSTREAM_BASE)
  upstream.searchParams.set('q', q)
  upstream.searchParams.set('catalogSchool', schoolCode)
  upstream.searchParams.set('limit', String(limit))
  for (const [key, val] of Object.entries(passThrough)) {
    if (val != null && val !== '') upstream.searchParams.set(key, val)
  }

  // Check edge cache per school+query combo
  const cacheKey = new Request(upstream.toString(), { headers: { Accept: 'application/json' } })
  const cached = await cache.match(cacheKey)
  if (cached) {
    try {
      const raw = await cached.json()
      return normalise(raw).results
    } catch { return [] }
  }

  try {
    const resp = await fetch(upstream.toString(), {
      headers: {
        'x-api-key': apiKey,
        'Accept': 'application/json',
        'User-Agent': 'HKS-Course-Explorer/2.0',
      },
    })
    if (!resp.ok) return []
    const raw = await resp.json().catch(() => ({}))
    const normalised = normalise(raw)
    // Cache per school
    const cacheResp = new Response(JSON.stringify(raw), {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300' },
    })
    await cache.put(cacheKey, cacheResp)
    return normalised.results
  } catch {
    return []
  }
}

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url)
  const q = url.searchParams.get('q')?.trim() ?? ''
  const limit = Math.min(Number(url.searchParams.get('limit') ?? 25), MAX_LIMIT)

  // Allow single-char queries (needed for Non-HKS browse mode: q='a')
  if (!q || q.length < 1) {
    return jsonResp({ error: 'q must be at least 1 character', results: [] }, 400, request)
  }

  // Check for API key
  const apiKey = env?.HARVARD_API_KEY
  if (!apiKey) {
    console.warn('HARVARD_API_KEY not configured')
    return jsonResp({ results: [], total: 0, _note: 'API key not configured' }, 200, request)
  }

  const schoolParam = url.searchParams.get('school') ?? 'HKS'
  const PASS_THROUGH_KEYS = ['term', 'session', 'day', 'crossreg', 'instructionMode', 'unitsMin', 'unitsMax']
  const passThrough = {}
  for (const key of PASS_THROUGH_KEYS) {
    const val = url.searchParams.get(key)
    if (val != null && val !== '') passThrough[key] = val
  }

  const cache = caches.default

  // ── Non-HKS: fan-out to multiple schools in parallel ──────────────────────
  if (schoolParam === 'Non-HKS') {
    // Per-school limit: fetch more per school so merged result has enough variety
    const perSchoolLimit = Math.min(Math.ceil(limit * 1.5), MAX_LIMIT)
    const schoolResults = await Promise.all(
      NON_HKS_SCHOOLS.map(sc => fetchOneSchool(sc, q, perSchoolLimit, passThrough, apiKey, cache))
    )
    // Merge + deduplicate by harvardId (fallback: courseCode)
    const seen = new Set()
    const merged = []
    for (const results of schoolResults) {
      for (const item of results) {
        const key = item.harvardId || item.courseCode
        if (key && seen.has(key)) continue
        if (key) seen.add(key)
        merged.push(item)
        if (merged.length >= limit) break
      }
      if (merged.length >= limit) break
    }
    const body = JSON.stringify({ results: merged, total: merged.length })
    return new Response(body, {
      headers: {
        'Content-Type': 'application/json',
        'CF-Cache-Status': 'MISS',
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
  const cached = await cache.match(cacheKey)
  if (cached) {
    const body = await cached.text()
    return new Response(body, {
      headers: {
        'Content-Type': 'application/json',
        'CF-Cache-Status': 'HIT',
        ...(request ? corsHeaders(request) : {}),
      },
    })
  }

  // Fetch from Harvard
  let resp
  try {
    resp = await fetch(upstream.toString(), {
      headers: {
        'x-api-key': apiKey,
        'Accept': 'application/json',
        'User-Agent': 'HKS-Course-Explorer/2.0',
      },
    })
  } catch (err) {
    console.error('Harvard API fetch error:', err)
    return jsonResp({ error: 'Could not reach Harvard API', results: [] }, 502, request)
  }

  if (!resp.ok) {
    const text = await resp.text().catch(() => '')
    console.error('Harvard API error:', resp.status, text)
    return jsonResp({ error: `Harvard API returned ${resp.status}`, results: [] }, 502, request)
  }

  const raw = await resp.json().catch(() => ({}))
  const normalised = normalise(raw)
  const body = JSON.stringify(normalised)

  // Cache the successful response for 5 minutes
  const cacheResp = new Response(body, {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=300',
    },
  })
  await cache.put(cacheKey, cacheResp)

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
