/**
 * Course identity linking for the future unified catalogue.
 *
 * This module intentionally does not use title, instructor, or suffix-stripped
 * matching. A false historical rating is worse than an explicit "unmatched"
 * state. Renumberings are linked only through the reviewed alias registry.
 */
export function normaliseCourseCode(value) {
  if (typeof value !== 'string') return null

  const code = value
    .trim()
    .toUpperCase()
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\s*-\s*/g, '-')
    .replace(/\s+/g, '-')

  return code || null
}

export function normaliseInstructorName(value) {
  if (typeof value !== 'string') return null
  const tokens = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase()
    .replace(/\b(professor|prof|doctor|dr)\b/g, '')
    .match(/[a-z]+/g)
    ?.filter((token) => token.length > 1)
    .sort()

  return tokens?.length ? tokens.join(' ') : null
}

export function instructorKeys(record) {
  if (!record || typeof record !== 'object') return []
  const values = Array.isArray(record.instructors)
    ? record.instructors
    : [record.professor_display, record.professor, record.instructor_label]
  return [...new Set(values.map(normaliseInstructorName).filter(Boolean))].sort()
}

function codeFrom(record) {
  return normaliseCourseCode(record?.course_code_base || record?.course_code)
}

function hasSharedInstructor(offering, record) {
  const offeringKeys = instructorKeys(offering)
  const recordKeys = new Set(instructorKeys(record))
  return offeringKeys.some((key) => recordKeys.has(key))
}

function probableSectionBase(code) {
  return typeof code === 'string' && /-[A-Z]$/.test(code) ? code.slice(0, -2) : null
}

export function buildHistoricalCourseIndex(records, historicalCodeMap = {}) {
  const direct = new Map()
  const mapped = new Map()

  const aliases = new Map(
    Object.entries(historicalCodeMap)
      .map(([from, to]) => [normaliseCourseCode(from), normaliseCourseCode(to)])
      .filter(([from, to]) => from && to),
  )

  for (const record of records || []) {
    const historicalCode = codeFrom(record)
    if (!historicalCode) continue

    if (!direct.has(historicalCode)) direct.set(historicalCode, [])
    direct.get(historicalCode).push(record)

    const canonicalCode = aliases.get(historicalCode)
    if (!canonicalCode) continue
    if (!mapped.has(canonicalCode)) mapped.set(canonicalCode, [])
    mapped.get(canonicalCode).push(record)
  }

  return { direct, mapped }
}

export function linkOfferingToHistory(offering, historicalIndex) {
  const offeringCode = codeFrom(offering)
  if (!offeringCode) {
    return {
      matchStatus: 'unmatched',
      matchMethod: null,
      historicalCodes: [],
      records: [],
      courseHistoryRecords: [],
      reviewCandidates: [],
    }
  }

  const directRecords = historicalIndex?.direct?.get(offeringCode) || []
  const aliasRecords = historicalIndex?.mapped?.get(offeringCode) || []
  const courseHistoryRecords = directRecords.length ? directRecords : aliasRecords
  const sourceMethod = directRecords.length
    ? 'exact_code'
    : aliasRecords.length
      ? 'approved_alias'
      : null
  const teachingRecords = courseHistoryRecords.filter((record) =>
    hasSharedInstructor(offering, record),
  )
  const historicalCodes = [...new Set(courseHistoryRecords.map(codeFrom).filter(Boolean))].sort()

  if (teachingRecords.length) {
    return {
      matchStatus: 'verified',
      matchMethod: `${sourceMethod}_same_professor`,
      historicalCodes,
      records: teachingRecords,
      courseHistoryRecords,
      reviewCandidates: [],
    }
  }

  if (courseHistoryRecords.length) {
    return {
      matchStatus: 'course_only',
      matchMethod: `${sourceMethod}_${instructorKeys(offering).length ? 'other_professor' : 'professor_unavailable'}`,
      historicalCodes,
      records: [],
      courseHistoryRecords,
      reviewCandidates: [],
    }
  }

  const sectionBase = probableSectionBase(offeringCode)
  const candidateRecords = sectionBase ? historicalIndex?.direct?.get(sectionBase) || [] : []
  const sameProfessorCandidates = candidateRecords.filter((record) =>
    hasSharedInstructor(offering, record),
  )
  if (sameProfessorCandidates.length) {
    return {
      matchStatus: 'needs_review',
      matchMethod: 'suspected_section_split',
      historicalCodes: [...new Set(sameProfessorCandidates.map(codeFrom).filter(Boolean))].sort(),
      records: [],
      courseHistoryRecords: [],
      reviewCandidates: sameProfessorCandidates,
    }
  }

  return {
    matchStatus: 'unmatched',
    matchMethod: null,
    historicalCodes: [],
    records: [],
    courseHistoryRecords: [],
    reviewCandidates: [],
  }
}
