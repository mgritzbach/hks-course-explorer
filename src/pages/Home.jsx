import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import CourseCard from '../components/CourseCard.jsx'
import CourseMap from '../components/CourseMap.jsx'
import ScatterPlot from '../components/ScatterPlot.jsx'
import Sidebar from '../components/Sidebar.jsx'

const DEFAULT_X = 'Instructor_Rating'
const DEFAULT_Y = 'Course_Rating'
const ALL_TERMS = ['Fall', 'Spring', 'January']

function isAverageYear(year) {
  return year === 0
}

function applyFilters(courses, filters) {
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
    if (avgMode) {
      if (!course.is_average) return false
    } else {
      if (course.year !== year) return false
      if (course.is_average) return false
      if (!terms.includes(course.term)) return false
    }

    if (concentration !== 'All' && course.concentration !== concentration) return false
    if (coreFilter === 'core' && !course.is_core) return false
    if (coreFilter === 'no-core' && course.is_core) return false
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
    apply: (filters) => filters,
    isActive: () => false,
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
]

export default function Home({ courses, meta, favs }) {
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
    coreFilter: 'all',
    terms: initTerms,
    stemGroup: 'all',
    year: initYear,
    minInstructorPct: 'any',
    evalOnly: false,
  })
  const [xMetric, setXMetric] = useState(DEFAULT_X)
  const [yMetric, setYMetric] = useState(DEFAULT_Y)
  const [activeTab, setActiveTab] = useState('comparisons')
  const [sortBy, setSortBy] = useState(initSort)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [showShortlistOnly, setShowShortlistOnly] = useState(false)

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
    if (sortBy !== 'bid_price_desc') params.sort = sortBy
    setSearchParams(params, { replace: true })
  }, [filters.year, filters.terms, filters.concentration, sortBy, meta.default_year, setSearchParams])

  const avgMode = isAverageYear(filters.year)
  const bidYear = filters.year === 2026
  const activeFilterCount = countFilterBadges(filters)

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

  const yearEvalCourses = useMemo(() => (
    avgMode
      ? courses.filter((course) => course.is_average && course.has_eval)
      : courses.filter((course) => course.year === filters.year && course.has_eval && !course.is_average)
  ), [avgMode, courses, filters.year])

  const biddingOnlyCourses = useMemo(() => {
    if (avgMode) return []
    return courses.filter((course) =>
      course.year === filters.year &&
      !course.has_eval &&
      course.has_bidding &&
      !course.is_average &&
      filters.terms.includes(course.term)
    )
  }, [avgMode, courses, filters.terms, filters.year])

  const filtered = useMemo(() => applyFilters(courses, filters), [courses, filters])
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
      {sidebarOpen && <button className="mobile-drawer-overlay md:hidden" onClick={() => setSidebarOpen(false)} aria-label="Close filters" />}

      <div className={`mobile-drawer md:hidden ${sidebarOpen ? 'open' : ''}`}>
        <Sidebar
          filters={filters}
          setFilters={setFilters}
          meta={meta}
          title="Search Courses"
          mobile
          onClose={() => setSidebarOpen(false)}
        />
      </div>

      <div className="hidden md:block">
        <Sidebar filters={filters} setFilters={setFilters} meta={meta} title="Search Courses" />
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
                Compare course quality, scan bidding pressure, and move through HKS offerings with a cleaner, more editorial experience inspired by a polished Harvard of the 2030s.
              </p>
            </div>

            <button
              type="button"
              onClick={() => setSidebarOpen(true)}
              className="md:hidden rounded-full border px-3 py-2 text-xs font-medium text-white shadow-sm"
              style={{ borderColor: 'var(--line)', background: 'rgba(255,255,255,0.04)' }}
            >
              Filters{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}
            </button>
          </div>

          <div className="flex flex-wrap gap-3 border-t px-5 py-4 md:px-7" style={{ borderColor: 'var(--line)', background: 'rgba(255,255,255,0.015)' }}>
            <div className="rounded-2xl border px-4 py-3 text-xs md:text-sm" style={{ borderColor: 'var(--line)', background: 'rgba(255,255,255,0.025)' }}>
              <span style={{ color: 'var(--text-muted)' }}>View</span>
              <p className="mt-1 font-medium" style={{ color: 'var(--text)' }}>{avgMode ? 'All-years weighted averages' : bidYear ? 'Active bidding season' : 'Filtered current courses'}</p>
            </div>
            <div className="rounded-2xl border px-4 py-3 text-xs md:text-sm" style={{ borderColor: 'var(--line)', background: 'rgba(255,255,255,0.025)' }}>
              <span style={{ color: 'var(--text-muted)' }}>Matching now</span>
              <p className="mt-1 font-medium" style={{ color: 'var(--text)' }}>{filtered.length} course{filtered.length !== 1 ? 's' : ''}</p>
            </div>
            <div className="rounded-2xl border px-4 py-3 text-xs md:text-sm" style={{ borderColor: 'var(--line)', background: 'rgba(255,255,255,0.025)' }}>
              <span style={{ color: 'var(--text-muted)' }}>Built for</span>
              <p className="mt-1 font-medium" style={{ color: 'var(--text)' }}>Harvard Kennedy School students</p>
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

        <div ref={visualizationRef} className="top-tabs-bar mb-5">
          {[
            { key: 'comparisons', label: 'Course Comparisons' },
            { key: 'map', label: 'Course Map' },
          ].map((tab) => (
            <button
              key={tab.key}
              onClick={() => {
                setActiveTab(tab.key)
                window.requestAnimationFrame(scrollToVisualization)
              }}
              className={`top-tab-button whitespace-nowrap rounded-full px-4 py-2.5 text-sm font-semibold transition-colors ${
                activeTab === tab.key ? 'text-white' : 'hover:text-label'
              }`}
              style={activeTab === tab.key
                ? {
                    background: 'linear-gradient(180deg, rgba(165, 28, 48, 0.28), rgba(165, 28, 48, 0.12))',
                    border: '1px solid rgba(212, 168, 106, 0.3)',
                    color: '#fff7f4',
                    boxShadow: 'inset 0 -2px 0 rgba(165, 28, 48, 0.9), 0 8px 22px rgba(15, 10, 8, 0.14)',
                  }
                : {
                    border: '1px solid var(--line)',
                    background: 'var(--panel-subtle)',
                    color: 'var(--text-soft)',
                  }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {activeTab === 'comparisons' && (
          <ScatterPlot
            allCourses={yearEvalCourses}
            matchedCourses={filteredEval}
            biddingOnlyCourses={biddingOnlyCourses}
            xMetric={xMetric}
            yMetric={yMetric}
            metrics={meta.metrics}
            onXChange={setXMetric}
            onYChange={setYMetric}
          />
        )}

        {activeTab === 'map' && <CourseMap courses={filtered} />}

        <div className="mt-6">
          <div className="preset-pills mb-3">
            {PRESETS.map((preset) => (
              <button
                key={preset.key}
                onClick={() => handlePreset(preset)}
                className={`preset-pill ${(preset.isActive(filters) || sortBy === preset.sortKey) ? 'active' : ''}`}
              >
                {preset.label}
              </button>
            ))}
            {favs && favs.count > 0 && (
              <button
                onClick={() => setShowShortlistOnly((v) => !v)}
                className={`preset-pill ${showShortlistOnly ? 'active' : ''}`}
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

          {visibleCourses.length === 0 ? (
            <div className="surface-card rounded-2xl py-12 text-center">
              <p className="mb-1 font-medium text-label">No courses match the current filters</p>
              <p className="text-xs text-muted">Try adjusting the year, terms, concentration, or removing some filters.</p>
            </div>
          ) : (
            visibleCourses.map((course) => <CourseCard key={course.id} course={course} favs={favs} />)
          )}
        </div>

        <div className="app-footer mt-8">
          HKS Course Explorer by Michael Gritzbach MPA&apos;26 · Data from HKS QReports · {new Date().getFullYear()}
        </div>
      </main>
    </div>
  )
}
