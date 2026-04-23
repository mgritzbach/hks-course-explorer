// GET /api/harvard-courses?q=API-101&term=2026Spring
// Proxies Harvard ATS Course v2 API; hides API key; normalises & caches 5 min.
// Env var required: HARVARD_API_KEY (set in Cloudflare Pages dashboard)

import { corsHeaders, handleOptions } from '../_shared/cors.js'

const UPSTREAM_BASE = 'https://go.apis.huit.harvard.edu/ats/course/v2/search'
const DEFAULT_SCHOOL = 'HKS'
const MAX_LIMIT = 50

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
    results: items.map(c => ({
      harvardId: String(c.id ?? c.classNumber ?? c.courseId ?? ''),
      subject: c.subject ?? c.subjectCode ?? '',
      catalog: c.catalogNumber ?? c.courseNumber ?? '',
      courseCode: c.subject
        ? `${c.subject}-${c.catalogNumber ?? c.courseNumber ?? ''}`.replace(/\s+/g, '')
        : '',
      title: c.title ?? c.courseTitle ?? '',
      term: c.termDescription ?? c.term ?? '',
      credits: c.units ?? c.credits ?? null,
      instructors: (c.instructors ?? c.staff ?? []).map(i =>
        i.displayName ?? i.name ?? `${i.firstName ?? ''} ${i.lastName ?? ''}`.trim()
      ).filter(Boolean),
      description: c.description ?? c.courseDescription ?? '',
      sections: (c.sections ?? c.classes ?? c.meetings ?? []).map(s => ({
        sectionId: String(s.sectionId ?? s.classNumber ?? s.id ?? ''),
        type: s.type ?? s.component ?? 'LEC',
        meetings: (s.meetings ?? s.schedule ?? []).map(m => ({
          day: normDay(m.day ?? m.meetingDay ?? ''),
          start: m.startTime ?? m.meetingStartTime ?? '',
          end: m.endTime ?? m.meetingEndTime ?? '',
          location: m.location ?? m.room ?? '',
        })).filter(m => m.day && m.start),
      })),
    })),
    total: raw?.total ?? raw?.count ?? items.length,
  }
}

const DAY_MAP = {
  M: 'MON', MON: 'MON', MONDAY: 'MON',
  T: 'TUE', TUE: 'TUE', TUESDAY: 'TUE',
  W: 'WED', WED: 'WED', WEDNESDAY: 'WED',
  R: 'THU', TH: 'THU', THU: 'THU', THURSDAY: 'THU',
  F: 'FRI', FRI: 'FRI', FRIDAY: 'FRI',
}
function normDay(d) { return DAY_MAP[String(d).toUpperCase().trim()] ?? d }

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url)
  const q = url.searchParams.get('q')?.trim() ?? ''
  const term = url.searchParams.get('term') ?? ''
  const school = url.searchParams.get('school') ?? DEFAULT_SCHOOL
  const limit = Math.min(Number(url.searchParams.get('limit') ?? 25), MAX_LIMIT)

  if (!q || q.length < 2) {
    return jsonResp({ error: 'q must be at least 2 characters', results: [] }, 400, request)
  }

  // Check for API key
  const apiKey = env?.HARVARD_API_KEY
  if (!apiKey) {
    // No key configured — return empty results gracefully (dev environment)
    console.warn('HARVARD_API_KEY not configured')
    return jsonResp({ results: [], total: 0, _note: 'API key not configured' }, 200, request)
  }

  // Build upstream URL
  const upstream = new URL(UPSTREAM_BASE)
  upstream.searchParams.set('q', q)
  if (term) upstream.searchParams.set('term', term)
  upstream.searchParams.set('school', school)
  upstream.searchParams.set('limit', String(limit))

  // Try edge cache first
  const cache = caches.default
  const cacheKey = new Request(upstream.toString(), { headers: { Accept: 'application/json' } })
  let cached = await cache.match(cacheKey)
  if (cached) {
    // Return cached but add CORS headers
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
