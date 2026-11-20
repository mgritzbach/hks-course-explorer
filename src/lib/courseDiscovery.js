import { fetchAllCoursesWithCache } from './courseDataCache.js'
import { loadSnapshotRows, usesCatalogueSnapshots } from './catalogueSnapshot.js'
import { fetchCataloguePages } from './cataloguePagination.js'

// Add current offerings without assigning old evaluations to a new year or instructor.
export function mergeCurrentOfferings(history, live) {
  const result = [...history]
  const classifications = new Map()
  for (const course of history) {
    const base = course.course_code_base || course.course_code
    if (course.is_average || !base) continue
    const previous = classifications.get(base)
    if (!previous || (course.year || 0) > (previous.year || 0)) classifications.set(base, course)
  }
  const keys = new Set(history.map((c) => `${c.course_code}|${c.year}|${c.term}`))
  for (const row of live) {
    if (!row.is_hks || row.active === false) continue
    const match = row.term?.match(/^(\d{4}) (Spring|Summer|Fall|January)$/)
    if (!match) continue
    const year = Number(match[1])
    const term = row.session_description === 'January' ? 'January' : match[2]
    const key = `${row.course_code}|${year}|${term}`
    if (keys.has(key)) continue
    keys.add(key)
    const classification = classifications.get(row.course_code_base || row.course_code)
    result.push({
      id: `current||${row.course_code}||${year}||${term}`,
      course_code: row.course_code,
      course_code_base: row.course_code_base || row.course_code,
      concentration: row.course_code?.match(/^[A-Z]+/)?.[0] || 'Other',
      course_name: row.title,
      year,
      term,
      session_description: row.session_description,
      professor: (row.instructors || []).join(', '),
      professor_display: (row.instructors || []).join(', '),
      course_url: row.source_url,
      credits: row.credits,
      meetings: row.meetings,
      meeting_days: row.meeting_days,
      time_start: row.time_start,
      time_end: row.time_end,
      is_core: classification?.is_core ?? false,
      is_stem: classification?.is_stem ?? false,
      stem_group: classification?.stem_group ?? null,
      stem_school: classification?.stem_school ?? null,
      academic_area: classification?.academic_area ?? null,
      is_average: false,
      is_current_offering: true,
      has_eval: false,
      has_bidding: false,
      metrics_raw: {},
      metrics_pct: {},
    })
  }
  return result
}

export async function fetchCurrentHksOfferings() {
  if (usesCatalogueSnapshots) {
    const inventory = await loadSnapshotRows('terms')
    const terms = [...new Set(inventory.filter((r) => r.is_hks).map((r) => r.term))]
    const datasets = await Promise.all(terms.map((term) => loadSnapshotRows(`live/${term}`)))
    return datasets.flat().filter((r) => r.is_hks && r.active !== false)
  }
  const { supabase } = await import('./supabase.js')
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 8000)
  try {
    return await fetchCataloguePages(() =>
      supabase
        .from('live_courses')
        .select('*')
        .eq('active', true)
        .eq('is_hks', true)
        .order('id')
        .abortSignal(controller.signal),
    )
  } finally {
    clearTimeout(timeout)
  }
}

export async function fetchDiscoveryCourses(onProgress, onCacheStatus) {
  const [history, current] = await Promise.all([
    fetchAllCoursesWithCache(onProgress, onCacheStatus),
    fetchCurrentHksOfferings().then(
      (rows) => ({ rows, error: '' }),
      () => ({
        rows: [],
        error:
          'Current offerings could not be loaded. Showing historical courses only. Reload to retry.',
      }),
    ),
  ])
  return {
    courses: mergeCurrentOfferings(history, current.rows),
    currentCatalogueError: current.error,
  }
}
