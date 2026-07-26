import { getBaseCourseKey } from './courseIdentity.js'
import { normalizeCourse } from './scheduleCourseNormalization.js'

/**
 * Pure ownership boundary for the persisted plan and completed-course lists.
 *
 * The Schedule Builder owns interaction feedback and persistence; this module
 * owns only immutable collection transitions. Keeping those transitions here
 * makes duplicate handling and course-code normalization testable without
 * rendering the planner or touching browser storage.
 */
function coursesFromPlan(plan) {
  return Array.isArray(plan?.courses) ? plan.courses : []
}

function hasCourseCode(courses, courseCode) {
  const baseKey = getBaseCourseKey(courseCode)
  return courses.some((course) => getBaseCourseKey(course) === baseKey)
}

/** Adds a normalized course unless the plan already has the same course code. */
export function addCourseToPlan(plan, course, planName) {
  const normalized = normalizeCourse(course)
  const courses = coursesFromPlan(plan)
  if (hasCourseCode(courses, normalized.courseCode)) return plan
  return { ...plan, name: planName, courses: [...courses, { ...normalized, isOnGrid: false }] }
}

/** Removes every persisted variant that normalizes to the selected course code. */
export function removeCourseFromPlan(plan, courseCode, planName) {
  const baseKey = getBaseCourseKey(courseCode)
  return {
    ...plan,
    name: planName,
    courses: coursesFromPlan(plan).filter((course) => getBaseCourseKey(course) !== baseKey),
  }
}

/** Removes planned copies of courses already recorded as completed. */
export function removeCompletedCoursesFromPlan(plan, completedCourses, planName) {
  const completedKeys = new Set((completedCourses || []).map(getBaseCourseKey).filter(Boolean))
  const courses = coursesFromPlan(plan)
  const nextCourses = courses.filter((course) => !completedKeys.has(getBaseCourseKey(course)))
  return nextCourses.length === courses.length
    ? plan
    : { ...plan, name: planName, courses: nextCourses }
}

/** Adds a completed course once, preserving the existing list reference on a duplicate. */
export function addCompletedCourse(completedCourses, course) {
  const normalized = normalizeCourse(course)
  const courses = Array.isArray(completedCourses) ? completedCourses : []
  if (hasCourseCode(courses, normalized.courseCode)) return completedCourses
  return [...courses, { ...normalized, _isCompleted: true }]
}

/** Updates every persisted variant of one completed base course. */
export function updateCompletedCourse(completedCourses, courseCode, changes) {
  const baseKey = getBaseCourseKey(courseCode)
  return (Array.isArray(completedCourses) ? completedCourses : []).map((course) =>
    getBaseCourseKey(course) === baseKey ? { ...course, ...changes } : course,
  )
}

/** Removes every completed-course variant that normalizes to the selected code. */
export function removeCompletedCourse(completedCourses, courseCode) {
  const courses = Array.isArray(completedCourses) ? completedCourses : []
  const baseKey = getBaseCourseKey(courseCode)
  return courses.filter((course) => getBaseCourseKey(course) !== baseKey)
}
