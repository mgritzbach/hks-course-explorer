import programRequirements from '../data/programRequirements.json'
import { getBaseCourseCode, getBaseCourseKey } from './courseIdentity.js'
import { getCourseRequirementKey } from './courseRequirementKey.js'

function normalizeCode(value) {
  return String(value || '')
    .toUpperCase()
    .replace(/[–—]/g, '-')
    .replace(/[^A-Z0-9-]/g, '')
}

function normalizeCourse(course, index) {
  const rawCredits = course?.credits ?? course?.credits_min ?? course?.credits_max
  const parsedCredits = rawCredits == null || rawCredits === '' ? 0 : Number(rawCredits)
  const grade = String(course?.grade || '').trim().toUpperCase()
  const credits =
    grade !== 'DRP' && Number.isFinite(parsedCredits) && parsedCredits > 0 ? parsedCredits : 0
  // Support both snake_case (Supabase rows) and camelCase (ScheduleBuilder plan objects)
  const courseCode = getBaseCourseCode(course) || `course-${index}`

  return {
    ...course,
    _index: index,
    _credits: credits,
    _grade: grade,
    _creditsMissing: credits === 0,
    _courseCode: courseCode,
    _courseCodeNormalized: normalizeCode(courseCode),
    _baseCourseKey: getBaseCourseKey(courseCode),
    _requirementKey: getCourseRequirementKey(course),
  }
}

