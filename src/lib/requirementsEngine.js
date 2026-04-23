import programRequirements from '../data/programRequirements.json'

function normalizeCode(value) {
  return String(value || '')
    .toUpperCase()
    .replace(/[–—]/g, '-')
    .replace(/[^A-Z0-9-]/g, '')
}

function normalizeCourse(course, index) {
  const credits = Number(course?.credits ?? course?.credits_min ?? course?.credits_max ?? 4) || 4
  // Support both snake_case (Supabase rows) and camelCase (ScheduleBuilder plan objects)
  const courseCode = course?.course_code || course?.course_code_base || course?.courseCode || course?.code || course?.id || `course-${index}`

  return {
    ...course,
    _index: index,
    _credits: credits,
    _courseCode: courseCode,
    _courseCodeNormalized: normalizeCode(courseCode),
  }
}

function courseMatchesCategory(course, category) {
  const normalized = course._courseCodeNormalized

  if (Array.isArray(category.courseCodes) && category.courseCodes.length > 0) {
    const allowed = category.courseCodes.map(normalizeCode)
    if (allowed.some((code) => normalized === code || normalized.startsWith(code) || code.startsWith(normalized))) {
      return true
    }
  }

  if (category.matchPattern) {
    try {
      return new RegExp(category.matchPattern, 'i').test(course._courseCode)
    } catch {
      return false
    }
  }

  return false
}

function selectPacCourses(courses, category) {
  const groups = ['BGP', 'DPI', 'IGA', 'DEV', 'SUP']
  const buckets = new Map(groups.map((group) => [group, []]))

  for (const course of courses) {
    const prefix = course._courseCodeNormalized.split('-')[0]
    if (buckets.has(prefix) && courseMatchesCategory(course, category)) {
      buckets.get(prefix).push(course)
    }
  }

  let chosenPrefix = null
  let chosenCourses = []
  let bestCredits = 0  // Only pick a prefix if it has at least some credits

  for (const [prefix, items] of buckets.entries()) {
    const credits = items.reduce((sum, item) => sum + item._credits, 0)
    if (credits > bestCredits) {
      chosenPrefix = prefix
      chosenCourses = items
      bestCredits = credits
    }
  }

  return {
    chosenPrefix,
    courses: chosenCourses,
  }
}

function takeCreditsUntilRequired(courses, requiredCredits) {
  const selected = []
  let appliedCredits = 0

  for (const course of courses) {
    if (appliedCredits >= requiredCredits) break
    selected.push(course)
    appliedCredits += course._credits
  }

  return {
    selected,
    appliedCredits,
  }
}

export function getPrograms() {
  return Object.entries(programRequirements)
    .filter(([id]) => !id.startsWith('_'))   // exclude _meta, _notes etc.
    .map(([id, program]) => ({
      id,
      ...program,
    }))
}

export function computeProgress(programId, scheduledCourses = []) {
  const program = programRequirements[programId]
  if (!program) return null

  const normalizedCourses = scheduledCourses.map(normalizeCourse)
  const categories = [...(program.categories || [])].sort((left, right) => (left.displayOrder || 0) - (right.displayOrder || 0))
  const usedIndices = new Set()

  const computedCategories = categories.map((category) => {
    const available = normalizedCourses.filter((course) => !usedIndices.has(course._index))
    let matchedCourses = []
    let chosenArea = null

    if (category.id === 'pac') {
      const pacSelection = selectPacCourses(available, category)
      matchedCourses = pacSelection.courses
      chosenArea = pacSelection.chosenPrefix
    } else if (category.id === 'electives') {
      matchedCourses = available
    } else {
      matchedCourses = available.filter((course) => courseMatchesCategory(course, category))
    }

    const { selected, appliedCredits } = takeCreditsUntilRequired(matchedCourses, category.requiredCredits || 0)
    selected.forEach((course) => usedIndices.add(course._index))

    const creditsEarned = Math.min(appliedCredits, category.requiredCredits || appliedCredits)
    const requiredCredits = category.requiredCredits || 0

    return {
      ...category,
      matchedCourses,
      selectedCourses: selected,
      matchedCredits: matchedCourses.reduce((sum, course) => sum + course._credits, 0),
      appliedCredits: creditsEarned,
      remainingCredits: Math.max(0, requiredCredits - creditsEarned),
      percent: requiredCredits > 0 ? Math.min(100, Math.round((creditsEarned / requiredCredits) * 100)) : 100,
      isComplete: creditsEarned >= requiredCredits,
      chosenArea,
    }
  })

  const totalScheduledCredits = normalizedCourses.reduce((sum, course) => sum + course._credits, 0)
  const totalRequiredCredits = Number(program.totalCreditsRequired || 0)
  const overallAppliedCredits = Math.min(totalScheduledCredits, totalRequiredCredits)

  return {
    id: programId,
    ...program,
    totalScheduledCredits,
    totalRequiredCredits,
    overallAppliedCredits,
    overallPercent: totalRequiredCredits > 0 ? Math.min(100, Math.round((overallAppliedCredits / totalRequiredCredits) * 100)) : 100,
    categories: computedCategories,
  }
}

export function findCompletingCourses(programId, scheduledCourses = [], allCourses = [], categoryId = null) {
  const progress = computeProgress(programId, scheduledCourses)
  if (!progress) return []

  const scheduledCodes = new Set(scheduledCourses.map((course) => normalizeCode(course?.course_code || course?.course_code_base || course?.courseCode || course?.code)))
  const candidateCategories = categoryId
    ? progress.categories.filter((category) => category.id === categoryId)
    : progress.categories.filter((category) => !category.isComplete)

  const suggestions = []
  const seenCodes = new Set()

  for (const category of candidateCategories) {
    const pool = allCourses
      .map(normalizeCourse)
      .filter((course) => !scheduledCodes.has(course._courseCodeNormalized))
      .filter((course) => {
        if (category.id === 'pac' && category.chosenArea) {
          return course._courseCodeNormalized.startsWith(`${category.chosenArea}-`)
        }
        return courseMatchesCategory(course, category)
      })
      .sort((left, right) => (right.year || 0) - (left.year || 0))

    for (const course of pool) {
      if (seenCodes.has(course._courseCodeNormalized)) continue
      seenCodes.add(course._courseCodeNormalized)
      suggestions.push({
        categoryId: category.id,
        categoryLabel: category.label,
        course,
      })
      if (suggestions.length >= 12) return suggestions
    }
  }

  return suggestions
}
