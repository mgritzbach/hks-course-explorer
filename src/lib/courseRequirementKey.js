import { getBaseCourseCode, getCourseSectionLetter } from './courseIdentity.js'

export function normalizeRequirementCourseCode(value) {
  return String(value || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
}

export function getCourseRequirementKey(course) {
  const code = normalizeRequirementCourseCode(getBaseCourseCode(course)) || 'UNKNOWN'
  const year = Number(course?.year) || ''
  const term = String(course?.term || course?.semester || '')
    .trim()
    .toUpperCase()
  const section = String(
    course?.drmSection ||
      course?.sectionCode ||
      course?.section_code ||
      course?.selectedSectionCode ||
      getCourseSectionLetter(course) ||
      '',
  )
    .trim()
    .toUpperCase()

  return `${code}|${year}|${term}|${section}`
}