function courseMatchesCategory(course, category) {
  const normalized = course._courseCodeNormalized

  if (Array.isArray(category.courseCodes) && category.courseCodes.length > 0) {
    const allowed = category.courseCodes.map(normalizeCode)
    if (
      allowed.some(
        (code) => normalized === code || normalized.startsWith(code) || code.startsWith(normalized),
      )
    ) {
      return true
    }
  }

  // matchProperty: check a boolean field on the course object.
  // Supports both top-level (is_stem) and enrichment-nested (enrichment.is_stem)
  // so it works for both Supabase-direct rows and ScheduleBuilder-normalised plan courses.
  if (category.matchProperty) {
    const val = course[category.matchProperty] ?? course.enrichment?.[category.matchProperty]
    if (val) return true
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

function buildComputedCategory(category, matchedCourses, selectedCourses, chosenArea = null) {
  const requiredCredits = Number(category.requiredCredits || 0)
  const selectedCredits = selectedCourses.reduce((sum, course) => sum + course._credits, 0)
  const appliedCredits = Math.min(selectedCredits, requiredCredits || selectedCredits)

  return {
    ...category,
    matchedCourses,
    selectedCourses,
    matchedCredits: matchedCourses.reduce((sum, course) => sum + course._credits, 0),
    appliedCredits,
    remainingCredits: Math.max(0, requiredCredits - appliedCredits),
    percent:
      requiredCredits > 0
        ? Math.min(100, Math.round((appliedCredits / requiredCredits) * 100))
        : 100,
    isComplete: appliedCredits >= requiredCredits,
    chosenArea,
  }
}

function allocationScore(candidate) {
  return [
    candidate.restrictedComplete,
    candidate.restrictedApplied,
    candidate.electiveComplete ? 1 : 0,
    candidate.totalApplied,
    -candidate.usedCredits,
  ]
}

function isBetterAllocation(candidate, current) {
  if (!current) return true
  const candidateScore = allocationScore(candidate)
  const currentScore = allocationScore(current)
  for (let index = 0; index < candidateScore.length; index += 1) {
    if (candidateScore[index] !== currentScore[index]) {
      return candidateScore[index] > currentScore[index]
    }
  }
  return false
}

function computeOptimalCategoryAllocation(courses, categories, options) {
  const exclusiveCategories = categories.filter((category) => !category.nonExclusive)
  const electiveCategory = exclusiveCategories.find((category) => category.id === 'electives')
  const restrictedCategories = exclusiveCategories.filter((category) => category.id !== 'electives')
  const coreCategories = restrictedCategories.filter((category) => category.id.startsWith('core_'))
  const pacCategory = restrictedCategories.find((category) => category.id === 'pac')
  const preferredPacArea = options.preferredPacArea || null
  const pacGroups = ['BGP', 'DPI', 'IGA', 'DEV', 'SUP']
  const pacChoices = pacCategory
    ? preferredPacArea
      ? [preferredPacArea]
      : pacGroups.filter((prefix) =>
          courses.some((course) => {
            const excluded = new Set(options.categoryExclusions?.pac || [])
            return (
              !excluded.has(course._requirementKey) &&
              course._courseCodeNormalized.startsWith(`${prefix}-`) &&
              courseMatchesCategory(course, pacCategory)
            )
          }),
        )
    : [null]
  if (pacChoices.length === 0) pacChoices.push(null)

  let bestAllocation = null

  for (const pacChoice of pacChoices) {
    const matchedByCategory = restrictedCategories.map((category) => {
      const excluded = new Set(options.categoryExclusions?.[category.id] || [])
      return courses.filter((course) => {
        if (excluded.has(course._requirementKey)) return false
        if (category.id === 'pac') {
          return (
            Boolean(pacChoice) &&
            course._courseCodeNormalized.startsWith(`${pacChoice}-`) &&
            courseMatchesCategory(course, category)
          )
        }
        return courseMatchesCategory(course, category)
      })
    })
    const matchedIndexSets = matchedByCategory.map(
      (matchedCourses) => new Set(matchedCourses.map((course) => course._index)),
    )
    const initialCredits = restrictedCategories.map(() => 0)
    let states = new Map([
      [
        initialCredits.join('|'),
        {
          credits: initialCredits,
          selected: restrictedCategories.map(() => []),
          usedCredits: 0,
        },
      ],
    ])

    for (const course of courses) {
      const nextStates = new Map(states)
      for (const state of states.values()) {
        restrictedCategories.forEach((category, categoryIndex) => {
          const requiredCredits = Number(category.requiredCredits || 0)
          if (
            course._credits <= 0 ||
            state.credits[categoryIndex] >= requiredCredits ||
            !matchedIndexSets[categoryIndex].has(course._index)
          ) {
            return
          }

          const credits = [...state.credits]
          credits[categoryIndex] = Math.min(
            requiredCredits,
            credits[categoryIndex] + course._credits,
          )
          const key = credits.join('|')
          const usedCredits = state.usedCredits + course._credits
          const existing = nextStates.get(key)
          if (existing && existing.usedCredits <= usedCredits) return

          const selected = state.selected.map((items, index) =>
            index === categoryIndex ? [...items, course] : items,
          )
          nextStates.set(key, { credits, selected, usedCredits })
        })
      }
      states = nextStates
    }

    for (const state of states.values()) {
      const electiveExcluded = new Set(options.categoryExclusions?.[electiveCategory?.id] || [])
      const electiveMatches = electiveCategory
        ? courses.filter(
            (course) =>
              !course.enrichment?.is_core &&
              !coreCategories.some((category) => courseMatchesCategory(course, category)) &&
              !electiveExcluded.has(course._requirementKey) &&
              courseMatchesCategory(course, electiveCategory),
          )
        : []
      const electiveSelection = takeCreditsUntilRequired(
        electiveMatches,
        Number(electiveCategory?.requiredCredits || 0),
      )
      const restrictedApplied = state.credits.reduce((sum, credits) => sum + credits, 0)
      const restrictedComplete = state.credits.filter(
        (credits, index) => credits >= Number(restrictedCategories[index].requiredCredits || 0),
      ).length
      const electiveApplied = electiveCategory
        ? Math.min(
            electiveSelection.appliedCredits,
            Number(electiveCategory.requiredCredits || electiveSelection.appliedCredits),
          )
        : 0
      const candidate = {
        pacChoice,
        matchedByCategory,
        state,
        electiveMatches,
        electiveSelected: electiveSelection.selected,
        restrictedApplied,
        restrictedComplete,
        electiveComplete:
          !electiveCategory || electiveApplied >= Number(electiveCategory.requiredCredits || 0),
        totalApplied: restrictedApplied + electiveApplied,
        usedCredits: state.usedCredits,
      }
      if (isBetterAllocation(candidate, bestAllocation)) bestAllocation = candidate
    }
  }

  const computedById = new Map()
  restrictedCategories.forEach((category, index) => {
    computedById.set(
      category.id,
      buildComputedCategory(
        category,
        bestAllocation?.matchedByCategory[index] || [],
        bestAllocation?.state.selected[index] || [],
        category.id === 'pac' ? bestAllocation?.pacChoice || null : null,
      ),
    )
  })
  if (electiveCategory) {
    computedById.set(
      electiveCategory.id,
      buildComputedCategory(
        electiveCategory,
        bestAllocation?.electiveMatches || [],
        bestAllocation?.electiveSelected || [],
      ),
    )
  }

  for (const category of categories.filter((item) => item.nonExclusive)) {
    const excluded = new Set(options.categoryExclusions?.[category.id] || [])
    const matchedCourses = courses.filter(
      (course) => !excluded.has(course._requirementKey) && courseMatchesCategory(course, category),
    )
    const selection = takeCreditsUntilRequired(
      matchedCourses,
      Number(category.requiredCredits || 0),
    )
    computedById.set(
      category.id,
      buildComputedCategory(category, matchedCourses, selection.selected),
    )
  }

  return categories.map((category) => computedById.get(category.id))
}

export function getPrograms() {
  return Object.entries(programRequirements)
    .filter(([id]) => !id.startsWith('_')) // exclude _meta, _notes etc.
    .map(([id, program]) => ({
      id,
      ...program,
    }))
}

export function computeProgress(
  programId,
  scheduledCourses = [],
  completedCourses = [],
  options = {},
) {
  const program = programRequirements[programId]
  if (!program) return null

  const normalizedScheduled = scheduledCourses.map(normalizeCourse)
  const normalizedCompleted = completedCourses.map((c, i) => ({
    ...normalizeCourse({ ...c, _isCompleted: true }, 100000 + i),
    _isCompleted: true,
  }))
  const coursesByBase = new Map()
  ;[...normalizedScheduled, ...normalizedCompleted].forEach((course) => {
    const key = course._baseCourseKey || `index-${course._index}`
    const previous = coursesByBase.get(key)
    if (!previous || course._isCompleted) coursesByBase.set(key, course)
  })
  const normalizedCourses = [...coursesByBase.values()]
  const categories = [...(program.categories || [])].sort(
    (left, right) => (left.displayOrder || 0) - (right.displayOrder || 0),
  )
  // nonExclusive categories don't consume slots — those courses remain available for other categories
  const computedCategories = computeOptimalCategoryAllocation(
    normalizedCourses,
    categories,
    options,
  )

  const stemCat = computedCategories.find((category) => category.id === 'stem')
  if (stemCat?.overlapCap != null) {
    const otherUsedIndices = new Set(
      computedCategories
        .filter((category) => category.id !== 'stem' && !category.nonExclusive)
        .flatMap((category) => category.selectedCourses.map((course) => course._index)),
    )
    const overlapCredits = stemCat.selectedCourses
      .filter((course) => otherUsedIndices.has(course._index))
      .reduce((sum, course) => sum + course._credits, 0)
    const cappedOverlap = Math.min(overlapCredits, stemCat.overlapCap || Infinity)

    stemCat.overlapCredits = overlapCredits
    stemCat.cappedOverlapCredits = cappedOverlap
    stemCat.overlapExceeded = overlapCredits > (stemCat.overlapCap || Infinity)
  }

  const totalScheduledCredits = normalizedCourses.reduce((sum, course) => sum + course._credits, 0)
  const totalRequiredCredits = Number(program.totalCreditsRequired || 0)
  const overallAppliedCredits = Math.min(totalScheduledCredits, totalRequiredCredits)

  return {
    id: programId,
    ...program,
    totalScheduledCredits,
    totalRequiredCredits,
    overallAppliedCredits,
    overallPercent:
      totalRequiredCredits > 0
        ? Math.min(100, Math.round((overallAppliedCredits / totalRequiredCredits) * 100))
        : 100,
    categories: computedCategories,
  }
}

export function findCompletingCourses(
  programId,
  scheduledCourses = [],
  allCourses = [],
  categoryId = null,
  options = {},
) {
  const progress = computeProgress(programId, scheduledCourses, [], options)
  if (!progress) return []

  const scheduledCodes = new Set(
    scheduledCourses.map((course) =>
      normalizeCode(
        course?.course_code || course?.course_code_base || course?.courseCode || course?.code,
      ),
    ),
  )
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
