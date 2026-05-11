const DAY_ALIASES = {
  m: 'M',
  mon: 'M',
  monday: 'M',
  t: 'T',
  tu: 'T',
  tue: 'T',
  tues: 'T',
  tuesday: 'T',
  w: 'W',
  wed: 'W',
  wednesday: 'W',
  th: 'R',
  thu: 'R',
  thur: 'R',
  thurs: 'R',
  thursday: 'R',
  r: 'R',
  f: 'F',
  fri: 'F',
  friday: 'F',
  sa: 'S',
  sat: 'S',
  saturday: 'S',
  su: 'U',
  sun: 'U',
  sunday: 'U',
}

function parseMeetingDays(value) {
  if (!value) return new Set()

  const compact = String(value).trim()
  if (!compact) return new Set()

  const pieces = compact
    .replace(/&/g, '/')
    .replace(/,/g, '/')
    .split(/[/\s]+/)
    .filter(Boolean)

  const normalized = new Set()

  for (const piece of pieces) {
    const lower = piece.toLowerCase()
    if (DAY_ALIASES[lower]) {
      normalized.add(DAY_ALIASES[lower])
      continue
    }

    const squashed = lower.replace(/[^a-z]/g, '')
    if (DAY_ALIASES[squashed]) {
      normalized.add(DAY_ALIASES[squashed])
      continue
    }

    let index = 0
    while (index < squashed.length) {
      const nextTwo = squashed.slice(index, index + 2)
      const nextThree = squashed.slice(index, index + 3)
      if (DAY_ALIASES[nextThree]) {
        normalized.add(DAY_ALIASES[nextThree])
        index += 3
      } else if (DAY_ALIASES[nextTwo]) {
        normalized.add(DAY_ALIASES[nextTwo])
        index += 2
      } else if (DAY_ALIASES[squashed[index]]) {
        normalized.add(DAY_ALIASES[squashed[index]])
        index += 1
      } else {
        index += 1
      }
    }
  }

  return normalized
}

function parseTimeToMinutes(value) {
  if (!value) return null
  const raw = String(value).trim().toUpperCase()
  if (!raw) return null

  const match = raw.match(/^(\d{1,2})(?::?(\d{2}))?\s*(AM|PM)?$/)
  if (!match) return null

  let hours = Number(match[1])
  const minutes = Number(match[2] || '0')
  const meridiem = match[3]

  if (meridiem === 'AM' && hours === 12) hours = 0
  if (meridiem === 'PM' && hours !== 12) hours += 12

  return hours * 60 + minutes
}

function parseMeetingWindow(course) {
  return {
    days: parseMeetingDays(course?.meeting_days),
    start: parseTimeToMinutes(course?.time_start),
    end: parseTimeToMinutes(course?.time_end),
  }
}

export function meetingsConflict(left, right) {
  const first = parseMeetingWindow(left)
  const second = parseMeetingWindow(right)

  if (!first.days.size || !second.days.size) return false
  if (first.start == null || first.end == null || second.start == null || second.end == null) return false

  const sameDay = [...first.days].some((day) => second.days.has(day))
  if (!sameDay) return false

  return first.start < second.end && second.start < first.end
}

export function findConflicts(courses) {
  const conflicts = []
  const list = Array.isArray(courses) ? courses : []

  for (let index = 0; index < list.length; index += 1) {
    for (let inner = index + 1; inner < list.length; inner += 1) {
      if (meetingsConflict(list[index], list[inner])) {
        conflicts.push([list[index], list[inner]])
      }
    }
  }

  return conflicts
}
