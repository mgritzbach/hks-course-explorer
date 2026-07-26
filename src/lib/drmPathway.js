import drmDeniedCourses from '../data/drmDeniedCourses.json'
import drmQualifyingCourses from '../data/drmQualifyingCourses.json'
import programRequirements from '../data/programRequirements.json'

export const DRM_ARTICLE_URL =
  'https://hub.hks.harvard.edu/article/Data-and-Research-Methods-Pathway'
export const DRM_WORKBOOK_URL =
  'https://hu.sharepoint.com/:x:/s/HKSRO16/EdmEmIUW0fZDvGy7-3slNZsBhevdygZbRSUurk_OGHwRzA'
export const DRM_PETITION_FORM_URL =
  'https://hub.hks.harvard.edu/s/contentdocument/069Pp00000HrQKNIA3'

export const DRM_ELIGIBLE_PROGRAMS = new Set(['MPP_Y1', 'MPP_Y2', 'MPA_2YR', 'MC_MPA'])
export const DRM_PASSING_GRADES = new Set(['A+', 'A', 'A-', 'B+', 'B', 'B-'])
export const DRM_GRADE_OPTIONS = [
  '',
  'A+',
  'A',
  'A-',
  'B+',
  'B',
  'B-',
  'C+',
  'C',
  'C-',
  'D+',
  'D',
  'D-',
  'F',
]

const PAC_PREFIXES = new Set(['BGP', 'DPI', 'IGA', 'DEV', 'SUP'])

