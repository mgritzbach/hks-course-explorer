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
    results: items.map(c => {
      // Parse meeting times — new format has meetings as object/array on top-level course
      const meetings = parseMeetings(c.meetings ?? c.sections ?? c.classes)
      const courseNum = String(c.courseNumber ?? c.catalog ?? '').trim()
      const subject   = String(c.catalogSubject ?? c.subject ?? courseNum.split(' ')[0] ?? '').trim()
      const catalog   = String(c.classCatalogNumber ?? c.catalogNumber ?? courseNum.split(' ')[1] ?? '').trim()
      const code = subject && catalog ? `${subject}-${catalog}` : courseNum.replace(/\s+/g, '-')
      return {
        harvardId:   String(c.courseID ?? c.id ?? c.classNumber ?? ''),
        courseCode:  code,
        title:       String(c.courseTitle ?? c.title ?? ''),
        term:        String(c.termDescription ?? c.term ?? ''),
        credits:     c.classMinUnits ?? c.units ?? null,
        instructors: (c.publishedInstructors ?? c.instructors ?? []).map(i =>
          String(i.instructorName ?? i.displayName ?? i.name ?? `${i.firstName ?? ''} ${i.lastName ?? ''}`.trim())
        ).filter(Boolean),
        description: String(c.courseDescription ?? c.description ?? ''),
        location:    meetings[0]?.location ?? '',
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

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url)
  const q = url.searchParams.get('q')?.trim() ?? ''
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

  // Build upstream URL — use catalogSchool=HKS (not school=)
  const upstream = new URL(UPSTREAM_BASE)
  if (q) upstream.searchParams.set('q', q)
  upstream.searchParams.set('catalogSchool', 'HKS')
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
