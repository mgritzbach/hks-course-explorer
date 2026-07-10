/** Builds the stable metadata contract consumed by catalogue views. */
export const COURSE_METRICS = [
  { key: 'Instructor_Rating', label: 'Instructor Rating', higher_is_better: true },
  { key: 'Course_Rating', label: 'Course Rating', higher_is_better: true },
  { key: 'Workload', label: 'Workload', higher_is_better: false },
  { key: 'Assignments', label: 'Assignment Value', higher_is_better: true },
  { key: 'Availability', label: 'Availability', higher_is_better: true },
  { key: 'Discussions', label: 'Class Discussions', higher_is_better: true },
  { key: 'Diverse Perspectives', label: 'Diverse Perspectives', higher_is_better: true },
  { key: 'Feedback', label: 'Feedback', higher_is_better: true },
  { key: 'Discussion Diversity', label: 'Discussion Diversity', higher_is_better: true },
  { key: 'Rigor', label: 'Rigor', higher_is_better: true },
  { key: 'Readings', label: 'Readings', higher_is_better: false },
  { key: 'Insights', label: 'Insights', higher_is_better: true },
  { key: 'Bid_Price', label: 'Bid Price', higher_is_better: false, bid_metric: true },
  { key: 'Bid_N_Bids', label: 'Number of Bids', higher_is_better: false, bid_metric: true },
]

/** @returns {never} */
function contractError(message) {
  throw new Error(`Course metadata contract: ${message}`)
}

/** @param {unknown} value @param {string} message @returns {unknown[]} */
function requireArray(value, message) {
  if (!Array.isArray(value)) contractError(message)
  return value
}

/** @param {unknown} value @param {string} message @returns {Record<string, unknown>} */
function requireRecord(value, message) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) contractError(message)
  return /** @type {Record<string, unknown>} */ (value)
}

/**
 * Validate a metric-definition fixture before it is exposed to catalogue views.
 * @param {unknown} metrics Candidate metric definition array.
 * @returns {true} True when the fixture satisfies the stable public contract.
 * @throws {Error} When keys, labels, or sort-direction flags are invalid.
 */
export function assertCourseMetricDefinitions(metrics = COURSE_METRICS) {
  const metricItems = requireArray(metrics, 'metrics must be a non-empty array')
  if (metricItems.length === 0) contractError('metrics must be a non-empty array')
  const keys = new Set()
  for (const metric of metricItems) {
    const candidate = requireRecord(metric, 'each metric must be an object')
    const { key, label, higher_is_better: higherIsBetter, bid_metric: bidMetric } = candidate
    if (typeof key !== 'string' || !key) contractError('each metric must have a non-empty key')
    if (keys.has(key)) contractError(`metric key "${key}" must be unique`)
    keys.add(key)
    if (typeof label !== 'string' || !label)
      contractError(`metric "${key}" must have a non-empty label`)
    if (typeof higherIsBetter !== 'boolean')
      contractError(`metric "${key}" must declare higher_is_better`)
    if (bidMetric != null && typeof bidMetric !== 'boolean')
      contractError(`metric "${key}" bid_metric must be boolean when present`)
  }
  return true
}

/**
 * Validate the metadata object returned by {@link buildCourseMeta}.
 * @param {unknown} meta Candidate metadata object.
 * @returns {true} True when the object is safe for catalogue view consumers.
 * @throws {Error} When a required field has an incompatible shape.
 */
export function assertCourseMetaContract(meta) {
  const candidate = requireRecord(meta, 'metadata must be an object')
  if (
    !Array.isArray(candidate.concentrations) ||
    !Array.isArray(candidate.years) ||
    !Array.isArray(candidate.terms) ||
    !Array.isArray(candidate.default_terms)
  ) {
    contractError('concentrations, years, terms, and default_terms must be arrays')
  }
  if (!Number.isFinite(candidate.default_year))
    contractError('default_year must be a finite number')
  if (
    !candidate.year_medians_instructor ||
    typeof candidate.year_medians_instructor !== 'object' ||
    Array.isArray(candidate.year_medians_instructor)
  ) {
    contractError('year_medians_instructor must be an object')
  }
  if (
    candidate.overall_median_instructor != null &&
    !Number.isFinite(candidate.overall_median_instructor)
  ) {
    contractError('overall_median_instructor must be null or a finite number')
  }
  assertCourseMetricDefinitions(candidate.metrics)
  return true
}

function median(values) {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

export function buildCourseMeta(courses) {
  const source = Array.isArray(courses) ? courses : []
  const concentrations = [
    ...new Set(source.map((course) => course.concentration).filter(Boolean)),
  ].sort()
  const years = [...new Set(source.map((course) => course.year).filter(Boolean))].sort(
    (a, b) => a - b,
  )
  const evaluatedCourses = source.filter(
    (course) => course.metrics_raw?.Instructor_Rating != null && !course.is_average,
  )
  const byYear = {}
  for (const course of evaluatedCourses) {
    if (!course.year) continue
    if (!byYear[course.year]) byYear[course.year] = []
    byYear[course.year].push(course.metrics_raw.Instructor_Rating)
  }
  const evalYears = source
    .filter((course) => course.has_eval && !course.is_average && course.year)
    .map((course) => course.year)

  return {
    concentrations,
    years,
    terms: ['Fall', 'Spring', 'January'],
    default_year: evalYears.length ? Math.max(...evalYears) : 2025,
    default_terms: ['Fall', 'Spring'],
    metrics: COURSE_METRICS,
    overall_median_instructor: median(
      evaluatedCourses.map((course) => course.metrics_raw.Instructor_Rating),
    ),
    year_medians_instructor: Object.fromEntries(
      Object.entries(byYear).map(([year, values]) => [year, median(values)]),
    ),
    academic_areas: [],
  }
}
