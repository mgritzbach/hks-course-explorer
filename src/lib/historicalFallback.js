import { compareCourseChronology } from './courseChronology.js'

const isBidMetric = (key) => key.startsWith('Bid_')
const hasEvaluation = (row) =>
  row.has_eval &&
  [...Object.entries(row.metrics_raw || {}), ...Object.entries(row.metrics_pct || {})].some(
    ([key, value]) => !isBidMetric(key) && Number.isFinite(value),
  )
const hasBid = (row) =>
  row.has_bidding && Number.isFinite(row.bid_clearing_price ?? row.last_bid_price)
const instructorKey = (row) =>
  (row.professor_display || row.professor || '')
    .toLowerCase()
    .replace(/[^a-z ]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .sort()
    .join(' ')

function latestSource(course, history, available) {
  return history
    .filter(
      (row) =>
        !row.is_average &&
        !row.evaluation_source &&
        !row.bidding_source &&
        (row.course_code_base || row.course_code) ===
          (course.course_code_base || course.course_code) &&
        compareCourseChronology(row, course) < 0 &&
        available(row),
    )
    .sort(
      (a, b) =>
        compareCourseChronology(b, a) ||
        Number(instructorKey(b) === instructorKey(course)) -
          Number(instructorKey(a) === instructorKey(course)) ||
        Number(b.course_code === course.course_code) -
          Number(a.course_code === course.course_code) ||
        String(a.id).localeCompare(String(b.id)),
    )[0]
}

function sourceDetails(row) {
  return {
    id: row.id,
    year: row.year,
    term: row.term,
    professor: row.professor_display || row.professor || 'Instructor not listed',
    course_code: row.course_code,
  }
}

/** Keep offering identity/current values; borrow only missing data and retain its source. */
export function withHistoricalFallback(course, history) {
  if (!course.is_current_offering) return course
  const evaluation = hasEvaluation(course) ? null : latestSource(course, history, hasEvaluation)
  const bidding = hasBid(course) ? null : latestSource(course, history, hasBid)
  const result = {
    ...course,
    metrics_raw: { ...course.metrics_raw },
    metrics_pct: { ...course.metrics_pct },
  }
  if (evaluation) {
    for (const field of ['metrics_raw', 'metrics_pct']) {
      Object.assign(
        result[field],
        Object.fromEntries(
          Object.entries(evaluation[field] || {}).filter(([key]) => !isBidMetric(key)),
        ),
      )
    }
    for (const field of ['n_respondents', 'instructor_label', 'workload_label'])
      result[field] = evaluation[field]
    result.has_eval = true
    result.evaluation_source = sourceDetails(evaluation)
  }
  if (bidding) {
    for (const field of ['metrics_raw', 'metrics_pct']) {
      Object.assign(
        result[field],
        Object.fromEntries(
          Object.entries(bidding[field] || {}).filter(([key]) => isBidMetric(key)),
        ),
      )
    }
    for (const field of [
      'last_bid_price',
      'last_bid_acad',
      'last_bid_term',
      'last_bid_capacity',
      'last_bid_n_bids',
      'bid_clearing_price',
      'bid_academic_year',
      'bid_capacity',
      'bid_n_bids',
    ])
      result[field] = bidding[field]
    result.last_bid_price = bidding.bid_clearing_price ?? bidding.last_bid_price
    result.has_bidding = true
    result.ever_bidding = true
    result.bidding_source = {
      ...sourceDetails(bidding),
      label: `${bidding.last_bid_term || bidding.term} ${bidding.bid_academic_year || bidding.last_bid_acad || bidding.year}`,
    }
  }
  return result
}
