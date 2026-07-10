// Pure URL/filter state transforms for the Course Explorer. These helpers do
// not know about React Router, so their behavior is directly testable.

export const ALL_COURSE_TERMS = Object.freeze(['Fall', 'Spring', 'January'])

/**
 * Create the Course Explorer's initial filter state from a URLSearchParams-like
 * object. This intentionally preserves the existing parseInt behavior for a
 * non-empty `y` value so legacy shared links retain their prior semantics.
 * @param {{ get(key: string): string | null }} searchParams URL parameter reader.
 * @returns {{ year: number | 'all', terms: string[], concentration: string, academicArea: string, coreFilter: string, stemGroup: string, minInstructorPct: string, evalOnly: boolean }} Initial filter state.
 */
export function courseFiltersFromSearchParams(searchParams) {
  const rawYear = searchParams.get('y')
  return {
    year: rawYear && rawYear !== 'all' ? parseInt(rawYear, 10) : 'all',
    terms: [...ALL_COURSE_TERMS],
    concentration: searchParams.get('c') || 'All',
    academicArea: 'All',
    coreFilter: 'all',
    stemGroup: 'all',
    minInstructorPct: 'any',
    evalOnly: false,
  }
}

/**
 * Return a cloned URLSearchParams with the shareable course filters applied.
 * @param {URLSearchParams} current Current URL parameters.
 * @param {{ year: number | 'all', concentration: string }} filters Course filters that are encoded in the URL.
 * @returns {URLSearchParams} Updated URL parameters without mutating `current`.
 */
export function withCourseFilterSearchParams(current, filters) {
  const next = new URLSearchParams(current)
  if (filters.year !== 'all') next.set('y', String(filters.year))
  else next.delete('y')
  if (filters.concentration !== 'All') next.set('c', filters.concentration)
  else next.delete('c')
  return next
}

/**
 * Return a cloned URLSearchParams with the course text query applied.
 * @param {URLSearchParams} current Current URL parameters.
 * @param {string} query Course text query.
 * @returns {URLSearchParams} Updated URL parameters without mutating `current`.
 */
export function withCourseQuerySearchParams(current, query) {
  const next = new URLSearchParams(current)
  if (query) next.set('q', query)
  else next.delete('q')
  return next
}
