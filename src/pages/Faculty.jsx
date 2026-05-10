import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import OnboardingTour from '../components/OnboardingTour.jsx'
import { fmtShort, modeSubLabel, modeUnit } from '../utils/formatMetric.js'
import config from '../school.config.js'

const FACULTY_TOUR_STEPS = [
  {
    target: 'faculty-search',
    title: 'Search Instructors',
    body: 'Type a professor\'s name to find their profile. The list shows all instructors with evaluation data — sorted by name, rating, or number of courses.',
  },
  {
    target: 'faculty-active-since',
    title: 'Filter by Recency',
    body: '"Active Since" hides instructors who haven\'t taught since a chosen year. Set it to 2023 or 2024 to see only currently active faculty.',
  },
]

const FACULTY_DETAIL_TOUR_STEPS = [
  {
    target: 'faculty-ratings',
    title: 'Average Ratings Breakdown',
    body: 'Percentile bars across all evaluation dimensions — instructor quality, course value, workload, rigor, diverse perspectives. Green = top 25%, amber = median range, red = bottom 25%.',
  },
  {
    target: 'faculty-quick-stats',
    title: 'Quick Stats & Raw Scores',
    body: 'The headline percentile plus the raw 0–5 average score. The "all-courses med" line tells you how this instructor compares to the typical HKS course — so 92% means better than 92% of all courses ever taught.',
  },
  {
    target: 'faculty-courses-table',
    title: 'Full Teaching History',
    body: 'Every course this instructor has taught with evaluation data. Click any row to jump directly to that course\'s detail page — useful for seeing how a professor performs across different subjects.',
  },
]

function MetricBar({ label, value, higherBetter = true, neutral = false, metricMode = 'score' }) {
  if (value == null) return null
  const rounded = Math.round(value)
  let color
  if (neutral) color = 'var(--blue)'
  else if (higherBetter) color = rounded >= 75 ? 'var(--success)' : rounded >= 50 ? 'var(--gold)' : 'var(--danger)'
  else color = rounded <= 25 ? 'var(--success)' : rounded <= 50 ? 'var(--gold)' : 'var(--danger)'

  return (
    <div className="mb-2">
      <div className="mb-0.5 flex justify-between text-xs">
        <span className="text-muted">{label}</span>
        <span className="font-medium text-label">{fmtShort(value, metricMode)}</span>
      </div>
      <div className="h-1 w-full rounded-full" style={{ background: 'var(--track-bg)', position: 'relative' }}>
        <div className="h-1 rounded-full" style={{ width: `${rounded}%`, background: color }} />
        {/* Average reference tick at 50% */}
        <div style={{ position: 'absolute', top: -2, left: '50%', width: 1, height: 7, background: 'var(--line-strong)', transform: 'translateX(-50%)' }} title="50th pct = average" />
      </div>
    </div>
  )
}

const SORT_OPTIONS = [
  { value: 'name_asc', label: 'Name A-Z' },
  { value: 'rating_desc', label: 'Instructor Rating desc' },
  { value: 'course_rating_desc', label: 'Course Rating desc' },
  { value: 'courses_desc', label: 'Most Courses' },
  { value: 'respondents_desc', label: 'Most Respondents' },
]

function activeFilterCount({ concentration, minRating, minCourses, taughtSinceYear }) {
  return (concentration !== 'All' ? 1 : 0) + (minRating !== 'any' ? 1 : 0) + (minCourses !== 'any' ? 1 : 0) + (taughtSinceYear !== 'any' ? 1 : 0)
}