export function normalizeDrmCourseCode(value) {
  return String(value || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
}

function parseOfficialCourseNumber(rawCourseNumber, group) {
  const raw = String(rawCourseNumber || '').trim()
  const sectionText = raw.match(/sections?\s+(.+)$/i)?.[1] || ''
  const sections = sectionText.match(/\b[A-Z]\b/g) || []
  const codePart = raw.split('*')[0].replace(/\+/g, '').trim()
  const aliases = codePart.split('/').map(normalizeDrmCourseCode).filter(Boolean)

  return {
    raw,
    group,
    aliases,
    sections,
  }
}

const OFFICIAL_YEARS = Object.fromEntries(
  Object.entries(drmQualifyingCourses)
    .filter(([key]) => key.startsWith('AY'))
    .map(([key, value]) => [
      key,
      {
        ...value,
        entries: value.courses.map(([group, courseNumber]) =>
          parseOfficialCourseNumber(courseNumber, group),
        ),
      },
    ]),
)

const OFFICIAL_CODES = new Set(
  Object.values(OFFICIAL_YEARS).flatMap((year) => year.entries.flatMap((entry) => entry.aliases)),
)

const DENIED_CODES = new Set(
  [...drmDeniedCourses.hks, ...drmDeniedCourses.nonHks].map(normalizeDrmCourseCode),
)

function getCourseCode(course) {
  return (
    course?.course_code_base ||
    course?.course_code ||
    course?.courseCodeBase ||
    course?.courseCode ||
    course?.code ||
    ''
  )
}

function getCourseSection(course, normalizedCode = normalizeDrmCourseCode(getCourseCode(course))) {
  const directSection =
    course?.drmSection ||
    course?.sectionCode ||
    course?.section_code ||
    course?.selectedSectionCode ||
    ''
  const direct = String(directSection)
    .trim()
    .toUpperCase()
    .match(/\b([A-Z])\b/)?.[1]
  if (direct) return direct

  const sections = Array.isArray(course?.sections) ? course.sections : []
  const selectedSection =
    sections.find((section) => section?.id === course?.selectedSectionId) ||
    (sections.length === 1 ? sections[0] : null)
  const selectedValue =
    selectedSection?.sectionCode ||
    selectedSection?.section_code ||
    selectedSection?.code ||
    selectedSection?.name ||
    ''
  const selected = String(selectedValue)
    .trim()
    .toUpperCase()
    .match(/\b([A-Z])\b/)?.[1]
  if (selected) return selected

  if (normalizedCode.startsWith('API203M')) {
    const suffix = normalizedCode.slice('API203M'.length)
    if (/^[A-Z]$/.test(suffix)) return suffix
  }
  return ''
}

function parseAcademicYearEnd(value) {
  if (value == null || value === '') return null
  const raw = String(value).trim().toUpperCase()
  const ayMatch = raw.match(/^AY\s*(\d{2}|\d{4})$/)
  if (ayMatch) {
    const year = Number(ayMatch[1])
    return year < 100 ? 2000 + year : year
  }
  const range = raw.match(/\b(20\d{2})\D+(20\d{2})\b/)
  if (range) return Number(range[2])
  const single = Number(raw.match(/\b20\d{2}\b/)?.[0])
  return Number.isFinite(single) ? single : null
}

export function getDrmAcademicYearEnd(course) {
  const explicit =
    parseAcademicYearEnd(course?.drmAcademicYear) ??
    parseAcademicYearEnd(course?.academicYear) ??
    parseAcademicYearEnd(course?.academic_year)
  if (explicit) return explicit

  const year = Number(course?.year)
  if (!Number.isFinite(year) || year <= 0) return null
  const term = String(course?.term || course?.semester || course?.sessionDescription || '')
    .trim()
    .toUpperCase()
  return term.includes('FALL') || term.includes('AUTUMN') ? year + 1 : year
}

export function getDrmAcademicYearKey(course) {
  const endYear = getDrmAcademicYearEnd(course)
  return endYear ? `AY${String(endYear).slice(-2)}` : null
}

export function getDrmCourseKey(course) {
  const code = normalizeDrmCourseCode(getCourseCode(course)) || 'UNKNOWN'
  const year = Number(course?.year) || ''
  const term = String(course?.term || course?.semester || '')
    .trim()
    .toUpperCase()
  const section = getCourseSection(course, code)
  return `${code}|${year}|${term}|${section}`
}

function isKnownOfficialCode(course) {
  const normalizedCode = normalizeDrmCourseCode(getCourseCode(course))
  if (OFFICIAL_CODES.has(normalizedCode)) return true
  return [...OFFICIAL_CODES].some(
    (code) => normalizedCode.startsWith(code) && normalizedCode.length === code.length + 1,
  )
}

function findOfficialEntry(course) {
  const normalizedCode = normalizeDrmCourseCode(getCourseCode(course))
  const deniedByCurrentArticle = DENIED_CODES.has(normalizedCode)
  const academicYear = getDrmAcademicYearKey(course)
  if (!academicYear || !OFFICIAL_YEARS[academicYear]) {
    return {
      status: deniedByCurrentArticle
        ? 'denied'
        : academicYear
          ? 'unsupported-year'
          : 'year-required',
      academicYear,
      group: null,
      officialEntry: null,
    }
  }

  const section = getCourseSection(course, normalizedCode)
  const matches = OFFICIAL_YEARS[academicYear].entries.filter((entry) =>
    entry.aliases.some((alias) => {
      if (normalizedCode === alias) return true
      if (!entry.sections.length || !normalizedCode.startsWith(alias)) return false
      const suffix = normalizedCode.slice(alias.length)
      return suffix.length === 1 && /^[A-Z]$/.test(suffix)
    }),
  )

  if (!matches.length) {
    return {
      status: deniedByCurrentArticle ? 'denied' : 'not-listed',
      academicYear,
      group: null,
      officialEntry: null,
    }
  }

  const sectionSpecific = matches.filter((entry) => entry.sections.length > 0)
  if (sectionSpecific.length > 0) {
    if (!section) {
      return {
        status: 'section-required',
        academicYear,
        group: null,
        officialEntry: null,
      }
    }
    const matchingSection = sectionSpecific.find((entry) => entry.sections.includes(section))
    if (!matchingSection) {
      return {
        status: 'section-not-listed',
        academicYear,
        group: null,
        officialEntry: null,
      }
    }
    return {
      status: 'qualifying',
      academicYear,
      group: matchingSection.group,
      officialEntry: matchingSection,
    }
  }

  return {
    status: 'qualifying',
    academicYear,
    group: matches[0].group,
    officialEntry: matches[0],
  }
}

export function getDrmEligibility(course) {
  return findOfficialEntry(course)
}

export function isPassingDrmGrade(grade) {
  return DRM_PASSING_GRADES.has(
    String(grade || '')
      .trim()
      .toUpperCase(),
  )
}

function getGradeStatus(course, source) {
  if (source === 'scheduled') return 'planned'
  const grade = String(course?.grade || '')
    .trim()
    .toUpperCase()
  if (!grade) return 'missing'
  return isPassingDrmGrade(grade) ? 'passing' : 'below-minimum'
}

function getExplicitCredits(course) {
  const raw = course?.credits ?? course?.credits_min ?? course?.credits_max
  if (raw == null || raw === '') return null
  const credits = Number(raw)
  return Number.isFinite(credits) && credits > 0 ? credits : null
}

function courseMatchesCodes(course, courseCodes = []) {
  const normalized = normalizeDrmCourseCode(getCourseCode(course))
  return courseCodes.some((code) => {
    const allowed = normalizeDrmCourseCode(code)
    return (
      normalized === allowed || normalized.startsWith(allowed) || allowed.startsWith(normalized)
    )
  })
}

function pacPrefix(course) {
  const raw = String(getCourseCode(course)).toUpperCase()
  const prefix = raw.split(/[-\s]/)[0]
  return PAC_PREFIXES.has(prefix) ? prefix : null
}

function classifyOverlap(programId, course, preferredPacArea) {
  if (programId === 'MPP_Y1' || programId === 'MPP_Y2') {
    const coreCategories = programRequirements.MPP_Y1.categories.filter((category) =>
      category.id.startsWith('core_'),
    )
    const matchingCoreIds = coreCategories
      .filter((category) => courseMatchesCodes(course, category.courseCodes))
      .map((category) => category.id)
    if (matchingCoreIds.length) {
      return {
        bucket: 'mpp-core',
        label: 'MPP core',
        cap: 4,
        categoryIds: matchingCoreIds,
      }
    }

    const prefix = pacPrefix(course)
    if (preferredPacArea && prefix === preferredPacArea) {
      return {
        bucket: 'mpp-pac',
        label: `declared ${preferredPacArea} PAC`,
        cap: 4,
        categoryIds: ['pac'],
      }
    }
    return null
  }

  if (programId === 'MPA_2YR' || programId === 'MC_MPA') {
    const categories = programRequirements[programId]?.categories || []
    const distributionIds = categories
      .filter((category) => category.id.startsWith('dist_'))
      .filter((category) => courseMatchesCodes(course, category.courseCodes))
      .map((category) => category.id)
    const prefix = pacPrefix(course)
    const alsoMatchesDeclaredPac =
      programId === 'MPA_2YR' && preferredPacArea && prefix === preferredPacArea
    if (distributionIds.length) {
      return {
        bucket: 'mpa-distribution',
        label: 'MPA/MC-MPA distribution',
        cap: 4,
        categoryIds: alsoMatchesDeclaredPac ? [...distributionIds, 'pac'] : distributionIds,
      }
    }

    if (programId === 'MPA_2YR' && preferredPacArea && prefix === preferredPacArea) {
      return {
        bucket: 'mpa-other-requirement',
        label: `${preferredPacArea} PAC`,
        cap: 0,
        categoryIds: ['pac'],
      }
    }
  }

  return null
}

function buildCourseRecords(scheduledCourses, completedCourses) {
  const byOffering = new Map()
  const add = (course, source, sourceIndex) => {
    const key = getDrmCourseKey(course)
    const record = {
      key,
      source,
      sourceIndex,
      course,
      code: getCourseCode(course) || 'Unknown course',
      credits: getExplicitCredits(course),
      section: getCourseSection(course),
      ...findOfficialEntry(course),
    }
    const previous = byOffering.get(key)
    if (!previous || source === 'completed') byOffering.set(key, record)
  }

  ;(Array.isArray(scheduledCourses) ? scheduledCourses : []).forEach((course, index) =>
    add(course, 'scheduled', index),
  )
  ;(Array.isArray(completedCourses) ? completedCourses : []).forEach((course, index) =>
    add(course, 'completed', index),
  )
  return [...byOffering.values()]
}

export function computeDrmProgress(
  programId,
  scheduledCourses = [],
  completedCourses = [],
  options = {},
) {
  if (!DRM_ELIGIBLE_PROGRAMS.has(programId)) {
    return {
      eligibleProgram: false,
      programId,
      officialArticleUpdated: drmQualifyingCourses._meta.articleUpdated,
    }
  }

  const assignments = options.assignments || {}
  const preferredPacArea = options.preferredPacArea || null
  const allRecords = buildCourseRecords(scheduledCourses, completedCourses)
  const relevantRecords = allRecords.filter(
    (record) =>
      record.status === 'qualifying' ||
      record.status === 'denied' ||
      DENIED_CODES.has(normalizeDrmCourseCode(getCourseCode(record.course))) ||
      isKnownOfficialCode(record.course) ||
      Boolean(record.course?.is_stem ?? record.course?.enrichment?.is_stem),
  )
  const qualifying = relevantRecords
    .filter((record) => record.status === 'qualifying')
    .map((record) => ({
      ...record,
      gradeStatus: getGradeStatus(record.course, record.source),
      overlap: classifyOverlap(programId, record.course, preferredPacArea),
      requestedAllocation: assignments[record.key] || 'auto',
    }))
    .sort((left, right) => {
      const priority = { passing: 0, missing: 1, planned: 2, 'below-minimum': 3 }
      return (
        priority[left.gradeStatus] - priority[right.gradeStatus] ||
        left.sourceIndex - right.sourceIndex
      )
    })

  const bucketUsage = new Map()
  const courses = qualifying.map((record) => {
    const countableGrade = record.gradeStatus !== 'below-minimum'
    let allocation = 'drm-only'
    let decisionRequired = false

    if (!countableGrade || record.requestedAllocation === 'degree') {
      allocation = 'degree-only'
    } else if (record.overlap && record.requestedAllocation === 'auto') {
      const used = bucketUsage.get(record.overlap.bucket) || 0
      if (
        record.credits != null &&
        record.overlap.cap > 0 &&
        used + record.credits <= record.overlap.cap
      ) {
        allocation = 'overlap'
        bucketUsage.set(record.overlap.bucket, used + record.credits)
      } else {
        allocation = 'degree-only'
        decisionRequired = true
      }
    }

    const countsTowardDrm = allocation !== 'degree-only' && countableGrade && record.credits != null
    return {
      ...record,
      allocation,
      decisionRequired,
      countsTowardDrm,
    }
  })

  const categoryExclusions = {}
  const degreeCategoryIds = (programRequirements[programId]?.categories || []).map(
    (category) => category.id,
  )
  courses
    .filter((record) => record.allocation === 'drm-only' && record.countsTowardDrm)
    .forEach((record) => {
      degreeCategoryIds.forEach((categoryId) => {
        if (!categoryExclusions[categoryId]) categoryExclusions[categoryId] = []
        categoryExclusions[categoryId].push(record.key)
      })
    })

  const totalsFor = (predicate) =>
    courses
      .filter((course) => course.countsTowardDrm && predicate(course))
      .reduce((sum, course) => sum + course.credits, 0)

  const verifiedCredits = totalsFor(
    (course) => course.source === 'completed' && course.gradeStatus === 'passing',
  )
  const pendingGradeCredits = totalsFor(
    (course) => course.source === 'completed' && course.gradeStatus === 'missing',
  )
  const plannedCredits = totalsFor((course) => course.source === 'scheduled')
  const projectedCredits = verifiedCredits + pendingGradeCredits + plannedCredits
  const verifiedGroupA = totalsFor(
    (course) =>
      course.group === 'A' && course.source === 'completed' && course.gradeStatus === 'passing',
  )
  const verifiedGroupB = totalsFor(
    (course) =>
      course.group === 'B' && course.source === 'completed' && course.gradeStatus === 'passing',
  )
  const projectedGroupA = totalsFor((course) => course.group === 'A')
  const projectedGroupB = totalsFor((course) => course.group === 'B')

  return {
    eligibleProgram: true,
    programId,
    requiredCredits: 16,
    requiredGroupACredits: 4,
    requiredGroupBCredits: 4,
    minimumGrade: 'B-',
    courses,
    reviewCourses: relevantRecords.filter((record) => record.status !== 'qualifying'),
    verifiedCredits,
    pendingGradeCredits,
    plannedCredits,
    projectedCredits,
    verifiedGroupA,
    verifiedGroupB,
    projectedGroupA,
    projectedGroupB,
    courseRequirementsVerified: verifiedCredits >= 16 && verifiedGroupA >= 4 && verifiedGroupB >= 4,
    courseRequirementsProjected:
      projectedCredits >= 16 && projectedGroupA >= 4 && projectedGroupB >= 4,
    categoryExclusions,
    bucketUsage: Object.fromEntries(bucketUsage),
    availableAcademicYears: Object.keys(OFFICIAL_YEARS),
    source: drmQualifyingCourses._meta,
  }
}

export function getDrmCategoryExclusions(drmProgress) {
  return drmProgress?.eligibleProgram ? drmProgress.categoryExclusions : {}
}
