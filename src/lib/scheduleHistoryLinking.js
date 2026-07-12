import { instructorKeys, normaliseCourseCode } from './catalogueLinking.js'

const RATING_KEYS = ['Instructor_Rating', 'Course_Rating', 'Workload', 'Rigor']

export function hasMeaningfulHistoricalRatings(metrics) {
  return Boolean(
    metrics &&
    typeof metrics === 'object' &&
    RATING_KEYS.some((key) => metrics[key] != null && Number(metrics[key]) > 0),
  )
}

/** Build an exact-code index; aliases and suffixes require separate review. */
export function buildHistoricalRatingsByCode(records) {
  const index = new Map()
  for (const record of Array.isArray(records) ? records : []) {
    const code = normaliseCourseCode(record?.course_code_base || record?.course_code)
    if (!code || !hasMeaningfulHistoricalRatings(record?.metrics_pct)) continue
    if (!index.has(code)) index.set(code, [])
    index.get(code).push(record)
  }
  return index
}

function sharedInstructor(course, record) {
  const current = new Set(instructorKeys(course))
  if (current.size === 0) return false
  return instructorKeys(record).some((key) => current.has(key))
}

function isBetterRating(candidate, current) {
  if (!current) return true
  if (candidate.is_average && !current.is_average) return true
  if (!candidate.is_average && !current.is_average)
    return Number(candidate.year || 0) > Number(current.year || 0)
  return false
}

/**
 * Return rating evidence only when this delivery has the exact course code and
 * at least one matching instructor. An absent result is intentional: callers
 * must display no rating rather than borrow one from a related course.
 */
export function findVerifiedHistoricalRating(course, ratingsByCode) {
  // The reviewed evaluation history is HKS-only. Current non-HKS offerings
  // remain scheduleable, but must never inherit a coincidental HKS rating.
  if (course?.is_hks === false) return null

  const code = normaliseCourseCode(
    course?.courseCodeBase || course?.course_code_base || course?.courseCode || course?.course_code,
  )
  if (!code) return null

  let best = null
  for (const record of ratingsByCode?.get(code) || []) {
    if (sharedInstructor(course, record) && isBetterRating(record, best)) best = record
  }
  return best
    ? {
        metrics_pct: best.metrics_pct,
        isAverage: Boolean(best.is_average),
        year: best.year ?? null,
      }
    : null
}
