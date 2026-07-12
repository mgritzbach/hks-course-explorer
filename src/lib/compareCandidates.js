/** Build one stable comparison option per course code, including current-only courses. */
export function buildComparisonCandidatePool(courses = []) {
  const byBase = new Map()
  for (const course of courses) {
    const key = course?.course_code_base || course?.course_code
    if (!key) continue
    if (!byBase.has(key)) byBase.set(key, [])
    byBase.get(key).push(course)
  }

  const result = []
  for (const group of byBase.values()) {
    const average = group.find((course) => course.is_average)
    if (average) {
      result.push(average)
      continue
    }
    result.push(
      group.reduce(
        (best, course) => (Number(course.year || 0) > Number(best.year || 0) ? course : best),
        group[0],
      ),
    )
  }
  return result.sort((a, b) => (a.course_name || '').localeCompare(b.course_name || ''))
}
