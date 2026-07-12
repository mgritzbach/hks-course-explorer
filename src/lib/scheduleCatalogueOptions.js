const SESSION_OPTIONS = Object.freeze({
  Spring: Object.freeze(['Full Term', 'Spring 1', 'Spring 2', 'January']),
  Fall: Object.freeze(['Full Term', 'Fall 1', 'Fall 2']),
  January: Object.freeze(['January']),
  Summer: Object.freeze(['Full Term']),
})

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
