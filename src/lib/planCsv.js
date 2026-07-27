import { PLANS } from './scheduleStorage.js'
import { addCourseToPlan } from './schedulePlanMutations.js'

export const PLAN_CSV_COLUMNS = [
  'plan',
  'course_code',
  'title',
  'credits',
  'year',
  'term',
  'grade',
  'selected_section_id',
  'is_on_grid',
  'course_json',
]

function csvCell(value) {
  const text = String(value ?? '')
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

function parseCsvRows(text) {
  const rows = []
  let row = []
  let cell = ''
  let quoted = false

  for (let index = 0; index < String(text || '').length; index += 1) {
    const character = text[index]
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        cell += '"'
        index += 1
      } else if (character === '"') {
        quoted = false
      } else {
        cell += character
      }
    } else if (character === '"') {
      quoted = true
    } else if (character === ',') {
      row.push(cell)
      cell = ''
    } else if (character === '\n') {
      row.push(cell.replace(/\r$/, ''))
      rows.push(row)
      row = []
      cell = ''
    } else {
      cell += character
    }
  }

  if (quoted) throw new Error('CSV contains an unclosed quoted field')
  if (cell || row.length) {
    row.push(cell.replace(/\r$/, ''))
    rows.push(row)
  }
  return rows.filter((candidate) => candidate.some((value) => value.trim()))
}

function courseCode(course) {
  return course?.courseCode || course?.course_code || course?.code || ''
}

/** Exports every selected plan course while retaining the complete course record. */
export function serializePlansCsv(plansByName) {
  const rows = [PLAN_CSV_COLUMNS]
  PLANS.forEach((planName) => {
    const plan = plansByName?.[planName]
    const courses = Array.isArray(plan?.courses) ? plan.courses : Array.isArray(plan) ? plan : []
    courses.forEach((course) => {
      rows.push([
        planName,
        courseCode(course),
        course.title || course.course_name || '',
        course.credits ?? course.credits_min ?? course.credits_max ?? '',
        course.year || course.academicYear || '',
        course.term || course.semester || course.session || '',
        course.grade || '',
        course.selectedSectionId || course.selected_section_id || '',
        course.isOnGrid ? 'true' : 'false',
        JSON.stringify(course),
      ])
    })
  })
  return `${rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`
}

function parseBoolean(value) {
  return ['true', '1', 'yes', 'y'].includes(
    String(value || '')
      .trim()
      .toLowerCase(),
  )
}

function parseCredits(value) {
  if (String(value ?? '').trim() === '') return undefined
  const credits = Number(value)
  if (!Number.isFinite(credits) || credits < 0) throw new Error(`Invalid credits value: ${value}`)
  return credits
}

/** Parses CSV rows into plan/course records. Rows can be edited without course_json. */
export function parsePlansCsv(text, fallbackPlan = PLANS[0]) {
  const rows = parseCsvRows(String(text || '').replace(/^\uFEFF/, ''))
  if (rows.length < 2) throw new Error('CSV has no course rows')

  const header = rows[0].map((value) => value.trim().toLowerCase())
  const column = (name) => header.indexOf(name)
  if (column('course_code') < 0) throw new Error('CSV is missing course_code')

  return rows.slice(1).map((row, rowIndex) => {
    const read = (name) => (column(name) >= 0 ? row[column(name)] || '' : '')
    const requestedPlan = read('plan').trim()
    const plan = PLANS.includes(requestedPlan) ? requestedPlan : fallbackPlan
    const code = read('course_code').trim().toUpperCase()
    if (!code) throw new Error(`CSV row ${rowIndex + 2} is missing course_code`)

    let metadata = {}
    if (read('course_json').trim()) {
      try {
        metadata = JSON.parse(read('course_json'))
      } catch {
        throw new Error(`CSV row ${rowIndex + 2} has invalid course_json`)
      }
    }

    const credits = parseCredits(read('credits'))
    const course = {
      ...metadata,
      courseCode: code,
      title: read('title').trim() || metadata.title || metadata.course_name || code,
      isOnGrid: parseBoolean(read('is_on_grid')),
    }
    if (credits !== undefined) course.credits = credits
    if (read('year').trim()) course.year = read('year').trim()
    if (read('term').trim()) course.term = read('term').trim()
    if (read('grade').trim()) course.grade = read('grade').trim()
    if (read('selected_section_id').trim()) {
      course.selectedSectionId = read('selected_section_id').trim()
    }

    return { plan, course }
  })
}

/** Merges imported rows without overwriting existing plans or adding course variants twice. */
export function mergePlanCsvRecords(plansByName, records) {
  const merged = Object.fromEntries(
    PLANS.map((planName) => [
      planName,
      plansByName?.[planName] || { name: planName, courses: [], updatedAt: null },
    ]),
  )

  records.forEach(({ plan, course }) => {
    const planName = PLANS.includes(plan) ? plan : PLANS[0]
    const current = merged[planName]
    const next = addCourseToPlan(current, course, planName)
    if (next === current || !course.isOnGrid) {
      merged[planName] = next
      return
    }
    merged[planName] = {
      ...next,
      courses: next.courses.map((candidate, index) =>
        index === next.courses.length - 1 ? { ...candidate, isOnGrid: true } : candidate,
      ),
    }
  })

  return merged
}
