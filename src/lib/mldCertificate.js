import { getCourseCode, getExplicitCourseCredits } from './courseCredits.js'

export const MLD_CERTIFICATE_REQUIRED_CREDITS = 12
export const MLD_CERTIFICATE_MAX_NON_HKS_CREDITS = 4
export const MLD_CERTIFICATE_COURSE_LIST_UPDATED = 'July 24, 2026'
export const MLD_CERTIFICATE_PASSING_GRADES = new Set(['A+', 'A', 'A-', 'B+'])

export const MLD_CERTIFICATE_SOURCES = Object.freeze([
  {
    label: 'HKS Hub',
    url: 'https://hub.hks.harvard.edu/article/Certificate-in-Management-Leadership-and-Decision-Sciences',
  },
  {
    label: 'HKS overview',
    url: 'https://www.hks.harvard.edu/educational-programs/masters-programs/master-public-policy/management-leadership-decision-sciences',
  },
  {
    label: 'Requirements',
    url: 'https://hksmldarea.com/certificate/',
  },
  {
    label: 'Eligible HKS courses',
    url: 'https://hksmldarea.com/certificate/elective-courses-in-mld/',
  },
  {
    label: 'Non-HKS course approval',
    url: 'https://hksmldarea.com/non-hks-courses/',
  },
  {
    label: 'Training statement',
    url: 'https://hksmldarea.com/guidance-on-statement-of-mld-coursework/',
  },
  {
    label: 'FAQ',
    url: 'https://hksmldarea.com/faqs/',
  },
])

const ELIGIBLE_COURSES_BY_AREA = Object.freeze({
  Leadership: [
    'MLD-201',
    'MLD-201-A',
    'MLD-201-B',
    'MLD-201-C',
    'MLD-202',
    'MLD-215',
    'MLD-250',
    'MLD-326',
    'MLD-355',
    'MLD-360M',
    'MLD-617M',
    'DPI-202',
    'DPI-208',
    'DPI-115',
    'IGA-125',
  ],
  'Negotiation & Decision Sciences': [
    'MLD-304',
    'MLD-308',
    'API-222',
    'API-302',
    'API-303',
    'API-305',
    'API-318',
    'MLD-215',
    'MLD-223',
    'MLD-234M',
    'MLD-257M',
    'MLD-280',
    'MLD-290M',
    'IGA-109',
    'IGA-353M',
    'IGA-455',
  ],
  'Organizing for Social Change': [
    'MLD-638M',
    'DEV-320M',
    'DPI-660',
    'DPI-662M',
    'MLD-340M',
    'MLD-371',
    'MLD-375',
    'MLD-377',
    'DPI-351M',
    'DPI-535',
    'DPI-376',
    'IGA-453',
    'MLD-802',
    'MLD-820M',
    'MLD-830',
    'MLD-831',
    'MLD-836M',
    'BGP-235M',
  ],
  'Strategic Management': [
    'MLD-102',
    'MLD-103M',
    'MLD-125',
    'MLD-321M',
    'MLD-381',
    'MLD-630M',
    'MLD-634M',
    'MLD-802',
    'MLD-820M',
    'MLD-401M',
    'MLD-411M',
    'MLD-412',
    'MLD-427',
    'API-141',
    'API-148',
    'DEV-209',
    'DEV-210',
    'MLD-502',
    'MLD-515M',
    'MLD-601',
    'MLD-605',
    'DPI-678M',
  ],
})

export const MLD_CERTIFICATE_FOCUS_AREAS = Object.freeze(Object.keys(ELIGIBLE_COURSES_BY_AREA))

function normalizeCourseCode(value) {
  return String(value || '')
    .trim()
    .toUpperCase()
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, '')
    .replace(/(\d)M$/, '$1-M')
}

const ELIGIBLE_COURSE_AREAS = new Map()
for (const [area, codes] of Object.entries(ELIGIBLE_COURSES_BY_AREA)) {
  for (const code of codes) {
    const normalized = normalizeCourseCode(code)
    if (!ELIGIBLE_COURSE_AREAS.has(normalized)) ELIGIBLE_COURSE_AREAS.set(normalized, [])
    ELIGIBLE_COURSE_AREAS.get(normalized).push(area)
  }
}

function getEligibleCourseMatch(course) {
  const normalized = normalizeCourseCode(getCourseCode(course))
  if (ELIGIBLE_COURSE_AREAS.has(normalized)) return normalized
  return [...ELIGIBLE_COURSE_AREAS.keys()].find((code) => normalized.startsWith(`${code}-`)) || null
}

export function getMldCertificateEligibility(course, programId) {
  const matchedCode = getEligibleCourseMatch(course)
  if (!matchedCode) return null

  // MLD-102 is a required course for MPA/ID students and therefore is only
  // certificate-eligible when taken as an elective by another program.
  if (matchedCode === normalizeCourseCode('MLD-102') && programId === 'MPA_ID') return null

  return {
    code: matchedCode,
    displayCode: getCourseCode(course),
    areas: ELIGIBLE_COURSE_AREAS.get(matchedCode),
    credits: getExplicitCourseCredits(course),
  }
}

export function isPassingMldCertificateGrade(grade) {
  return MLD_CERTIFICATE_PASSING_GRADES.has(
    String(grade || '')
      .trim()
      .toUpperCase(),
  )
}

export function computeMldCertificateProgress(
  scheduledCourses = [],
  completedCourses = [],
  programId = '',
) {
  const completedCodes = new Set()
  const completed = []
  const planned = []
  const missingCreditCodes = new Set()

  const ineligibleCompleted = []
  for (const course of Array.isArray(completedCourses) ? completedCourses : []) {
    const eligibility = getMldCertificateEligibility(course, programId)
    if (!eligibility || completedCodes.has(eligibility.code)) continue
    completedCodes.add(eligibility.code)
    if (eligibility.credits == null) missingCreditCodes.add(eligibility.code)
    if (!isPassingMldCertificateGrade(course?.grade)) {
      ineligibleCompleted.push({
        course,
        ...eligibility,
        grade: String(course?.grade || '')
          .trim()
          .toUpperCase(),
      })
      continue
    }
    completed.push({ course, ...eligibility, credits: eligibility.credits || 0 })
  }

  const plannedCodes = new Set()
  for (const course of Array.isArray(scheduledCourses) ? scheduledCourses : []) {
    const eligibility = getMldCertificateEligibility(course, programId)
    if (
      !eligibility ||
      completedCodes.has(eligibility.code) ||
      plannedCodes.has(eligibility.code)
    ) {
      continue
    }
    plannedCodes.add(eligibility.code)
    if (eligibility.credits == null) missingCreditCodes.add(eligibility.code)
    planned.push({ course, ...eligibility, credits: eligibility.credits || 0 })
  }

  const completedCredits = completed.reduce((sum, item) => sum + item.credits, 0)
  const plannedCredits = planned.reduce((sum, item) => sum + item.credits, 0)
  const totalCredits = completedCredits + plannedCredits

  return {
    requiredCredits: MLD_CERTIFICATE_REQUIRED_CREDITS,
    completedCredits,
    plannedCredits,
    totalCredits,
    remainingCredits: Math.max(0, MLD_CERTIFICATE_REQUIRED_CREDITS - totalCredits),
    percent: Math.min(100, Math.round((totalCredits / MLD_CERTIFICATE_REQUIRED_CREDITS) * 100)),
    completed,
    planned,
    ineligibleCompleted,
    missingCreditCodes: [...missingCreditCodes],
  }
}
