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
  return courses.some((course) => normalizeCourse(course).courseCode === courseCode)
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
  return {
    ...plan,
    name: planName,
    courses: coursesFromPlan(plan).filter(
      (course) => normalizeCourse(course).courseCode !== courseCode,
    ),
  }
}

/** Adds a completed course once, preserving the existing list reference on a duplicate. */
export function addCompletedCourse(completedCourses, course) {
  const normalized = normalizeCourse(course)
  const courses = Array.isArray(completedCourses) ? completedCourses : []
  if (hasCourseCode(courses, normalized.courseCode)) return completedCourses
  return [...courses, { ...normalized, _isCompleted: true }]
}

/** Removes every completed-course variant that normalizes to the selected code. */
export function removeCompletedCourse(completedCourses, courseCode) {
  const courses = Array.isArray(completedCourses) ? completedCourses : []
  return courses.filter((course) => normalizeCourse(course).courseCode !== courseCode)
}
