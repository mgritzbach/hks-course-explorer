import { useEffect, useMemo, useState } from 'react'
import { findConflicts } from '../lib/conflictDetector'
import { loadPlan, savePlan, PLANS, DEFAULT_PLAN } from '../lib/scheduleStorage'
import { computeProgress, getPrograms } from '../lib/requirementsEngine'
import { searchHarvardCourses } from '../lib/harvardApi'

const GRID_START = 480
const GRID_END = 1080
const ROW_HEIGHT = 36
const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']
const DAY_INDEX = { MON: 0, TUE: 1, WED: 2, THU: 3, FRI: 4 }
const TERM_OPTIONS = ['Q1', 'Q2', 'FULL']

function fallbackSearch(q, allCourses) {
  const query = String(q || '').trim().toLowerCase()
  if (!query) return []
  return (Array.isArray(allCourses) ? allCourses : [])
    .filter((c) => !c?.is_average && Number(c?.year || 0) >= 2024)
    .filter((c) =>
      [c?.course_code, c?.course_name, c?.professor, c?.professor_display]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(query)
    )
    .sort((a, b) => Number(b?.year || 0) - Number(a?.year || 0))
    .slice(0, 12)
    .map((c) => ({
      courseCode: c.course_code_base || c.course_code,
      title: c.course_name,
      instructors: [c.professor_display || c.professor].filter(Boolean),
      credits: 4,
      sections: [],
      enrichment: {
        is_stem: c.is_stem,
        is_core: c.is_core,
        metrics_pct: c.metrics_pct,
        bid_clearing_price: c.bid_clearing_price,
      },
      _fromDB: true,
    }))
}

function normalizeDayToken(token) {
  const value = String(token || '').trim().toUpperCase()
  const map = {
    M: 'MON', MON: 'MON', MONDAY: 'MON',
    T: 'TUE', TU: 'TUE', TUE: 'TUE', TUES: 'TUE', TUESDAY: 'TUE',
    W: 'WED', WED: 'WED', WEDNESDAY: 'WED',
    R: 'THU', TH: 'THU', THU: 'THU', THUR: 'THU', THURS: 'THU', THURSDAY: 'THU',
    F: 'FRI', FRI: 'FRI', FRIDAY: 'FRI',
  }
  return map[value] || null
}

function extractDays(value) {
  if (!value) return []
  const parts = String(value).trim().replace(/&/g, '/').replace(/,/g, '/').split(/[\/\s]+/).filter(Boolean)
  const days = new Set()
  parts.forEach((part) => {
    const direct = normalizeDayToken(part)
    if (direct) return void days.add(direct)
    let cursor = part.replace(/[^A-Za-z]/g, '').toUpperCase()
    const combos = ['THU', 'MON', 'TUE', 'WED', 'FRI', 'TH', 'TU', 'M', 'T', 'W', 'R', 'F']
    while (cursor) {
      const match = combos.find((candidate) => cursor.startsWith(candidate))
      if (!match) {
        cursor = cursor.slice(1)
      } else {
        const day = normalizeDayToken(match)
        if (day) days.add(day)
        cursor = cursor.slice(match.length)
      }
    }
  })
  return [...days].sort((a, b) => DAY_INDEX[a] - DAY_INDEX[b])
}

function parseTimeParts(value) {
  if (!value) return null
  const match = String(value).trim().toUpperCase().match(/^(\d{1,2})(?::?(\d{2}))?\s*(AM|PM)?$/)
  if (!match) return null
  let hours = Number(match[1])
  const minutes = Number(match[2] || '0')
  if (match[3] === 'AM' && hours === 12) hours = 0
  if (match[3] === 'PM' && hours !== 12) hours += 12
  return { hours, minutes }
}

function minutesFromValue(value) {
  const parts = parseTimeParts(value)
  return parts ? parts.hours * 60 + parts.minutes : null
}

function formatClockLabel(value) {
  const parts = parseTimeParts(value)
  if (!parts) return 'TBA'
  const date = new Date()
  date.setHours(parts.hours, parts.minutes, 0, 0)
  return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }).format(date)
}

