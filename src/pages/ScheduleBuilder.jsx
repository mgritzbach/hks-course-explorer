import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { findConflicts } from '../lib/conflictDetector'
import { loadPlan, savePlan, PLANS, DEFAULT_PLAN, loadCompleted, saveCompleted } from '../lib/scheduleStorage'
import { computeProgress, getPrograms } from '../lib/requirementsEngine'
import { searchHarvardCourses } from '../lib/harvardApi'
import { useFavorites } from '../useFavorites'
import { supabase } from '../lib/supabase.js'

const GRID_START = 480
const GRID_END = 1170
const ROW_HEIGHT = 36
const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']
const WEEKEND_LABELS = ['Sat', 'Sun']
const DAY_INDEX = { MON: 0, TUE: 1, WED: 2, THU: 3, FRI: 4, SAT: 5, SUN: 6 }
const TERM_OPTIONS = ['Q1', 'Q2', 'FULL']

function fallbackSearch(q, allCourses, filters = {}) {
  const query = String(q || '').trim().toLowerCase()
  const { concentration, stem, coreOnly, semester, searchSource, minRating, allYears } = filters
  const hasFilters = (concentration && concentration !== 'All') || (stem && stem !== 'all') || coreOnly || (semester && semester !== 'All') || (searchSource && searchSource !== 'All') || minRating
  if (!query && !hasFilters) return []
  // Map semester → (year, term) used in the courses table
  const semesterTermMap = {
    Spring:  { year: 2026, term: 'Spring' },
    Fall:    { year: 2025, term: 'Fall' },
    January: { year: 2025, term: 'January' },
  }
  const termFilter = (allYears || !semester || semester === 'All') ? null : (semesterTermMap[semester] || null)
  return (Array.isArray(allCourses) ? allCourses : [])
    .filter((c) => !c?.is_average)
    .filter((c) => {
      const hks = isHksCourse(c?.course_code_base || c?.course_code)
      if (query && !([c?.course_code, c?.course_name, c?.professor, c?.professor_display].filter(Boolean).join(' ').toLowerCase().includes(query))) return false
      if (concentration && concentration !== 'All' && c?.concentration !== concentration) return false
      if (stem === 'stem' && !c?.is_stem) return false
      if (stem === 'nonstem' && c?.is_stem) return false
      if (coreOnly && !c?.is_core) return false
      if (searchSource === 'HKS' && !hks) return false
      if (searchSource === 'Non-HKS' && hks) return false
      if (termFilter && (Number(c?.year) !== termFilter.year || c?.term !== termFilter.term)) return false
      if (minRating && (c?.metrics_pct?.Instructor_Rating == null || Number(c.metrics_pct.Instructor_Rating) < Number(minRating))) return false
      return true
    })
    .sort((a, b) => Number(b?.year || 0) - Number(a?.year || 0))
    .map((c) => ({
      courseCode: c.course_code_base || c.course_code,
      title: c.course_name,
      instructors: [c.professor_display || c.professor].filter(Boolean),
      credits: Number(c.credits_min ?? c.credits_max ?? c.credits ?? 4) || 4,
      sections: [],
      meeting_days: c.meeting_days || null,
      time_start: c.time_start || null,
      time_end: c.time_end || null,
      location: c.location || null,
      year: c.year || null,
      term: c.term || null,
      enrichment: {
        is_stem: c.is_stem,
        is_core: c.is_core,
        metrics_pct: c.metrics_pct,
        bid_clearing_price: c.bid_clearing_price,
        last_bid_price: c.last_bid_price,
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
    S: 'SAT', SA: 'SAT', SAT: 'SAT', SATURDAY: 'SAT',
    SU: 'SUN', SUN: 'SUN', SUNDAY: 'SUN',
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
    year: raw?.year ?? null,
    term: raw?.term ?? null,
    enrichment: {
      is_core: Boolean(raw?.enrichment?.is_core ?? raw?.is_core),
      is_stem: Boolean(raw?.enrichment?.is_stem ?? raw?.is_stem),
      metrics_pct: raw?.enrichment?.metrics_pct ?? raw?.metrics_pct ?? null,
      bid_clearing_price: raw?.enrichment?.bid_clearing_price ?? raw?.bid_clearing_price ?? null,
      last_bid_price: raw?.enrichment?.last_bid_price ?? raw?.last_bid_price ?? null,
    },
  }
}

function getActiveSection(course) {
  return course?.sections?.find((section) => section.id === course?.selectedSectionId) || course?.sections?.[0] || null
}

function courseHasSchedule(course) {
  return extractDays(course?.meeting_days).length > 0 && minutesFromValue(course?.time_start) != null && minutesFromValue(course?.time_end) != null
}

const HKS_PREFIXES = new Set(['API', 'BGP', 'DEV', 'DPI', 'IGA', 'MLD', 'SUP', 'MPAID', 'HKS'])
function isHksCourse(courseCode) {
  const prefix = String(courseCode || '').split('-')[0].toUpperCase()
  return HKS_PREFIXES.has(prefix)
}

// Infer the school abbreviation from a non-HKS course code prefix.
const SCHOOL_BY_PREFIX = {
  BUSS: 'HBS', HBS: 'HBS',
  MIT: 'MIT',
  ECON: 'FAS', STAT: 'FAS', MATH: 'FAS', APMTH: 'FAS', GOV: 'FAS', SOC: 'FAS',
  LAW: 'Law', HLSC: 'Law',
  HPM: 'HSPH', EPI: 'HSPH', BST: 'HSPH',
  EDU: 'HGSE', PPE: 'HGSE',
  GSD: 'GSD',
}
function inferSchool(courseCode) {
  const prefix = String(courseCode || '').split('-')[0].toUpperCase().replace(/[0-9]/g, '')
  // Handle MIT numerical sub-codes like "MIT-6.036" → prefix "MIT"
  if (prefix === 'MIT' || String(courseCode || '').startsWith('MIT-')) return 'MIT'
  return SCHOOL_BY_PREFIX[prefix] || null
}

// Normalise a course code to PREFIX-NUMBER for deduplication across code variants.
// e.g. "DPI-802-M-D" → "DPI-802", "DPI-802M" → "DPI-802", "IGA-109" → "IGA-109"
function getBaseCourseId(code) {
  const parts = String(code || '').split('-')
  if (parts.length < 2) return code
  const numOnly = parts[1].replace(/[^0-9]/g, '') // strip letters: "802M" → "802"
  return numOnly ? `${parts[0]}-${numOnly}` : code
}

const HIST_RATING_KEYS = ['Instructor_Rating', 'Course_Rating', 'Workload', 'Rigor']
function hasMeaningfulRatings(pct) {
  return Boolean(pct && typeof pct === 'object' && HIST_RATING_KEYS.some((k) => pct[k] != null && Number(pct[k]) > 0))
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

function ManualCourseModal({ initial, onAdd, onClose }) {
  const [code, setCode] = useState(initial?.code || '')
  const [title, setTitle] = useState('')
  const [instructor, setInstructor] = useState('')
  const [credits, setCredits] = useState(4)
  const [days, setDays] = useState([])
  const [timeStart, setTimeStart] = useState('')
  const [timeEnd, setTimeEnd] = useState('')
  const [location, setLocation] = useState('')
  const [isStem, setIsStem] = useState(false)
  const [isCore, setIsCore] = useState(false)

  useEffect(() => {
    const handleEscape = (event) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleEscape)
    return () => window.removeEventListener('keydown', handleEscape)
  }, [onClose])

  const toggleDay = (day) => {
    setDays((current) => current.includes(day) ? current.filter((value) => value !== day) : [...current, day].sort((a, b) => DAY_INDEX[a] - DAY_INDEX[b]))
  }

  const handleSubmit = (event) => {
    event.preventDefault()
    const normalizedCode = code.trim().toUpperCase().replace(/\s+/g, '-')
    if (!normalizedCode) return
    onAdd({
      courseCode: normalizedCode,
      title: title.trim() || normalizedCode,
      instructors: instructor.trim() ? [instructor.trim()] : [],
      credits,
      sections: [],
      meeting_days: days.join('/'),
      time_start: timeStart || null,
      time_end: timeEnd || null,
      location: location.trim() || null,
      enrichment: {
        is_stem: isStem,
        is_core: isCore,
        metrics_pct: null,
      },
      _crossRegManual: true,
    })
  }

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center p-4"
      style={{ background: 'rgba(15, 23, 42, 0.62)' }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="manual-course-modal-title"
    >
      <div
        className="w-full max-w-2xl rounded-[28px] border p-6 shadow-2xl"
        style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)', color: 'var(--text)' }}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em]" style={{ color: 'var(--text-muted)' }}>Manual course</p>
            <h2 id="manual-course-modal-title" className="mt-2 text-2xl font-semibold">Add a cross-registration course</h2>
            <p className="mt-2 text-sm leading-6" style={{ color: 'var(--text-muted)' }}>
              Fill in what you know now. You can still edit timing directly in the schedule later.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-10 w-10 items-center justify-center rounded-full border text-lg transition-transform hover:-translate-y-[1px]"
            style={{ background: 'var(--panel-soft)', borderColor: 'var(--line-strong)', color: 'var(--text-muted)' }}
            aria-label="Close manual course form"
          >
            ×
          </button>
        </div>

        <form className="space-y-5" onSubmit={handleSubmit}>
          <div className="grid gap-4 md:grid-cols-2">
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.12em]" style={{ color: 'var(--text-muted)' }}>Course code</span>
              <input
                type="text"
                value={code}
                onChange={(event) => setCode(event.target.value.toUpperCase())}
                placeholder="MIT-15.783"
                className="w-full rounded-2xl border px-4 py-3 text-sm outline-none transition-colors"
                style={{ background: 'var(--panel-soft)', borderColor: 'var(--line-strong)', color: 'var(--text)' }}
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.12em]" style={{ color: 'var(--text-muted)' }}>Title</span>
              <input
                type="text"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Machine Learning for Policy"
                className="w-full rounded-2xl border px-4 py-3 text-sm outline-none transition-colors"
                style={{ background: 'var(--panel-soft)', borderColor: 'var(--line-strong)', color: 'var(--text)' }}
              />
            </label>
          </div>

          <div className="grid gap-4 md:grid-cols-[1.3fr,0.7fr]">
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.12em]" style={{ color: 'var(--text-muted)' }}>Instructor</span>
              <input
                type="text"
                value={instructor}
                onChange={(event) => setInstructor(event.target.value)}
                placeholder="Prof. Example"
                className="w-full rounded-2xl border px-4 py-3 text-sm outline-none transition-colors"
                style={{ background: 'var(--panel-soft)', borderColor: 'var(--line-strong)', color: 'var(--text)' }}
              />
            </label>
            <div>
              <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.12em]" style={{ color: 'var(--text-muted)' }}>Credits</span>
              <div className="flex gap-2">
                {[2, 3, 4].map((value) => {
                  const active = credits === value
                  return (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setCredits(value)}
                      className="flex-1 rounded-full border px-3 py-2 text-sm font-semibold transition-transform hover:-translate-y-[1px]"
                      style={{
                        background: active ? 'var(--accent)' : 'var(--accent-soft)',
                        borderColor: active ? 'var(--accent)' : 'var(--line-strong)',
                        color: active ? '#fff' : 'var(--text)',
                      }}
                    >
                      {value} cr
                    </button>
                  )
                })}
              </div>
            </div>
          </div>

          <div>
            <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.12em]" style={{ color: 'var(--text-muted)' }}>Meeting days</span>
            <div className="flex flex-wrap gap-2">
              {['MON', 'TUE', 'WED', 'THU', 'FRI'].map((day) => {
                const active = days.includes(day)
                return (
                  <button
                    key={day}
                    type="button"
                    onClick={() => toggleDay(day)}
                    className="rounded-full border px-3 py-2 text-xs font-semibold tracking-[0.08em] transition-transform hover:-translate-y-[1px]"
                    style={{
                      background: active ? 'var(--blue)' : 'var(--blue-soft)',
                      borderColor: active ? 'var(--blue)' : 'var(--line-strong)',
                      color: active ? '#fff' : 'var(--text)',
                    }}
                  >
                    {day}
                  </button>
                )
              })}
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.12em]" style={{ color: 'var(--text-muted)' }}>Start time</span>
              <input
                type="time"
                value={timeStart}
                onChange={(event) => setTimeStart(event.target.value)}
                className="w-full rounded-2xl border px-4 py-3 text-sm outline-none transition-colors"
                style={{ background: 'var(--panel-soft)', borderColor: 'var(--line-strong)', color: 'var(--text)' }}
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.12em]" style={{ color: 'var(--text-muted)' }}>End time</span>
              <input
                type="time"
                value={timeEnd}
                onChange={(event) => setTimeEnd(event.target.value)}
                className="w-full rounded-2xl border px-4 py-3 text-sm outline-none transition-colors"
                style={{ background: 'var(--panel-soft)', borderColor: 'var(--line-strong)', color: 'var(--text)' }}
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.12em]" style={{ color: 'var(--text-muted)' }}>Location</span>
              <input
                type="text"
                value={location}
                onChange={(event) => setLocation(event.target.value)}
                placeholder="Building / room"
                className="w-full rounded-2xl border px-4 py-3 text-sm outline-none transition-colors"
                style={{ background: 'var(--panel-soft)', borderColor: 'var(--line-strong)', color: 'var(--text)' }}
              />
            </label>
          </div>

          <div>
            <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.12em]" style={{ color: 'var(--text-muted)' }}>Tags</span>
            <div className="flex flex-wrap gap-2">
              {[
                { key: 'stem', label: 'STEM', active: isStem, onClick: () => setIsStem((value) => !value) },
                { key: 'core', label: 'Core', active: isCore, onClick: () => setIsCore((value) => !value) },
              ].map((item) => (
                <button
                  key={item.key}
                  type="button"
                  onClick={item.onClick}
                  className="rounded-full border px-3 py-2 text-xs font-semibold transition-transform hover:-translate-y-[1px]"
                  style={{
                    background: item.active ? 'var(--accent)' : 'var(--panel-soft)',
                    borderColor: item.active ? 'var(--accent)' : 'var(--line-strong)',
                    color: item.active ? '#fff' : 'var(--text)',
                  }}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between gap-3 border-t pt-5" style={{ borderColor: 'var(--line-strong)' }}>
            <p className="text-xs leading-5" style={{ color: 'var(--text-muted)' }}>
              This creates a manual shortlist entry marked as cross-registration.
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-full border px-4 py-2 text-sm font-semibold transition-transform hover:-translate-y-[1px]"
                style={{ background: 'var(--panel-soft)', borderColor: 'var(--line-strong)', color: 'var(--text)' }}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="rounded-full border px-4 py-2 text-sm font-semibold transition-transform hover:-translate-y-[1px]"
                style={{ background: 'var(--accent)', borderColor: 'var(--accent)', color: '#fff' }}
              >
                Add to schedule
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  )
}

const SEMESTER_STARTS = {
  'Fall-Q1': '20250902',
  'Fall-Q2': '20251027',
  'Fall-FULL': '20250902',
  'Spring-Q1': '20260127',
  'Spring-Q2': '20260309',
  'Spring-FULL': '20260127',
  'January-FULL': '20260105',
}

function buildIcs(courses, term = 'FULL', semester = 'Spring') {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//HKS Course Explorer//Schedule Builder//EN']
  lines.push('BEGIN:VTIMEZONE')
  lines.push('TZID:America/New_York')
  lines.push('BEGIN:STANDARD')
  lines.push('DTSTART:19671029T020000')
  lines.push('RRULE:FREQ=YEARLY;BYDAY=-1SU;BYMONTH=11')
  lines.push('TZNAME:EST')
  lines.push('TZOFFSETFROM:-0400')
  lines.push('TZOFFSETTO:-0500')
  lines.push('END:STANDARD')
  lines.push('BEGIN:DAYLIGHT')
  lines.push('DTSTART:19870405T020000')
  lines.push('RRULE:FREQ=YEARLY;BYDAY=2SU;BYMONTH=3')
  lines.push('TZNAME:EDT')
  lines.push('TZOFFSETFROM:-0500')
  lines.push('TZOFFSETTO:-0400')
  lines.push('END:DAYLIGHT')
  lines.push('END:VTIMEZONE')
  const dayMap = { MON: 'MO', TUE: 'TU', WED: 'WE', THU: 'TH', FRI: 'FR' }
  const dateBase = SEMESTER_STARTS[`${semester}-${term}`] || SEMESTER_STARTS['Spring-FULL']
  const weekCount = term === 'Q1' || term === 'Q2' ? 7 : 14
  courses.filter((c) => c.isOnGrid && courseHasSchedule(c)).forEach((course, index) => {
    const start = parseTimeParts(course.time_start)
    const end = parseTimeParts(course.time_end)
    const days = extractDays(course.meeting_days).map((day) => dayMap[day]).filter(Boolean)
    if (!start || !end || !days.length) return
    lines.push('BEGIN:VEVENT')
    lines.push(`UID:${course.courseCode}-${index}@hks-course-explorer`)
    lines.push(`DTSTAMP:${stamp}`)
    lines.push(`SUMMARY:${String(course.courseCode).replace(/,/g, '\\,')} ${String(course.title).replace(/,/g, '\\,')}`)
    lines.push(`DTSTART;TZID=America/New_York:${dateBase}T${String(start.hours).padStart(2, '0')}${String(start.minutes).padStart(2, '0')}00`)
    lines.push(`DTEND;TZID=America/New_York:${dateBase}T${String(end.hours).padStart(2, '0')}${String(end.minutes).padStart(2, '0')}00`)
    lines.push(`RRULE:FREQ=WEEKLY;BYDAY=${days.join(',')};COUNT=${weekCount}`)
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
    gold: { background: 'var(--gold-soft)', borderColor: 'var(--gold)', color: 'var(--gold)' },
    muted: { background: 'transparent', borderColor: 'var(--line)', color: 'var(--text-muted)' },
  }
  return (
    <span className="inline-flex items-center rounded-full border px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.08em]" style={styles[tone] || styles.default}>
      {children}
    </span>
  )
}

function ProgressBar({ value, tone = 'var(--accent)', label }) {
  const pct = Math.max(0, Math.min(100, value || 0))
  return (
    <div role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={label || `${pct}%`} className="h-2 overflow-hidden rounded-full" style={{ background: 'var(--track-bg)', border: '1px solid var(--line-strong)' }}>
      <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: tone }} />
    </div>
  )
}

