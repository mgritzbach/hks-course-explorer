const SESSION_OPTIONS = Object.freeze({
  Spring: Object.freeze(['Full Term', 'Spring 1', 'Spring 2', 'January']),
  Fall: Object.freeze(['Full Term', 'Fall 1', 'Fall 2']),
  January: Object.freeze(['January']),
  Summer: Object.freeze(['Full Term']),
})

const CATALOGUE_SEMESTER_ORDER = Object.freeze({ Spring: 0, Summer: 1, Fall: 2 })

/**
 * Build the term selector from the active HKS catalogue itself. This prevents
 * impossible year/semester pairs such as "2026 Spring" when the current
 * academic catalogue contains Fall 2026 and Spring 2027.
 */
export function buildAvailableCatalogueTerms(rows) {
  const counts = new Map()
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row || row.is_hks !== true || typeof row.term !== 'string') continue
    const match = row.term.trim().match(/^(\d{4})\s+(Spring|Summer|Fall)$/)
    if (!match) continue
    const term = `${match[1]} ${match[2]}`
    counts.set(term, (counts.get(term) || 0) + 1)
  }

  return [...counts.entries()]
    .map(([term, count]) => {
      const [year, semester] = term.split(' ')
      return { term, year, semester, count, label: `${semester} ${year}` }
    })
    .sort(
      (a, b) =>
        Number(a.year) - Number(b.year) ||
        CATALOGUE_SEMESTER_ORDER[a.semester] - CATALOGUE_SEMESTER_ORDER[b.semester],
    )
}

/** Choose the current planning term without hard-coding an expired catalog. */
export function getDefaultScheduleTerm(now = new Date()) {
  return {
    year: String(now.getFullYear()),
    semester: now.getMonth() >= 5 ? 'Fall' : 'Spring',
  }
}

export function getSessionOptions(semester) {
  return SESSION_OPTIONS[semester] || SESSION_OPTIONS.Spring
}

export function normalizeSessionForSemester(session, semester) {
  if (session === 'all') return 'all'
  return getSessionOptions(semester).includes(session) ? session : 'all'
}

/**
 * my.harvard publishes January offerings inside the Spring catalogue and
 * distinguishes them with session_description="January".
 */
export function getLiveCatalogueTerm(year, semester) {
  const sourceSemester = semester === 'January' ? 'Spring' : semester
  return `${year} ${sourceSemester}`
}

/** J-Term is a session-only view of the Spring source term. */
export function getEffectiveScheduleSession(semester, selectedSession) {
  return semester === 'January' ? 'January' : selectedSession
}