function timeToY(h, m) {
  return ((h * 60 + m) - GRID_START) / 30 * ROW_HEIGHT
}

function durationToH(sh, sm, eh, em) {
  return ((eh * 60 + em) - (sh * 60 + sm)) / 30 * ROW_HEIGHT
}

function clampMinutes(value) {
  if (value == null) return null
  return Math.max(GRID_START, Math.min(GRID_END, value))
}

function toNumber(value, fallback = 0) {
  const next = Number(value)
  return Number.isFinite(next) ? next : fallback
}

function normalizeSection(section, course) {
  if (!section || typeof section !== 'object') return null
  const code = section.code || section.sectionCode || section.section_code || section.name || section.title || 'Section'
  return {
    id: section.id || code,
    code,
    title: section.title || code,
    instructors: Array.isArray(section.instructors) ? section.instructors.filter(Boolean) : [section.instructor, section.professor, section.faculty].filter(Boolean),
    meeting_days: section.meeting_days || section.meetingDays || section.days || section.pattern || course?.meeting_days || '',
    time_start: section.time_start || section.start || section.start_time || course?.time_start || '',
    time_end: section.time_end || section.end || section.end_time || course?.time_end || '',
    location: section.location || '',
  }
}

function normalizeCourse(raw, index = 0) {
  const sections = (Array.isArray(raw?.sections) ? raw.sections : []).map((s) => normalizeSection(s, raw)).filter(Boolean)
  const main = sections[0] || null
  return {
    id: raw?.id || `${raw?.courseCode || raw?.course_code || raw?.course_code_base || raw?.code || 'course'}-${index}`,
    courseCode: raw?.courseCode || raw?.course_code || raw?.course_code_base || raw?.code || `course-${index}`,
    title: raw?.title || raw?.course_name || raw?.name || 'Untitled course',
    instructors: Array.isArray(raw?.instructors) ? raw.instructors.filter(Boolean) : [raw?.instructor, raw?.professor, raw?.professor_display].filter(Boolean),
    credits: toNumber(raw?.credits ?? raw?.credits_min ?? raw?.credits_max, 4) || 4,
    sections,
    selectedSectionId: raw?.selectedSectionId || main?.id || '',
    meeting_days: raw?.meeting_days || main?.meeting_days || '',
    time_start: raw?.time_start || main?.time_start || '',
    time_end: raw?.time_end || main?.time_end || '',
    location: raw?.location || main?.location || '',
    isOnGrid: Boolean(raw?.isOnGrid),
    enrichment: {
      is_core: Boolean(raw?.enrichment?.is_core ?? raw?.is_core),
      is_stem: Boolean(raw?.enrichment?.is_stem ?? raw?.is_stem),
      metrics_pct: raw?.enrichment?.metrics_pct ?? raw?.metrics_pct ?? null,
      bid_clearing_price: raw?.enrichment?.bid_clearing_price ?? raw?.bid_clearing_price ?? null,
    },
  }
}

function getActiveSection(course) {
  return course?.sections?.find((section) => section.id === course?.selectedSectionId) || course?.sections?.[0] || null
}

function courseHasSchedule(course) {
  return extractDays(course?.meeting_days).length > 0 && minutesFromValue(course?.time_start) != null && minutesFromValue(course?.time_end) != null
}

function EmptyScheduleState() {
  return (
    <div className="rounded-[24px] border p-5 text-sm" style={{ background: 'var(--panel-soft)', borderColor: 'var(--line)' }}>
      <p className="text-base font-semibold" style={{ color: 'var(--text)' }}>Your shortlist is empty</p>
      <p className="mt-2 leading-6" style={{ color: 'var(--text-muted)' }}>
        Start from the search panel on the left and add a course to begin building your schedule.
      </p>
      <p className="mt-3 text-lg" style={{ color: 'var(--accent)' }}>← Search lives here</p>
    </div>
  )
}

