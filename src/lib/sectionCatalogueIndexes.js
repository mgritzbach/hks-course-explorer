/**
 * Exact lookup indexes for trusted course-section records.
 *
 * Course additions and section suffixes are part of an offering's identity.
 * This normalises formatting only; it never removes or invents a suffix.
 */
export function sectionCodeKey(value) {
  if (typeof value !== 'string') return null

  const code = value
    .trim()
    .toUpperCase()
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\s*-\s*/g, '-')
    .replace(/\s+/g, '-')

  return code || null
}

/** Build exact-code indexes without allowing one course variant to borrow another's meeting data. */
export function buildSectionCatalogueIndexes(rows) {
  const sectionTimesMap = new Map()
  const sectionCanonicalCodes = new Set()
  const sectionInfoMap = new Map()

  for (const row of Array.isArray(rows) ? rows : []) {
    const code = sectionCodeKey(row?.course_code_base || row?.course_code)
    if (!code || !Array.isArray(row.meetings) || row.meetings.length === 0) continue

    sectionTimesMap.set(code, row.meetings)
    sectionCanonicalCodes.add(code)

    if (row.title || row.instructors?.length || row.credits != null) {
      sectionInfoMap.set(code, {
        title: row.title || null,
        instructors: Array.isArray(row.instructors) ? row.instructors : [],
        credits: row.credits != null ? Number(row.credits) : null,
      })
    }
  }

  return { sectionTimesMap, sectionCanonicalCodes, sectionInfoMap }
}