function FacultySidebar({
  meta, displayedProfs, allProfessors, selectedProf, query, setQuery, concentration, setConcentration,
  minRating, setMinRating, minCourses, setMinCourses, taughtSinceYear, setTaughtSinceYear, sortBy, setSortBy, resetFilters, handleSelectProf,
  metricMode = 'score', setMetricMode = null, mobile = false, onClose = null, onReplayTour = null, searchInputRef = null,
}) {
  const filters = activeFilterCount({ concentration, minRating, minCourses, taughtSinceYear })

  return (
    <aside data-tour="faculty-list" className="flex h-full flex-col overflow-hidden shrink-0" style={{ width: mobile ? '100%' : 292, background: 'linear-gradient(180deg, var(--panel-strong), var(--panel-soft))', borderRight: '1px solid var(--line)' }}>
      <div className="shrink-0 border-b px-4 pb-3 pt-4" style={{ borderColor: 'var(--line)' }}>
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <p className="kicker">Faculty Explorer</p>
            {filters > 0 && <span className="filter-badge">{filters} active</span>}
          </div>
          <div className="flex items-center gap-2">
            {filters > 0 && <button onClick={resetFilters} className="text-[10px] text-muted hover:text-label">Reset</button>}
            {mobile && onClose && <button onClick={onClose} className="rounded-full border px-2 py-1 text-[11px] text-muted hover:text-label" style={{ borderColor: 'var(--line)' }}>Close</button>}
          </div>
        </div>

        <div className="mb-3">
          <div className="mb-1.5 flex items-center justify-between">
            <p className="text-[10px] uppercase tracking-wider text-muted">Search</p>
            {!mobile && <span className="hidden rounded border px-1.5 py-0.5 text-[10px] font-mono text-muted md:inline" style={{ borderColor: 'var(--line)', background: 'var(--panel-strong)' }}>/</span>}
          </div>
          <input ref={searchInputRef} data-tour="faculty-search" type="text" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by name..." className="w-full touch-manipulation" style={{ fontSize: 16, minHeight: 44 }} />
        </div>

        <div className="grid gap-2">
          <div><p className="mb-1 text-[10px] uppercase tracking-wider text-muted">Sort</p><div className="select-wrap"><select value={sortBy} onChange={(event) => setSortBy(event.target.value)} style={{ fontSize: 11, padding: '3px 24px 3px 6px' }}>{SORT_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></div></div>
          <div><p className="mb-1 text-[10px] uppercase tracking-wider text-muted">Concentration</p><div className="select-wrap"><select value={concentration} onChange={(event) => setConcentration(event.target.value)} style={{ fontSize: 11, padding: '3px 24px 3px 6px' }}><option value="All">All</option>{meta.concentrations.map((item) => <option key={item} value={item}>{item}</option>)}</select></div></div>
          <div><p className="mb-1 text-[10px] uppercase tracking-wider text-muted">Min Instructor Rating</p><div className="select-wrap"><select value={minRating} onChange={(event) => setMinRating(event.target.value)} style={{ fontSize: 11, padding: '3px 24px 3px 6px' }}><option value="any">Any</option><option value="90">Top 10%</option><option value="75">Top 25%</option><option value="50">Top 50%</option></select></div></div>
          <div><p className="mb-1 text-[10px] uppercase tracking-wider text-muted">Min Courses Taught</p><div className="select-wrap"><select value={minCourses} onChange={(event) => setMinCourses(event.target.value)} style={{ fontSize: 11, padding: '3px 24px 3px 6px' }}><option value="any">Any</option><option value="3">3+</option><option value="5">5+</option><option value="10">10+</option><option value="20">20+</option></select></div></div>
          <div data-tour="faculty-active-since"><p className="mb-1 text-[10px] uppercase tracking-wider text-muted">Active Since (exclude older)</p><div className="select-wrap"><select value={taughtSinceYear} onChange={(e) => setTaughtSinceYear(e.target.value)} style={{ fontSize: 11, padding: '3px 24px 3px 6px' }}><option value="any">Any Year</option>{[...meta.years].reverse().slice(0, 12).map((year) => <option key={year} value={year}>Since {year}</option>)}</select></div></div>
        </div>

        {setMetricMode && (
          <div className="mt-3">
            <p className="mb-1.5 text-[10px] uppercase tracking-wider text-muted">Metric Display</p>
            <div className="flex gap-1 rounded-full border p-0.5" style={{ borderColor: 'var(--line)', background: 'var(--panel-subtle)' }}>
              <button
                onClick={() => setMetricMode('score')}
                className="flex-1 rounded-full py-1.5 text-[11px] font-medium transition-colors"
                style={{ background: metricMode === 'score' ? 'var(--accent)' : 'transparent', color: metricMode === 'score' ? '#fff' : 'var(--text-muted)' }}
              >
                Score
              </button>
              <button
                onClick={() => setMetricMode('percentile')}
                className="flex-1 rounded-full py-1.5 text-[11px] font-medium transition-colors"
                style={{ background: metricMode === 'percentile' ? 'var(--blue)' : 'transparent', color: metricMode === 'percentile' ? '#fff' : 'var(--text-muted)' }}
              >
                Percentile
              </button>
            </div>
            <p className="mt-1.5 text-[11px] leading-snug" style={{ color: 'var(--text-muted)' }}>
              {metricMode === 'score' ? 'Absolute quality: avg rating ÷ 5 × 100. E.g. 4.2/5 → 84%.' : 'Relative rank: 80 pct = better than 80% of all courses.'}
            </p>
          </div>
        )}

        <p className="mt-3 text-[10px] text-muted">{displayedProfs.length} of {allProfessors.length} instructors</p>
      </div>

      <div className="flex-1 overflow-y-auto">
        {displayedProfs.map((prof) => {
          const avg = prof.avgMetrics?.Instructor_Rating
          const selected = selectedProf === prof.professor
          return (
            <button
              key={prof.professor}
              onClick={() => { handleSelectProf(prof); if (mobile && onClose) onClose() }}
              className="w-full border-b px-4 py-4 text-left transition-colors"
              style={{ background: selected ? 'var(--panel-subtle)' : undefined, borderColor: 'var(--line)', borderLeft: selected ? '3px solid var(--accent)' : '3px solid transparent' }}
            >
              <p className="text-xs font-medium leading-tight text-label">{prof.professor_display}</p>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <span className="text-[10px] text-muted">{prof.evalCourses} course{prof.evalCourses !== 1 ? 's' : ''}</span>
                {avg != null && <span className="rounded px-1 py-0.5 text-[10px] font-medium" style={{ background: avg >= 75 ? 'var(--success-soft)' : avg >= 50 ? 'var(--gold-soft)' : 'var(--danger-soft)', color: avg >= 75 ? 'var(--success)' : avg >= 50 ? 'var(--gold)' : 'var(--danger)' }}>{fmtShort(avg, metricMode)} instr.</span>}
              </div>
            </button>
          )
        })}
        {displayedProfs.length === 0 && <p className="px-4 py-6 text-center text-xs text-muted">No instructors match the current filters.</p>}
      </div>
      {onReplayTour && (
        <div className="shrink-0 border-t px-4 py-3" style={{ borderColor: 'var(--line)' }}>
          <button
            type="button"
            onClick={onReplayTour}
            className="block text-xs transition-colors hover:text-label"
            style={{ color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
          >
            ↺ Replay tour
          </button>
        </div>
      )}
    </aside>
  )
}

export default function Faculty({ courses, meta, metricMode = 'score', setMetricMode = null }) {
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [selectedProf, setSelectedProf] = useState(searchParams.get('prof') || null)
  const [concentration, setConcentration] = useState('All')
  const [minRating, setMinRating] = useState('any')
  const [minCourses, setMinCourses] = useState('any')
  const [taughtSinceYear, setTaughtSinceYear] = useState('any')
  const [sortBy, setSortBy] = useState('name_asc')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const drawerTouchStartRef = useRef(null)

  useEffect(() => { const professor = searchParams.get('prof'); if (professor) setSelectedProf(professor) }, [searchParams])
  useEffect(() => { document.title = config.schoolCode + ' Faculty Explorer' }, [])

  // "/" shortcut to focus faculty search
  const facultySearchRef = useRef(null)
  useEffect(() => {
    const handler = (event) => {
      if (event.key !== '/') return
      const tag = document.activeElement?.tagName?.toLowerCase()
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return
      event.preventDefault()
      facultySearchRef.current?.focus()
      facultySearchRef.current?.select()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [])

  // Stage 1: build registry from raw course data — independent of metricMode.
  // Stores weighted sums for BOTH score and percentile so toggling metricMode
  // doesn't need to rebuild from scratch (O(n) over 5k+ courses).
  const professorRegistry = useMemo(() => {
    const registry = new Map()
    for (const course of courses) {
      if (!course.professor || course.is_average) continue
      if (!registry.has(course.professor)) {
        registry.set(course.professor, {
          professor: course.professor,
          professor_display: course.professor_display || course.professor,
          faculty_title: course.faculty_title,
          faculty_category: course.faculty_category,
          courses: [],
          evalCourses: 0,
          totalRespondents: 0,
          concentrationSet: new Set(),
          // Store sums for both modes so we only build once
          sumScore: {},  cntScore: {},
          sumPct: {},    cntPct: {},
          sumRawInstructor: 0,
          cntRawInstructor: 0,
        })
      }
      const entry = registry.get(course.professor)
      entry.courses.push(course)
      if (course.concentration) entry.concentrationSet.add(course.concentration)
      if (course.has_eval && !course.is_average) {
        entry.evalCourses += 1
        entry.totalRespondents += course.n_respondents || 0
        const weight = course.n_respondents || 1
        for (const metric of meta.metrics) {
          const scoreVal = course.metrics_score?.[metric.key]
          const pctVal = course.metrics_pct?.[metric.key]
          if (scoreVal != null) {
            entry.sumScore[metric.key] = (entry.sumScore[metric.key] || 0) + scoreVal * weight
            entry.cntScore[metric.key] = (entry.cntScore[metric.key] || 0) + weight
          }
          if (pctVal != null) {
            entry.sumPct[metric.key] = (entry.sumPct[metric.key] || 0) + pctVal * weight
            entry.cntPct[metric.key] = (entry.cntPct[metric.key] || 0) + weight
          }
        }
        if (course.metrics_raw?.Instructor_Rating != null) {
          entry.sumRawInstructor += course.metrics_raw.Instructor_Rating
          entry.cntRawInstructor += 1
        }
      }
    }
    return [...registry.values()].filter((prof) => prof.evalCourses > 0).map((prof) => ({
      ...prof,
      concentrations: [...prof.concentrationSet].sort(),
      avgRawInstructor: prof.cntRawInstructor > 0 ? Math.round(prof.sumRawInstructor / prof.cntRawInstructor * 100) / 100 : null,
      lastTaughtYear: Math.max(...prof.courses.map((c) => c.year || 0).filter((y) => y > 0), 0) || null,
    }))
  }, [courses, meta.metrics])

  // Stage 2: apply metricMode to compute avgMetrics — cheap, avoids full registry rebuild.
  const allProfessors = useMemo(() => {
    return professorRegistry.map((prof) => {
      const sumMap = metricMode === 'score' ? prof.sumScore : prof.sumPct
      const cntMap = metricMode === 'score' ? prof.cntScore : prof.cntPct
      return {
        ...prof,
        avgMetrics: Object.fromEntries(
          meta.metrics.map((metric) => [
            metric.key,
            cntMap[metric.key] ? Math.round((sumMap[metric.key] / cntMap[metric.key]) * 10) / 10 : null,
          ])
        ),
      }
    })
  }, [professorRegistry, meta.metrics, metricMode])

  const displayedProfs = useMemo(() => {
    const minRatingValue = minRating !== 'any' ? parseFloat(minRating) : null
    const minCoursesValue = minCourses !== 'any' ? parseInt(minCourses, 10) : null
    const taughtSinceValue = taughtSinceYear !== 'any' ? parseInt(taughtSinceYear, 10) : null
    const list = allProfessors.filter((prof) => {
      if (query) {
        const normalized = query.toLowerCase()
        if (!(prof.professor_display || '').toLowerCase().includes(normalized) && !(prof.professor || '').toLowerCase().includes(normalized)) return false
      }
      if (concentration !== 'All' && !prof.concentrations.includes(concentration)) return false
      if (minRatingValue !== null && (prof.avgMetrics?.Instructor_Rating ?? -1) < minRatingValue) return false
      if (minCoursesValue !== null && prof.evalCourses < minCoursesValue) return false
      if (taughtSinceValue !== null && (prof.lastTaughtYear ?? 0) < taughtSinceValue) return false
      return true
    })
    switch (sortBy) {
      case 'rating_desc': list.sort((a, b) => (b.avgMetrics?.Instructor_Rating ?? -1) - (a.avgMetrics?.Instructor_Rating ?? -1)); break
      case 'course_rating_desc': list.sort((a, b) => (b.avgMetrics?.Course_Rating ?? -1) - (a.avgMetrics?.Course_Rating ?? -1)); break
      case 'courses_desc': list.sort((a, b) => b.evalCourses - a.evalCourses); break
      case 'respondents_desc': list.sort((a, b) => b.totalRespondents - a.totalRespondents); break
      default: list.sort((a, b) => (a.professor_display || '').localeCompare(b.professor_display || ''))
    }
    return list
  }, [allProfessors, concentration, minCourses, minRating, query, sortBy, taughtSinceYear])

  const selectedData = useMemo(() => selectedProf ? allProfessors.find((prof) => prof.professor === selectedProf) || null : null, [allProfessors, selectedProf])
  const profCourses = useMemo(() => selectedData ? selectedData.courses.filter((course) => course.has_eval && !course.is_average).sort((a, b) => (b.year || 0) - (a.year || 0) || (a.term || '').localeCompare(b.term || '')) : [], [selectedData])

  const resetFilters = () => { setConcentration('All'); setMinRating('any'); setMinCourses('any'); setTaughtSinceYear('any'); setSortBy('name_asc'); setQuery('') }
  const handleSelectProf = (prof) => { setSelectedProf(prof.professor); setSearchParams({ prof: prof.professor }) }

  const [replayTour, setReplayTour] = useState(false)
  const handleReplayTour = () => {
    localStorage.removeItem('hks-tour-faculty')
    localStorage.removeItem('hks-tour-faculty-detail')
    setReplayTour(true)
  }

  const handleTourStepChange = (stepIndex) => {
    // Steps 0 and 1 target 'faculty-search' and 'faculty-active-since' — both in the sidebar drawer
    if (stepIndex === 0 || stepIndex === 1) setSidebarOpen(true)
    else setSidebarOpen(false)
  }

  const handleDrawerTouchStart = (event) => {
    const touch = event.touches[0]
    if (!touch) return
    drawerTouchStartRef.current = { x: touch.clientX, y: touch.clientY }
  }

  const handleDrawerTouchEnd = (event) => {
    const start = drawerTouchStartRef.current
    const touch = event.changedTouches[0]
    drawerTouchStartRef.current = null
    if (!start || !touch) return

    const deltaX = touch.clientX - start.x
    const deltaY = touch.clientY - start.y

    if (deltaX < -60 || deltaY > 80) {
      setSidebarOpen(false)
    }
  }

  return (
    <div className="flex h-full min-h-0 overflow-hidden">
      <OnboardingTour steps={FACULTY_TOUR_STEPS} storageKey="hks-tour-faculty" autoStart={replayTour} onDone={() => { setReplayTour(false); setSidebarOpen(false) }} onStepChange={handleTourStepChange} />
      {selectedData && <OnboardingTour steps={FACULTY_DETAIL_TOUR_STEPS} storageKey="hks-tour-faculty-detail" />}
      <div
        className={`mobile-drawer-backdrop md:hidden ${sidebarOpen ? 'open' : ''}`}
        onClick={() => setSidebarOpen(false)}
        aria-hidden={!sidebarOpen}
      />
      <div
        className={`mobile-drawer md:hidden ${sidebarOpen ? 'open' : ''}`}
        onTouchStart={handleDrawerTouchStart}
        onTouchEnd={handleDrawerTouchEnd}
      >
        <FacultySidebar
          meta={meta}
          displayedProfs={displayedProfs}
          allProfessors={allProfessors}
          selectedProf={selectedProf}
          query={query}
          setQuery={setQuery}
          concentration={concentration}
          setConcentration={setConcentration}
          minRating={minRating}
          setMinRating={setMinRating}
          minCourses={minCourses}
          setMinCourses={setMinCourses}
          taughtSinceYear={taughtSinceYear}
          setTaughtSinceYear={setTaughtSinceYear}
          sortBy={sortBy}
          setSortBy={setSortBy}
          resetFilters={resetFilters}
          handleSelectProf={handleSelectProf}
          metricMode={metricMode}
          setMetricMode={setMetricMode}
          mobile
          onClose={() => setSidebarOpen(false)}
          onReplayTour={handleReplayTour}
        />
      </div>
      <div className="hidden md:block">
        <FacultySidebar
          meta={meta}
          displayedProfs={displayedProfs}
          allProfessors={allProfessors}
          selectedProf={selectedProf}
          query={query}
          setQuery={setQuery}
          concentration={concentration}
          setConcentration={setConcentration}
          minRating={minRating}
          setMinRating={setMinRating}
          minCourses={minCourses}
          setMinCourses={setMinCourses}
          taughtSinceYear={taughtSinceYear}
          setTaughtSinceYear={setTaughtSinceYear}
          sortBy={sortBy}
          setSortBy={setSortBy}
          resetFilters={resetFilters}
          handleSelectProf={handleSelectProf}
          metricMode={metricMode}
          setMetricMode={setMetricMode}
          onReplayTour={handleReplayTour}
          searchInputRef={facultySearchRef}
        />
      </div>

      <main data-tour="faculty-detail" className="flex min-w-0 flex-1 flex-col overflow-y-auto px-4 py-4 md:px-8 md:py-6">
        <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
          <div><p className="kicker mb-2">Teaching lens</p><h2 className="serif-display text-3xl font-semibold md:text-[2.4rem]" style={{ color: 'var(--text)' }}>Faculty Explorer</h2><p className="mt-2 text-xs text-muted md:text-sm">Browse teaching history and weighted rating averages for {config.schoolCode} instructors.</p></div>
          <button onClick={() => setSidebarOpen(true)} className="rounded-full border px-3 py-2 text-xs font-medium text-label md:hidden" style={{ borderColor: 'var(--line)', background: 'var(--panel-subtle)', minHeight: 44 }}>Browse Faculty{activeFilterCount({ concentration, minRating, minCourses, taughtSinceYear }) > 0 ? ` (${activeFilterCount({ concentration, minRating, minCourses, taughtSinceYear })})` : ''}</button>
        </div>

        {!selectedData && (
          <div className="flex flex-1 flex-col items-center justify-center px-6 text-center" style={{ color: 'var(--text-muted)' }}>
            <p className="text-3xl" aria-hidden="true">👤</p>
            <h3 className="mt-4 text-lg font-semibold" style={{ color: 'var(--text)' }}>Select an instructor</h3>
            <p className="mt-2 max-w-md text-sm">
              Choose any instructor from the list to see teaching history evaluation trends and course-level ratings.
            </p>
          </div>
        )}

        {selectedData && <>
          <button
            onClick={() => { setSelectedProf(null); setSearchParams({}) }}
            className="mb-4 flex items-center gap-1.5 text-xs text-muted transition-colors hover:text-label"
            style={{ minHeight: 44, padding: '8px 0' }}
          >
            <span>←</span> <span>Back to faculty list</span>
          </button>
          <div className="mb-6">
            <h2 className="serif-display mb-1 text-3xl font-semibold md:text-[2.25rem]" style={{ color: 'var(--text)' }}>{selectedData.professor_display}</h2>
            {selectedData.faculty_title && <p className="text-sm text-muted">{selectedData.faculty_title}</p>}
            {selectedData.faculty_category && <p className="text-xs text-muted">{selectedData.faculty_category}</p>}
            {selectedData.concentrations.length > 0 && <div className="mt-3 flex flex-wrap gap-2">{selectedData.concentrations.map((item) => <span key={item} className="rounded-full px-2.5 py-1 text-[10px] font-medium" style={{ background: 'var(--blue-soft)', color: 'var(--blue)' }}>{item}</span>)}</div>}
            <div className="mt-3 flex flex-wrap gap-4 text-xs text-muted"><span>{selectedData.evalCourses} course{selectedData.evalCourses !== 1 ? 's' : ''} with evals</span>{selectedData.totalRespondents > 0 && <span>{selectedData.totalRespondents} total respondents</span>}</div>
          </div>

          <div className="mb-6 grid gap-4 lg:grid-cols-2">
            <div data-tour="faculty-ratings" className="surface-card rounded-[22px] p-4">
              <h4 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted">Average Ratings</h4>
              {meta.metrics.filter((metric) => !metric.bid_metric).map((metric) => <MetricBar key={metric.key} label={metric.label} value={selectedData.avgMetrics?.[metric.key]} higherBetter={metric.higher_is_better} neutral={metric.key === 'Workload' || metric.key === 'Rigor'} metricMode={metricMode} />)}
            </div>
            <div data-tour="faculty-quick-stats" className="surface-card rounded-[22px] p-4">
              <h4 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted">Quick Stats</h4>
              {selectedData.avgMetrics?.Instructor_Rating != null && (
                <div className="mb-3 rounded-2xl p-3" style={{ background: 'var(--panel-subtle)' }}>
                  <p className="text-[10px] uppercase tracking-wider text-muted">Instructor Rating</p>
                  <p className="text-xl font-bold" style={{ color: 'var(--accent-strong)' }}>{fmtShort(selectedData.avgMetrics.Instructor_Rating, metricMode)}</p>
                  <p className="text-[10px] text-muted">{modeSubLabel(metricMode)}</p>
                  {selectedData.avgRawInstructor != null && (
                    <p className="mt-1 text-[10px]" style={{ color: 'var(--text-muted)', opacity: 0.72 }}>
                      avg {selectedData.avgRawInstructor.toFixed(2)}/5
                      {meta.overall_median_instructor != null && (
                        <span className="ml-1.5">· all-courses med {meta.overall_median_instructor.toFixed(2)}</span>
                      )}
                    </p>
                  )}
                </div>
              )}
              <div className="grid grid-cols-2 gap-2">{[{ key: 'Course_Rating', label: 'Course Rating', color: 'var(--success)' }, { key: 'Workload', label: 'Workload', color: 'var(--text-soft)' }, { key: 'Rigor', label: 'Rigor', color: 'var(--text-soft)' }, { key: 'Diverse Perspectives', label: 'Diverse Persp.', color: 'var(--text-soft)' }, { key: 'Feedback', label: 'Feedback', color: 'var(--text-soft)' }].map(({ key, label, color }) => selectedData.avgMetrics?.[key] != null && <div key={key} className="rounded-2xl p-2" style={{ background: 'var(--panel-subtle)' }}><p className="text-[10px] text-muted">{label}</p><p className="text-sm font-bold" style={{ color }}>{fmtShort(selectedData.avgMetrics[key], metricMode)}</p></div>)}</div>
            </div>
          </div>

          <div data-tour="faculty-courses-table" className="surface-card rounded-[22px]">
            <div className="border-b px-4 py-3" style={{ borderColor: 'var(--line)' }}><h4 className="text-xs font-semibold uppercase tracking-wider text-muted">All Courses Taught ({profCourses.length})</h4></div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead><tr style={{ borderBottom: '1px solid var(--line-strong)' }}>{['Year', 'Term', 'Course', `Instructor (${modeUnit(metricMode)})`, `Course (${modeUnit(metricMode)})`, `Workload (${modeUnit(metricMode)})`, `Rigor (${modeUnit(metricMode)})`, 'Diverse Persp.', 'N'].map((h) => <th key={h} scope="col" className="whitespace-nowrap px-3 py-2 text-left font-medium text-muted">{h}</th>)}</tr></thead>
                <tbody>{profCourses.map((course) => {
                  const src = metricMode === 'score' ? course.metrics_score : course.metrics_pct
                  const instrVal = src?.Instructor_Rating
                  const instrColor = instrVal == null ? 'var(--text-muted)' : instrVal >= 75 ? 'var(--success)' : instrVal >= 50 ? 'var(--gold)' : 'var(--danger)'
                  return <tr key={`${course.year}-${course.term}-${course.course_code}`} className="cursor-pointer transition-colors" style={{ borderBottom: '1px solid var(--line)', cursor: 'pointer' }} onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--panel-subtle)' }} onMouseLeave={(e) => { e.currentTarget.style.background = '' }} onClick={() => navigate(`/courses?id=${encodeURIComponent(course.id)}`)}><td className="px-3 py-2 text-label">{course.year}</td><td className="px-3 py-2 text-muted">{course.term}</td><td className="px-3 py-2"><span className="font-medium" style={{ color: 'var(--accent-strong)' }}>{course.course_code}</span><span className="ml-2 text-label">{course.course_name}</span></td><td className="px-3 py-2 font-medium" style={{ color: instrColor }}>{fmtShort(instrVal, metricMode)}</td><td className="px-3 py-2 text-label">{fmtShort(src?.Course_Rating, metricMode)}</td><td className="px-3 py-2 text-label">{fmtShort(src?.Workload, metricMode)}</td><td className="px-3 py-2 text-label">{fmtShort(src?.Rigor, metricMode)}</td><td className="px-3 py-2 text-label">{fmtShort(src?.['Diverse Perspectives'], metricMode)}</td><td className="px-3 py-2 text-muted">{course.n_respondents ?? '-'}</td></tr>
                })}</tbody>
              </table>
              {meta.overall_median_instructor != null && (
                <p className="border-t px-4 py-2 text-[10px] text-muted" style={{ borderColor: 'var(--line)' }}>
                  Overall median instructor rating: <span className="font-medium text-label">{meta.overall_median_instructor.toFixed(2)}/5</span> across all courses and years
                </p>
              )}
            </div>
          </div>

          <div className="app-footer mt-8">{config.appTitle} by <a href={config.creatorUrl} target="_blank" rel="noopener noreferrer" style={{ color: 'inherit' }}>Michael Gritzbach<span aria-hidden="true" style={{ fontSize: 9, marginLeft: 2, opacity: 0.7 }}>↗</span></a> {config.creatorDegrees} · {new Date().getFullYear()}</div>
        </>}
      </main>
    </div>
  )
}