function buildIcs(courses) {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//HKS Course Explorer//Schedule Builder//EN']
  const dayMap = { MON: 'MO', TUE: 'TU', WED: 'WE', THU: 'TH', FRI: 'FR' }
  courses.filter((c) => c.isOnGrid && courseHasSchedule(c)).forEach((course, index) => {
    const start = parseTimeParts(course.time_start)
    const end = parseTimeParts(course.time_end)
    const days = extractDays(course.meeting_days).map((day) => dayMap[day]).filter(Boolean)
    if (!start || !end || !days.length) return
    lines.push('BEGIN:VEVENT')
    lines.push(`UID:${course.courseCode}-${index}@hks-course-explorer`)
    lines.push(`DTSTAMP:${stamp}`)
    lines.push(`SUMMARY:${String(course.courseCode).replace(/,/g, '\\,')} ${String(course.title).replace(/,/g, '\\,')}`)
    lines.push(`DTSTART:20260105T${String(start.hours).padStart(2, '0')}${String(start.minutes).padStart(2, '0')}00`)
    lines.push(`DTEND:20260105T${String(end.hours).padStart(2, '0')}${String(end.minutes).padStart(2, '0')}00`)
    lines.push(`RRULE:FREQ=WEEKLY;BYDAY=${days.join(',')};COUNT=14`)
    if (course.location) lines.push(`LOCATION:${String(course.location).replace(/,/g, '\\,')}`)
    lines.push('END:VEVENT')
  })
  lines.push('END:VCALENDAR')
  return new Blob([lines.join('\r\n')], { type: 'text/calendar;charset=utf-8' })
}

function Chip({ children, tone = 'default' }) {
  const styles = {
    default: { background: 'var(--panel-soft)', borderColor: 'var(--line)', color: 'var(--text-soft)' },
    success: { background: 'var(--success)', borderColor: 'var(--success)', color: 'var(--panel)' },
    blue: { background: 'var(--blue)', borderColor: 'var(--blue)', color: 'var(--panel)' },
    danger: { background: 'var(--panel-soft)', borderColor: 'var(--danger)', color: 'var(--danger)' },
  }
  return (
    <span className="inline-flex items-center rounded-full border px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.08em]" style={styles[tone] || styles.default}>
      {children}
    </span>
  )
}

function ProgressBar({ value, tone = 'var(--accent)' }) {
  return (
    <div className="h-2 overflow-hidden rounded-full" style={{ background: 'var(--panel-soft)', border: '1px solid var(--line)' }}>
      <div className="h-full rounded-full transition-all" style={{ width: `${Math.max(0, Math.min(100, value || 0))}%`, background: tone }} />
    </div>
  )
}

