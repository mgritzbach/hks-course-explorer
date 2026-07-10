import { ALL_COURSE_TERMS } from './courseBrowserState.js'

/**
 * Pure Course Explorer catalogue transforms.
 *
 * Courses.jsx owns Router state, deferred rendering, and selection. This
 * module owns the deterministic deduplication, filtering, and ordering used
 * to present that state, so the visible catalogue can be tested without React.
 */
export function courseConcentration(code) {
  const match = code?.match(/^([A-Z]+)/)
  return match ? match[1] : 'Other'
}

export function countActiveCourseFilters(filters) {
  let count = 0
  if (filters.year !== 'all') count++
  if (filters.concentration !== 'All') count++
  if (filters.academicArea !== 'All') count++
  if (filters.coreFilter !== 'all') count++
  if (filters.stemGroup !== 'all') count++
  if (filters.minInstructorPct !== 'any') count++
  if (filters.evalOnly) count++
  if (
    filters.year !== 'all' &&
    (filters.terms.length !== ALL_COURSE_TERMS.length ||
      !ALL_COURSE_TERMS.every((term) => filters.terms.includes(term)))
  )
    count++
  return count
}

/** Deduplicate offerings by base course code, retaining the most recent year. */
export function buildCourseOptions(courses) {
  const map = new Map()
  for (const course of courses) {
    const key = course.course_code_base
    if (!map.has(key) || (course.year || 0) > (map.get(key).year || 0)) map.set(key, course)
  }
  return [...map.values()].sort((a, b) =>
    (a.course_name || a.course_code).localeCompare(b.course_name || b.course_code),
  )
}

/**
 * Filter and order the canonical course options for the current UI filters.
 * The year-term set is deliberately indexed once before filtering to retain
 * the page's O(1) membership check for each option.
 */
export function filterCourseOptions({ allOptions, courses, filters, query }) {
  const minPct = filters.minInstructorPct !== 'any' ? parseFloat(filters.minInstructorPct) : null
  const yearTermKeys =
    filters.year !== 'all'
      ? new Set(
          courses
            .filter((row) => row.year === filters.year && filters.terms.includes(row.term))
            .map((row) => row.course_code_base),
        )
      : null

  const list = allOptions
    .filter((course) => {
      if (yearTermKeys !== null && !yearTermKeys.has(course.course_code_base)) return false
      if (
        filters.concentration !== 'All' &&
        courseConcentration(course.course_code) !== filters.concentration
      )
        return false
      if (filters.academicArea !== 'All' && course.academic_area !== filters.academicArea)
        return false
      if (filters.coreFilter === 'core' && !course.is_core) return false
      if (filters.coreFilter === 'no-core' && course.is_core) return false
      if (filters.stemGroup === 'A' && course.stem_group !== 'A') return false
      if (filters.stemGroup === 'B' && course.stem_group !== 'B') return false
      if (minPct !== null) {
        const rating = course.metrics_pct?.Instructor_Rating
        if (rating != null && rating < minPct) return false
      }
      if (filters.evalOnly && !course.has_eval) return false
      return true
    })
    .sort((a, b) => {
      const aBid = a.last_bid_price ?? -1
      const bBid = b.last_bid_price ?? -1
      if (aBid !== bBid) return bBid - aBid
      return (a.course_name || a.course_code || '').localeCompare(
        b.course_name || b.course_code || '',
      )
    })

  if (!query) return list
  const normalized = query.toLowerCase()
  return list.filter(
    (course) =>
      (course.course_name || '').toLowerCase().includes(normalized) ||
      (course.course_code || '').toLowerCase().includes(normalized) ||
      (course.professor_display || '').toLowerCase().includes(normalized) ||
      (course.description || '').toLowerCase().includes(normalized) ||
      (course.academic_area || '').toLowerCase().includes(normalized),
  )
}
