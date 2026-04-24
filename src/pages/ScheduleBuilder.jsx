import { useEffect, useMemo, useRef, useState } from 'react'
import { findConflicts } from '../lib/conflictDetector'
import { loadPlan, savePlan, PLANS, DEFAULT_PLAN, loadCompleted, saveCompleted } from '../lib/scheduleStorage'
import { computeProgress, getPrograms } from '../lib/requirementsEngine'
import { searchHarvardCourses } from '../lib/harvardApi'
import { useFavorites } from '../useFavorites'

const GRID_START = 480
const GRID_END = 1170
const ROW_HEIGHT = 36
const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']
const WEEKEND_LABELS = ['Sat', 'Sun']
const DAY_INDEX = { MON: 0, TUE: 1, WED: 2, THU: 3, FRI: 4, SAT: 5, SUN: 6 }
const TERM_OPTIONS = ['Q1', 'Q2', 'FULL']
const SEMESTER_OPTIONS = [
  { value: 'Spring', label: 'Spring' },
  { value: 'Fall',   label: 'Fall'   },
  { value: 'January', label: 'J-term' },
]

function fallbackSearch(q, allCourses, filters = {}) {
  const query = String(q || '').trim().toLowerCase()
  const { concentration, stem, coreOnly, semester, searchSource } = filters
  const hasFilters = (concentration && concentration !== 'All') || (stem && stem !== 'all') || coreOnly || (semester && semester !== 'All') || (searchSource && searchSource !== 'All')
  if (!query && !hasFilters) return []
  // Map semester → (year, term) used in the courses table
  const semesterTermMap = {
    Spring:  { year: 2026, term: 'Spring' },
    Fall:    { year: 2025, term: 'Fall' },
    January: { year: 2025, term: 'January' },
  }
  const termFilter = semesterTermMap[semester] || null
  return (Array.isArray(allCourses) ? allCourses : [])
    .filter((c) => !c?.is_average && Number(c?.year || 0) >= 2024)
    .filter((c) => {
      const hks = isHksCourse(c?.course_code_base || c?.course_code)
      if (query && !([c?.course_code, c?.course_name, c?.professor, c?.professor_display].filter(Boolean).join(' ').toLowerCase().includes(query))) return false
      if (concentration && concentration !== 'All' && c?.concentration !== concentration) return false
      if (stem === 'stem' && !c?.is_stem) return false
      if (stem === 'nonstem' && c?.is_stem) return false
      if (coreOnly && !c?.is_core) return false
      if (searchSource === 'HKS' && !hks) return false
      if (searchSource === 'Non-HKS' && hks) return false
      // Filter by semester/term if a matching entry exists in the catalog
      if (termFilter && (Number(c?.year) !== termFilter.year || c?.term !== termFilter.term)) return false
      return true
    })
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

// Term start dates: Fall 2025 = Sep 2, Spring 2026 = Jan 27
const TERM_START = { Q1: '20250902', Q2: '20251027', FULL: '20250902', SPRING: '20260127' }

function buildIcs(courses, term = 'FULL') {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//HKS Course Explorer//Schedule Builder//EN']
  const dayMap = { MON: 'MO', TUE: 'TU', WED: 'WE', THU: 'TH', FRI: 'FR' }
  const dateBase = TERM_START[term] || TERM_START.FULL
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
    lines.push(`DTSTART:${dateBase}T${String(start.hours).padStart(2, '0')}${String(start.minutes).padStart(2, '0')}00`)
    lines.push(`DTEND:${dateBase}T${String(end.hours).padStart(2, '0')}${String(end.minutes).padStart(2, '0')}00`)
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
  const [sectionTimesMap, setSectionTimesMap] = useState(new Map()) // courseCodeBase → meetings[]
  const [term, setTerm] = useState('FULL')
  const [semester, setSemester] = useState('Spring')
  const [showWeekends, setShowWeekends] = useState(false)
  const [searchQ, setSearchQ] = useState('')
  const [searchConcentration, setSearchConcentration] = useState('All')
  const [searchStem, setSearchStem] = useState('all')
  const [searchCoreOnly, setSearchCoreOnly] = useState(false)
  const [searchSource, setSearchSource] = useState('HKS')
  const [searchResults, setSearchResults] = useState([])
  const [searching, setSearching] = useState(false)
  const [apiMode, setApiMode] = useState('unknown') // 'live' | 'db' | 'unknown'
  const [expandedBlock, setExpandedBlock] = useState(null)
  const [reqProgram, setReqProgram] = useState(() => getPrograms()[0]?.id || '')
  const [gridMessages, setGridMessages] = useState({})
  const [exportMsg, setExportMsg] = useState(null)
  const exportMsgTimeoutRef = useRef(null)
  const [copyPlanMsg, setCopyPlanMsg] = useState(null)
  const copyPlanTimeoutRef = useRef(null)
  const [hubTheme, setHubTheme] = useState(() => window.localStorage.getItem('hks-theme') === 'hub')

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
    if (hubTheme) {
      document.documentElement.setAttribute('data-theme', 'hub')
      window.localStorage.setItem('hks-theme', 'hub')
      return
    }
    const savedTheme = window.localStorage.getItem('hks-theme')
    const nextTheme = savedTheme === 'hub' ? 'light' : (savedTheme || 'dark')
    document.documentElement.setAttribute('data-theme', nextTheme)
    window.localStorage.setItem('hks-theme', nextTheme)
  }, [hubTheme])

  useEffect(() => {
    return () => {
      if (exportMsgTimeoutRef.current) clearTimeout(exportMsgTimeoutRef.current)
      if (copyPlanTimeoutRef.current) clearTimeout(copyPlanTimeoutRef.current)
    }
  }, [])

  // Fetch meeting times from Supabase course_sections
  useEffect(() => {
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
    const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY
    if (!supabaseUrl || !supabaseKey) return
    // Map semester label to term string stored in course_sections
    const termStr = semester === 'Spring' ? '2026Spring' : semester === 'Fall' ? '2025Fall' : '2025January'
    fetch(`${supabaseUrl}/rest/v1/course_sections?term=eq.${termStr}&select=course_code_base,meetings,title,instructors&limit=500`, {
      headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` },
    })
      .then((r) => r.ok ? r.json() : [])
      .then((rows) => {
        const map = new Map()
        ;(Array.isArray(rows) ? rows : []).forEach((row) => {
          if (row.course_code_base && Array.isArray(row.meetings) && row.meetings.length) {
            map.set(row.course_code_base, row.meetings)
          }
        })
        setSectionTimesMap(map)
      })
      .catch(() => {})
  }, [semester])

  useEffect(() => {
    const query = searchQ.trim()
    const searchFilters = { concentration: searchConcentration, stem: searchStem, coreOnly: searchCoreOnly, semester, searchSource }
    const hasFilters = (searchConcentration !== 'All') || (searchStem !== 'all') || searchCoreOnly || searchSource !== 'All'
    if (!query && !hasFilters) {
      setSearching(false)
      setSearchResults([])
      return undefined
    }
    let cancelled = false
    const timer = window.setTimeout(async () => {
      setSearching(true)
      try {
        if (query) {
          const semesterKey = semester === 'January' ? 'January' : semester
          const termYear = semester === 'Fall' || semester === 'January' ? 2025 : 2026
          const remote = await searchHarvardCourses(query, { term: `${termYear}${semesterKey}`, school: 'HKS' })
          if (cancelled) return
          let normalized = (Array.isArray(remote) ? remote : []).map((item, index) => normalizeCourse(item, index))
          // Apply client-side filters to live results
          if (searchStem === 'stem') normalized = normalized.filter((c) => c.enrichment?.is_stem)
          if (searchStem === 'nonstem') normalized = normalized.filter((c) => !c.enrichment?.is_stem)
          if (searchCoreOnly) normalized = normalized.filter((c) => c.enrichment?.is_core)
          normalized = normalized.slice(0, 12)
          if (normalized.length) {
            setApiMode('live')
            setSearchResults(normalized)
          } else {
            setApiMode('db')
            setSearchResults(fallbackSearch(query, courses, searchFilters).map((item, index) => normalizeCourse(item, index)))
          }
        } else {
          // Filter-only mode — use DB
          if (cancelled) return
          setApiMode('db')
          setSearchResults(fallbackSearch('', courses, searchFilters).map((item, index) => normalizeCourse(item, index)))
        }
      } catch {
        if (!cancelled) {
          setApiMode('db')
          setSearchResults(fallbackSearch(query, courses, searchFilters).map((item, index) => normalizeCourse(item, index)))
        }
      } finally {
        if (!cancelled) setSearching(false)
      }
    }, 400)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [courses, searchQ, searchConcentration, searchStem, searchCoreOnly, searchSource, semester])

  const concentrationOptions = useMemo(() => {
    const seen = new Set()
    ;(Array.isArray(courses) ? courses : []).forEach((c) => { if (c?.concentration) seen.add(c.concentration) })
    return ['All', ...[...seen].sort()]
  }, [courses])

  const normalizedPlanCourses = useMemo(() => (Array.isArray(planData?.courses) ? planData.courses : []).map((course, index) => normalizeCourse(course, index)), [planData])
  // Enrich plan courses with Supabase meeting times where missing.
  // Must be declared before gridCourses which depends on it.
  const planCoursesEnriched = useMemo(() => normalizedPlanCourses.map((course) => {
    if (courseHasSchedule(course)) return course // already has times
    const meetings = sectionTimesMap.get(course.courseCode) || sectionTimesMap.get(course.courseCode.split('-').slice(0, 2).join('-'))
    if (!meetings?.length) return course
    const allDays = [...new Set(meetings.map((m) => m.day))].join('/')
    return {
      ...course,
      meeting_days: allDays,
      time_start: meetings[0].start,
      time_end: meetings[0].end,
      location: meetings[0].location || course.location,
      _hasLiveTimes: true,
    }
  }), [normalizedPlanCourses, sectionTimesMap])
  const planAvgRating = useMemo(() => {
    const ratedCourses = planCoursesEnriched.filter((course) => course.enrichment?.metrics_pct?.overall != null)
    if (!ratedCourses.length) return null
    const average = ratedCourses.reduce((sum, course) => sum + Number(course.enrichment.metrics_pct.overall || 0), 0) / ratedCourses.length
    return average.toFixed(1)
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
  const addToCompleted = (course) => {
    const normalized = normalizeCourse(course)
    setCompletedCourses((prev) => {
      if (prev.some((c) => normalizeCourse(c).courseCode === normalized.courseCode)) return prev
      return [...prev, { ...normalized, _isCompleted: true }]
    })
  }
  const removeFromCompleted = (courseCode) => {
    setCompletedCourses((prev) => prev.filter((c) => normalizeCourse(c).courseCode !== courseCode))
  }
  const handleQuickAddCompleted = () => {
    const courseCode = completedInput.trim().toUpperCase()
    if (!courseCode) return
    addToCompleted({
      courseCode,
      title: courseCode,
      credits: 4,
      sections: [],
      instructors: [],
      enrichment: {},
    })
    setCompletedInput('')
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
    const blob = buildIcs(normalizedPlanCourses, term)
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
      copyPlanTimeoutRef.current = setTimeout(() => setCopyPlanMsg(null), 2500)
    }).catch(() => {
      if (copyPlanTimeoutRef.current) clearTimeout(copyPlanTimeoutRef.current)
      setCopyPlanMsg('Failed')
      copyPlanTimeoutRef.current = setTimeout(() => setCopyPlanMsg(null), 2500)
    })
  }

  const handleSearchKeyDown = (event) => {
    if (event.key !== 'Enter') return
    const firstUnadded = searchResults.find((r) => !addedCourseCodes.has(r.courseCode))
    if (firstUnadded) addToShortlist(firstUnadded)
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

          <div className="flex items-center gap-3">
            {/* Semester selector */}
            <div className="inline-flex rounded-full border p-1" style={{ background: 'var(--panel-soft)', borderColor: 'var(--line)' }}>
              {SEMESTER_OPTIONS.map((opt) => {
                const active = opt.value === semester
                return (
                  <button key={opt.value} type="button" onClick={() => setSemester(opt.value)}
                    className="rounded-full px-4 py-2 text-sm font-semibold transition-colors"
                    style={{ background: active ? 'var(--accent)' : 'transparent', color: active ? '#fff8f5' : 'var(--text-muted)' }}>
                    {opt.label}
                  </button>
                )
              })}
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
              onClick={() => setHubTheme((current) => !current)}
              className="rounded-full border px-4 py-2 text-sm font-semibold transition-all hover:-translate-y-[1px]"
              style={{
                background: hubTheme ? 'var(--accent-soft)' : 'var(--panel-soft)',
                borderColor: hubTheme ? 'var(--accent)' : 'var(--line-strong)',
                color: 'var(--text)',
              }}
            >
              {hubTheme ? '← Classic' : 'HUB Style'}
            </button>
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
          <aside className="flex h-full w-[280px] shrink-0 flex-col border-r" style={{ borderColor: 'var(--line)', background: 'var(--panel)' }}>
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
                    className="shrink-0 rounded-xl border px-2 py-1.5 text-xs font-semibold transition-colors"
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
                <div className="flex flex-wrap gap-1.5">
                  {SEMESTER_OPTIONS.map((opt) => {
                    const active = semester === opt.value
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => setSemester(opt.value)}
                        className="rounded-xl border px-2 py-1.5 text-xs font-semibold transition-colors"
                        style={{
                          background: active ? 'var(--accent-soft)' : 'var(--panel-soft)',
                          borderColor: active ? 'var(--accent)' : 'var(--line-strong)',
                          color: active ? 'var(--text)' : 'var(--text-muted)',
                        }}
                      >
                        {opt.label}
                      </button>
                    )
                  })}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {['All', 'HKS', 'Non-HKS'].map((option) => {
                    const active = searchSource === option
                    return (
                      <button
                        key={option}
                        type="button"
                        onClick={() => setSearchSource(option)}
                        className="rounded-xl border px-2 py-1.5 text-xs font-semibold transition-colors"
                        style={{
                          background: active ? 'var(--accent-soft)' : 'var(--panel-soft)',
                          borderColor: active ? 'var(--accent)' : 'var(--line-strong)',
                          color: active ? 'var(--text)' : 'var(--text-muted)',
                        }}
                      >
                        {option}
                      </button>
                    )
                  })}
                </div>
              </div>
              {searchResults.length > 0 && searchQ.trim() ? (
                <p className="mt-2 text-[11px]" style={{ color: 'var(--text-muted)' }}>↩ Enter to add first result</p>
              ) : apiMode === 'db' && !searchQ.trim() ? (
                <p className="mt-2 text-[11px] leading-5" style={{ color: 'var(--text-muted)' }}>Q-guide data shown. Live section times need Harvard API key.</p>
              ) : null}
            </div>

            <div className="flex min-h-0 flex-1 flex-col p-4">
              {!searchQ.trim() ? (
                shortlistedSuggestions.length > 0 ? (
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
                ) : (
                  <div className="flex h-full items-center justify-center rounded-[24px] border p-6 text-center" style={{ background: 'var(--panel-soft)', borderColor: 'var(--line)', color: 'var(--text-muted)' }}>Type to search HKS courses</div>
                )
              ) : searching ? (
                <div className="py-8 text-center text-sm" style={{ color: 'var(--text-muted)' }}>Searching...</div>
              ) : searchResults.length === 0 ? (
                <div className="py-8 text-center text-sm" style={{ color: 'var(--text-muted)' }}>No matching courses found.</div>
              ) : (
                <div className="space-y-3">
                  {searchResults.slice(0, 12).map((course, index) => {
                    const added = addedCourseCodes.has(course.courseCode)
                    const done = completedCourseCodes.has(course.courseCode)
                    const hks = isHksCourse(course.courseCode)
                    return (
                      <div key={`${course.courseCode}-${index}`} className="rounded-[24px] border p-4" style={{ background: hks ? 'var(--panel-soft)' : 'var(--panel)', borderColor: hks ? 'var(--line)' : 'var(--line)', opacity: hks ? 1 : 0.75 }}>
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <p className="text-sm font-semibold" style={{ color: hks ? 'var(--text)' : 'var(--text-muted)' }}>{course.courseCode}</p>
                              {!hks && <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold" style={{ background: 'var(--panel-strong)', color: 'var(--text-muted)', border: '1px solid var(--line-strong)' }}>Cross-reg</span>}
                            </div>
                            <p className="mt-1 overflow-hidden text-sm leading-5" style={{ color: hks ? 'var(--text-soft)' : 'var(--text-muted)', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{course.title}</p>
                          </div>
                          <div className="flex shrink-0 flex-col gap-1.5">
                            <button type="button" disabled={added || done} onClick={() => addToShortlist(course)} className="rounded-full border px-3 py-1.5 text-xs font-semibold transition-transform enabled:hover:-translate-y-[1px] disabled:cursor-default" style={{ background: added ? 'var(--success)' : 'var(--accent-soft)', borderColor: added ? 'var(--success)' : 'var(--line-strong)', color: added ? 'var(--panel)' : 'var(--text)' }}>
                              {added ? 'Added ✓' : 'Add'}
                            </button>
                            {hks && (
                              <button type="button" onClick={() => done ? removeFromCompleted(course.courseCode) : addToCompleted(course)} className="rounded-full border px-3 py-1.5 text-xs font-semibold transition-transform hover:-translate-y-[1px]" style={{ background: done ? 'var(--success-soft)' : 'transparent', borderColor: done ? 'var(--success)' : 'var(--line)', color: done ? 'var(--success)' : 'var(--text-muted)' }}>
                                {done ? '✓ Done' : '+ Done'}
                              </button>
                            )}
                          </div>
                        </div>
                        <p className="mt-2 text-xs leading-5" style={{ color: 'var(--text-muted)' }}>{course.instructors.length ? course.instructors.join(', ') : 'Instructor TBA'}</p>
                        <div className="mt-3 flex flex-wrap gap-2">
                          {hks && course.enrichment?.is_core && <Chip tone="success">Core</Chip>}
                          {hks && course.enrichment?.is_stem && <Chip tone="blue">STEM</Chip>}
                          {course.sections.length > 0 ? (
                            <Chip>{course.sections.length} section{course.sections.length > 1 ? 's' : ''}</Chip>
                          ) : sectionTimesMap.has(course.courseCode) ? (
                            (() => {
                              const DAY_ABBR = { MON: 'M', TUE: 'Tu', WED: 'W', THU: 'Th', FRI: 'F', SAT: 'Sa', SUN: 'Su' }
                              const mtgs = sectionTimesMap.get(course.courseCode)
                              const days = [...new Set(mtgs.map((m) => DAY_ABBR[m.day] || m.day))].join('/')
                              const start = mtgs[0]?.start || ''
                              return <Chip tone="success">{days}{start ? ` ${start}` : ''}</Chip>
                            })()
                          ) : (
                            <Chip tone="danger">No time data</Chip>
                          )}
                          {hks && (course.enrichment?.last_bid_price ?? course.enrichment?.bid_clearing_price) != null && (
                            <Chip tone="gold">{course.enrichment.last_bid_price ?? course.enrichment.bid_clearing_price} bid pts</Chip>
                          )}
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
                      <div key={key} className="absolute z-10 rounded-2xl border p-2" style={{ top: `${top + 2}px`, left: `calc(52px + ${dayIndex} * (100% - 52px) / ${numDays} + 2px)`, width: `calc((100% - 52px) / ${numDays} - 4px)`, height: `${Math.max(height - 4, 28)}px`, background: conflict ? 'var(--panel-soft)' : 'var(--accent-soft)', borderColor: conflict ? 'var(--danger)' : 'var(--accent)', color: 'var(--text)' }}>
                        <button type="button" onClick={() => setExpandedBlock((current) => (current === course.courseCode ? null : course.courseCode))} className="block h-full w-full text-left">
                          <p className="truncate pr-6 text-xs font-semibold">{course.courseCode}</p>
                          <p className="mt-1 text-[11px] leading-4" style={{ color: 'var(--text-soft)', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{course.title}</p>
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

          <aside className="flex h-full w-[280px] shrink-0 flex-col border-l" style={{ borderColor: 'var(--line)', background: 'var(--panel)' }}>
            <div className="flex min-h-0 flex-1 flex-col p-4">
              <div className="shrink-0">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-semibold uppercase tracking-[0.12em]" style={{ color: 'var(--text-muted)' }}>Shortlist</p>
                  {normalizedPlanCourses.length >= 2 && (
                    <a
                      href={`/compare?ids=${normalizedPlanCourses.slice(0, 5).map((c) => encodeURIComponent(c.courseCode)).join(',')}`}
                      className="text-xs font-semibold transition-transform hover:-translate-y-[1px]"
                      style={{ color: 'var(--accent)' }}
                      title="Open top 5 shortlisted courses in Compare"
                    >
                      ⇄ Compare
                    </a>
                  )}
                </div>
                <div className="mt-1 flex items-baseline gap-2">
                  <p className="text-sm" style={{ color: 'var(--text-soft)' }}>{normalizedPlanCourses.length} course{normalizedPlanCourses.length === 1 ? '' : 's'}</p>
                  {normalizedPlanCourses.length > 0 && (
                    <p className="text-xs font-semibold" style={{ color: 'var(--gold)' }}>
                      {normalizedPlanCourses.reduce((sum, c) => sum + (c.credits || 4), 0)} cr
                    </p>
                  )}
                  {planAvgRating != null && (
                    <p className="text-xs font-semibold" style={{ color: 'var(--gold)' }}>
                      ★ {planAvgRating} avg
                    </p>
                  )}
                </div>
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
                ) : planCoursesEnriched.map((course) => {
                  const onGrid = course.isOnGrid
                  const inConflict = conflictSet.has(course.courseCode)
                  return (
                    <div key={course.courseCode} className="rounded-[24px] border p-4" style={{ background: 'var(--panel-soft)', borderColor: 'var(--line)' }}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="truncate text-sm font-semibold" style={{ color: 'var(--text)' }}>{course.courseCode}</p>
                            <span className="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ background: 'var(--gold-soft)', color: 'var(--gold)' }}>{course.credits || 4} cr</span>
                          </div>
                          <p className="mt-1 truncate text-sm" style={{ color: 'var(--text-soft)' }}>{course.title}</p>
                        </div>
                        <button type="button" onClick={() => removeCourse(course.courseCode)} className="text-sm font-semibold" style={{ color: 'var(--danger)' }} aria-label={`Remove ${course.courseCode}`}>×</button>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {course.enrichment?.is_core && <Chip tone="success">Core</Chip>}
                        {course.enrichment?.is_stem && <Chip tone="blue">STEM</Chip>}
                        {!course.enrichment?.is_core && !course.enrichment?.is_stem && <Chip>Elective</Chip>}
                        {course._hasLiveTimes && <Chip tone="success">🕐 Live times</Chip>}
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

              {/* Completed courses section */}
              <div className="shrink-0">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <p className="text-xs font-semibold uppercase tracking-[0.12em]" style={{ color: 'var(--text-muted)' }}>Completed</p>
                  <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{completedCourses.length} course{completedCourses.length !== 1 ? 's' : ''}</span>
                </div>
                <div className="mb-2 flex gap-2">
                  <input
                    type="text"
                    value={completedInput}
                    onChange={(event) => setCompletedInput(event.target.value.toUpperCase())}
                    onKeyDown={(event) => {
                      if (event.key !== 'Enter') return
                      event.preventDefault()
                      handleQuickAddCompleted()
                    }}
                    placeholder="Add course code"
                    className="min-w-0 flex-1 rounded-xl border px-3 py-2 text-xs outline-none transition-colors"
                    style={{ background: 'var(--panel-soft)', borderColor: 'var(--line-strong)', color: 'var(--text)' }}
                    aria-label="Quick add completed course code"
                  />
                  <button
                    type="button"
                    onClick={handleQuickAddCompleted}
                    disabled={!completedInput.trim()}
                    className="shrink-0 rounded-xl border px-3 py-2 text-xs font-semibold transition-transform enabled:hover:-translate-y-[1px] disabled:cursor-default disabled:opacity-50"
                    style={{ background: 'var(--accent-soft)', borderColor: 'var(--line-strong)', color: 'var(--text)' }}
                  >
                    Add
                  </button>
                </div>
                {completedCourses.length === 0 ? (
                  <p className="text-[11px] leading-5" style={{ color: 'var(--text-muted)' }}>Mark past courses as Done in search to count them toward requirements.</p>
                ) : (
                  <div className="space-y-1.5">
                    {normalizedCompletedCourses.map((c) => (
                      <div key={c.courseCode} className="flex items-center justify-between gap-2 rounded-xl border px-2.5 py-1.5" style={{ background: 'var(--panel-soft)', borderColor: 'var(--line)', opacity: 0.8 }}>
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-[11px]" style={{ color: 'var(--success)' }}>✓</span>
                          <span className="truncate text-[11px] font-semibold" style={{ color: 'var(--text-soft)' }}>{c.courseCode}</span>
                        </div>
                        <button type="button" onClick={() => removeFromCompleted(c.courseCode)} aria-label={`Un-complete ${c.courseCode}`} className="shrink-0 text-[11px] font-bold transition-opacity hover:opacity-70" style={{ color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer' }}>×</button>
                      </div>
                    ))}
                  </div>
                )}
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
                    <a
                      href={`/requirements?p=${reqProgram}`}
                      className="mt-1 block text-center text-xs font-semibold transition-transform hover:-translate-y-[1px]"
                      style={{ color: 'var(--accent)' }}
                    >
                      Full tracker →
                    </a>
                  </div>
                ) : <p className="mt-3 text-sm" style={{ color: 'var(--text-muted)' }}>No program definitions available.</p>}
              </div>
            </div>
          </aside>
        </div>
      </div>
    </div>
  )
}
