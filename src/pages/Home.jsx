import { useEffect, useMemo, useState } from 'react'
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
    isStemOnly,
    year,
    gender,
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
    if (isStemOnly && !course.is_stem) return false
    if (gender !== 'all' && course.gender != null && course.gender !== gender) return false

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
  if (filters.isStemOnly) count++
  if (filters.gender !== 'all') count++
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
    label: 'STEM Only',
    apply: (filters) => ({ ...filters, isStemOnly: true }),
    isActive: (filters) => filters.isStemOnly,
  },
  {
    key: 'bidding_2026',
    label: 'Bidding 2026',
    apply: (filters) => ({ ...filters, year: 2026, evalOnly: false }),
    isActive: (filters) => filters.year === 2026,
    sortKey: 'bid_price_desc',
  },
]

export default function Home({ courses, meta }) {
  const [filters, setFilters] = useState({
    searchText: '',
    concentration: 'All',
    coreFilter: 'all',
    terms: [...ALL_TERMS],
    isStemOnly: false,
    year: meta.default_year,
    gender: 'all',
    minInstructorPct: 'any',
    evalOnly: false,
  })
  const [xMetric, setXMetric] = useState(DEFAULT_X)
  const [yMetric, setYMetric] = useState(DEFAULT_Y)
  const [activeTab, setActiveTab] = useState('comparisons')
  const [sortBy, setSortBy] = useState('instructor_desc')
  const [sidebarOpen, setSidebarOpen] = useState(false)

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

      <div className={`mobile-drawer ${sidebarOpen ? 'open' : ''}`}>
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

      <main className="flex min-w-0 flex-1 flex-col overflow-y-auto px-4 py-4 md:px-6 md:py-6">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h1 className="text-lg font-bold text-white md:text-2xl" style={{ color: '#38bdf8' }}>
              {pageTitle(filters)}
            </h1>
            <p className="mt-1 text-xs text-muted md:text-sm">
              Compare ratings, scan bidding pressure, and jump into full course details.
            </p>
          </div>

          <button
            type="button"
            onClick={() => setSidebarOpen(true)}
            className="md:hidden rounded-full border border-[#2a2a3e] bg-[#151521] px-3 py-2 text-xs font-medium text-white shadow-sm"
          >
            Filters{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}
          </button>
        </div>

        {avgMode && (
          <div
            className="mb-4 rounded-lg px-4 py-3 text-xs md:text-sm"
            style={{ background: '#1a1e2e', border: '1px solid #2a3a5e', color: '#93c5fd' }}
          >
            Showing weighted averages across all years for each course and instructor pairing. Courses with more years and respondents carry more weight.
          </div>
        )}

        {bidYear && (
          <div
            className="mb-4 rounded-lg px-4 py-3 text-xs md:text-sm"
            style={{ background: '#1e1a0a', border: '1px solid #92400e', color: '#fbbf24' }}
          >
            Bidding Season 2026 is active. Courses without evaluation data still appear, and their scatter positions are illustrative unless you switch to bid-based axes.
          </div>
        )}

        {resultText && (
          <div
            className="mb-4 rounded-lg px-4 py-3 text-sm text-green-300"
            style={{ background: '#1a2e1a', border: '1px solid #2a4a2a' }}
          >
            {resultText}
          </div>
        )}

        <div className="mb-4 flex gap-2 overflow-x-auto border-b border-[#2a2a3e] pb-1">
          {[
            { key: 'comparisons', label: 'Course Comparisons' },
            { key: 'map', label: 'Course Map' },
          ].map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`whitespace-nowrap rounded-t-lg px-4 py-2 text-sm transition-colors ${
                activeTab === tab.key ? 'text-white' : 'text-muted hover:text-label'
              }`}
              style={activeTab === tab.key ? { borderBottom: '2px solid #38bdf8' } : undefined}
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
          </div>

          <div className="sort-bar mb-3 flex flex-col gap-3 rounded-lg px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-muted">
              <span className="font-medium text-label">{sorted.length}</span> course{sorted.length !== 1 ? 's' : ''}
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
                  <option value="instructor_desc">Instructor Rating desc</option>
                  <option value="course_rating_desc">Course Rating desc</option>
                  <option value="workload_asc">Workload asc (lightest first)</option>
                  <option value="rigor_desc">Rigor desc</option>
                  <option value="diverse_desc">Diverse Perspectives desc</option>
                  <option value="bid_price_desc">Last Bid Price desc</option>
                  <option value="name_asc">Course Name A-Z</option>
                </select>
              </div>
            </div>
          </div>

          {sorted.length === 0 ? (
            <div
              className="rounded-lg py-12 text-center"
              style={{ background: '#1a1a28', border: '1px solid #2a2a3e' }}
            >
              <p className="mb-1 font-medium text-label">No courses match the current filters</p>
              <p className="text-xs text-muted">Try adjusting the year, terms, concentration, or removing some filters.</p>
            </div>
          ) : (
            sorted.map((course) => <CourseCard key={course.id} course={course} />)
          )}
        </div>

        <div className="app-footer mt-8">
          Data from HKS QReports · {new Date().getFullYear()}
        </div>
      </main>
    </div>
  )
}