export default function ScheduleBuilder({ courses = [] }) {
  const programs = useMemo(() => getPrograms(), [])
  const [activePlan, setActivePlan] = useState(DEFAULT_PLAN)
  const [planData, setPlanData] = useState(() => loadPlan(DEFAULT_PLAN))
  const [term, setTerm] = useState('FULL')
  const [searchQ, setSearchQ] = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [searching, setSearching] = useState(false)
  const [expandedBlock, setExpandedBlock] = useState(null)
  const [reqProgram, setReqProgram] = useState(() => getPrograms()[0]?.id || '')
  const [gridMessages, setGridMessages] = useState({})

  useEffect(() => {
    void savePlan(activePlan, planData)
  }, [activePlan, planData])

  useEffect(() => {
    if (!reqProgram && programs[0]?.id) setReqProgram(programs[0].id)
  }, [programs, reqProgram])

  useEffect(() => {
    const query = searchQ.trim()
    if (!query) {
      setSearching(false)
      setSearchResults([])
      return undefined
    }
    let cancelled = false
    const timer = window.setTimeout(async () => {
      setSearching(true)
      try {
        const remote = await searchHarvardCourses(query)
        if (cancelled) return
        const normalized = (Array.isArray(remote) ? remote : []).map((item, index) => normalizeCourse(item, index)).slice(0, 12)
        setSearchResults(normalized.length ? normalized : fallbackSearch(query, courses).map((item, index) => normalizeCourse(item, index)))
      } catch {
        if (!cancelled) setSearchResults(fallbackSearch(query, courses).map((item, index) => normalizeCourse(item, index)))
      } finally {
        if (!cancelled) setSearching(false)
      }
    }, 400)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [courses, searchQ])

  const normalizedPlanCourses = useMemo(() => (Array.isArray(planData?.courses) ? planData.courses : []).map((course, index) => normalizeCourse(course, index)), [planData])
  const gridCourses = useMemo(() => normalizedPlanCourses.filter((course) => course.isOnGrid), [normalizedPlanCourses])
  const conflicts = useMemo(() => findConflicts(gridCourses), [gridCourses])
  const conflictSet = useMemo(() => {
    const next = new Set()
    conflicts.forEach(([left, right]) => {
      if (left?.courseCode) next.add(left.courseCode)
      if (right?.courseCode) next.add(right.courseCode)
    })
    return next
  }, [conflicts])
  const progress = useMemo(() => (reqProgram ? computeProgress(reqProgram, normalizedPlanCourses) : null), [normalizedPlanCourses, reqProgram])
  const addedCourseCodes = useMemo(() => new Set(normalizedPlanCourses.map((course) => course.courseCode)), [normalizedPlanCourses])

  const switchPlan = (planName) => {
    setActivePlan(planName)
    setPlanData(loadPlan(planName))
    setExpandedBlock(null)
  }
  const addToShortlist = (course) => {
    const normalized = normalizeCourse(course)
    setPlanData((current) => {
      const currentCourses = Array.isArray(current?.courses) ? current.courses : []
      if (currentCourses.some((item) => normalizeCourse(item).courseCode === normalized.courseCode)) return current
      return { ...current, name: activePlan, courses: [...currentCourses, { ...normalized, isOnGrid: false }] }
    })
    setGridMessages((current) => {
      if (!current[normalized.courseCode]) return current
      const next = { ...current }
      delete next[normalized.courseCode]
      return next
    })
  }
  const removeCourse = (courseCode) => {
    setPlanData((current) => ({
      ...current,
      name: activePlan,
      courses: (Array.isArray(current?.courses) ? current.courses : []).filter((course) => normalizeCourse(course).courseCode !== courseCode),
    }))
    setExpandedBlock((current) => (current === courseCode ? null : current))
    setGridMessages((current) => {
      if (!current[courseCode]) return current
      const next = { ...current }
      delete next[courseCode]
      return next
    })
  }
  const toggleGrid = (courseCode) => {
    setPlanData((current) => ({
      ...current,
      name: activePlan,
      courses: (Array.isArray(current?.courses) ? current.courses : []).map((course) => {
        const normalized = normalizeCourse(course)
        if (normalized.courseCode !== courseCode) return course
        if (!normalized.isOnGrid && !courseHasSchedule(normalized)) {
          setGridMessages((messages) => ({
            ...messages,
            [courseCode]: 'No schedule data — this course has no time slot in our database',
          }))
          return course
        }
        setGridMessages((messages) => {
          if (!messages[courseCode]) return messages
          const next = { ...messages }
          delete next[courseCode]
          return next
        })
        return { ...normalized, isOnGrid: !normalized.isOnGrid }
      }),
    }))
  }
  const changeSection = (courseCode, sectionId) => {
    setPlanData((current) => ({
      ...current,
      name: activePlan,
      courses: (Array.isArray(current?.courses) ? current.courses : []).map((course) => {
        const normalized = normalizeCourse(course)
        if (normalized.courseCode !== courseCode) return course
        const nextSection = normalized.sections.find((section) => section.id === sectionId) || null
        return {
          ...normalized,
          selectedSectionId: sectionId,
          meeting_days: nextSection?.meeting_days || '',
          time_start: nextSection?.time_start || '',
          time_end: nextSection?.time_end || '',
          location: nextSection?.location || '',
          instructors: nextSection?.instructors?.length ? nextSection.instructors : normalized.instructors,
        }
      }),
    }))
    setGridMessages((current) => {
      if (!current[courseCode]) return current
      const next = { ...current }
      delete next[courseCode]
      return next
    })
  }
  const handleExport = () => {
    const blob = buildIcs(normalizedPlanCourses)
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `${activePlan.toLowerCase().replace(/\s+/g, '-')}.ics`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  const timeLabels = useMemo(() => {
    const labels = []
    for (let minute = GRID_START; minute < GRID_END; minute += 30) {
      const h = Math.floor(minute / 60)
      const m = minute % 60
      labels.push({ minute, label: formatClockLabel(`${h}:${String(m).padStart(2, '0')}`) })
    }
    return labels
  }, [])

  const blocks = useMemo(() => normalizedPlanCourses.filter((course) => course.isOnGrid && courseHasSchedule(course)).flatMap((course) => {
    const start = clampMinutes(minutesFromValue(course.time_start))
    const end = clampMinutes(minutesFromValue(course.time_end))
    if (start == null || end == null || end <= start) return []
    const sh = Math.floor(start / 60)
    const sm = start % 60
    const eh = Math.floor(end / 60)
    const em = end % 60
    return extractDays(course.meeting_days).map((day) => ({
      key: `${course.courseCode}-${day}`,
      course,
      day,
      top: timeToY(sh, sm),
      height: durationToH(sh, sm, eh, em),
    }))
  }), [normalizedPlanCourses])

  return (
    <div className="h-full overflow-hidden">
      <div className="flex h-full items-center justify-center px-6 text-center md:hidden">
        <div className="max-w-sm">
          <h1 className="serif-display text-3xl font-semibold" style={{ color: 'var(--text)' }}>Schedule Builder</h1>
          <p className="mt-4 text-sm leading-6" style={{ color: 'var(--text-muted)' }}>Open on desktop for Schedule Builder</p>
          <a href="/requirements" className="mt-5 inline-flex rounded-full border px-4 py-2 text-sm font-semibold transition-transform hover:-translate-y-[1px]" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)', color: 'var(--text)' }}>
            Go to Requirements
          </a>
        </div>
      </div>

      <div className="hidden h-full flex-col md:flex">
        <div className="flex items-center justify-between gap-6 border-b px-6 py-4" style={{ borderColor: 'var(--line)', background: 'var(--panel)' }}>
          <div className="flex items-end gap-4">
            <div>
              <p className="kicker">Hidden Feature</p>
              <h1 className="serif-display mt-2 text-3xl font-semibold" style={{ color: 'var(--text)' }}>Schedule Builder</h1>
            </div>
            <div className="flex gap-2">
              {PLANS.map((planName) => {
                const active = planName === activePlan
                return (
                  <button key={planName} type="button" onClick={() => switchPlan(planName)} className="border-b-2 px-1 pb-2 pt-3 text-sm font-semibold transition-colors" style={{ borderColor: active ? 'var(--accent)' : 'transparent', color: active ? 'var(--text)' : 'var(--text-muted)' }}>
                    {planName}
                  </button>
                )
              })}
            </div>
          </div>

          <div className="inline-flex rounded-full border p-1" style={{ background: 'var(--panel-soft)', borderColor: 'var(--line)' }}>
            {TERM_OPTIONS.map((option) => {
              const active = option === term
              return (
                <button key={option} type="button" onClick={() => setTerm(option)} className="rounded-full px-4 py-2 text-sm font-semibold transition-colors" style={{ background: active ? 'var(--accent-soft)' : 'transparent', color: active ? 'var(--text)' : 'var(--text-muted)' }}>
                  {option === 'FULL' ? 'Full Term' : option}
                </button>
              )
            })}
          </div>
        </div>

        <div className="flex min-h-0 flex-1">
          <aside className="flex h-full w-[280px] shrink-0 flex-col border-r" style={{ borderColor: 'var(--line)', background: 'var(--panel)' }}>
            <div className="border-b p-4" style={{ borderColor: 'var(--line)' }}>
              <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.12em]" style={{ color: 'var(--text-muted)' }}>Course Search</label>
              <input value={searchQ} onChange={(event) => setSearchQ(event.target.value)} placeholder="Search courses, instructors..." className="w-full rounded-2xl border px-4 py-3 text-sm outline-none transition-colors" style={{ background: 'var(--panel-soft)', borderColor: 'var(--line-strong)', color: 'var(--text)' }} />
            </div>

            <div className="flex min-h-0 flex-1 flex-col p-4">
              {!searchQ.trim() ? (
                <div className="flex h-full items-center justify-center rounded-[24px] border p-6 text-center" style={{ background: 'var(--panel-soft)', borderColor: 'var(--line)', color: 'var(--text-muted)' }}>Type to search HKS courses</div>
              ) : searching ? (
                <div className="py-8 text-center text-sm" style={{ color: 'var(--text-muted)' }}>Searching...</div>
              ) : searchResults.length === 0 ? (
                <div className="py-8 text-center text-sm" style={{ color: 'var(--text-muted)' }}>No matching courses found.</div>
              ) : (
                <div className="space-y-3">
                  {searchResults.slice(0, 12).map((course, index) => {
                    const added = addedCourseCodes.has(course.courseCode)
                    return (
                      <div key={`${course.courseCode}-${index}`} className="rounded-[24px] border p-4" style={{ background: 'var(--panel-soft)', borderColor: 'var(--line)' }}>
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-sm font-semibold" style={{ color: 'var(--text)' }}>{course.courseCode}</p>
                            <p className="mt-1 overflow-hidden text-sm leading-5" style={{ color: 'var(--text-soft)', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{course.title}</p>
                          </div>
                          <button type="button" disabled={added} onClick={() => addToShortlist(course)} className="shrink-0 rounded-full border px-3 py-2 text-xs font-semibold transition-transform enabled:hover:-translate-y-[1px] disabled:cursor-default" style={{ background: added ? 'var(--success)' : 'var(--accent-soft)', borderColor: added ? 'var(--success)' : 'var(--line-strong)', color: added ? 'var(--panel)' : 'var(--text)' }}>
                            {added ? 'Added ✓' : 'Add'}
                          </button>
                        </div>
                        <p className="mt-2 text-xs leading-5" style={{ color: 'var(--text-muted)' }}>{course.instructors.length ? course.instructors.join(', ') : 'Instructor TBA'}</p>
                        <div className="mt-3 flex flex-wrap gap-2">
                          {course.enrichment?.is_core && <Chip tone="success">Core</Chip>}
                          {course.enrichment?.is_stem && <Chip tone="blue">STEM</Chip>}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </aside>

          <main className="min-w-0 flex-1 overflow-x-auto overflow-y-auto" style={{ background: 'var(--panel-strong)' }}>
            <div className="min-w-[720px] p-6">
              <div className="min-w-[720px] rounded-[28px] border" style={{ background: 'var(--panel)', borderColor: 'var(--line)' }}>
                <div className="grid min-w-[720px] border-b" style={{ borderColor: 'var(--line)', gridTemplateColumns: '52px repeat(5, minmax(0, 1fr))' }}>
                  <div className="border-r px-2 py-4 text-[11px] font-semibold uppercase tracking-[0.12em]" style={{ borderColor: 'var(--line)', color: 'var(--text-muted)' }}>Time</div>
                  {DAY_LABELS.map((day) => (
                    <div key={day} className="border-r px-3 py-4 text-center text-sm font-semibold last:border-r-0" style={{ borderColor: 'var(--line)', color: 'var(--text)' }}>{day}</div>
                  ))}
                </div>

                <div className="relative min-w-[720px]" style={{ height: `${((GRID_END - GRID_START) / 30) * ROW_HEIGHT}px` }}>
                  {timeLabels.map((slot, index) => (
                    <div key={slot.minute} className="absolute inset-x-0 grid" style={{ top: `${index * ROW_HEIGHT}px`, height: `${ROW_HEIGHT}px`, gridTemplateColumns: '52px repeat(5, minmax(0, 1fr))' }}>
                      <div className="border-r px-2 py-2 text-[11px]" style={{ borderColor: 'var(--line)', color: 'var(--text-muted)' }}>{slot.label}</div>
                      {DAY_LABELS.map((day) => (
                        <div key={`${slot.minute}-${day}`} className="border-r border-t last:border-r-0" style={{ borderColor: 'var(--line)', background: index % 2 === 0 ? 'var(--panel)' : 'var(--panel-soft)' }} />
                      ))}
                    </div>
                  ))}
                  {blocks.map(({ key, course, day, top, height }) => {
                    const conflict = conflictSet.has(course.courseCode)
                    const active = expandedBlock === course.courseCode
                    const section = getActiveSection(course)
                    const dayIndex = DAY_INDEX[day]
                    return (
                      <div key={key} className="absolute z-10 rounded-2xl border p-2" style={{ top: `${top + 2}px`, left: `calc(52px + ${dayIndex} * (100% - 52px) / 5 + 2px)`, width: 'calc((100% - 52px) / 5 - 4px)', height: `${Math.max(height - 4, 28)}px`, background: conflict ? 'var(--panel-soft)' : 'var(--accent-soft)', borderColor: conflict ? 'var(--danger)' : 'var(--accent)', color: 'var(--text)' }}>
                        <button type="button" onClick={() => setExpandedBlock((current) => (current === course.courseCode ? null : course.courseCode))} className="block h-full w-full text-left">
                          <p className="truncate pr-6 text-xs font-semibold">{course.courseCode}</p>
                          <p className="mt-1 text-[11px] leading-4" style={{ color: 'var(--text-soft)', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{course.title}</p>
                        </button>
                        <button type="button" onClick={() => toggleGrid(course.courseCode)} className="absolute right-2 top-2 text-xs font-semibold" style={{ color: conflict ? 'var(--danger)' : 'var(--text-soft)' }} aria-label={`Remove ${course.courseCode} from grid`}>×</button>
                        {active && (
                          <div className="absolute left-0 top-full z-20 mt-2 w-64 rounded-[20px] border p-4" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
                            <p className="text-sm font-semibold" style={{ color: 'var(--text)' }}>{course.title}</p>
                            <p className="mt-1 text-xs" style={{ color: 'var(--text-muted)' }}>{(section?.instructors?.length ? section.instructors : course.instructors).join(', ') || 'Instructor TBA'}</p>
                            <p className="mt-2 text-xs" style={{ color: 'var(--text-soft)' }}>{formatClockLabel(course.time_start)} - {formatClockLabel(course.time_end)} {course.meeting_days || ''}</p>
                            <p className="mt-2 text-xs" style={{ color: 'var(--text-soft)' }}>Metrics Q-score: <span style={{ color: 'var(--text)' }}>{course.enrichment?.metrics_pct ?? 'N/A'}</span></p>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          </main>

          <aside className="flex h-full w-[280px] shrink-0 flex-col border-l" style={{ borderColor: 'var(--line)', background: 'var(--panel)' }}>
            <div className="flex min-h-0 flex-1 flex-col p-4">
              <div className="shrink-0">
                <p className="text-xs font-semibold uppercase tracking-[0.12em]" style={{ color: 'var(--text-muted)' }}>Shortlist</p>
                <p className="mt-1 text-sm" style={{ color: 'var(--text-soft)' }}>{normalizedPlanCourses.length} course{normalizedPlanCourses.length === 1 ? '' : 's'}</p>
              </div>

              <div className="mt-4 flex-1 space-y-3 overflow-y-auto pr-1">
                {normalizedPlanCourses.length === 0 ? (
                  searchQ.trim() ? (
                    <div className="rounded-[24px] border p-5 text-sm" style={{ background: 'var(--panel-soft)', borderColor: 'var(--line)', color: 'var(--text-muted)' }}>
                      Add courses from search to start a plan.
                    </div>
                  ) : (
                    <EmptyScheduleState />
                  )
                ) : normalizedPlanCourses.map((course) => {
                  const onGrid = course.isOnGrid
                  const inConflict = conflictSet.has(course.courseCode)
                  return (
                    <div key={course.courseCode} className="rounded-[24px] border p-4" style={{ background: 'var(--panel-soft)', borderColor: 'var(--line)' }}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold" style={{ color: 'var(--text)' }}>{course.courseCode}</p>
                          <p className="mt-1 truncate text-sm" style={{ color: 'var(--text-soft)' }}>{course.title}</p>
                        </div>
                        <button type="button" onClick={() => removeCourse(course.courseCode)} className="text-sm font-semibold" style={{ color: 'var(--danger)' }} aria-label={`Remove ${course.courseCode}`}>×</button>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {course.enrichment?.is_core && <Chip tone="success">Core</Chip>}
                        {course.enrichment?.is_stem && <Chip tone="blue">STEM</Chip>}
                        {!course.enrichment?.is_core && !course.enrichment?.is_stem && <Chip>Elective</Chip>}
                      </div>
                      {course.sections.length > 0 && (
                        <div className="mt-3">
                          <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.08em]" style={{ color: 'var(--text-muted)' }}>Section</label>
                          <select value={course.selectedSectionId} onChange={(event) => changeSection(course.courseCode, event.target.value)} className="w-full rounded-2xl border px-3 py-2 text-sm" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)', color: 'var(--text)' }}>
                            {course.sections.map((section) => <option key={section.id} value={section.id}>{section.code}</option>)}
                          </select>
                        </div>
                      )}
                      <button type="button" onClick={() => toggleGrid(course.courseCode)} className="mt-3 w-full rounded-full border px-4 py-2 text-sm font-semibold transition-transform hover:-translate-y-[1px]" style={{ background: onGrid ? 'var(--gold-soft)' : 'var(--accent-soft)', borderColor: onGrid ? 'var(--gold)' : 'var(--line-strong)', color: 'var(--text)' }}>
                        {onGrid ? 'Remove from grid' : 'Place on grid'}
                      </button>
                      {gridMessages[course.courseCode] && <p className="mt-3 text-xs leading-5" style={{ color: 'var(--text-muted)' }}>{gridMessages[course.courseCode]}</p>}
                      {inConflict && <p className="mt-3 text-xs font-semibold uppercase tracking-[0.08em]" style={{ color: 'var(--danger)' }}>Conflict detected</p>}
                    </div>
                  )
                })}
              </div>

              <div className="my-5 shrink-0 border-t" style={{ borderColor: 'var(--line)' }} />

              <div className="shrink-0">
                <p className="text-xs font-semibold uppercase tracking-[0.12em]" style={{ color: 'var(--text-muted)' }}>Requirements</p>
                <div className="mt-3">
                  <select value={reqProgram} onChange={(event) => setReqProgram(event.target.value)} className="w-full rounded-2xl border px-3 py-2 text-sm" style={{ background: 'var(--panel-soft)', borderColor: 'var(--line-strong)', color: 'var(--text)' }}>
                    {programs.map((program) => <option key={program.id} value={program.id}>{program.label}</option>)}
                  </select>
                </div>
                {progress ? (
                  <div className="mt-4 space-y-4">
                    {progress.categories.map((category) => (
                      <div key={category.id}>
                        <div className="mb-2 flex items-center justify-between gap-3 text-xs">
                          <span style={{ color: 'var(--text-soft)' }}>{category.label}</span>
                          <span style={{ color: 'var(--text)' }}>{category.appliedCredits}/{category.requiredCredits} cr</span>
                        </div>
                        <ProgressBar value={category.percent} tone={category.isComplete ? 'var(--success)' : 'var(--accent)'} />
                      </div>
                    ))}
                    <div className="border-t pt-4" style={{ borderColor: 'var(--line)' }}>
                      <div className="mb-2 flex items-center justify-between gap-3 text-xs">
                        <span style={{ color: 'var(--text-soft)' }}>Total credits</span>
                        <span style={{ color: 'var(--text)' }}>{progress.overallAppliedCredits}/{progress.totalRequiredCredits} cr</span>
                      </div>
                      <ProgressBar value={progress.overallPercent} tone="var(--gold)" />
                    </div>
                  </div>
                ) : <p className="mt-3 text-sm" style={{ color: 'var(--text-muted)' }}>No program definitions available.</p>}
              </div>
            </div>

            <div className="shrink-0 border-t p-4" style={{ borderColor: 'var(--line)' }}>
              <button type="button" onClick={handleExport} className="w-full rounded-full border px-4 py-3 text-sm font-semibold transition-transform hover:-translate-y-[1px]" style={{ background: 'var(--gold-soft)', borderColor: 'var(--gold)', color: 'var(--text)' }}>
                {'\u{1F4C5} Export iCal (.ics)'}
              </button>
            </div>
          </aside>
        </div>
      </div>
    </div>
  )
}
