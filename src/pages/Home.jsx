import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import CourseCard from '../components/CourseCard.jsx'
import OnboardingTour from '../components/OnboardingTour.jsx'
import ScatterPlot from '../components/ScatterPlot.jsx'
import Sidebar from '../components/Sidebar.jsx'

const HOME_TOUR_STEPS = [
  {
    target: 'year-filter',
    title: 'Start with the Year',
    body: 'Pick the academic year you\'re planning for. 2025 has the most complete evaluations; 2026 shows the active bidding season.',
  },
  {
    target: 'scatter-plot',
    title: 'Visual Course Explorer',
    body: 'Every dot is a course. Change the X and Y axes to compare any two metrics — workload vs. rating, rigor vs. instructor quality, and more.',
  },
  {
    target: 'preset-pills',
    title: 'Quick Filters',
    body: 'One-click presets for Top Rated, STEM A/B, Bidding 2026, or your personal shortlist.',
  },
  {
    target: 'course-list',
    title: 'Course Cards',
    body: 'Click any card to expand full evaluations, score history, and add to your shortlist. Star it to track across sessions.',
  },
]

const DEFAULT_X = 'Workload'
const DEFAULT_Y = 'Course_Rating'
const ALL_TERMS = ['Fall', 'Spring', 'January']

function isAverageYear(year) {
  return year === 0
}

function useDebounce(value, delay) {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(t)
  }, [value, delay])
  return debounced
}

// yearPreFiltered=true skips the year/avg check when the caller already pre-filtered by year
function applyFilters(courses, filters, yearPreFiltered = false) {
  const {
    searchText,
    concentration,
    coreFilter,
    terms,
    stemGroup,
    year,
    minInstructorPct,
    evalOnly,
  } = filters

  const avgMode = isAverageYear(year)
  const searchTerms = searchText
    ? searchText.split(',').map((term) => term.trim().toLowerCase()).filter(Boolean)
    : []
  const minPct = minInstructorPct !== 'any' ? parseFloat(minInstructorPct) : null

  return courses.filter((course) => {
    if (!yearPreFiltered) {
      if (avgMode) {
        if (!course.is_average) return false
      } else {
        if (course.year !== year) return false
        if (course.is_average) return false
      }
    }
    // Always enforce term filter for non-avg mode (year pool includes all terms)
    if (!avgMode && !terms.includes(course.term)) return false

    if (concentration !== 'All' && course.concentration !== concentration) return false
    if (coreFilter === 'core' && !course.is_core) return false
    if (coreFilter === 'no-core' && course.is_core) return false
    if (stemGroup === 'stem' && !course.is_stem) return false
    if (stemGroup === 'A' && course.stem_group !== 'A') return false
    if (stemGroup === 'B' && course.stem_group !== 'B') return false

    if (minPct !== null) {
      const instructorPct = course.metrics_pct?.Instructor_Rating
      if (instructorPct != null && instructorPct < minPct) return false
    }

    if (evalOnly && !course.has_eval) return false

    if (searchTerms.length > 0) {
      const haystack = [
        course.course_name,
        course.course_code,
        course.professor_display,
        course.professor,
        course.description,
        course.concentration,
      ].join(' ').toLowerCase()

      if (!searchTerms.some((term) => haystack.includes(term))) return false
    }

    return true
  })
}

function pageTitle(filters) {
  if (isAverageYear(filters.year)) return 'HKS Course Search - All Years Average'
  const termLabel = filters.terms.length === ALL_TERMS.length ? 'All Terms' : filters.terms.join(' + ')
  return `HKS Course Search - ${termLabel} ${filters.year}`
}

function countFilterBadges(filters) {
  let count = 0
  if (filters.searchText.trim()) count++
  if (filters.concentration !== 'All') count++
  if (filters.coreFilter !== 'all') count++
  if (filters.stemGroup !== 'all') count++
  if (filters.minInstructorPct !== 'any') count++
  if (filters.evalOnly) count++
  if (!isAverageYear(filters.year)) {
    if (filters.terms.length !== ALL_TERMS.length || !ALL_TERMS.every((term) => filters.terms.includes(term))) {
      count++
    }
  }
  return count
}

