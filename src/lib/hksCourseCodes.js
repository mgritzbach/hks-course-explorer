/**
 * Stable HKS-owned course-code prefixes used across planning surfaces.
 * Keep this source shared so search, schedule, and completion behavior cannot
 * silently drift when a program prefix is added or retired.
 */
export const HKS_COURSE_PREFIXES = new Set([
  'API',
  'BGP',
  'DEV',
  'DPI',
  'IGA',
  'MLD',
  'SUP',
  'MPAID',
  'HKS',
])

export function isHksCourseCode(courseCode) {
  const prefix = String(courseCode || '')
    .split('-')[0]
    .toUpperCase()
  return HKS_COURSE_PREFIXES.has(prefix)
}
