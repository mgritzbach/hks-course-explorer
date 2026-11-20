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

/** Filter actual offerings before choosing one representative per base course. */
export function filterCourseOptions({ courses, filters, query }) {
  const minPct = filters.minInstructorPct !== 'any' ? parseFloat(filters.minInstructorPct) : null
  const normalized = query?.toLowerCase() || ''
  const matching = courses.filter((course) => {
    if (
      filters.year !== 'all' &&
      (course.year !== filters.year || !filters.terms.includes(course.term))
    )
      return false
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
    return (
      !normalized ||
      [
        course.course_name,
        course.course_code,
        course.professor_display,
        course.description,
        course.academic_area,
      ].some((value) => (value || '').toLowerCase().includes(normalized))
    )
  })
  return buildCourseOptions(matching).sort((a, b) => {
    const aBid = a.last_bid_price ?? -1
    const bBid = b.last_bid_price ?? -1
    if (aBid !== bBid) return bBid - aBid
    return (a.course_name || a.course_code || '').localeCompare(
      b.course_name || b.course_code || '',
    )
  })
}