const PRESETS = [
  {
    key: 'top_rated',
    label: 'Top Rated',
    apply: (filters) => ({ ...filters, minInstructorPct: '75' }),
    isActive: (filters) => filters.minInstructorPct === '75',
  },
  {
    key: 'light_workload',
    label: 'Light Workload',
    apply: (filters) => ({ ...filters, evalOnly: true }),
    isActive: (filters) => filters.evalOnly,
    sortKey: 'workload_asc',
  },
  {
    key: 'stem_only',
    label: 'STEM A',
    apply: (filters) => ({ ...filters, stemGroup: 'A' }),
    isActive: (filters) => filters.stemGroup === 'A',
  },
  {
    key: 'stem_b',
    label: 'STEM B',
    apply: (filters) => ({ ...filters, stemGroup: 'B' }),
    isActive: (filters) => filters.stemGroup === 'B',
  },
  {
    key: 'bidding_2026',
    label: 'Bidding 2026',
    apply: (filters) => ({ ...filters, year: 2026, evalOnly: false }),
    isActive: (filters) => filters.year === 2026,
    sortKey: 'bid_price_desc',
  },
  {
    key: 'core_only',
    label: 'Core Courses',
    apply: (filters) => ({ ...filters, coreFilter: 'core' }),
    isActive: (filters) => filters.coreFilter === 'core',
  },
]

