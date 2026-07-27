import { getBaseCourseCode } from './courseIdentity.js'

function normalizeCourseCode(value) {
  return String(value || '')
    .trim()
    .toUpperCase()
}

function getOfferingParts(course) {
  const rawTerm = String(course?.term || course?.semester || '').trim()
  const rawSession = String(
    course?.sessionDescription || course?.session_description || course?.session || rawTerm,
  ).trim()
  const combined = `${rawTerm} ${rawSession}`.toUpperCase()
  const explicitYear = Number(course?.year)
  const parsedYear = Number(combined.match(/\b(20\d{2})\b/)?.[1])
  const year = Number.isFinite(explicitYear) && explicitYear > 0 ? explicitYear : parsedYear
  const season = combined.match(/\b(JANUARY|SPRING|SUMMER|FALL)\b/)?.[1] || ''
  const sessionNumber = combined.match(/\b(?:JANUARY|SPRING|SUMMER|FALL)\s*([12])\b/)?.[1] || ''

  return {
    year: Number.isFinite(year) ? year : null,
    season,
    session: season && sessionNumber ? `${season} ${sessionNumber}` : '',
  }
}
export function getCourseCode(course) {
  return getBaseCourseCode(course) || null
}

function getCourseCreditKeys(course) {
  const code = normalizeCourseCode(getCourseCode(course))
  if (!code) return []

  const { year, season, session } = getOfferingParts(course)
  const keys = []
  if (year && session) keys.push(`${code}|${year}|${session}`)
  if (year && season) keys.push(`${code}|${year}|${season}`)
  keys.push(code)
  return keys
}
export function getExplicitCourseCredits(course) {
  const rawCredits = course?.credits ?? course?.credits_min ?? course?.credits_max
  if (rawCredits == null || rawCredits === '') return null
  const credits = Number(rawCredits)
  return Number.isFinite(credits) ? credits : null
}

export function buildCourseCreditMap(rows = []) {
  const creditsByCode = new Map()
  const ambiguousKeys = new Set()

  for (const row of Array.isArray(rows) ? rows : []) {
    const credits = getExplicitCourseCredits(row)
    if (credits == null) continue
    for (const key of getCourseCreditKeys(row)) {
      if (ambiguousKeys.has(key)) continue
      if (!creditsByCode.has(key)) {
        creditsByCode.set(key, credits)
      } else if (creditsByCode.get(key) !== credits) {
        creditsByCode.delete(key)
        ambiguousKeys.add(key)
      }
    }
  }

  return creditsByCode
}

export function resolveCourseCredits(course, creditsByCode = new Map()) {
  if (creditsByCode instanceof Map) {
    for (const key of getCourseCreditKeys(course)) {
      if (!creditsByCode.has(key)) continue
      const credits = Number(creditsByCode.get(key))
      if (Number.isFinite(credits)) return credits
    }
  }
  return getExplicitCourseCredits(course)
}

export function applyCourseCreditMap(courses, creditsByCode) {
  if (!Array.isArray(courses) || !(creditsByCode instanceof Map) || creditsByCode.size === 0) {
    return courses
  }

  let changed = false
  const nextCourses = courses.map((course) => {
    const credits = resolveCourseCredits(course, creditsByCode)
    if (credits == null || getExplicitCourseCredits(course) === credits) return course
    changed = true
    return { ...course, credits }
  })

  return changed ? nextCourses : courses
}

export function withResolvedCourseCredits(course, creditsByCode) {
  const credits = resolveCourseCredits(course, creditsByCode)
  return credits == null || getExplicitCourseCredits(course) === credits
    ? course
    : { ...course, credits }
}