export default function ScheduleBuilder({ courses = [] }) {
  const programs = useMemo(() => getPrograms(), [])
  const { favorites } = useFavorites()
  const [activePlan, setActivePlan] = useState(DEFAULT_PLAN)
  const [planData, setPlanData] = useState(() => loadPlan(DEFAULT_PLAN))
  const [completedCourses, setCompletedCourses] = useState(() => loadCompleted())
  const [completedInput, setCompletedInput] = useState('')
  const [sectionTimesMap, setSectionTimesMap] = useState(new Map()) // courseCodeBase (+ aliases) → meetings[]
  const [sectionCanonicalCodes, setSectionCanonicalCodes] = useState(new Set()) // original codes only (no aliases)
  const [sectionInfoMap, setSectionInfoMap] = useState(new Map()) // courseCodeBase → { title, instructors } from course_sections
  const [liveCoursesData, setLiveCoursesData] = useState([])     // rows from live_courses table (all schools)
  const [term, setTerm] = useState('FULL')
  const [semesterYear, setSemesterYear] = useState('2026')
  const [semester, setSemester] = useState('Spring') // Spring | Fall | Summer | January
  const [showWeekends, setShowWeekends] = useState(false)
  const [searchQ, setSearchQ] = useState('')
  const [searchConcentration, setSearchConcentration] = useState('All')
  const [searchStem, setSearchStem] = useState('all')
  const [searchCoreOnly, setSearchCoreOnly] = useState(false)
  const [searchSource, setSearchSource] = useState('HKS')
  const [searchMinRating, setSearchMinRating] = useState('')
  const [browseAll, setBrowseAll] = useState(false)
  const [searchDays, setSearchDays] = useState([])
  const [searchTimeFrom, setSearchTimeFrom] = useState('') // HH:MM
  const [searchTimeTo, setSearchTimeTo] = useState('')     // HH:MM
  const [searchCredits, setSearchCredits] = useState('')   // '' | '2' | '3' | '4'
  const [filterCrossRegOnly, setFilterCrossRegOnly] = useState(true) // hide NONH courses by default
  const [searchSession, setSearchSession] = useState('all') // 'all' | 'Full Term' | 'Spring 1' | 'Spring 2' | 'January'
  const [searchMode, setSearchMode] = useState('live')
  const [completedSearchQ, setCompletedSearchQ] = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [searching, setSearching] = useState(false)
  const [sectionTimesLoading, setSectionTimesLoading] = useState(false)
  const [apiMode, setApiMode] = useState('unknown') // 'live' | 'db' | 'unknown'
  const [expandedBlock, setExpandedBlock] = useState(null)
  const [reqProgram, setReqProgram] = useState(() => getPrograms()[0]?.id || '')
  const [gridMessages, setGridMessages] = useState({})
  const [manualTimeEdit, setManualTimeEdit] = useState({}) // courseCode → {days:[], start:'', end:''}
  const [manualCourseModal, setManualCourseModal] = useState(null)
  const [browseLimit, setBrowseLimit] = useState(25)
  const [exportMsg, setExportMsg] = useState(null)
  const exportMsgTimeoutRef = useRef(null)
  const [copyPlanMsg, setCopyPlanMsg] = useState(null)
  const copyPlanTimeoutRef = useRef(null)
  const [collapsedSections, setCollapsedSections] = useState({ shortlist: false, completed: true, requirements: false })
  const toggleSection = (key) => setCollapsedSections((s) => ({ ...s, [key]: !s[key] }))
  const importInputRef = useRef(null)
  const [saveLoadMsg, setSaveLoadMsg] = useState(null)

  function openManualModal(prefillCode) {
    setManualCourseModal({ code: prefillCode || '' })
  }
  const saveLoadTimeoutRef = useRef(null)
  const announcerRef = useRef(null)
  const announce = useCallback((msg) => {
    if (!announcerRef.current) return
    announcerRef.current.textContent = ''
    setTimeout(() => { if (announcerRef.current) announcerRef.current.textContent = msg }, 50)
  }, [])
  useEffect(() => {
    void savePlan(activePlan, planData)
  }, [activePlan, planData])

  useEffect(() => {
    saveCompleted(completedCourses)
  }, [completedCourses])

  useEffect(() => {
    if (!reqProgram && programs[0]?.id) setReqProgram(programs[0].id)
  }, [programs, reqProgram])

  useEffect(() => {
    return () => {
      if (exportMsgTimeoutRef.current) clearTimeout(exportMsgTimeoutRef.current)
      if (copyPlanTimeoutRef.current) clearTimeout(copyPlanTimeoutRef.current)
      if (saveLoadTimeoutRef.current) clearTimeout(saveLoadTimeoutRef.current)
    }
  }, [])

  // ── (a) Fetch live_courses ONCE on mount (all terms, semester-independent) ──
  // Uses hardcoded-credential supabase client so it always works in Cloudflare Pages.
  // We fetch ALL terms up-front; term filtering happens client-side in filteredSearchResults.
  // Keeping this separate from course_sections prevents liveCoursesData from flashing
  // empty when the user changes semester (which was causing Non-HKS browse to disappear).
  useEffect(() => {
    supabase
      .from('live_courses')
      .select('id,course_code,course_code_base,title,term,credits,instructors,meeting_days,time_start,time_end,school,is_hks,session_code,session_description,cross_reg_eligible')
      .order('term', { ascending: false })
      .limit(2000)
      .then(({ data }) => setLiveCoursesData(Array.isArray(data) ? data : []))
      .catch(() => {})
  }, []) // run once — all terms are fetched; client-side filter picks the right semester

  // ── (b) Fetch course_sections on semester/year change ──
  // course_sections holds HKS schedule data (meeting times) for a specific semester.
  // Uses our internal term format without space: '2026Spring', '2025Fall', etc.
  useEffect(() => {
    setSectionTimesMap(new Map())
    setSectionCanonicalCodes(new Set())
    setSectionInfoMap(new Map())
    setSectionTimesLoading(true)
    const termStrInternal = `${semesterYear}${semester === 'January' ? 'January' : semester}`
    supabase
      .from('course_sections')
      .select('course_code_base,meetings,title,instructors,credits')
      .eq('term', termStrInternal)
      .limit(2000)
      .then(({ data }) => {
        const sectionRows = data || []
        const map = new Map()
        const canonical = new Set()
        const infoMap = new Map()
        ;(Array.isArray(sectionRows) ? sectionRows : []).forEach((row) => {
          if (!row.course_code_base || !Array.isArray(row.meetings) || !row.meetings.length) return
          const meetings = row.meetings
          const code = row.course_code_base
          map.set(code, meetings)
          canonical.add(code)
          if (row.title || row.instructors?.length || row.credits != null) {
            infoMap.set(code, {
              title: row.title || null,
              instructors: Array.isArray(row.instructors) ? row.instructors : [],
              credits: row.credits != null ? Number(row.credits) : null,
            })
          }
          const withDash = code.replace(/([0-9])([A-Z])/, '$1-$2')
          if (withDash !== code) map.set(withDash, meetings)
          const base = code.replace(/-?[A-Z]+$/, '')
          if (base !== code && !map.has(base)) map.set(base, meetings)
        })
        setSectionTimesMap(map)
        setSectionCanonicalCodes(canonical)
        setSectionInfoMap(infoMap)
        setSectionTimesLoading(false)
      })
      .catch(() => setSectionTimesLoading(false))
  }, [semesterYear, semester])

  useEffect(() => {
    const query = searchQ.trim()
    const searchFilters = { concentration: searchConcentration, stem: searchStem, coreOnly: searchCoreOnly, semester, searchSource, minRating: searchMinRating, allYears: searchMode === 'history' }
    const hasFilters = (searchConcentration !== 'All') || (searchStem !== 'all') || searchCoreOnly || (searchSource === 'Non-HKS') || Boolean(searchMinRating) || browseAll
    // SC-22: all-years mode requires a typed query — otherwise it would return thousands of courses
    if (searchMode === 'history' && !query) {
      setSearching(false)
      setSearchResults([])
      return undefined
    }
    // Live browse (no query): serve directly from live_courses Supabase table — instant, no API call.
    // Covers Non-HKS, specific school, and All source modes.
    const liveBrowse = !query && searchMode === 'live' && searchSource !== 'HKS'
    if (liveBrowse && liveCoursesData.length > 0) {
      const rows = searchSource === 'Non-HKS'
        ? liveCoursesData.filter((r) => !r.is_hks)
        : liveCoursesData  // All: show every school
      const normalized = rows.map((r, i) => normalizeCourse({
        courseCode:   r.course_code || r.course_code_base,
        title:        r.title || '',
        instructors:  Array.isArray(r.instructors) ? r.instructors : [],
        credits:      r.credits,
        sections:     [],
        meeting_days: r.meeting_days || null,
        time_start:   r.time_start   || null,
        time_end:     r.time_end     || null,
        location:     r.location     || null,
        term:         r.term         || null,
        _fromLiveDB:  true,
      }, i))
      setApiMode('live')
      setSearchResults(normalized)
      setSearching(false)
      return undefined
    }
    // effectiveQuery: typed query, or 'a' as browse seed when live_courses table is still empty
    const effectiveQuery = query || (liveBrowse ? 'a' : '')
    if (!effectiveQuery && !hasFilters) {
      setSearching(false)
      setSearchResults([])
      setApiMode('db')
      return undefined
    }
    let cancelled = false
    if (query && browseAll) setBrowseAll(false)
    setBrowseLimit(25) // reset pagination on any new search
    const timer = window.setTimeout(async () => {
      setSearching(true)
      try {
        // Use live API when mode=live and we have a query (typed or browse seed)
        if (effectiveQuery && searchMode === 'live') {
          const semesterKey = semester === 'January' ? 'January' : semester
          const apiOptions = { term: `${semesterYear}${semesterKey}` }
          // Pass school to proxy — specific school selections use 'Non-HKS' + client-side filter
          if (searchSource === 'HKS') apiOptions.school = 'HKS'
          else if (searchSource === 'Non-HKS') apiOptions.school = 'Non-HKS'
          else if (searchSource === 'All') apiOptions.school = 'All'
          else apiOptions.school = 'Non-HKS' // specific school: fetch Non-HKS, filter client-side
          const remote = await searchHarvardCourses(effectiveQuery, apiOptions)
          if (cancelled) return
          // Proxy returns { results: [...], total: N } — extract .results array
          const remoteArr = Array.isArray(remote) ? remote : (Array.isArray(remote?.results) ? remote.results : [])
          let normalized = remoteArr.map((item, index) => normalizeCourse(item, index))
          // Apply client-side filters to live results
          if (searchSource === 'HKS') normalized = normalized.filter((c) => isHksCourse(c.courseCode))
          if (searchSource === 'Non-HKS') normalized = normalized.filter((c) => !isHksCourse(c.courseCode))
          if (searchStem === 'stem') normalized = normalized.filter((c) => c.enrichment?.is_stem)
          if (searchStem === 'nonstem') normalized = normalized.filter((c) => !c.enrichment?.is_stem)
          if (searchCoreOnly) normalized = normalized.filter((c) => c.enrichment?.is_core)
          if (normalized.length) {
            setApiMode('live')
            setSearchResults(normalized)
          } else {
            // API returned nothing — fall back to DB for HKS; Non-HKS browse stays empty (not in DB)
            setApiMode('db')
            setSearchResults(query && searchSource !== 'Non-HKS' ? fallbackSearch(query, courses, searchFilters).map((item, index) => normalizeCourse(item, index)) : [])
          }
        } else {
          // History DB search (searchMode=history + query), or filter-only mode
          if (cancelled) return
          setApiMode('db')
          setSearchResults(fallbackSearch(effectiveQuery, courses, searchFilters).map((item, index) => normalizeCourse(item, index)))
        }
      } catch {
        if (!cancelled) {
          setApiMode('db')
          setSearchResults(query ? fallbackSearch(query, courses, searchFilters).map((item, index) => normalizeCourse(item, index)) : [])
        }
      } finally {
        if (!cancelled) setSearching(false)
      }
    }, searchMode === 'history' ? 100 : 400)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [browseAll, courses, searchQ, searchConcentration, searchStem, searchCoreOnly, searchSource, semester, semesterYear, searchMinRating, searchMode, liveCoursesData])

  // TIME_SLOTS removed — replaced with From/To time inputs (searchTimeFrom / searchTimeTo)

  // Step 1 — enrich search results with live section times from sectionTimesMap.
  // Mirrors exactly what planCoursesEnriched does for plan courses.
  // This is why search cards showed "NO TIME DATA" — the map was never applied here.
  const enrichedSearchResults = useMemo(() => {
    return searchResults.map((course) => {
      if (courseHasSchedule(course)) return course // already has time data (e.g. from Harvard API or DB)
      const code = course.courseCode
      const meetings =
        sectionTimesMap.get(code) ||
        sectionTimesMap.get(code.replace(/-[A-Z]$/, '')) ||    // strip trailing -D/-E: DPI-802-M-D → DPI-802-M
        sectionTimesMap.get(code.split('-').slice(0, 2).join('-'))  // base: DPI-802
      if (!meetings?.length) return course // genuinely no data
      const allDays = [...new Set(meetings.map((m) => m.day))].join('/')
      return {
        ...course,
        meeting_days: allDays,
        time_start: meetings[0].start,
        time_end: meetings[0].end,
        location: meetings[0].location || course.location,
        _hasLiveTimes: true,
      }
    })
  }, [searchResults, sectionTimesMap])

  // Step 1b — generate stub courses from sectionTimesMap for courses not returned by DB search.
  // Iterates CANONICAL codes only (original keys from course_sections, not aliases) to avoid duplicates.
  const sectionMapStubs = useMemo(() => {
    if (sectionCanonicalCodes.size === 0 || sectionTimesLoading) return []
    const q = searchQ.trim().toLowerCase()
    // Build base-ID set from DB results so DPI-802-M-D and DPI-802M both normalise to DPI-802
    const existingBaseIds = new Set(searchResults.map((r) => getBaseCourseId(r.courseCode)))
    const stubs = []
    // Build a quick lookup for historical course data by normalized code
    const histMap = new Map()
    const histMapByBase = new Map() // fallback: getBaseCourseId(key) → course
    ;(Array.isArray(courses) ? courses : []).filter((c) => !c?.is_average).forEach((c) => {
      const key = c.course_code_base || c.course_code
      if (!key) return
      const existing = histMap.get(key)
      if (!existing || Number(c.year || 0) > Number(existing.year || 0)) histMap.set(key, c)
      const baseKey = getBaseCourseId(key)
      const existingBase = histMapByBase.get(baseKey)
      if (!existingBase || Number(c.year || 0) > Number(existingBase.year || 0)) histMapByBase.set(baseKey, c)
    })
    for (const code of sectionCanonicalCodes) {
      if (existingBaseIds.has(getBaseCourseId(code))) continue  // already covered by DB result
      const hks = isHksCourse(code)
      if (searchSource === 'HKS' && !hks) continue
      if (searchSource === 'Non-HKS' && hks) continue
      // Text query filter — match on course code or historical title
      if (q) {
        const hist = histMap.get(code) || histMapByBase.get(getBaseCourseId(code))
        const secInfo = sectionInfoMap.get(code)
        const codeMatch = code.toLowerCase().includes(q)
        const titleMatch = String(hist?.course_name || secInfo?.title || '').toLowerCase().includes(q)
        const instrMatch = String(hist?.professor_display || hist?.professor || (secInfo?.instructors || []).join(' ') || '').toLowerCase().includes(q)
        if (!codeMatch && !titleMatch && !instrMatch) continue
      }
      const meetings = sectionTimesMap.get(code)
      if (!meetings?.length) continue
      const hist = histMap.get(code) || histMapByBase.get(getBaseCourseId(code))
      const secInfo = sectionInfoMap.get(code)  // title/instructors stored from course_sections (key for non-HKS courses)
      const allDays = [...new Set(meetings.map((m) => m.day))].join('/')
      stubs.push(normalizeCourse({
        courseCode: code,
        title: hist?.course_name || secInfo?.title || code,
        instructors: hist ? [hist?.professor_display || hist?.professor].filter(Boolean) : (secInfo?.instructors || []),
        credits: Number(hist?.credits_min ?? hist?.credits_max ?? hist?.credits ?? secInfo?.credits ?? 4) || 4,
        sections: [],
        meeting_days: allDays,
        time_start: meetings[0]?.start || '',
        time_end: meetings[0]?.end || '',
        location: meetings[0]?.location || '',
        enrichment: {
          is_stem: hist?.is_stem ?? false,
          is_core: hist?.is_core ?? false,
          metrics_pct: hist?.metrics_pct ?? null,
          bid_clearing_price: hist?.bid_clearing_price ?? null,
          last_bid_price: hist?.last_bid_price ?? null,
        },
        _fromSections: true,
      }, 10000 + stubs.length))
    }
    return stubs
  }, [sectionCanonicalCodes, sectionTimesMap, sectionInfoMap, sectionTimesLoading, searchResults, searchQ, searchSource, courses])

  // Step 2 — apply day-of-week and time-slot filters on the enriched results.
  // Courses that still have no schedule data pass through (can't exclude the unknown).
  const filteredSearchResults = useMemo(() => {
    const hasTypedQuery = searchQ.trim().length > 0

    // ── Browse mode: no typed query + live mode ─────────────────────────────
    // Synchronously derive from liveCoursesData — avoids the race condition where
    // the search effect fires before the Supabase fetch completes (liveCoursesData=[]).
    // live_courses stores terms as "YYYY Semester" (e.g. "2026 Spring", "2025 Fall").
    const apiTerm = `${semesterYear} ${semester === 'January' ? 'January' : semester}`
    // Specific school codes that can be selected (all are non-HKS Harvard schools or NONH)
    const SPECIFIC_SCHOOLS = new Set(['HLS', 'HGSE', 'HMS', 'HSPH', 'FAS', 'GSD', 'HBS', 'HDS', 'NONH'])
    const isSpecificSchool = SPECIFIC_SCHOOLS.has(searchSource)
    const isBrowseLive = !hasTypedQuery && searchMode === 'live' &&
      searchSource !== 'HKS' && liveCoursesData.length > 0

    let allResults
    if (isBrowseLive) {
      let liveRows = liveCoursesData.filter((r) => r.term === apiTerm)
      // Apply school filter
      if (searchSource === 'Non-HKS') liveRows = liveRows.filter((r) => !r.is_hks)
      else if (searchSource === 'HBS') liveRows = liveRows.filter((r) => r.school === 'HBSD' || r.school === 'HBSM')
      else if (isSpecificSchool) liveRows = liveRows.filter((r) => r.school === searchSource)
      // else searchSource === 'All': show every school
      // Cross-reg filter: use cross_reg_eligible field when available, else fall back to school check
      if (filterCrossRegOnly && searchSource !== 'NONH') {
        liveRows = liveRows.filter((r) => {
          if (r.cross_reg_eligible) return r.cross_reg_eligible.toLowerCase() !== 'n'
          return r.school !== 'NONH' // legacy fallback
        })
      }
      // Session filter (Full Term / Spring 1 / Spring 2 / January)
      if (searchSession !== 'all') {
        liveRows = liveRows.filter((r) => r.session_description === searchSession)
      }
      allResults = liveRows.map((r, i) => {
        const norm = normalizeCourse({
          courseCode:   r.course_code || r.course_code_base,
          title:        r.title || '',
          instructors:  Array.isArray(r.instructors) ? r.instructors : [],
          credits:      r.credits,
          sections:     [],
          meeting_days: r.meeting_days || null,
          time_start:   r.time_start   || null,
          time_end:     r.time_end     || null,
          location:     r.location     || null,
          term:         r.term         || null,
        }, i)
        // Mark as having live times if schedule data exists (drives sort + UI badge)
        if (norm.meeting_days && norm.time_start) norm._hasLiveTimes = true
        return norm
      })
    } else {
      // Typed query, history mode, or HKS browse — use enrichedSearchResults + stubs
      // Merge DB-enriched results with section stubs (currently-offered courses not in Q-guide)
      const useStubs = sectionMapStubs.length > 0 && searchMode === 'live' && (
        apiMode === 'db' ||
        (apiMode === 'live' && (searchSource === 'All' || searchSource === 'Non-HKS') && hasTypedQuery)
      )
      allResults = useStubs ? [...enrichedSearchResults, ...sectionMapStubs] : enrichedSearchResults
    }
    const fromMinutes = searchTimeFrom ? minutesFromValue(searchTimeFrom) : null
    const toMinutes = searchTimeTo ? minutesFromValue(searchTimeTo) : null
    const results = allResults.filter((course) => {
      // --- Day filter ---
      if (searchDays.length > 0) {
        const days = extractDays(course.meeting_days)
        if (days.length > 0) {
          const upperDays = days.map((d) => String(d).toUpperCase().slice(0, 3))
          if (!upperDays.every((d) => searchDays.includes(d))) return false
        }
      }
      // --- Time from/to filter ---
      if (fromMinutes != null || toMinutes != null) {
        const startMin = minutesFromValue(course.time_start)
        if (startMin != null) {
          if (fromMinutes != null && startMin < fromMinutes) return false
          if (toMinutes != null && startMin >= toMinutes) return false
        }
        // no time data → passes through
      }
      // --- Credit filter ---
      if (searchCredits && course.credits != null) {
        if (Number(course.credits) !== Number(searchCredits)) return false
      }
      return true
    })
    // Deduplicate by courseCode (stubs may overlap with enriched results)
    const seen = new Set()
    const deduped = results.filter((c) => { if (seen.has(c.courseCode)) return false; seen.add(c.courseCode); return true })
    return deduped.sort((a, b) => {
      const aHasTime = courseHasSchedule(a) || a._hasLiveTimes
      const bHasTime = courseHasSchedule(b) || b._hasLiveTimes
      if (aHasTime === bHasTime) return 0
      return aHasTime ? -1 : 1
    })
  }, [liveCoursesData, enrichedSearchResults, sectionMapStubs, apiMode, searchDays, searchTimeFrom, searchTimeTo, searchCredits, searchMode, searchSource, searchQ, semester, semesterYear, filterCrossRegOnly])

  const concentrationOptions = useMemo(() => {
    const seen = new Set()
    ;(Array.isArray(courses) ? courses : []).forEach((c) => { if (c?.concentration) seen.add(c.concentration) })
    return ['All', ...[...seen].sort()]
  }, [courses])

  // Search results for the "Completed" section — searches all years for any HKS course
  const completedSearchResults = useMemo(() => {
    const q = completedSearchQ.trim().toLowerCase()
    if (!q) return []
    return (Array.isArray(courses) ? courses : [])
      .filter((c) => !c?.is_average && isHksCourse(c?.course_code_base || c?.course_code))
      .filter((c) => [c?.course_code, c?.course_name, c?.professor, c?.professor_display].filter(Boolean).join(' ').toLowerCase().includes(q))
      .sort((a, b) => Number(b?.year || 0) - Number(a?.year || 0))
      // Deduplicate by course_code_base — keep most recent
      .reduce((acc, c) => {
        const key = c.course_code_base || c.course_code
        if (!acc.seen.has(key)) { acc.seen.add(key); acc.list.push(c) }
        return acc
      }, { seen: new Set(), list: [] }).list
      .slice(0, 20)
  }, [completedSearchQ, courses])

  // Historical ratings map: course_code_base → metrics_pct from best available row
  // Prefer is_average rows (multi-year aggregate), fall back to most recent year with actual rating values
  const histRatingsMap = useMemo(() => {
    const map = new Map()
    ;(Array.isArray(courses) ? courses : []).forEach((c) => {
      const key = c.course_code_base || c.course_code
      if (!key || !hasMeaningfulRatings(c.metrics_pct)) return
      const existing = map.get(key)
      // Prefer is_average (aggregate) over single-year; among same type prefer newer
      const isBetter = !existing
        || (c.is_average && !existing._isAvg)
        || (!c.is_average && !existing._isAvg && Number(c.year || 0) > Number(existing._year || 0))
      if (isBetter) map.set(key, { metrics_pct: c.metrics_pct, _isAvg: !!c.is_average, _year: c.year })
    })
    return map
  }, [courses])

  const normalizedPlanCourses = useMemo(() => (Array.isArray(planData?.courses) ? planData.courses : []).map((course, index) => normalizeCourse(course, index)), [planData])
  // Enrich plan courses with Supabase meeting times + historical ratings where missing.
  const planCoursesEnriched = useMemo(() => normalizedPlanCourses.map((course) => {
    let enriched = course
    // 1. Inject historical ratings if current enrichment has no meaningful ratings
    if (!hasMeaningfulRatings(enriched.enrichment?.metrics_pct)) {
      // Try exact code → 3-part base (DPI-802-M) → 2-part base (DPI-802)
      const parts = enriched.courseCode.split('-')
      const threeBase = parts.slice(0, 3).join('-') // e.g. DPI-802-M
      const twoBase = parts.slice(0, 2).join('-')   // e.g. DPI-802
      const hist = histRatingsMap.get(enriched.courseCode) || histRatingsMap.get(threeBase) || histRatingsMap.get(twoBase)
      if (hist) {
        enriched = { ...enriched, enrichment: { ...(enriched.enrichment || {}), metrics_pct: hist.metrics_pct, _ratingFromHistory: true } }
      }
    }
    // 2. Inject live section times if schedule not yet present
    if (courseHasSchedule(enriched)) return enriched
    const eCode = enriched.courseCode
    const meetings =
      sectionTimesMap.get(eCode) ||
      sectionTimesMap.get(eCode.replace(/-[A-Z]$/, '')) ||
      sectionTimesMap.get(eCode.split('-').slice(0, 2).join('-'))
    if (!meetings?.length) return enriched
    const allDays = [...new Set(meetings.map((m) => m.day))].join('/')
    return {
      ...enriched,
      meeting_days: allDays,
      time_start: meetings[0].start,
      time_end: meetings[0].end,
      location: meetings[0].location || enriched.location,
      _hasLiveTimes: true,
    }
  }), [normalizedPlanCourses, sectionTimesMap, histRatingsMap])
  // Compute per-category averages across all plan courses that have ratings
  const planRatings = useMemo(() => {
    const METRICS = [
      { key: 'Instructor_Rating', label: 'Instructor' },
      { key: 'Course_Rating',     label: 'Course' },
      { key: 'Workload',          label: 'Workload' },
      { key: 'Rigor',             label: 'Rigor' },
    ]
    const result = []
    for (const { key, label } of METRICS) {
      const rated = planCoursesEnriched.filter((c) => c.enrichment?.metrics_pct?.[key] != null)
      if (!rated.length) continue
      const avg = rated.reduce((sum, c) => sum + Number(c.enrichment.metrics_pct[key]), 0) / rated.length
      result.push({ label, value: avg.toFixed(0), n: rated.length })
    }
    return result
  }, [planCoursesEnriched])
  const gridCourses = useMemo(() => planCoursesEnriched.filter((course) => course.isOnGrid), [planCoursesEnriched])
  const conflicts = useMemo(() => findConflicts(gridCourses), [gridCourses])
  const conflictSet = useMemo(() => {
    const next = new Set()
    conflicts.forEach(([left, right]) => {
      if (left?.courseCode) next.add(left.courseCode)
      if (right?.courseCode) next.add(right.courseCode)
    })
    return next
  }, [conflicts])
  const normalizedCompletedCourses = useMemo(() => completedCourses.map((c, i) => normalizeCourse({ ...c, _isCompleted: true }, i)), [completedCourses])
  const progress = useMemo(() => (reqProgram ? computeProgress(reqProgram, normalizedPlanCourses, normalizedCompletedCourses) : null), [normalizedPlanCourses, normalizedCompletedCourses, reqProgram])
  const addedCourseCodes = useMemo(() => new Set(normalizedPlanCourses.map((course) => course.courseCode)), [normalizedPlanCourses])
  const completedCourseCodes = useMemo(() => new Set(normalizedCompletedCourses.map((c) => c.courseCode)), [normalizedCompletedCourses])
  const visibleDayLabels = showWeekends ? [...WEEKDAY_LABELS, ...WEEKEND_LABELS] : WEEKDAY_LABELS
  const numDays = visibleDayLabels.length
  const gridCols = `52px repeat(${numDays}, minmax(0, 1fr))`

  // Starred courses from the Home shortlist that aren't already in this plan
  const shortlistedSuggestions = useMemo(() => {
    if (!favorites?.size || !courses.length) return []
    // Deduplicate by course_code_base — take the most recent year per code
    const seenCodes = new Set()
    const deduped = []
    const sorted = [...courses].filter((c) => !c.is_average && favorites.has(c.course_code_base || c.course_code) && !addedCourseCodes.has(c.course_code_base || c.course_code)).sort((a, b) => (b.year || 0) - (a.year || 0))
    for (const c of sorted) {
      const code = c.course_code_base || c.course_code
      if (!seenCodes.has(code)) { seenCodes.add(code); deduped.push(c) }
      if (deduped.length >= 6) break
    }
    return deduped.map((c) => ({
        courseCode: c.course_code_base || c.course_code,
        title: c.course_name,
        instructors: [c.professor_display || c.professor].filter(Boolean),
        credits: 4,
        sections: [],
        enrichment: {
          is_core: c.is_core,
          is_stem: c.is_stem,
          metrics_pct: c.metrics_pct,
          bid_clearing_price: c.bid_clearing_price,
          last_bid_price: c.last_bid_price,
        },
        _fromDB: true,
      })
    )
  }, [favorites, courses, addedCourseCodes])

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
    announce(`Added ${normalized.courseCode} to plan`)
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
    announce(`Removed ${courseCode} from plan`)
    setExpandedBlock((current) => (current === courseCode ? null : current))
    setGridMessages((current) => {
      if (!current[courseCode]) return current
      const next = { ...current }
      delete next[courseCode]
      return next
    })
  }
  const addToCompleted = (course) => {
    const normalized = normalizeCourse(course)
    setCompletedCourses((prev) => {
      if (prev.some((c) => normalizeCourse(c).courseCode === normalized.courseCode)) return prev
      return [...prev, { ...normalized, _isCompleted: true }]
    })
    announce('Marked as completed')
  }
  const removeFromCompleted = (courseCode) => {
    setCompletedCourses((prev) => prev.filter((c) => normalizeCourse(c).courseCode !== courseCode))
  }
  const handleQuickAddCompleted = () => {
    const courseCode = completedInput.trim().toUpperCase()
    if (!courseCode) return
    const found = (Array.isArray(courses) ? courses : [])
      .filter((c) => !c?.is_average)
      .find((c) => {
        const code = String(c?.course_code_base || c?.course_code || '').toUpperCase()
        return code === courseCode || code.startsWith(courseCode + '-') || courseCode.startsWith(code)
      })
    if (found) {
      addToCompleted(normalizeCourse({
        courseCode: found.course_code_base || found.course_code,
        title: found.course_name || courseCode,
        instructors: [found.professor_display || found.professor].filter(Boolean),
        credits: Number(found.credits_min ?? found.credits_max ?? found.credits ?? 4) || 4,
        sections: [],
        is_stem: found.is_stem,
        is_core: found.is_core,
        metrics_pct: found.metrics_pct,
        enrichment: {
          is_stem: found.is_stem,
          is_core: found.is_core,
          metrics_pct: found.metrics_pct,
          bid_clearing_price: found.bid_clearing_price,
          last_bid_price: found.last_bid_price,
        },
      }))
    } else {
      addToCompleted({
        courseCode,
        title: courseCode,
        credits: 4,
        sections: [],
        instructors: [],
        enrichment: {},
      })
    }
    setCompletedInput('')
  }
  const applyManualTime = (courseCode) => {
    const edit = manualTimeEdit[courseCode]
    if (!edit || !edit.days?.length || !edit.start || !edit.end) return
    // SC-38c: write times AND set isOnGrid:true in one operation (single-click flow)
    setPlanData((current) => ({
      ...current,
      courses: (Array.isArray(current?.courses) ? current.courses : []).map((course) => {
        const normalized = normalizeCourse(course)
        if (normalized.courseCode !== courseCode) return course
        return {
          ...normalized,
          meeting_days: edit.days.join('/'),
          time_start: edit.start,
          time_end: edit.end,
          isOnGrid: true,
        }
      }),
    }))
    setManualTimeEdit((prev) => { const next = { ...prev }; delete next[courseCode]; return next })
    setGridMessages((msgs) => { const next = { ...msgs }; delete next[courseCode]; return next })
  }
  const toggleGrid = (courseCode) => {
    // Use the enriched version (has Supabase times merged in) for both the
    // schedule check and writing times back into planData so they persist.
    const enrichedCourse = planCoursesEnriched.find((c) => c.courseCode === courseCode)
    setPlanData((current) => ({
      ...current,
      name: activePlan,
      courses: (Array.isArray(current?.courses) ? current.courses : []).map((course) => {
        const normalized = normalizeCourse(course)
        if (normalized.courseCode !== courseCode) return course
        const courseWithTimes = enrichedCourse || normalized
        if (!courseWithTimes.isOnGrid && !courseHasSchedule(courseWithTimes)) {
          setGridMessages((messages) => ({
            ...messages,
            [courseCode]: 'No schedule data — this course has no time slot in our database yet',
          }))
          return course
        }
        setGridMessages((messages) => {
          if (!messages[courseCode]) return messages
          const next = { ...messages }
          delete next[courseCode]
          return next
        })
        // Write enriched times into planData so they survive re-renders
        return { ...courseWithTimes, isOnGrid: !courseWithTimes.isOnGrid }
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
    const exportable = normalizedPlanCourses.filter((c) => c.isOnGrid && courseHasSchedule(c))
    if (exportable.length === 0) {
      if (exportMsgTimeoutRef.current) clearTimeout(exportMsgTimeoutRef.current)
      setExportMsg({ text: 'Place courses on the grid with time data to export', error: true })
      exportMsgTimeoutRef.current = setTimeout(() => setExportMsg(null), 3500)
      return
    }
    const blob = buildIcs(normalizedPlanCourses, term, semester)
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `${activePlan.toLowerCase().replace(/\s+/g, '-')}-${term.toLowerCase()}.ics`
    anchor.style.display = 'none'
    document.body.appendChild(anchor)
    anchor.click()
    document.body.removeChild(anchor)
    setTimeout(() => URL.revokeObjectURL(url), 100)
    if (exportMsgTimeoutRef.current) clearTimeout(exportMsgTimeoutRef.current)
    setExportMsg({ text: `Downloaded ${exportable.length} event${exportable.length === 1 ? '' : 's'} ↓`, error: false })
    announce(`Exported ${exportable.length} calendar events`)
    exportMsgTimeoutRef.current = setTimeout(() => setExportMsg(null), 3000)
  }

  const handleCopyPlan = () => {
    if (!normalizedPlanCourses.length) return
    const totalCr = normalizedPlanCourses.reduce((sum, c) => sum + (c.credits || 4), 0)
    const lines = [
      `${activePlan} — ${totalCr} credits`,
      '',
      ...normalizedPlanCourses.map((c) => {
        const instructor = c.instructors?.length ? ` — ${c.instructors[0]}` : ''
        return `• ${c.courseCode}: ${c.title} (${c.credits || 4} cr)${instructor}`
      }),
    ]
    navigator.clipboard.writeText(lines.join('\n')).then(() => {
      if (copyPlanTimeoutRef.current) clearTimeout(copyPlanTimeoutRef.current)
      setCopyPlanMsg('Copied!')
      announce('Plan copied to clipboard')
      copyPlanTimeoutRef.current = setTimeout(() => setCopyPlanMsg(null), 2500)
    }).catch(() => {
      if (copyPlanTimeoutRef.current) clearTimeout(copyPlanTimeoutRef.current)
      setCopyPlanMsg('Failed')
      copyPlanTimeoutRef.current = setTimeout(() => setCopyPlanMsg(null), 2500)
    })
  }

  const handleSavePlan = () => {
    try {
      // Snapshot all 4 plans + completed list
      const snapshot = {
        version: 1,
        savedAt: new Date().toISOString(),
        activePlan,
        plans: Object.fromEntries(PLANS.map((name) => [name, loadPlan(name)])),
        completedCourses,
      }
      const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `hks-plan-${activePlan.toLowerCase().replace(/\s+/g, '-')}-${new Date().toISOString().slice(0, 10)}.json`
      a.click()
      URL.revokeObjectURL(url)
      if (saveLoadTimeoutRef.current) clearTimeout(saveLoadTimeoutRef.current)
      setSaveLoadMsg('Saved!')
      saveLoadTimeoutRef.current = setTimeout(() => setSaveLoadMsg(null), 2500)
    } catch {
      setSaveLoadMsg('Error saving')
      saveLoadTimeoutRef.current = setTimeout(() => setSaveLoadMsg(null), 2500)
    }
  }

  const handleLoadPlan = (event) => {
    const file = event.target.files?.[0]
    if (!file) return
    // Reset input so same file can be re-selected
    event.target.value = ''
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const snapshot = JSON.parse(e.target.result)
        if (!snapshot?.plans || snapshot.version !== 1) throw new Error('Invalid file')
        // Restore all plans
        PLANS.forEach((name) => { if (snapshot.plans[name]) savePlan(name, snapshot.plans[name]) })
        // Restore completed courses
        if (Array.isArray(snapshot.completedCourses)) {
          setCompletedCourses(snapshot.completedCourses)
        }
        // Switch to the active plan from the snapshot
        const planToLoad = PLANS.includes(snapshot.activePlan) ? snapshot.activePlan : PLANS[0]
        setActivePlan(planToLoad)
        setPlanData(loadPlan(planToLoad))
        if (saveLoadTimeoutRef.current) clearTimeout(saveLoadTimeoutRef.current)
        setSaveLoadMsg('Loaded!')
        saveLoadTimeoutRef.current = setTimeout(() => setSaveLoadMsg(null), 2500)
      } catch {
        if (saveLoadTimeoutRef.current) clearTimeout(saveLoadTimeoutRef.current)
        setSaveLoadMsg('Invalid file')
        saveLoadTimeoutRef.current = setTimeout(() => setSaveLoadMsg(null), 2500)
      }
    }
    reader.readAsText(file)
  }

  const handleSearchKeyDown = (event) => {
    if (event.key !== 'Enter') return
    const firstUnadded = filteredSearchResults.find((r) => !addedCourseCodes.has(r.courseCode))
    if (firstUnadded) { addToShortlist(firstUnadded); return }
    // SC-21/SC-38c: manual add for Non-HKS AND All modes — if no results, create a cross-reg stub
    // Do NOT auto-create for HKS mode (all HKS courses should be in our DB)
    const q = searchQ.trim()
    if (searchSource !== 'HKS' && q && filteredSearchResults.length === 0) {
      const code = q.toUpperCase().replace(/\s+/g, '-')
      if (!addedCourseCodes.has(code)) {
        openManualModal(code)
      }
    }
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

  const blocks = useMemo(() => planCoursesEnriched.filter((course) => course.isOnGrid && courseHasSchedule(course)).flatMap((course) => {
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
  }), [planCoursesEnriched])

  return (
    <div className="h-full overflow-hidden">
      <div
        ref={announcerRef}
        aria-live="polite"
        aria-atomic="true"
        style={{ position: 'absolute', width: 1, height: 1, padding: 0, margin: -1, overflow: 'hidden', clip: 'rect(0,0,0,0)', whiteSpace: 'nowrap', border: 0 }}
      />
      {/* ── Mobile gate — Schedule Builder needs a wide screen ── */}
      <div className="flex h-full flex-col items-center justify-center gap-6 overflow-y-auto px-6 py-12 text-center md:hidden">
        <div
          className="w-full max-w-sm rounded-[28px] border p-8"
          style={{ background: 'var(--panel)', borderColor: 'var(--line)' }}
        >
          <div style={{ fontSize: 48, lineHeight: 1 }}>🗓</div>
          <h1 className="serif-display mt-4 text-2xl font-semibold" style={{ color: 'var(--text)' }}>Schedule Builder</h1>
          <p className="mt-3 text-sm leading-6" style={{ color: 'var(--text-muted)' }}>
            The timetable grid needs a wider screen. Open this page on a laptop or tablet in landscape mode.
          </p>
          <div className="mt-2 rounded-2xl border px-4 py-3 text-left text-xs" style={{ borderColor: 'var(--line)', background: 'var(--panel-subtle)' }}>
            <p className="font-semibold" style={{ color: 'var(--text-soft)' }}>💡 Tip</p>
            <p className="mt-1" style={{ color: 'var(--text-muted)' }}>
              Star courses on the Courses tab and they'll appear in the Schedule Builder when you switch to desktop.
            </p>
          </div>
        </div>
        <div className="flex w-full max-w-sm flex-col gap-3">
          <a
            href="/courses"
            className="flex items-center justify-center gap-2 rounded-full border px-4 py-3 text-sm font-semibold transition-transform hover:-translate-y-[1px]"
            style={{ background: 'var(--accent)', borderColor: 'var(--accent)', color: '#fff' }}
          >
            📖 Browse Courses
          </a>
          <a
            href="/requirements"
            className="flex items-center justify-center gap-2 rounded-full border px-4 py-3 text-sm font-semibold transition-transform hover:-translate-y-[1px]"
            style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)', color: 'var(--text)' }}
          >
            ✅ Requirements Tracker
          </a>
        </div>
      </div>

      <div className="hidden h-full flex-col md:flex">
        <div className="flex items-center justify-between gap-6 border-b px-6 py-4" style={{ borderColor: 'var(--line)', background: 'var(--panel)' }}>
          <div className="flex items-end gap-4">
            <div>
              <p className="kicker">Advanced Planning</p>
              <h1 className="serif-display mt-2 text-3xl font-semibold" style={{ color: 'var(--text)' }}>Schedule Builder</h1>
            </div>
            <div data-tour="plan-tabs" className="flex gap-2">
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

          <div className="flex items-center gap-3">
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
            <button
              type="button"
              onClick={() => setShowWeekends((v) => !v)}
              title="Show Saturday and Sunday columns"
              className="rounded-full border px-3 py-2 text-sm font-semibold transition-colors"
              style={{
                background: showWeekends ? 'var(--panel-subtle)' : 'transparent',
                borderColor: showWeekends ? 'var(--line-strong)' : 'var(--line)',
                color: showWeekends ? 'var(--text)' : 'var(--text-muted)',
              }}
            >
              {showWeekends ? 'Hide Weekends' : '+ Weekends'}
            </button>
            {/* Hidden file input for JSON import */}
            <input ref={importInputRef} type="file" accept=".json,application/json" onChange={handleLoadPlan} className="hidden" aria-label="Load plan from JSON" />

            {/* Save / Load JSON */}
            <button
              type="button"
              onClick={handleSavePlan}
              title="Save all plans + completed courses to a JSON file"
              className="rounded-full border px-4 py-2 text-sm font-semibold transition-all hover:-translate-y-[1px]"
              style={{
                background: saveLoadMsg === 'Saved!' ? 'var(--success-soft)' : 'var(--panel-soft)',
                borderColor: saveLoadMsg === 'Saved!' ? 'var(--success)' : 'var(--line-strong)',
                color: saveLoadMsg === 'Saved!' ? 'var(--success)' : 'var(--text-soft)',
              }}
            >
              {saveLoadMsg === 'Saved!' ? '✓ Saved' : '💾 Save'}
            </button>
            <button
              type="button"
              onClick={() => importInputRef.current?.click()}
              title="Load a previously saved plan JSON file"
              className="rounded-full border px-4 py-2 text-sm font-semibold transition-all hover:-translate-y-[1px]"
              style={{
                background: saveLoadMsg === 'Loaded!' ? 'var(--success-soft)' : saveLoadMsg && saveLoadMsg !== 'Saved!' ? 'var(--warning-soft)' : 'var(--panel-soft)',
                borderColor: saveLoadMsg === 'Loaded!' ? 'var(--success)' : saveLoadMsg && saveLoadMsg !== 'Saved!' ? 'var(--warning)' : 'var(--line-strong)',
                color: saveLoadMsg === 'Loaded!' ? 'var(--success)' : saveLoadMsg && saveLoadMsg !== 'Saved!' ? 'var(--warning)' : 'var(--text-soft)',
              }}
            >
              {saveLoadMsg === 'Loaded!' ? '✓ Loaded' : saveLoadMsg && saveLoadMsg !== 'Saved!' ? `⚠ ${saveLoadMsg}` : '📂 Load'}
            </button>

            {normalizedPlanCourses.length > 0 && (
              <button
                type="button"
                onClick={handleCopyPlan}
                title="Copy plan as text for sharing with advisors"
                className="rounded-full border px-4 py-2 text-sm font-semibold transition-all hover:-translate-y-[1px]"
                style={{
                  background: copyPlanMsg === 'Copied!' ? 'rgba(100,180,100,0.12)' : 'var(--panel-soft)',
                  borderColor: copyPlanMsg === 'Copied!' ? 'var(--success)' : 'var(--line-strong)',
                  color: copyPlanMsg === 'Copied!' ? 'var(--success)' : 'var(--text-soft)',
                }}
              >
                {copyPlanMsg === 'Copied!' ? '✓ Copied' : copyPlanMsg || '📋 Copy Plan'}
              </button>
            )}
            <button
              type="button"
              onClick={handleExport}
              title={exportMsg?.text}
              className="rounded-full border px-4 py-2 text-sm font-semibold transition-all hover:-translate-y-[1px]"
              style={{
                background: exportMsg?.error ? 'var(--warning-soft)' : exportMsg ? 'var(--success-soft)' : 'var(--gold-soft)',
                borderColor: exportMsg?.error ? 'var(--warning)' : exportMsg ? 'var(--success)' : 'var(--gold)',
                color: exportMsg?.error ? 'var(--warning)' : exportMsg ? 'var(--success)' : 'var(--text)',
              }}
            >
              {exportMsg?.error ? '⚠ No grid courses' : exportMsg ? `✓ ${exportMsg.text}` : `${'\u{1F4C5}'} Export iCal`}
            </button>
          </div>
        </div>

        <div className="flex min-h-0 flex-1">
          <aside data-tour="schedule-search" className="flex h-full w-[280px] shrink-0 flex-col border-r" style={{ borderColor: 'var(--line)', background: 'var(--panel)' }}>
            <div className="border-b p-4" style={{ borderColor: 'var(--line)' }}>
              <div className="mb-2 flex items-center justify-between gap-2">
                <label className="text-xs font-semibold uppercase tracking-[0.12em]" style={{ color: 'var(--text-muted)' }}>Course Search</label>
                {apiMode !== 'unknown' && (
                  <span className="flex items-center gap-1 text-[11px] font-semibold" style={{ color: apiMode === 'live' ? 'var(--success)' : 'var(--text-muted)' }}>
                    <span className="h-1.5 w-1.5 rounded-full" style={{ background: apiMode === 'live' ? 'var(--success)' : 'var(--text-muted)' }} />
                    {apiMode === 'live' ? 'Live' : 'DB only'}
                  </span>
                )}
              </div>
              <input id="course-search" aria-label="Search courses and instructors" value={searchQ} onChange={(event) => setSearchQ(event.target.value)} onKeyDown={handleSearchKeyDown} placeholder="Search courses, instructors..." className="w-full rounded-2xl border px-4 py-3 text-sm outline-none transition-colors" style={{ background: 'var(--panel-soft)', borderColor: 'var(--line-strong)', color: 'var(--text)' }} />
              {/* Filter row */}
              <div className="mt-2 flex flex-col gap-1.5">
                <select
                  value={searchConcentration}
                  onChange={(e) => setSearchConcentration(e.target.value)}
                  className="w-full rounded-xl border px-2 py-1.5 text-xs"
                  style={{ background: 'var(--panel-soft)', borderColor: 'var(--line-strong)', color: 'var(--text)' }}
                  aria-label="Filter by concentration"
                >
                  {concentrationOptions.map((opt) => <option key={opt} value={opt}>{opt === 'All' ? 'All concentrations' : opt}</option>)}
                </select>
                <div className="flex gap-1.5">
                  <select
                    value={searchStem}
                    onChange={(e) => setSearchStem(e.target.value)}
                    className="flex-1 rounded-xl border px-2 py-1.5 text-xs"
                    style={{ background: 'var(--panel-soft)', borderColor: 'var(--line-strong)', color: 'var(--text)' }}
                    aria-label="Filter by STEM"
                  >
                    <option value="all">All types</option>
                    <option value="stem">STEM only</option>
                    <option value="nonstem">Non-STEM</option>
                  </select>
                  <button
                    type="button"
                    onClick={() => setSearchCoreOnly((v) => !v)}
                    className="hidden"
                    style={{
                      background: searchCoreOnly ? 'var(--accent-soft)' : 'var(--panel-soft)',
                      borderColor: searchCoreOnly ? 'var(--accent)' : 'var(--line-strong)',
                      color: searchCoreOnly ? 'var(--text)' : 'var(--text-muted)',
                    }}
                    aria-pressed={searchCoreOnly}
                  >
                    Core
                  </button>
                </div>
                {/* Year + Semester selectors */}
                <div className="flex gap-1.5">
                  <select
                    value={semesterYear}
                    onChange={(e) => setSemesterYear(e.target.value)}
                    className="rounded-xl border px-2 py-1.5 text-xs"
                    style={{ background: 'var(--panel-soft)', borderColor: 'var(--line-strong)', color: 'var(--text)' }}
                    aria-label="Year"
                  >
                    <option value="2025">2025</option>
                    <option value="2026">2026</option>
                    <option value="2027">2027</option>
                    <option value="2028">2028</option>
                  </select>
                  <select
                    value={semester}
                    onChange={(e) => setSemester(e.target.value)}
                    className="flex-1 rounded-xl border px-2 py-1.5 text-xs"
                    style={{ background: 'var(--panel-soft)', borderColor: 'var(--line-strong)', color: 'var(--text)' }}
                    aria-label="Semester"
                  >
                    <option value="Spring">Spring</option>
                    <option value="Fall">Fall</option>
                    <option value="Summer">Summer</option>
                    <option value="January">J-Term</option>
                  </select>
                  {/* Session filter — Full Term / Spring 1 / Spring 2 / J-Term */}
                  {searchSource !== 'HKS' && (
                    <select
                      value={searchSession}
                      onChange={(e) => setSearchSession(e.target.value)}
                      className="rounded-xl border px-2 py-1.5 text-xs"
                      style={{ background: 'var(--panel-soft)', borderColor: searchSession !== 'all' ? 'var(--accent)' : 'var(--line-strong)', color: 'var(--text)' }}
                      aria-label="Session filter"
                    >
                      <option value="all">All sessions</option>
                      <option value="Full Term">Full Term</option>
                      <option value="Spring 1">Spring 1</option>
                      <option value="Spring 2">Spring 2</option>
                      <option value="January">January</option>
                    </select>
                  )}
                </div>
                {/* School dropdown — replaces All/HKS/Non-HKS buttons */}
                <div className="flex gap-1.5">
                  <select
                    value={searchSource}
                    onChange={(e) => setSearchSource(e.target.value)}
                    className="flex-1 rounded-xl border px-2 py-1.5 text-xs"
                    style={{
                      background: 'var(--panel-soft)',
                      borderColor: searchSource !== 'HKS' ? 'var(--accent)' : 'var(--line-strong)',
                      color: 'var(--text)',
                    }}
                    aria-label="School filter"
                  >
                    <option value="All">All schools</option>
                    <optgroup label="Harvard">
                      <option value="HKS">HKS</option>
                      <option value="Non-HKS">Non-HKS (All Harvard)</option>
                      <option value="HLS">HLS — Law</option>
                      <option value="HGSE">HGSE — Education</option>
                      <option value="HMS">HMS — Medicine</option>
                      <option value="HSPH">HSPH — Public Health</option>
                      <option value="FAS">FAS — Arts &amp; Sciences</option>
                      <option value="GSD">GSD — Design</option>
                      <option value="HBS">HBS — Business</option>
                      <option value="HDS">HDS — Divinity</option>
                    </optgroup>
                    <optgroup label="Other">
                      <option value="NONH">Non-Harvard</option>
                    </optgroup>
                  </select>
                </div>
                {/* Cross-reg filter — only show when a non-HKS source is selected */}
                {searchSource !== 'HKS' && searchSource !== 'NONH' && (
                  <label className="flex cursor-pointer items-center gap-1.5 px-0.5 text-xs">
                    <input
                      type="checkbox"
                      checked={filterCrossRegOnly}
                      onChange={(e) => setFilterCrossRegOnly(e.target.checked)}
                      className="h-3 w-3 rounded"
                      style={{ accentColor: 'var(--accent)' }}
                    />
                    <span style={{ color: filterCrossRegOnly ? 'var(--text)' : 'var(--text-muted)' }}>Harvard cross-reg only</span>
                  </label>
                )}
                <div className="flex items-center gap-1.5">
                  <select
                    value={searchMinRating}
                    onChange={(e) => setSearchMinRating(e.target.value)}
                    className="flex-1 rounded-xl border px-2 py-1.5 text-xs"
                    style={{ background: 'var(--panel-soft)', borderColor: searchMinRating ? 'var(--accent)' : 'var(--line-strong)', color: 'var(--text)' }}
                    aria-label="Minimum instructor rating percentile"
                  >
                    <option value="">Any rating</option>
                    <option value="50">≥ 50th %ile</option>
                    <option value="65">≥ 65th %ile</option>
                    <option value="75">≥ 75th %ile</option>
                    <option value="85">≥ 85th %ile</option>
                    <option value="90">≥ 90th %ile</option>
                  </select>
                </div>
                {/* Day-of-week filter — only courses meeting on selected days */}
                <div className="flex gap-1.5">
                  {[
                    { value: 'live', label: 'Live', hint: 'Currently offered (Harvard API)' },
                    { value: 'history', label: 'History', hint: 'Q-guide DB - all years' },
                  ].map(({ value, label, hint }) => (
                    <button
                      key={value}
                      type="button"
                      title={hint}
                      aria-pressed={searchMode === value}
                      onClick={() => setSearchMode(value)}
                      className="rounded-xl border px-2 py-1.5 text-xs font-semibold transition-colors"
                      style={{
                        background: searchMode === value ? 'var(--accent-soft)' : 'var(--panel-soft)',
                        borderColor: searchMode === value ? 'var(--accent)' : 'var(--line-strong)',
                        color: searchMode === value ? 'var(--text)' : 'var(--text-muted)',
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {WEEKDAY_LABELS.map((label) => {
                    const day = label.toUpperCase().slice(0, 3)
                    const active = searchDays.includes(day)
                    return (
                      <button
                        key={day}
                        type="button"
                        aria-pressed={active}
                        onClick={() => setSearchDays((prev) =>
                          prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]
                        )}
                        className="rounded-xl border px-2 py-1.5 text-xs font-semibold transition-colors"
                        style={{
                          background: active ? 'var(--accent-soft)' : 'var(--panel-soft)',
                          borderColor: active ? 'var(--accent)' : 'var(--line-strong)',
                          color: active ? 'var(--text)' : 'var(--text-muted)',
                        }}
                      >
                        {label}
                      </button>
                    )
                  })}
                  {searchDays.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setSearchDays([])}
                      className="rounded-xl border px-2 py-1.5 text-xs transition-colors"
                      style={{ borderColor: 'var(--line-strong)', color: 'var(--text-muted)', background: 'var(--panel-soft)' }}
                    >
                      All days
                    </button>
                  )}
                </div>
                {/* Time From–To filter */}
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[11px] font-semibold" style={{ color: 'var(--text-muted)', minWidth: 28 }}>Time</span>
                  <input
                    type="time"
                    value={searchTimeFrom}
                    onChange={(e) => setSearchTimeFrom(e.target.value)}
                    aria-label="Start time from"
                    className="rounded-xl border px-2 py-1 text-xs"
                    style={{ background: searchTimeFrom ? 'var(--accent-soft)' : 'var(--panel-soft)', borderColor: searchTimeFrom ? 'var(--accent)' : 'var(--line-strong)', color: 'var(--text)', minWidth: 90 }}
                  />
                  <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>to</span>
                  <input
                    type="time"
                    value={searchTimeTo}
                    onChange={(e) => setSearchTimeTo(e.target.value)}
                    aria-label="Start time to"
                    className="rounded-xl border px-2 py-1 text-xs"
                    style={{ background: searchTimeTo ? 'var(--accent-soft)' : 'var(--panel-soft)', borderColor: searchTimeTo ? 'var(--accent)' : 'var(--line-strong)', color: 'var(--text)', minWidth: 90 }}
                  />
                  {(searchTimeFrom || searchTimeTo) && (
                    <button
                      type="button"
                      onClick={() => { setSearchTimeFrom(''); setSearchTimeTo('') }}
                      className="rounded-xl border px-2 py-1 text-xs transition-colors"
                      style={{ borderColor: 'var(--line-strong)', color: 'var(--text-muted)', background: 'var(--panel-soft)' }}
                    >
                      Any time
                    </button>
                  )}
                </div>
                {/* Credits filter */}
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[11px] font-semibold" style={{ color: 'var(--text-muted)', minWidth: 28 }}>Credits</span>
                  {['', '2', '3', '4'].map((val) => {
                    const label = val === '' ? 'Any' : `${val} cr`
                    const active = searchCredits === val
                    return (
                      <button
                        key={val}
                        type="button"
                        aria-pressed={active}
                        onClick={() => setSearchCredits(val)}
                        className="rounded-xl border px-2 py-1.5 text-xs font-semibold transition-colors"
                        style={{
                          background: active ? 'var(--accent-soft)' : 'var(--panel-soft)',
                          borderColor: active ? 'var(--accent)' : 'var(--line-strong)',
                          color: active ? 'var(--text)' : 'var(--text-muted)',
                        }}
                      >
                        {label}
                      </button>
                    )
                  })}
                </div>
              </div>
              {/* Active filter summary + reset */}
              {(() => {
                const hasActiveFilters = searchConcentration !== 'All' || searchStem !== 'all' || searchCoreOnly || searchSource !== 'HKS' || searchMinRating || searchDays.length > 0 || searchTimeFrom || searchTimeTo || searchCredits || searchMode !== 'live' || browseAll || semesterYear !== '2026' || semester !== 'Spring' || !filterCrossRegOnly || searchSession !== 'all'
                return hasActiveFilters ? (
                  <button
                    type="button"
                    onClick={() => {
                      setSearchConcentration('All')
                      setSearchStem('all')
                      setSearchCoreOnly(false)
                      setSearchSource('HKS')
                      setSearchMinRating('')
                      setSearchDays([])
                      setSearchTimeFrom('')
                      setSearchTimeTo('')
                      setSearchCredits('')
                      setSearchMode('live')
                      setBrowseAll(false)
                      setSemesterYear('2026')
                      setSemester('Spring')
                      setFilterCrossRegOnly(true)
                      setSearchSession('all')
                    }}
                    className="mt-2 w-full rounded-xl border px-2 py-1 text-xs font-semibold transition-colors"
                    style={{ borderColor: 'var(--line-strong)', color: 'var(--text-muted)', background: 'var(--panel-soft)' }}
                  >
                    ✕ Reset all filters
                  </button>
                ) : null
              })()}
              {searchMode === 'history' && !searchQ.trim() ? (
                <p className="mt-2 text-[11px] leading-5" style={{ color: 'var(--gold)' }}>📚 All-years mode — type a query to search Q-guide history</p>
              ) : filteredSearchResults.length > 0 && searchQ.trim() ? (
                <p className="mt-2 text-[11px]" style={{ color: 'var(--text-muted)' }}>↩ Enter to add first result{searchSource !== 'HKS' ? ' · Enter with code to manually add if not found' : ''}</p>
              ) : !searchQ.trim() && searchSource !== 'HKS' && searchMode === 'live' ? (
                <p className="mt-2 text-[11px] leading-5" style={{ color: 'var(--text-muted)' }}>
                  {liveCoursesData.length > 0
                    ? `Browsing ${semesterYear} ${semester} catalog — type to narrow`
                    : 'Loading catalog…'}
                </p>
              ) : apiMode === 'db' && !searchQ.trim() ? (
                <p className="mt-2 text-[11px] leading-5" style={{ color: 'var(--text-muted)' }}>
                  {sectionTimesLoading ? 'Loading schedule times…' : sectionMapStubs.length > 0 ? `${semesterYear} ${semester} schedule loaded · type to search Harvard catalog` : 'Q-guide history · type to search Harvard catalog'}
                </p>
              ) : null}
            </div>

            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-4">
              {searching ? (
                <div className="py-8 text-center text-sm" style={{ color: 'var(--text-muted)' }}>Searching…</div>
              ) : filteredSearchResults.length > 0 ? (
                <div role="list" aria-label="Course search results" className="space-y-3">
                  {(() => {
                    const withTime = filteredSearchResults.filter((course) => courseHasSchedule(course) || course._hasLiveTimes)
                    const withoutTime = filteredSearchResults.filter((course) => !courseHasSchedule(course) && !course._hasLiveTimes)
                    const visibleResults = filteredSearchResults.slice(0, browseLimit)
                    const visibleWithTime = visibleResults.filter((course) => courseHasSchedule(course) || course._hasLiveTimes)
                    const visibleWithoutTime = visibleResults.filter((course) => !courseHasSchedule(course) && !course._hasLiveTimes)
                    const hasMore = filteredSearchResults.length > browseLimit
                    return (
                      <>
                        <p className="mb-1 text-[11px]" style={{ color: 'var(--text-muted)' }}>
                          {searchMode === 'history'
                            ? `Q-guide: ${filteredSearchResults.length} result${filteredSearchResults.length !== 1 ? 's' : ''} across all years`
                            : !searchQ.trim() && searchSource !== 'HKS'
                              ? `${filteredSearchResults.length} course${filteredSearchResults.length !== 1 ? 's' : ''} · ${searchSource === 'All' ? 'all schools' : searchSource} · type to narrow`
                              : `${withTime.length} with schedule${withoutTime.length > 0 ? ` · ${withoutTime.length} historical` : ''}`}
                          {searchDays.length > 0 ? ` · ${searchDays.map(d => d[0] + d.slice(1).toLowerCase()).join('/')}` : ''}
                          {(searchTimeFrom || searchTimeTo) ? ` · ${searchTimeFrom || '–'}–${searchTimeTo || '–'}` : ''}
                          {searchCredits ? ` · ${searchCredits} cr` : ''}
                        </p>
                        {visibleWithTime.map((course, index) => {
                          const added = addedCourseCodes.has(course.courseCode)
                          const done = completedCourseCodes.has(course.courseCode)
                          const hks = isHksCourse(course.courseCode)
                          const codeParts = course.courseCode.split('-')
                          const baseCode = codeParts.slice(0, 2).join('-')
                          const threeBase = codeParts.slice(0, 3).join('-')
                          const histRating = histRatingsMap.get(course.courseCode) || histRatingsMap.get(threeBase) || histRatingsMap.get(baseCode)
                          const instrPct = histRating?.metrics_pct?.Instructor_Rating
                          return (
                            <div key={`with-${course.courseCode}-${index}`} role="listitem" className="rounded-[24px] border p-4" style={{ background: hks ? 'var(--panel-soft)' : 'var(--panel)', borderColor: hks ? 'var(--line)' : 'var(--line)', opacity: hks || searchSource === 'Non-HKS' ? 1 : 0.75 }}>
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <p className="text-sm font-semibold" style={{ color: hks ? 'var(--text)' : 'var(--text-muted)' }}>{course.courseCode}</p>
                                    {!hks && (() => { const school = inferSchool(course.courseCode); return <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold" style={{ background: 'var(--panel-strong)', color: 'var(--text-muted)', border: '1px solid var(--line-strong)' }}>{school || 'Cross-reg'}</span> })()}
                                    {searchMode === 'history' && course.year && <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold" style={{ background: 'var(--panel-strong)', color: 'var(--text-muted)', border: '1px solid var(--line-strong)' }}>{course.year} {course.term}</span>}
                                    {histRating && <a href={`/courses?q=${encodeURIComponent(baseCode)}`} target="_blank" rel="noopener noreferrer" aria-label={`View ${baseCode} evaluations in Q-guide (opens in new tab)`} title="View evaluations in Q-guide" className="text-[10px] font-semibold hover:underline" style={{ color: 'var(--accent)', textDecoration: 'none' }}>Q ↗</a>}
                                  </div>
                                  <p className="mt-1 overflow-hidden text-sm leading-5" style={{ color: hks ? 'var(--text-soft)' : 'var(--text-muted)', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{course.title}</p>
                                </div>
                                <div className="flex shrink-0 flex-col gap-1.5">
                                  {searchMode === 'history' ? (
                                    <>
                                      <button type="button" onClick={() => done ? removeFromCompleted(course.courseCode) : addToCompleted(course)} className="rounded-full border px-3 py-1.5 text-xs font-semibold transition-transform hover:-translate-y-[1px]" style={{ background: 'var(--success-soft)', borderColor: 'var(--success)', color: 'var(--success)' }} aria-label={done ? `Un-complete ${course.courseCode}` : `Mark ${course.courseCode} as completed`}>
                                        {done ? '✓ Done' : '✓ Mark done'}
                                      </button>
                                      <button type="button" disabled={done} onClick={() => added ? removeCourse(course.courseCode) : addToShortlist(course)} className="rounded-full border px-3 py-1.5 text-xs font-semibold transition-transform enabled:hover:-translate-y-[1px] disabled:cursor-default" style={{ background: 'transparent', borderColor: added ? '#c0392b' : 'var(--line)', color: added ? '#c0392b' : 'var(--text-muted)' }} aria-label={added ? `Remove ${course.courseCode} from plan` : `Add ${course.courseCode} to plan`}>
                                        {added ? 'Remove ✕' : '+ Plan'}
                                      </button>
                                    </>
                                  ) : (
                                    <>
                                      <button type="button" disabled={done} onClick={() => added ? removeCourse(course.courseCode) : addToShortlist(course)} className="rounded-full border px-3 py-1.5 text-xs font-semibold transition-transform enabled:hover:-translate-y-[1px] disabled:cursor-default" style={{ background: added ? 'rgba(192,57,43,0.08)' : 'var(--accent-soft)', borderColor: added ? '#c0392b' : 'var(--line-strong)', color: added ? '#c0392b' : 'var(--text)' }} aria-label={added ? `Remove ${course.courseCode} from plan` : `Add ${course.courseCode} to plan`}>
                                        {added ? 'Remove ✕' : 'Add'}
                                      </button>
                                      <button type="button" onClick={() => done ? removeFromCompleted(course.courseCode) : addToCompleted(course)} className="rounded-full border px-3 py-1.5 text-xs font-semibold transition-transform hover:-translate-y-[1px]" style={{ background: done ? 'var(--success-soft)' : 'transparent', borderColor: done ? 'var(--success)' : 'var(--line)', color: done ? 'var(--success)' : 'var(--text-muted)' }}>
                                        {done ? '✓ Done' : '+ Done'}
                                      </button>
                                    </>
                                  )}
                                </div>
                              </div>
                              <p className="mt-2 text-xs leading-5" style={{ color: 'var(--text-muted)' }}>{course.instructors.length ? course.instructors.join(', ') : 'Instructor TBA'}</p>
                              <div className="mt-3 flex flex-wrap gap-2">
                                {hks && course.enrichment?.is_core && <Chip tone="success">Core</Chip>}
                                {hks && course.enrichment?.is_stem && <Chip tone="blue">STEM</Chip>}
                                {course.sections.length > 0 ? (
                                  <Chip>{course.sections.length} section{course.sections.length > 1 ? 's' : ''}</Chip>
                                ) : courseHasSchedule(course) ? (
                                  (() => {
                                    const DAY_ABBR = { MON: 'M', TUE: 'Tu', WED: 'W', THU: 'Th', FRI: 'F', SAT: 'Sa', SUN: 'Su' }
                                    const days = extractDays(course.meeting_days).map((d) => DAY_ABBR[d] || d).join('/')
                                    return <Chip tone="success">{days}{course.time_start ? ` ${formatClockLabel(course.time_start)}` : ''}</Chip>
                                  })()
                                ) : sectionTimesLoading ? (
                                  <Chip tone="default">Times loading</Chip>
                                ) : (
                                  <Chip tone="muted">Schedule pending</Chip>
                                )}
                                {instrPct != null && <Chip tone="gold">★ {Math.round(instrPct)}th instr</Chip>}
                                {hks && (course.enrichment?.last_bid_price ?? course.enrichment?.bid_clearing_price) != null && (
                                  <Chip tone="gold">{course.enrichment.last_bid_price ?? course.enrichment.bid_clearing_price} bid pts</Chip>
                                )}
                              </div>
                            </div>
                          )
                        })}
                        {visibleWithoutTime.length > 0 && (
                          <div style={{ borderTop: '1px solid var(--line)', margin: '8px 0 4px', paddingTop: 8 }}>
                            <p style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--text-muted)' }}>
                              {searchMode === 'history' ? `Past semesters · ${withoutTime.length}` : `Historical / no schedule · ${withoutTime.length}`}
                            </p>
                          </div>
                        )}
                        {visibleWithoutTime.map((course, index) => {
                          const added = addedCourseCodes.has(course.courseCode)
                          const done = completedCourseCodes.has(course.courseCode)
                          const hks = isHksCourse(course.courseCode)
                          const codeParts = course.courseCode.split('-')
                          const baseCode = codeParts.slice(0, 2).join('-')
                          const threeBase = codeParts.slice(0, 3).join('-')
                          const histRating = histRatingsMap.get(course.courseCode) || histRatingsMap.get(threeBase) || histRatingsMap.get(baseCode)
                          const instrPct = histRating?.metrics_pct?.Instructor_Rating
                          return (
                            <div key={`without-${course.courseCode}-${index}`} role="listitem" className="rounded-[24px] border p-4" style={{ background: hks ? 'var(--panel-soft)' : 'var(--panel)', borderColor: hks ? 'var(--line)' : 'var(--line)', opacity: hks || searchSource === 'Non-HKS' ? 1 : 0.75 }}>
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <p className="text-sm font-semibold" style={{ color: hks ? 'var(--text)' : 'var(--text-muted)' }}>{course.courseCode}</p>
                                    {!hks && (() => { const school = inferSchool(course.courseCode); return <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold" style={{ background: 'var(--panel-strong)', color: 'var(--text-muted)', border: '1px solid var(--line-strong)' }}>{school || 'Cross-reg'}</span> })()}
                                    {searchMode === 'history' && course.year && <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold" style={{ background: 'var(--panel-strong)', color: 'var(--text-muted)', border: '1px solid var(--line-strong)' }}>{course.year} {course.term}</span>}
                                    {histRating && <a href={`/courses?q=${encodeURIComponent(baseCode)}`} target="_blank" rel="noopener noreferrer" aria-label={`View ${baseCode} evaluations in Q-guide (opens in new tab)`} title="View evaluations in Q-guide" className="text-[10px] font-semibold hover:underline" style={{ color: 'var(--accent)', textDecoration: 'none' }}>Q ↗</a>}
                                  </div>
                                  <p className="mt-1 overflow-hidden text-sm leading-5" style={{ color: hks ? 'var(--text-soft)' : 'var(--text-muted)', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{course.title}</p>
                                </div>
                                <div className="flex shrink-0 flex-col gap-1.5">
                                  {/* In all-years mode: promote "Mark done" to primary, "Add" secondary */}
                                  {searchMode === 'history' ? (
                                    <>
                                      <button type="button" onClick={() => done ? removeFromCompleted(course.courseCode) : addToCompleted(course)} className="rounded-full border px-3 py-1.5 text-xs font-semibold transition-transform hover:-translate-y-[1px]" style={{ background: done ? 'var(--success-soft)' : 'var(--success-soft)', borderColor: 'var(--success)', color: 'var(--success)' }} aria-label={done ? `Un-complete ${course.courseCode}` : `Mark ${course.courseCode} as completed`}>
                                        {done ? '✓ Done' : '✓ Mark done'}
                                      </button>
                                      <button type="button" disabled={done} onClick={() => added ? removeCourse(course.courseCode) : addToShortlist(course)} className="rounded-full border px-3 py-1.5 text-xs font-semibold transition-transform enabled:hover:-translate-y-[1px] disabled:cursor-default" style={{ background: 'transparent', borderColor: added ? '#c0392b' : 'var(--line)', color: added ? '#c0392b' : 'var(--text-muted)' }} aria-label={added ? `Remove ${course.courseCode} from plan` : `Add ${course.courseCode} to plan`}>
                                        {added ? 'Remove ✕' : '+ Plan'}
                                      </button>
                                    </>
                                  ) : (
                                    <>
                                      <button type="button" disabled={done} onClick={() => added ? removeCourse(course.courseCode) : addToShortlist(course)} className="rounded-full border px-3 py-1.5 text-xs font-semibold transition-transform enabled:hover:-translate-y-[1px] disabled:cursor-default" style={{ background: added ? 'rgba(192,57,43,0.08)' : 'var(--accent-soft)', borderColor: added ? '#c0392b' : 'var(--line-strong)', color: added ? '#c0392b' : 'var(--text)' }} aria-label={added ? `Remove ${course.courseCode} from plan` : `Add ${course.courseCode} to plan`}>
                                        {added ? 'Remove ✕' : 'Add'}
                                      </button>
                                      <button type="button" onClick={() => done ? removeFromCompleted(course.courseCode) : addToCompleted(course)} className="rounded-full border px-3 py-1.5 text-xs font-semibold transition-transform hover:-translate-y-[1px]" style={{ background: done ? 'var(--success-soft)' : 'transparent', borderColor: done ? 'var(--success)' : 'var(--line)', color: done ? 'var(--success)' : 'var(--text-muted)' }}>
                                        {done ? '✓ Done' : '+ Done'}
                                      </button>
                                    </>
                                  )}
                                </div>
                              </div>
                              <p className="mt-2 text-xs leading-5" style={{ color: 'var(--text-muted)' }}>{course.instructors.length ? course.instructors.join(', ') : 'Instructor TBA'}</p>
                              <div className="mt-3 flex flex-wrap gap-2">
                                {hks && course.enrichment?.is_core && <Chip tone="success">Core</Chip>}
                                {hks && course.enrichment?.is_stem && <Chip tone="blue">STEM</Chip>}
                                {course.sections.length > 0 ? (
                                  <Chip>{course.sections.length} section{course.sections.length > 1 ? 's' : ''}</Chip>
                                ) : courseHasSchedule(course) ? (
                                  (() => {
                                    const DAY_ABBR = { MON: 'M', TUE: 'Tu', WED: 'W', THU: 'Th', FRI: 'F', SAT: 'Sa', SUN: 'Su' }
                                    const days = extractDays(course.meeting_days).map((d) => DAY_ABBR[d] || d).join('/')
                                    return <Chip tone="success">{days}{course.time_start ? ` ${formatClockLabel(course.time_start)}` : ''}</Chip>
                                  })()
                                ) : sectionTimesLoading ? (
                                  <Chip tone="default">Times loading</Chip>
                                ) : (
                                  <Chip tone="muted">Historical / no schedule</Chip>
                                )}
                                {instrPct != null && <Chip tone="gold">★ {Math.round(instrPct)}th instr</Chip>}
                                {hks && (course.enrichment?.last_bid_price ?? course.enrichment?.bid_clearing_price) != null && (
                                  <Chip tone="gold">{course.enrichment.last_bid_price ?? course.enrichment.bid_clearing_price} bid pts</Chip>
                                )}
                              </div>
                            </div>
                          )
                        })}
                        {hasMore && (
                          <button
                            type="button"
                            onClick={() => setBrowseLimit((n) => n + 25)}
                            className="mt-2 w-full rounded-full border py-2 text-xs font-semibold transition-colors"
                            style={{ background: 'var(--panel-soft)', borderColor: 'var(--line-strong)', color: 'var(--text-muted)' }}
                          >
                            Show more ({filteredSearchResults.length - browseLimit} remaining)
                          </button>
                        )}
                      </>
                    )
                  })()}
                </div>
              ) : (
                /* No results — show shortlist if available, otherwise a browse prompt */
                shortlistedSuggestions.length > 0 && !searchQ.trim() ? (
                  <div>
                    <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.1em]" style={{ color: 'var(--text-muted)' }}>★ From your shortlist</p>
                    <div className="space-y-2">
                      {shortlistedSuggestions.map((course) => (
                        <div key={course.courseCode} className="flex items-center justify-between gap-2 rounded-2xl border px-3 py-2" style={{ background: 'var(--panel-soft)', borderColor: 'var(--line)' }}>
                          <div className="min-w-0">
                            <p className="truncate text-xs font-semibold" style={{ color: 'var(--text)' }}>{course.courseCode}</p>
                            <p className="truncate text-[11px]" style={{ color: 'var(--text-muted)' }}>{course.instructors[0] || 'TBA'}</p>
                          </div>
                          <button type="button" onClick={() => addToShortlist(course)} className="shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-transform hover:-translate-y-[1px]" style={{ background: 'var(--accent-soft)', borderColor: 'var(--line-strong)', color: 'var(--text)' }}>Add</button>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : searchSource === 'Non-HKS' && !searchQ.trim() && searchMode === 'history' ? (
                  <div className="flex flex-col items-center gap-3 py-10 text-center">
                    <p className="text-sm font-semibold" style={{ color: 'var(--text)' }}>No cross-reg history</p>
                    <p className="text-xs leading-5" style={{ color: 'var(--text-muted)' }}>Q-guide history only covers HKS courses.</p>
                    <button
                      type="button"
                      onClick={() => setSearchMode('live')}
                      className="rounded-full border px-4 py-2 text-xs font-semibold transition-colors"
                      style={{ background: 'var(--accent-soft)', borderColor: 'var(--accent)', color: 'var(--text)' }}
                    >
                      🔴 Switch to Live to browse all schools
                    </button>
                  </div>
                ) : searchSource === 'Non-HKS' && searchQ.trim() ? (
                  <div className="rounded-[20px] border p-4 text-sm" style={{ background: 'var(--panel-soft)', borderColor: 'var(--line)' }}>
                    <p className="font-semibold" style={{ color: 'var(--text)' }}>Cross-registration</p>
                    <p className="mt-2 text-xs leading-5" style={{ color: 'var(--text-muted)' }}>
                      Non-HKS courses may not be in our Q-guide database. If the Harvard API returned no results, press <kbd className="rounded border px-1 py-0.5 font-mono text-[10px]" style={{ borderColor: 'var(--line-strong)', color: 'var(--text-soft)' }}>Enter</kbd> to add <strong style={{ color: 'var(--text)' }}>{searchQ.trim().toUpperCase().replace(/\s+/g, '-')}</strong> as a manual cross-reg course.
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        const code = searchQ.trim().toUpperCase().replace(/\s+/g, '-')
                        if (code && !addedCourseCodes.has(code)) {
                          openManualModal(code)
                        }
                      }}
                      className="mt-3 rounded-full border px-3 py-1.5 text-xs font-semibold transition-transform hover:-translate-y-[1px]"
                      style={{ background: 'var(--accent-soft)', borderColor: 'var(--line-strong)', color: 'var(--text)' }}
                    >
                      + Add {searchQ.trim().toUpperCase().replace(/\s+/g, '-')} with details
                    </button>
                  </div>
                ) : searchQ.trim() ? (
                  <div className="py-8 text-center text-sm" style={{ color: 'var(--text-muted)' }}>No matching courses found.</div>
                ) : (
                  <div className="flex flex-col items-center gap-3 py-10 text-center">
                    <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Use the filters above to browse, or type to search.</p>
                    <button
                      type="button"
                      onClick={() => { setSearchSource('HKS'); setBrowseAll(true) }}
                      className="rounded-full border px-4 py-2 text-xs font-semibold transition-transform hover:-translate-y-[1px]"
                      style={{ background: 'var(--accent-soft)', borderColor: 'var(--accent)', color: 'var(--text)' }}
                    >
                      Browse all {semesterYear} {semester} HKS courses
                    </button>
                    <button
                      type="button"
                      onClick={() => setSearchSource('Non-HKS')}
                      className="rounded-full border px-4 py-2 text-xs font-semibold transition-transform hover:-translate-y-[1px]"
                      style={{ background: 'var(--panel-soft)', borderColor: 'var(--line-strong)', color: 'var(--text-soft)' }}
                    >
                      Browse cross-reg offerings (HBS, MIT…)
                    </button>
                  </div>
                )
              )}
            </div>
          </aside>

          <main data-tour="schedule-grid" className="min-w-0 flex-1 overflow-x-auto overflow-y-auto" style={{ background: 'var(--panel-strong)' }}>
            <div className="min-w-[720px] p-6">
              {conflicts.length > 0 && (
                <div className="mb-4 rounded-[20px] border px-4 py-3 text-sm" style={{ background: 'var(--panel-soft)', borderColor: 'var(--danger)', color: 'var(--danger)' }}>
                  <div className="flex items-center gap-3 font-semibold">
                    <span>⚠</span>
                    <span>{conflicts.length} time conflict{conflicts.length > 1 ? 's' : ''} detected — overlapping courses are highlighted in red</span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2 pl-7">
                    {conflicts.map(([left, right], i) => (
                      <span
                        key={i}
                        className="rounded-full px-3 py-1 text-xs font-semibold"
                        style={{ background: 'var(--danger-soft)', border: '1px solid var(--danger)', color: 'var(--danger)' }}
                      >
                        {left.courseCode} ↔ {right.courseCode}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              <div className="min-w-[720px] rounded-[28px] border" style={{ background: 'var(--panel)', borderColor: 'var(--line)' }}>
                <div className="grid min-w-[720px] border-b" style={{ borderColor: 'var(--line)', gridTemplateColumns: gridCols }}>
                  <div className="border-r px-2 py-4 text-[11px] font-semibold uppercase tracking-[0.12em]" style={{ borderColor: 'var(--line)', color: 'var(--text-muted)' }}>Time</div>
                  {visibleDayLabels.map((day) => (
                    <div key={day} className="border-r px-3 py-4 text-center text-sm font-semibold last:border-r-0" style={{ borderColor: 'var(--line)', color: 'var(--text)' }}>{day}</div>
                  ))}
                </div>

                <div className="relative min-w-[720px]" style={{ height: `${((GRID_END - GRID_START) / 30) * ROW_HEIGHT}px` }}>
                  {timeLabels.map((slot, index) => (
                    <div key={slot.minute} className="absolute inset-x-0 grid" style={{ top: `${index * ROW_HEIGHT}px`, height: `${ROW_HEIGHT}px`, gridTemplateColumns: gridCols }}>
                      <div className="border-r px-2 py-2 text-[11px]" style={{ borderColor: 'var(--line)', color: 'var(--text-muted)' }}>{slot.label}</div>
                      {visibleDayLabels.map((day) => (
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
                      <div
                        key={key}
                        className="absolute z-10 rounded-2xl border p-2"
                        tabIndex={0}
                        role="button"
                        aria-label={`${course.courseCode}: ${course.title}${conflict ? ' — time conflict' : ''}. Press Enter to expand, Delete to remove from grid.`}
                        aria-expanded={expandedBlock === course.courseCode}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault()
                            setExpandedBlock((current) => (current === course.courseCode ? null : course.courseCode))
                            return
                          }
                          if (event.key === 'Escape') {
                            setExpandedBlock(null)
                            return
                          }
                          if (event.key === 'Delete' || event.key === 'Backspace') {
                            event.preventDefault()
                            toggleGrid(course.courseCode)
                          }
                        }}
                        style={{ top: `${top + 2}px`, left: `calc(52px + ${dayIndex} * (100% - 52px) / ${numDays} + 2px)`, width: `calc((100% - 52px) / ${numDays} - 4px)`, height: `${Math.max(height - 4, 28)}px`, background: conflict ? 'var(--panel-soft)' : 'var(--accent-soft)', borderColor: conflict ? 'var(--danger)' : 'var(--accent)', color: 'var(--text)' }}
                      >
                        <button type="button" onClick={() => setExpandedBlock((current) => (current === course.courseCode ? null : course.courseCode))} className="block h-full w-full text-left" aria-label={course.courseCode + (conflict ? ' — time conflict' : '')}>
                          <p className="truncate pr-6 text-xs font-semibold">{course.courseCode}</p>
                          <p className="mt-1 text-[11px] leading-4" style={{ color: 'var(--text-soft)', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{course.title}</p>
                          {conflict && (
                            <p className="mt-0.5 text-[9px] font-bold uppercase tracking-[0.08em]" style={{ color: 'var(--danger)' }}>⚡ Conflict</p>
                          )}
                          {height > 72 && course.instructors?.length > 0 && (
                            <p className="mt-1 truncate text-[10px]" style={{ color: 'var(--text-muted)' }}>{course.instructors[0]}</p>
                          )}
                        </button>
                        <button type="button" onClick={() => toggleGrid(course.courseCode)} className="absolute right-2 top-2 text-xs font-semibold" style={{ color: conflict ? 'var(--danger)' : 'var(--text-soft)' }} aria-label={`Remove ${course.courseCode} from grid`}>×</button>
                        {active && (
                          <div className="absolute left-0 top-full z-20 mt-2 w-64 rounded-[20px] border p-4" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
                            <div className="flex items-center gap-2">
                              <p className="text-sm font-semibold" style={{ color: 'var(--text)' }}>{course.title}</p>
                              {course._hasLiveTimes && <span className="shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold" style={{ background: 'var(--success-soft)', color: 'var(--success)' }}>Live</span>}
                            </div>
                            <p className="mt-1 text-xs" style={{ color: 'var(--text-muted)' }}>{(section?.instructors?.length ? section.instructors : course.instructors).join(', ') || 'Instructor TBA'}</p>
                            <p className="mt-2 text-xs" style={{ color: 'var(--text-soft)' }}>{formatClockLabel(course.time_start)} – {formatClockLabel(course.time_end)} · {course.meeting_days || ''}</p>
                            {course.location && <p className="mt-1 text-xs" style={{ color: 'var(--text-muted)' }}>📍 {course.location}</p>}
                            <p className="mt-2 text-xs" style={{ color: 'var(--text-soft)' }}>Instructor rating: <span style={{ color: 'var(--text)' }}>{course.enrichment?.metrics_pct?.Instructor_Rating != null ? `${Math.round(course.enrichment.metrics_pct.Instructor_Rating)}th pct` : 'N/A'}</span></p>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          </main>

          <aside data-tour="plan-shortlist" className="flex h-full w-[280px] shrink-0 flex-col border-l" style={{ borderColor: 'var(--line)', background: 'var(--panel)' }}>
            <div className="flex-1 overflow-y-auto">

              {/* ── SECTION 1: SHORTLIST ── */}
              <div className="p-4">
                {/* Header row */}
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <button type="button" onClick={() => toggleSection('shortlist')} className="flex h-4 w-4 items-center justify-center text-[10px] transition-transform" style={{ color: 'var(--text-muted)', transform: collapsedSections.shortlist ? 'rotate(-90deg)' : 'rotate(0deg)' }} aria-label="Toggle shortlist">▾</button>
                    <p className="text-xs font-semibold uppercase tracking-[0.12em]" style={{ color: 'var(--text-muted)' }}>Shortlist</p>
                    <span className="text-sm" style={{ color: 'var(--text-soft)' }}>{normalizedPlanCourses.length}</span>
                    {normalizedPlanCourses.length > 0 && (() => {
                      const totalCr = normalizedPlanCourses.reduce((sum, c) => sum + (c.credits || 4), 0)
                      const crossCr = normalizedPlanCourses.filter((c) => !isHksCourse(c.courseCode)).reduce((sum, c) => sum + (c.credits || 4), 0)
                      return (
                        <>
                          <span className="text-xs font-semibold" style={{ color: 'var(--gold)' }}>{totalCr} cr</span>
                          {crossCr > 0 && <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>({crossCr} cross-reg)</span>}
                        </>
                      )
                    })()}
                  </div>
                  {normalizedPlanCourses.length >= 2 && (
                    <a href={`/compare?ids=${normalizedPlanCourses.slice(0, 5).map((c) => encodeURIComponent(c.courseCode)).join(',')}`} className="text-xs font-semibold transition-transform hover:-translate-y-[1px]" style={{ color: 'var(--accent)' }} title="Compare top 5">⇄ Compare</a>
                  )}
                </div>

                {/* Plan avg ratings — always visible, shows n of m courses rated per metric */}
                <div className="mt-2 rounded-xl border px-3 py-2" style={{ background: 'var(--panel-soft)', borderColor: 'var(--line)' }}>
                  <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.1em]" style={{ color: 'var(--text-muted)' }}>Plan avg ratings <span className="normal-case font-normal" title="Based on Q-guide history for courses in this plan">(Q-guide history)</span></p>
                  <div className="flex flex-wrap gap-x-3 gap-y-1">
                    {[
                      { key: 'Instructor_Rating', label: 'Instr.' },
                      { key: 'Course_Rating',     label: 'Course' },
                      { key: 'Workload',          label: 'Work.' },
                      { key: 'Rigor',             label: 'Rigor' },
                    ].map(({ key, label }) => {
                      const LABEL_MAP = { Instructor_Rating: 'Instructor', Course_Rating: 'Course', Workload: 'Workload', Rigor: 'Rigor' }
                      const entry = planRatings.find((r) => r.label === LABEL_MAP[key])
                      return (
                        <div key={key} className="flex items-baseline gap-1">
                          <span className="text-[10px] uppercase tracking-[0.08em]" style={{ color: 'var(--text-muted)' }}>{label}</span>
                          <span className="text-xs font-semibold" style={{ color: entry ? 'var(--gold)' : 'var(--text-muted)' }}>
                            {entry ? `${entry.value}%` : '—'}
                          </span>
                          {entry && (
                            <span className="text-[9px]" style={{ color: 'var(--text-muted)' }}>{entry.n}/{normalizedPlanCourses.length}</span>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>

                {/* Collapsible course list */}
                {!collapsedSections.shortlist && (
                  <div className="mt-4 space-y-3">
                    {normalizedPlanCourses.length === 0 ? (
                      <EmptyScheduleState />
                    ) : planCoursesEnriched.map((course) => {
                      const onGrid = course.isOnGrid
                      const inConflict = conflictSet.has(course.courseCode)
                      const hasRatings = hasMeaningfulRatings(course.enrichment?.metrics_pct)
                      const isHistorical = course.enrichment?._ratingFromHistory
                      const codeParts = course.courseCode.split('-')
                      const baseCode = codeParts.slice(0, 2).join('-')
                      const inQGuide = histRatingsMap.has(course.courseCode) || histRatingsMap.has(codeParts.slice(0, 3).join('-')) || histRatingsMap.has(baseCode)
                      return (
                        <div key={course.courseCode} className="rounded-[24px] border p-4" style={{ background: 'var(--panel-soft)', borderColor: 'var(--line)' }}>
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-1.5">
                                <p className="truncate text-sm font-semibold" style={{ color: 'var(--text)' }}>{course.courseCode}</p>
                                {inQGuide && (
                                  <a href={`/courses?q=${encodeURIComponent(baseCode)}`} target="_blank" rel="noopener noreferrer" title="View evaluations in Q-guide" className="text-[10px] font-semibold hover:underline" style={{ color: 'var(--accent)', textDecoration: 'none' }}>Q ↗</a>
                                )}
                                {!hasRatings ? (
                                  <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>no evals</span>
                                ) : isHistorical ? (
                                  <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>hist. data</span>
                                ) : null}
                                <span className="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ background: 'var(--gold-soft)', color: 'var(--gold)' }}>{course.credits || 4} cr</span>
                              </div>
                              <p className="mt-1 truncate text-sm" style={{ color: 'var(--text-soft)' }}>{course.title}</p>
                              {courseHasSchedule(course) && (
                                (() => {
                                  const DAY_ABBR = { MON: 'M', TUE: 'Tu', WED: 'W', THU: 'Th', FRI: 'F', SAT: 'Sa', SUN: 'Su' }
                                  const days = extractDays(course.meeting_days).map((d) => DAY_ABBR[d] || d).join('/')
                                  return (
                                    <p className="mt-1 text-[11px]" style={{ color: 'var(--text-soft)' }}>
                                      🕐 {days} {formatClockLabel(course.time_start)}–{formatClockLabel(course.time_end)}
                                    </p>
                                  )
                                })()
                              )}
                              {hasRatings && (
                                <p className="mt-1 text-[11px]" style={{ color: 'var(--text-muted)' }}>
                                  Instr. <span style={{ color: 'var(--gold)', fontWeight: 600 }}>{Math.round(course.enrichment.metrics_pct.Instructor_Rating)}%</span>
                                  {course.enrichment.metrics_pct.Course_Rating != null && (
                                    <> · Course <span style={{ color: 'var(--gold)', fontWeight: 600 }}>{Math.round(course.enrichment.metrics_pct.Course_Rating)}%</span></>
                                  )}
                                </p>
                              )}
                            </div>
                            <button type="button" onClick={() => removeCourse(course.courseCode)} className="shrink-0 text-sm font-semibold" style={{ color: 'var(--danger)' }} aria-label={`Remove ${course.courseCode}`}>×</button>
                          </div>
                          <div className="mt-3 flex flex-wrap gap-2">
                            {!isHksCourse(course.courseCode) && <Chip tone="muted">{inferSchool(course.courseCode) || 'Cross-reg'}</Chip>}
                            {course.enrichment?.is_core && <Chip tone="success">Core</Chip>}
                            {course.enrichment?.is_stem && <Chip tone="blue">STEM</Chip>}
                            {isHksCourse(course.courseCode) && !course.enrichment?.is_core && !course.enrichment?.is_stem && <Chip>Elective</Chip>}
                            {course._hasLiveTimes ? (
                              <Chip tone="success">🕐 Live times</Chip>
                            ) : courseHasSchedule(course) ? null
                            : sectionTimesLoading ? (
                              <Chip tone="default">Times loading</Chip>
                            ) : isHksCourse(course.courseCode) ? (
                              <Chip tone="danger">No time data</Chip>
                            ) : (
                              <Chip tone="muted">No schedule yet</Chip>
                            )}
                            {(course.enrichment?.last_bid_price ?? course.enrichment?.bid_clearing_price) != null && (
                              <Chip tone="gold">{course.enrichment.last_bid_price ?? course.enrichment.bid_clearing_price} bid pts</Chip>
                            )}
                          </div>
                          {course.sections.length > 0 && (
                            <div className="mt-3">
                              <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.08em]" style={{ color: 'var(--text-muted)' }}>Section</label>
                              <select value={course.selectedSectionId} onChange={(event) => changeSection(course.courseCode, event.target.value)} className="w-full rounded-2xl border px-3 py-2 text-sm" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)', color: 'var(--text)' }}>
                                {course.sections.map((section) => <option key={section.id} value={section.id}>{section.code}</option>)}
                              </select>
                            </div>
                          )}
                          {(() => {
                            const noSchedule = !onGrid && !courseHasSchedule(course)
                            return (
                              <button
                                type="button"
                                onClick={() => toggleGrid(course.courseCode)}
                                title={noSchedule ? 'No schedule data yet — cannot place on grid' : onGrid ? 'Remove from weekly grid' : 'Place on weekly grid'}
                                className="mt-3 w-full rounded-full border px-4 py-2 text-sm font-semibold transition-transform hover:-translate-y-[1px]"
                                style={{
                                  background: onGrid ? 'var(--gold-soft)' : noSchedule ? 'var(--panel-soft)' : 'var(--accent-soft)',
                                  borderColor: onGrid ? 'var(--gold)' : noSchedule ? 'var(--line)' : 'var(--line-strong)',
                                  color: noSchedule ? 'var(--text-muted)' : 'var(--text)',
                                  opacity: noSchedule ? 0.7 : 1,
                                }}
                              >
                                {onGrid ? 'Remove from grid' : noSchedule ? 'No schedule — can\'t place' : 'Place on grid'}
                              </button>
                            )
                          })()}
                          {gridMessages[course.courseCode] && <p className="mt-3 text-xs leading-5" style={{ color: 'var(--text-muted)' }}>{gridMessages[course.courseCode]}</p>}
                          {/* Manual time entry for cross-reg / MIT courses with no schedule data */}
                          {!onGrid && !courseHasSchedule(course) && !sectionTimesLoading && (
                            <div className="mt-3 rounded-xl border px-3 py-2" style={{ background: 'var(--panel-subtle)', borderColor: 'var(--line)' }}>
                              <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.08em]" style={{ color: 'var(--text-muted)' }}>Set meeting time</p>
                              <div className="mb-2 flex flex-wrap gap-1">
                                {['MON','TUE','WED','THU','FRI'].map((day) => {
                                  const edit = manualTimeEdit[course.courseCode] || { days: [], start: '', end: '' }
                                  const active = edit.days.includes(day)
                                  return (
                                    <button key={day} type="button"
                                      onClick={() => setManualTimeEdit((prev) => {
                                        const e = prev[course.courseCode] || { days: [], start: '', end: '' }
                                        const days = active ? e.days.filter((d) => d !== day) : [...e.days, day]
                                        return { ...prev, [course.courseCode]: { ...e, days } }
                                      })}
                                      className="rounded-full border px-2 py-0.5 text-[11px] font-semibold"
                                      style={{ background: active ? 'var(--accent-soft)' : 'transparent', borderColor: active ? 'var(--accent)' : 'var(--line)', color: active ? 'var(--accent-strong)' : 'var(--text-muted)' }}
                                    >{day.slice(0,2)}</button>
                                  )
                                })}
                              </div>
                              <div className="flex gap-2">
                                <input type="time" value={(manualTimeEdit[course.courseCode] || {}).start || ''} onChange={(e) => setManualTimeEdit((prev) => ({ ...prev, [course.courseCode]: { ...(prev[course.courseCode] || { days: [], start: '', end: '' }), start: e.target.value } }))} className="flex-1 min-w-0 rounded-lg border px-2 py-1 text-xs" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)', color: 'var(--text)' }} aria-label="Start time" />
                                <span className="self-center text-xs" style={{ color: 'var(--text-muted)' }}>–</span>
                                <input type="time" value={(manualTimeEdit[course.courseCode] || {}).end || ''} onChange={(e) => setManualTimeEdit((prev) => ({ ...prev, [course.courseCode]: { ...(prev[course.courseCode] || { days: [], start: '', end: '' }), end: e.target.value } }))} className="flex-1 min-w-0 rounded-lg border px-2 py-1 text-xs" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)', color: 'var(--text)' }} aria-label="End time" />
                              </div>
                              {(() => {
                                const edit = manualTimeEdit[course.courseCode] || {}
                                const ready = edit.days?.length > 0 && edit.start && edit.end
                                return (
                                  <button type="button" disabled={!ready} onClick={() => applyManualTime(course.courseCode)}
                                    className="mt-2 w-full rounded-full border px-3 py-1.5 text-xs font-semibold transition-transform enabled:hover:-translate-y-[1px] disabled:cursor-default disabled:opacity-40"
                                    style={{ background: ready ? 'var(--accent-soft)' : 'transparent', borderColor: ready ? 'var(--line-strong)' : 'var(--line)', color: ready ? 'var(--text)' : 'var(--text-muted)' }}>
                                    Save &amp; place on grid
                                  </button>
                                )
                              })()}
                            </div>
                          )}
                          {inConflict && <p className="mt-3 text-xs font-semibold uppercase tracking-[0.08em]" style={{ color: 'var(--danger)' }}>Conflict detected</p>}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>

              <div className="border-t" style={{ borderColor: 'var(--line)' }} />

              {/* ── SECTION 2: COMPLETED ── */}
              <div className="p-4">
                {/* Header */}
                <div className="mb-3 rounded-xl border px-3 py-2.5" style={{ background: 'color-mix(in srgb, var(--success) 8%, var(--panel-soft))', borderColor: 'color-mix(in srgb, var(--success) 30%, var(--line))' }}>
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <button type="button" onClick={() => toggleSection('completed')} className="flex h-4 w-4 items-center justify-center text-[10px] transition-transform" style={{ color: 'var(--success)', transform: collapsedSections.completed ? 'rotate(-90deg)' : 'rotate(0deg)' }} aria-label="Toggle completed">▾</button>
                      <span style={{ fontSize: 15 }}>🎓</span>
                      <p className="text-xs font-bold uppercase tracking-[0.12em]" style={{ color: 'var(--success)' }}>Already Taken</p>
                    </div>
                    <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ background: 'color-mix(in srgb, var(--success) 15%, transparent)', color: 'var(--success)' }}>{completedCourses.length} course{completedCourses.length !== 1 ? 's' : ''}</span>
                  </div>
                  <p className="mt-1 text-[11px] leading-4" style={{ color: 'var(--text-muted)' }}>Log courses you've completed — they count toward your requirements tracker below.</p>
                </div>

                {/* Taken courses list — always visible for easy review/delete */}
                {completedCourses.length > 0 && (
                  <div className="mb-3 space-y-1.5">
                    {normalizedCompletedCourses.map((c) => (
                      <div key={c.courseCode} className="flex items-center justify-between gap-2 rounded-xl border px-2.5 py-1.5" style={{ background: 'color-mix(in srgb, var(--success) 6%, var(--panel-soft))', borderColor: 'color-mix(in srgb, var(--success) 25%, var(--line))' }}>
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-[11px]" style={{ color: 'var(--success)' }}>✓</span>
                          <span className="truncate text-[11px] font-semibold" style={{ color: 'var(--text-soft)' }}>{c.courseCode}</span>
                        </div>
                        <button type="button" onClick={() => removeFromCompleted(c.courseCode)} aria-label={`Un-complete ${c.courseCode}`} className="shrink-0 text-[11px] font-bold transition-opacity hover:opacity-70" style={{ color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer' }}>×</button>
                      </div>
                    ))}
                  </div>
                )}

                {/* Search + add — behind collapse toggle */}
                {!collapsedSections.completed && (
                  <>
                    <div className="relative mb-2">
                      <input
                        type="text"
                        value={completedSearchQ}
                        onChange={(e) => setCompletedSearchQ(e.target.value)}
                        placeholder="🔍  Search courses you've taken…"
                        className="w-full rounded-xl border px-3 py-2.5 text-xs outline-none transition-colors"
                        style={{ background: 'var(--panel-soft)', borderColor: completedSearchQ ? 'var(--success)' : 'var(--line-strong)', color: 'var(--text)' }}
                        aria-label="Search courses already taken"
                      />
                      {completedSearchResults.length > 0 && (
                        <div className="absolute left-0 right-0 top-full z-30 mt-1 max-h-52 overflow-y-auto rounded-xl border shadow-lg" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
                          {completedSearchResults.map((c) => {
                            const code = c.course_code_base || c.course_code
                            const alreadyDone = completedCourseCodes.has(code)
                            return (
                              <button
                                key={code}
                                type="button"
                                onClick={() => {
                                  if (!alreadyDone) addToCompleted({ courseCode: code, title: c.course_name, instructors: [c.professor_display || c.professor].filter(Boolean), credits: 4, sections: [], enrichment: {} })
                                  setCompletedSearchQ('')
                                }}
                                className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs transition-colors hover:bg-[var(--panel-soft)]"
                              >
                                <div className="min-w-0 flex-1 overflow-hidden">
                                  <span className="font-semibold" style={{ color: 'var(--text)' }}>{code}</span>
                                  <span className="ml-2" style={{ color: 'var(--text-muted)' }}>{c.course_name}</span>
                                </div>
                                {alreadyDone ? (
                                  <span className="shrink-0 text-xs font-semibold" style={{ color: 'var(--success)' }}>✓ Added</span>
                                ) : (
                                  <span className="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ background: 'color-mix(in srgb, var(--success) 12%, transparent)', color: 'var(--success)', border: '1px solid color-mix(in srgb, var(--success) 35%, transparent)' }}>✓ Mark done</span>
                                )}
                              </button>
                            )
                          })}
                        </div>
                      )}
                      {completedSearchQ.trim().length >= 2 && completedSearchResults.length === 0 && (
                        <div className="mt-1.5 flex items-center justify-between rounded-xl border px-3 py-1.5 text-xs" style={{ background: 'var(--panel-soft)', borderColor: 'var(--line)' }}>
                          <span style={{ color: 'var(--text-muted)' }}>Not in Q-guide history</span>
                          <button
                            type="button"
                            onClick={() => {
                              const code = completedSearchQ.trim().toUpperCase().replace(/\s+/g, '-')
                              const secInfo = sectionInfoMap.get(code)
                              addToCompleted({ courseCode: code, title: secInfo?.title || code, credits: secInfo?.credits ?? 4, sections: [], instructors: secInfo?.instructors || [], enrichment: {} })
                              setCompletedSearchQ('')
                            }}
                            className="rounded-full border px-2 py-0.5 text-[11px] font-semibold"
                            style={{ background: 'color-mix(in srgb, var(--success) 12%, transparent)', color: 'var(--success)', borderColor: 'color-mix(in srgb, var(--success) 35%, transparent)' }}
                          >
                            + Add {completedSearchQ.trim().toUpperCase().replace(/\s+/g, '-')} as done
                          </button>
                        </div>
                      )}
                    </div>
                    <details className="mb-2">
                      <summary className="cursor-pointer select-none text-[11px]" style={{ color: 'var(--text-muted)' }}>Add by course code</summary>
                      <div className="mt-1.5 flex gap-2">
                        <input
                          type="text"
                          value={completedInput}
                          onChange={(event) => setCompletedInput(event.target.value.toUpperCase())}
                          onKeyDown={(event) => { if (event.key !== 'Enter') return; event.preventDefault(); handleQuickAddCompleted() }}
                          placeholder="e.g. API-101"
                          className="min-w-0 flex-1 rounded-xl border px-3 py-2 text-xs outline-none transition-colors"
                          style={{ background: 'var(--panel-soft)', borderColor: 'var(--line-strong)', color: 'var(--text)' }}
                          aria-label="Quick add completed course code"
                        />
                        <button type="button" onClick={handleQuickAddCompleted} disabled={!completedInput.trim()} className="shrink-0 rounded-xl border px-3 py-2 text-xs font-semibold transition-transform enabled:hover:-translate-y-[1px] disabled:cursor-default disabled:opacity-50" style={{ background: 'var(--accent-soft)', borderColor: 'var(--line-strong)', color: 'var(--text)' }}>Add</button>
                      </div>
                    </details>
                    {completedCourses.length === 0 && (
                      <p className="text-[11px] leading-5" style={{ color: 'var(--text-muted)' }}>Search above to mark courses as completed.</p>
                    )}
                  </>
                )}
              </div>

              <div className="border-t" style={{ borderColor: 'var(--line)' }} />

              {/* ── SECTION 3: REQUIREMENTS ── */}
              <div data-tour="req-tracker" className="p-4">
                <div className="mb-3 flex items-center gap-2">
                  <button type="button" onClick={() => toggleSection('requirements')} className="flex h-4 w-4 items-center justify-center text-[10px] transition-transform" style={{ color: 'var(--text-muted)', transform: collapsedSections.requirements ? 'rotate(-90deg)' : 'rotate(0deg)' }} aria-label="Toggle requirements">▾</button>
                  <p className="text-xs font-semibold uppercase tracking-[0.12em]" style={{ color: 'var(--text-muted)' }}>Requirements</p>
                  {progress && <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>· {programs.find(p => p.id === reqProgram)?.shortLabel || reqProgram}</span>}
                  {progress && <span className="ml-auto text-[10px] font-semibold" style={{ color: progress.overallPercent >= 100 ? 'var(--success)' : 'var(--gold)' }}>{progress.overallAppliedCredits}/{progress.totalRequiredCredits} cr</span>}
                </div>
                {!collapsedSections.requirements && (
                  <>
                    <div className="mb-3">
                      <select value={reqProgram} onChange={(event) => setReqProgram(event.target.value)} className="w-full rounded-2xl border px-3 py-2 text-sm" style={{ background: 'var(--panel-soft)', borderColor: 'var(--line-strong)', color: 'var(--text)' }}>
                        {programs.map((program) => <option key={program.id} value={program.id}>{program.label}</option>)}
                      </select>
                    </div>
                    {progress ? (
                      <div className="space-y-4">
                        {progress.categories.map((category) => (
                          <div key={category.id}>
                            <div className="mb-2 flex items-center justify-between gap-3 text-xs">
                              <span style={{ color: category.isComplete ? 'var(--success)' : 'var(--text-soft)' }}>
                                {category.isComplete ? '✓ ' : ''}{category.label}
                                {category.chosenArea ? ` (${category.chosenArea})` : ''}
                              </span>
                              <span style={{ color: 'var(--text)' }}>{category.appliedCredits}/{category.requiredCredits} cr</span>
                            </div>
                            <ProgressBar value={category.percent} tone={category.isComplete ? 'var(--success)' : 'var(--accent)'} label={`${category.label}: ${category.appliedCredits}/${category.requiredCredits} credits`} />
                            {category.selectedCourses?.length > 0 && (
                              <div className="mt-1.5 space-y-1">
                                {category.selectedCourses.map((sc) => (
                                  <div key={sc._courseCode} className="flex items-center justify-between gap-1.5 rounded-xl px-2 py-1" style={{ background: 'var(--panel-soft)', opacity: sc._isCompleted ? 0.7 : 1 }}>
                                    <div className="flex items-center gap-1.5 min-w-0">
                                      {sc._isCompleted && <span className="shrink-0 text-[10px]" style={{ color: 'var(--success)' }}>✓</span>}
                                      <span className="truncate text-[11px] font-semibold" style={{ color: sc._isCompleted ? 'var(--text-muted)' : 'var(--text-soft)' }}>{sc._courseCode}</span>
                                    </div>
                                    <div className="flex shrink-0 items-center gap-1.5">
                                      <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{sc._credits}cr</span>
                                      {sc._isCompleted ? (
                                        <button type="button" onClick={() => removeFromCompleted(sc._courseCode)} aria-label={`Un-complete ${sc._courseCode}`} className="flex h-4 w-4 items-center justify-center text-[11px] font-bold transition-opacity hover:opacity-70" style={{ color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer' }}>×</button>
                                      ) : (
                                        <button type="button" onClick={() => removeCourse(sc._courseCode)} aria-label={`Remove ${sc._courseCode}`} className="flex h-4 w-4 items-center justify-center text-[11px] font-bold transition-opacity hover:opacity-70" style={{ color: 'var(--danger)', background: 'none', border: 'none', cursor: 'pointer' }}>×</button>
                                      )}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        ))}
                        <div className="border-t pt-4" style={{ borderColor: 'var(--line)' }}>
                          <div className="mb-2 flex items-center justify-between gap-3 text-xs">
                            <span style={{ color: 'var(--text-soft)' }}>Total credits</span>
                            <span style={{ color: 'var(--text)' }}>{progress.overallAppliedCredits}/{progress.totalRequiredCredits} cr</span>
                          </div>
                          <ProgressBar value={progress.overallPercent} tone="var(--gold)" label={`Total: ${progress.overallAppliedCredits}/${progress.totalRequiredCredits} credits`} />
                        </div>
                        <a href={`/requirements?p=${reqProgram}`} className="mt-1 block text-center text-xs font-semibold transition-transform hover:-translate-y-[1px]" style={{ color: 'var(--accent)' }}>Full tracker →</a>
                      </div>
                    ) : <p className="mt-3 text-sm" style={{ color: 'var(--text-muted)' }}>No program definitions available.</p>}
                  </>
                )}
              </div>

            </div>
          </aside>
        </div>
        {manualCourseModal !== null && (
          <ManualCourseModal
            initial={manualCourseModal}
            onAdd={(courseData) => {
              addToShortlist(normalizeCourse(courseData))
              setManualCourseModal(null)
              setSearchQ('')
            }}
            onClose={() => setManualCourseModal(null)}
          />
        )}
      </div>
    </div>
  )
}