export default function Home({ courses, meta, favs, metricMode = 'score', setMetricMode, colorblindMode = false, setColorblindMode, notes, setNote }) {
  const [searchParams, setSearchParams] = useSearchParams()
  const mainRef = useRef(null)
  const visualizationRef = useRef(null)

  const initYear = (() => {
    const y = searchParams.get('year')
    if (!y) return meta.default_year
    const n = parseInt(y, 10)
    return Number.isNaN(n) ? meta.default_year : n
  })()
  const initTerms = (() => {
    const t = searchParams.get('terms')
    if (!t) return [...ALL_TERMS]
    const parts = t.split(',').filter((term) => ALL_TERMS.includes(term))
    return parts.length ? parts : [...ALL_TERMS]
  })()
  const initConc = searchParams.get('conc') || 'All'
  const initSort = searchParams.get('sort') || 'bid_price_desc'

  const [filters, setFilters] = useState({
    searchText: '',
    concentration: initConc,
    coreFilter: searchParams.get('core') || 'all',
    terms: initTerms,
    stemGroup: searchParams.get('stem') || 'all',
    year: initYear,
    minInstructorPct: searchParams.get('min_pct') || 'any',
    evalOnly: searchParams.get('eval') === '1',
  })
  const [xMetric, setXMetric] = useState(searchParams.get('x') || DEFAULT_X)
  const [yMetric, setYMetric] = useState(searchParams.get('y') || DEFAULT_Y)
  const [sortBy, setSortBy] = useState(initSort)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [showShortlistOnly, setShowShortlistOnly] = useState(false)
  const [replayTour, setReplayTour] = useState(false)

  const handleReplayTour = () => {
    localStorage.removeItem('hks-tour-home')
    setReplayTour(true)
  }

  const handleTourStepChange = (stepIndex) => {
    // Step 0 targets 'year-filter' which lives in the sidebar drawer
    if (stepIndex === 0) setSidebarOpen(true)
    else setSidebarOpen(false)
  }

  const [activeTab, setActiveTab] = useState('comparisons')

  const scrollToVisualization = () => {
    if (!mainRef.current || !visualizationRef.current) return

    const offsetTop = Math.max(0, visualizationRef.current.offsetTop - 12)
    mainRef.current.scrollTo({ top: offsetTop, behavior: 'smooth' })
  }

  useEffect(() => {
    const params = {}
    if (filters.year !== meta.default_year) params.year = filters.year
    if (filters.terms.length !== ALL_TERMS.length) params.terms = filters.terms.join(',')
    if (filters.concentration !== 'All') params.conc = filters.concentration
    if (filters.coreFilter !== 'all') params.core = filters.coreFilter
    if (filters.stemGroup !== 'all') params.stem = filters.stemGroup
    if (filters.minInstructorPct !== 'any') params.min_pct = filters.minInstructorPct
    if (filters.evalOnly) params.eval = '1'
    if (sortBy !== 'bid_price_desc') params.sort = sortBy
    if (xMetric !== DEFAULT_X) params.x = xMetric
    if (yMetric !== DEFAULT_Y) params.y = yMetric
    setSearchParams(params, { replace: true })
  }, [filters.year, filters.terms, filters.concentration, filters.coreFilter, filters.stemGroup, filters.minInstructorPct, filters.evalOnly, sortBy, xMetric, yMetric, meta.default_year, setSearchParams])

  // Debounce text search — only triggers a re-filter after user pauses typing (150ms)
  const debouncedSearch = useDebounce(filters.searchText, 150)
  // Merge debounced search back into filters before deferring
  const filtersWithDebouncedSearch = useMemo(
    () => ({ ...filters, searchText: debouncedSearch }),
    [filters, debouncedSearch]
  )

  // Defer heavy filter computation so the UI stays responsive while the chart/list re-render
  const deferredFilters = useDeferredValue(filtersWithDebouncedSearch)
  const isStale = filtersWithDebouncedSearch !== deferredFilters

  const avgMode = isAverageYear(filters.year)
  const bidYear = filters.year === 2026
  const activeFilterCount = countFilterBadges(filters)

  // Derive "last updated" label dynamically from the data
  const lastUpdatedLabel = useMemo(() => {
    const evalYears = courses.filter((c) => c.has_eval && !c.is_average && c.year && c.term)
    if (!evalYears.length) return 'Spring 2025'
    const maxYear = Math.max(...evalYears.map((c) => c.year))
    const termsInMaxYear = [...new Set(evalYears.filter((c) => c.year === maxYear).map((c) => c.term))]
    const termOrder = { Spring: 2, Fall: 1, January: 0 }
    const latestTerm = termsInMaxYear.sort((a, b) => (termOrder[b] ?? -1) - (termOrder[a] ?? -1))[0]
    return latestTerm ? `${latestTerm} ${maxYear}` : `${maxYear}`
  }, [courses])

  useEffect(() => {
    document.title = pageTitle(filters)
  }, [filters])

  useEffect(() => {
    if (!sidebarOpen) return undefined

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') setSidebarOpen(false)
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [sidebarOpen])

  // Build a year→courses index once on load so filter passes touch ~300 items not 5500
  const coursesByYear = useMemo(() => {
    const map = new Map()
    for (const c of courses) {
      const key = c.is_average ? 0 : (c.year ?? -1)
      if (!map.has(key)) map.set(key, [])
      map.get(key).push(c)
    }
    return map
  }, [courses])

  const avgBidByBase = useMemo(() => {
    const grouped = new Map()
    for (const course of courses) {
      const bid = course.bid_clearing_price ?? course.last_bid_price
      if (!course.course_code_base || bid == null) continue
      if (!grouped.has(course.course_code_base)) grouped.set(course.course_code_base, [])
      grouped.get(course.course_code_base).push(bid)
    }

    const averages = new Map()
    for (const [base, bids] of grouped.entries()) {
      averages.set(base, Math.round((bids.reduce((sum, value) => sum + value, 0) / bids.length) * 10) / 10)
    }
    return averages
  }, [courses])

  // All heavy computations use deferredFilters to avoid blocking the UI thread
  const dAvgMode = isAverageYear(deferredFilters.year)

  // Pre-filtered to just the current year — reduces filter work from 5500 → ~300 items
  const yearPool = useMemo(() => (
    coursesByYear.get(deferredFilters.year) ?? []
  ), [coursesByYear, deferredFilters.year])

  const yearEvalCourses = useMemo(() => (
    yearPool.filter((course) => course.has_eval)
  ), [yearPool])

  const biddingOnlyCourses = useMemo(() => {
    if (dAvgMode || deferredFilters.evalOnly) return []
    return yearPool.filter((course) =>
      !course.has_eval &&
      course.has_bidding &&
      deferredFilters.terms.includes(course.term)
    )
  }, [dAvgMode, yearPool, deferredFilters.evalOnly, deferredFilters.terms])

  const filtered = useMemo(() => (
    applyFilters(yearPool, deferredFilters, true).map((course) => ({
      ...course,
      avg_bid_price: avgBidByBase.get(course.course_code_base) ?? null,
    }))
  ), [avgBidByBase, yearPool, deferredFilters])
  const filteredEval = useMemo(() => filtered.filter((course) => course.has_eval), [filtered])

  const sorted = useMemo(() => {
    const result = [...filtered]
    const compareValues = (a, b, getPrimary, direction = 'desc') => {
      const av = getPrimary(a)
      const bv = getPrimary(b)
      const aBid = a.last_bid_price
      const bBid = b.last_bid_price

      if (av == null && bv == null) {
        if (aBid == null && bBid == null) return 0
        if (aBid == null) return 1
        if (bBid == null) return -1
        return bBid - aBid
      }

      if (av == null) return 1
      if (bv == null) return -1

      return direction === 'asc' ? av - bv : bv - av
    }

    switch (sortBy) {
      case 'instructor_desc':
        return result.sort((a, b) => compareValues(a, b, (course) => course.metrics_pct?.Instructor_Rating))
      case 'workload_asc':
        return result.sort((a, b) => compareValues(a, b, (course) => course.metrics_pct?.Workload, 'asc'))
      case 'course_rating_desc':
        return result.sort((a, b) => compareValues(a, b, (course) => course.metrics_pct?.Course_Rating))
      case 'rigor_desc':
        return result.sort((a, b) => compareValues(a, b, (course) => course.metrics_pct?.Rigor))
      case 'diverse_desc':
        return result.sort((a, b) => compareValues(a, b, (course) => course.metrics_pct?.['Diverse Perspectives']))
      case 'bid_price_desc':
        return result.sort((a, b) => {
          const av = a.last_bid_price
          const bv = b.last_bid_price
          if (av == null && bv == null) return 0
          if (av == null) return 1
          if (bv == null) return -1
          return bv - av
        })
      case 'name_asc':
        return result.sort((a, b) => (a.course_name || '').localeCompare(b.course_name || ''))
      default:
        return result
    }
  }, [filtered, sortBy])

  const visibleCourses = useMemo(() => (
    showShortlistOnly && favs
      ? sorted.filter((course) => favs.isFavorite(course.course_code_base))
      : sorted
  ), [favs, showShortlistOnly, sorted])

  const resultText = filters.searchText.trim()
    ? `Search complete. Scroll down to view ${filtered.length} result${filtered.length !== 1 ? 's' : ''}.`
    : null

  const handlePreset = (preset) => {
    if (preset.sortKey) setSortBy(preset.sortKey)
    if (preset.apply) setFilters((current) => preset.apply(current))
  }

  return (
    <div className="flex h-full min-h-0 overflow-hidden">
      <OnboardingTour steps={HOME_TOUR_STEPS} storageKey="hks-tour-home" autoStart={replayTour} onDone={() => { setReplayTour(false); setSidebarOpen(false) }} onStepChange={handleTourStepChange} />
      {sidebarOpen && <button className="mobile-drawer-overlay md:hidden" onClick={() => setSidebarOpen(false)} aria-label="Close filters" />}

      <div className={`mobile-drawer md:hidden ${sidebarOpen ? 'open' : ''}`}>
        <Sidebar
          filters={filters}
          setFilters={setFilters}
          metricMode={metricMode}
          setMetricMode={setMetricMode}
          colorblindMode={colorblindMode}
          setColorblindMode={setColorblindMode}
          meta={meta}
          title="Search Courses"
          mobile
          onClose={() => setSidebarOpen(false)}
          onReplayTour={handleReplayTour}
        />
      </div>

      <div className="hidden md:block">
        <Sidebar filters={filters} setFilters={setFilters} meta={meta} title="Search Courses" metricMode={metricMode} setMetricMode={setMetricMode} colorblindMode={colorblindMode} setColorblindMode={setColorblindMode} onReplayTour={handleReplayTour} />
      </div>

      <main ref={mainRef} className="flex min-w-0 flex-1 flex-col overflow-y-auto px-4 py-4 md:px-6 md:py-6">
        <section className="panel-shell mb-5 overflow-hidden">
          <div className="flex flex-wrap items-start justify-between gap-4 px-5 py-5 md:px-7 md:py-7">
            <div className="min-w-0 flex-1">
              <p className="kicker mb-2">Independent HKS student tool</p>
              <h1 className="serif-display text-3xl font-semibold md:text-[2.5rem]" style={{ color: 'var(--text)' }}>
                {pageTitle(filters)}
              </h1>
              <p className="mt-3 max-w-3xl text-sm md:text-[15px]" style={{ color: 'var(--text-soft)' }}>
                Cut through the HKS course selection chaos. Compare ratings, workload, and bidding history across every offering — so you can actually make an informed choice.
              </p>
            </div>

            <button
              type="button"
              onClick={() => setSidebarOpen(true)}
              className="md:hidden rounded-full border px-3 py-2 text-xs font-medium text-label shadow-sm"
              style={{ borderColor: 'var(--line)', background: 'var(--panel-subtle)', minHeight: 44 }}
            >
              Filters{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}
            </button>
          </div>

          <div className="flex flex-wrap gap-3 border-t px-5 py-4 md:px-7" style={{ borderColor: 'var(--line)', background: 'var(--panel-subtle)' }}>
            <div className="rounded-2xl border px-4 py-3 text-xs md:text-sm" style={{ borderColor: 'var(--line)', background: 'var(--panel-soft)' }}>
              <span style={{ color: 'var(--text-muted)' }}>View</span>
              <p className="mt-1 font-medium" style={{ color: 'var(--text)' }}>{avgMode ? 'All-years weighted averages' : bidYear ? 'Active bidding season' : 'Filtered current courses'}</p>
            </div>
            <div className="rounded-2xl border px-4 py-3 text-xs md:text-sm" style={{ borderColor: 'var(--line)', background: 'var(--panel-soft)' }}>
              <span style={{ color: 'var(--text-muted)' }}>Matching now</span>
              <p className="mt-1 font-medium" style={{ color: 'var(--text)' }}>{filtered.length} course{filtered.length !== 1 ? 's' : ''}</p>
            </div>
            <div className="rounded-2xl border px-4 py-3 text-xs md:text-sm" style={{ borderColor: 'var(--line)', background: 'var(--panel-soft)' }}>
              <span style={{ color: 'var(--text-muted)' }}>Built for</span>
              <p className="mt-1 font-medium" style={{ color: 'var(--text)' }}>Harvard Kennedy School students</p>
            </div>
            <div className="rounded-2xl border px-4 py-3 text-xs md:text-sm" style={{ borderColor: 'var(--line)', background: 'var(--panel-soft)' }}>
              <span style={{ color: 'var(--text-muted)' }}>Last updated</span>
              <p className="mt-1 font-medium" style={{ color: 'var(--text)' }}>{lastUpdatedLabel}</p>
            </div>
          </div>
        </section>

        {avgMode && (
          <div
            className="mb-4 rounded-2xl px-4 py-3 text-xs md:text-sm"
            style={{ background: 'var(--blue-soft)', border: '1px solid rgba(157, 194, 219, 0.18)', color: 'var(--blue)' }}
          >
            Showing weighted averages across all years for each course and instructor pairing. Courses with more years and respondents carry more weight.
          </div>
        )}

        {bidYear && (
          <div
            className="mb-4 rounded-2xl px-4 py-3 text-xs md:text-sm"
            style={{ background: 'var(--gold-soft)', border: '1px solid rgba(212, 168, 106, 0.18)', color: 'var(--gold)' }}
          >
            Bidding Season 2026 is active. Courses without evaluation data still appear, and amber diamonds are spread by competitiveness rank.
          </div>
        )}

        {resultText && (
          <div
            className="mb-4 rounded-2xl px-4 py-3 text-sm"
            style={{ background: 'rgba(123, 176, 138, 0.12)', border: '1px solid rgba(123, 176, 138, 0.2)', color: 'var(--success)' }}
          >
            {resultText}
          </div>
        )}

        <div ref={visualizationRef} className="mb-4">
          <p className="kicker mb-1">Visual explorer</p>
          <h2 className="serif-display text-2xl font-semibold" style={{ color: 'var(--text)' }}>Course Comparisons</h2>
        </div>

        {activeTab === 'comparisons' && (
          <div data-tour="scatter-plot" style={{ position: 'relative' }}>
          {isStale && <div style={{ position: 'absolute', top: 8, right: 52, zIndex: 10, fontSize: 10, color: 'var(--text-muted)', pointerEvents: 'none' }}>updating…</div>}
          <ScatterPlot
            allCourses={yearEvalCourses}
            matchedCourses={filteredEval}
            biddingOnlyCourses={biddingOnlyCourses}
            xMetric={xMetric}
            yMetric={yMetric}
            metrics={meta.metrics}
            onXChange={setXMetric}
            onYChange={setYMetric}
            metricMode={metricMode}
            colorblindMode={colorblindMode}
            isLight={document.documentElement.getAttribute('data-theme') === 'light'}
          />
          </div>
        )}

        <div className="mt-6">
          <div data-tour="preset-pills" className="preset-pills mb-3">
            {PRESETS.map((preset) => {
              const active = preset.isActive(filters) || sortBy === preset.sortKey
              return (
                <button
                  key={preset.key}
                  onClick={() => handlePreset(preset)}
                  aria-pressed={active}
                  className={`preset-pill touch-manipulation min-h-[44px] ${active ? 'active' : ''}`}
                >
                  {preset.label}
                </button>
              )
            })}
            {favs && favs.count > 0 && (
              <button
                onClick={() => setShowShortlistOnly((v) => !v)}
                className={`preset-pill touch-manipulation min-h-[44px] ${showShortlistOnly ? 'active' : ''}`}
                style={showShortlistOnly ? { borderColor: 'rgba(212, 168, 106, 0.38)', color: 'var(--gold)' } : {}}
              >
                ★ Shortlist ({favs.count})
              </button>
            )}
          </div>

          <div className="sort-bar mb-3 flex flex-col gap-3 rounded-[22px] px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-muted">
              <span className="font-medium text-label">{visibleCourses.length}</span> course{visibleCourses.length !== 1 ? 's' : ''}
              <span className="text-muted"> ({filteredEval.length} with evals)</span>
            </p>

            <div className="flex items-center gap-2">
              <span className="text-xs text-muted">Sort:</span>
              <div className="select-wrap w-full sm:w-[220px]">
                <select
                  value={sortBy}
                  onChange={(event) => setSortBy(event.target.value)}
                  style={{ padding: '4px 28px 4px 8px', fontSize: 12 }}
                >
                  <option value="bid_price_desc">Most Competitive</option>
                  <option value="instructor_desc">Top Instructor Rating</option>
                  <option value="course_rating_desc">Top Course Rating</option>
                  <option value="workload_asc">Lightest Workload</option>
                  <option value="rigor_desc">Most Rigorous</option>
                  <option value="diverse_desc">Most Diverse Perspectives</option>
                  <option value="name_asc">Course Name A-Z</option>
                </select>
              </div>
            </div>
          </div>

          <div data-tour="course-list">
          {visibleCourses.length === 0 ? (
            <div className="surface-card rounded-2xl py-12 text-center">
              <p className="mb-1 font-medium text-label">No courses match the current filters</p>
              <p className="text-xs text-muted">Try adjusting the year, terms, concentration, or removing some filters.</p>
            </div>
          ) : (
            visibleCourses.map((course) => (
              <CourseCard
                key={course.id}
                course={course}
                favs={favs}
                metricMode={metricMode}
                notes={notes}
                setNote={setNote}
                yearMedianInstructor={
                  course.is_average
                    ? meta.overall_median_instructor ?? null
                    : meta.year_medians_instructor?.[String(course.year)] ?? null
                }
              />
            ))
          )}
          </div>
        </div>

        <div className="app-footer mt-8">
          HKS Course Explorer by <a href="https://www.linkedin.com/in/michael-gritzbach/" target="_blank" rel="noopener noreferrer" style={{ color: 'inherit' }}>Michael Gritzbach</a> VUS&apos;18, MPA&apos;26 · {new Date().getFullYear()}
        </div>
      </main>
    </div>
  )
}
