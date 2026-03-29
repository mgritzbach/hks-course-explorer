import { useState, useMemo, useEffect } from 'react'
import Sidebar from '../components/Sidebar.jsx'
import ScatterPlot from '../components/ScatterPlot.jsx'
import CourseMap from '../components/CourseMap.jsx'
import CourseCard from '../components/CourseCard.jsx'

const DEFAULT_X = 'Instructor_Rating'
const DEFAULT_Y = 'Course_Rating'

const IS_AVG_YEAR = (year) => year === 0

function applyFilters(courses, filters) {
  const {
    searchText, concentration, coreFilter, terms, isStemOnly, year,
    gender, minInstructorPct, evalOnly,
  } = filters
  const isAvg = IS_AVG_YEAR(year)

  const searchTerms = searchText
    ? searchText.split(',').map(t => t.trim().toLowerCase()).filter(Boolean)
    : []

  const minPct = minInstructorPct !== 'any' ? parseFloat(minInstructorPct) : null

  return courses.filter(c => {
    // Year / avg mode
    if (isAvg) {
      if (!c.is_average) return false
    } else {
      if (c.year !== year)          return false
      if (c.is_average)             return false
      if (!terms.includes(c.term))  return false
    }

    if (concentration !== 'All' && c.concentration !== concentration) return false
    if (coreFilter === 'core'    && !c.is_core)                       return false
    if (coreFilter === 'no-core' &&  c.is_core)                       return false
    if (isStemOnly && !c.is_stem)                                     return false

    // Gender filter (only applies if gender field exists in data)
    if (gender !== 'all' && c.gender != null && c.gender !== gender)  return false

    // Min instructor rating (only filters out courses that HAVE eval data but below threshold)
    if (minPct !== null) {
      const instrPct = c.metrics_pct?.Instructor_Rating
      if (instrPct != null && instrPct < minPct) return false
    }

    // Eval-only toggle
    if (evalOnly && !c.has_eval) return false

    if (searchTerms.length > 0) {
      const haystack = [
        c.course_name, c.course_code, c.professor_display,
        c.professor, c.description, c.concentration,
      ].join(' ').toLowerCase()
      if (!searchTerms.some(t => haystack.includes(t))) return false
    }

    return true
  })
}

function pageTitle(filters) {
  if (IS_AVG_YEAR(filters.year)) return 'HKS Course Search — All Years Average'
  const tLabel = filters.terms.length === 3 ? 'All Terms' : filters.terms.join(' + ')
  return `HKS Course Search — ${tLabel} ${filters.year}`
}

// Preset definitions
const PRESETS = [
  {
    key: 'top_rated',
    label: '🏆 Top Rated',
    apply: (f) => ({ ...f, minInstructorPct: '75' }),
    isActive: (f) => f.minInstructorPct === '75',
  },
  {
    key: 'light_workload',
    label: '🧘 Light Workload',
    apply: (f) => f,
    isActive: () => false,
    sortKey: 'workload_asc',
  },
  {
    key: 'stem_only',
    label: '🔬 STEM Only',
    apply: (f) => ({ ...f, isStemOnly: true }),
    isActive: (f) => f.isStemOnly,
  },
  {
    key: 'bidding_2026',
    label: '🔥 Bidding 2026',
    apply: (f) => ({ ...f, year: 2026, evalOnly: false }),
    isActive: (f) => f.year === 2026,
    sortKey: 'bid_price_desc',
  },
]

export default function Home({ courses, meta }) {
  const [filters, setFilters] = useState({
    searchText:       '',
    concentration:    'All',
    coreFilter:       'all',
    terms:            ['Fall', 'Spring', 'January'],
    isStemOnly:       false,
    year:             meta.default_year,
    gender:           'all',
    minInstructorPct: 'any',
    evalOnly:         false,
  })
  const [xMetric, setXMetric] = useState(DEFAULT_X)
  const [yMetric, setYMetric] = useState(DEFAULT_Y)
  const [activeTab, setActiveTab] = useState('comparisons') // 'comparisons' | 'map'
  const [sortBy, setSortBy]   = useState('instructor_desc')
  const [sidebarOpen, setSidebarOpen] = useState(false)

  const isAvg    = IS_AVG_YEAR(filters.year)
  const isBidYear = filters.year === 2026

  // Update document title
  useEffect(() => {
    document.title = pageTitle(filters)
  }, [filters])

  // All courses for selected year with eval data (used for scatter background)
  const yearEvalCourses = useMemo(
    () => isAvg
      ? courses.filter(c => c.is_average && c.has_eval)
      : courses.filter(c => c.year === filters.year && c.has_eval && !c.is_average),
    [courses, filters.year, isAvg]
  )

  // Bidding-only: has bidding this year/term but no eval data yet
  const biddingOnlyCourses = useMemo(() => {
    if (isAvg) return []
    return courses.filter(c =>
      c.year === filters.year &&
      !c.has_eval &&
      c.has_bidding &&
      !c.is_average &&
      filters.terms.includes(c.term)
    )
  }, [courses, filters.year, filters.terms, isAvg])

  // Filtered courses (all, for the card list)
  const filtered = useMemo(() => applyFilters(courses, filters), [courses, filters])

  // Filtered eval courses (for scatter highlighted dots)
  const filteredEval = useMemo(() => filtered.filter(c => c.has_eval), [filtered])

  // Sorted card list — null-metric courses always go to bottom
  const sorted = useMemo(() => {
    const arr = [...filtered]
    switch (sortBy) {
      case 'instructor_desc':
        return arr.sort((a, b) => {
          const av = a.metrics_pct?.Instructor_Rating
          const bv = b.metrics_pct?.Instructor_Rating
          if (av == null && bv == null) return 0
          if (av == null) return 1
          if (bv == null) return -1
          return bv - av
        })
      case 'workload_asc':
        return arr.sort((a, b) => {
          const av = a.metrics_pct?.Workload
          const bv = b.metrics_pct?.Workload
          if (av == null && bv == null) return 0
          if (av == null) return 1
          if (bv == null) return -1
          return av - bv
        })
      case 'course_rating_desc':
        return arr.sort((a, b) => {
          const av = a.metrics_pct?.Course_Rating
          const bv = b.metrics_pct?.Course_Rating
          if (av == null && bv == null) return 0
          if (av == null) return 1
          if (bv == null) return -1
          return bv - av
        })
      case 'rigor_desc':
        return arr.sort((a, b) => {
          const av = a.metrics_pct?.Rigor
          const bv = b.metrics_pct?.Rigor
          if (av == null && bv == null) return 0
          if (av == null) return 1
          if (bv == null) return -1
          return bv - av
        })
      case 'diverse_desc':
        return arr.sort((a, b) => {
          const av = a.metrics_pct?.['Diverse Perspectives']
          const bv = b.metrics_pct?.['Diverse Perspectives']
          if (av == null && bv == null) return 0
          if (av == null) return 1
          if (bv == null) return -1
          return bv - av
        })
      case 'bid_price_desc':
        return arr.sort((a, b) => {
          const av = a.last_bid_price
          const bv = b.last_bid_price
          if (av == null && bv == null) return 0
          if (av == null) return 1
          if (bv == null) return -1
          return bv - av
        })
      case 'name_asc':
        return arr.sort((a, b) => (a.course_name || '').localeCompare(b.course_name || ''))
      default:
        return arr
    }
  }, [filtered, sortBy])

  const hasSearch  = filters.searchText.trim().length > 0
  const resultText = hasSearch
    ? `Search complete! Scroll down to view ${filtered.length} result${filtered.length !== 1 ? 's' : ''}.`
    : null

  const handlePreset = (preset) => {
    if (preset.sortKey) {
      setSortBy(preset.sortKey)
    }
    if (preset.apply) {
      setFilters(f => preset.apply(f))
    }
  }

  return (
    <div className="flex h-full overflow-hidden">
      {/* ── Mobile overlay ── */}
      <div
        className={`sidebar-overlay ${sidebarOpen ? 'active' : ''}`}
        onClick={() => setSidebarOpen(false)}
      />

      {/* ── Sidebar ── */}
      <div className={`mobile-sidebar ${sidebarOpen ? 'open' : ''}`} style={{ display: 'contents' }}>
        <Sidebar filters={filters} setFilters={setFilters} meta={meta} />
      </div>

      {/* ── Main ── */}
      <main className="flex-1 overflow-y-auto px-6 py-6 flex flex-col">
        {/* Title + hamburger row */}
        <div className="flex items-center gap-3 mb-4">
          <button
            className="md:hidden text-muted hover:text-label text-xl leading-none"
            onClick={() => setSidebarOpen(o => !o)}
            aria-label="Toggle sidebar"
          >
            ☰
          </button>
          <h1 className="text-xl font-bold flex items-center gap-2" style={{ color: '#38bdf8' }}>
            🔍 {pageTitle(filters)}
          </h1>
        </div>

        {isAvg && (
          <div
            className="px-4 py-2 rounded mb-4 text-xs"
            style={{ background: '#1a1e2e', border: '1px solid #2a3a5e', color: '#93c5fd' }}
          >
            ⭐ Showing weighted averages across all years for each (course, instructor) pair.
            Percentile ranks are relative to other course averages — not individual year scores.
            {' '}Courses with more years/respondents carry more weight.
          </div>
        )}

        {isBidYear && (
          <div
            className="px-4 py-2 rounded mb-4 text-xs"
            style={{ background: '#1e1a0a', border: '1px solid #92400e', color: '#fbbf24' }}
          >
            🔥 <strong>Bidding Season 2026</strong> — These courses are currently in the bidding phase.
            No evaluation data yet. Bid prices and course details shown where available.
            Positions on the scatter plot are illustrative.
          </div>
        )}

        {/* Search result banner */}
        {resultText && (
          <div
            className="px-4 py-3 rounded mb-4 text-sm text-green-300"
            style={{ background: '#1a2e1a', border: '1px solid #2a4a2a' }}
          >
            {resultText}
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-1 mb-4 border-b border-[#2a2a3e]">
          {[
            { key: 'comparisons', label: '📊 Course Comparisons' },
            { key: 'map',         label: '🗺️ Course Map' },
          ].map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-4 py-2 text-sm transition-colors ${
                activeTab === tab.key
                  ? 'text-white -mb-px'
                  : 'text-muted hover:text-label'
              }`}
              style={activeTab === tab.key
                ? { borderBottom: '2px solid #38bdf8' }
                : undefined}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* ── SCATTER PLOT ── */}
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

        {/* ── COURSE MAP ── */}
        {activeTab === 'map' && (
          <CourseMap courses={filtered} filters={filters} />
        )}

        {/* ── COURSE LIST ── */}
        <div className="mt-6">
          {/* Quick Presets row */}
          <div className="preset-pills mb-3">
            {PRESETS.map(preset => (
              <button
                key={preset.key}
                onClick={() => handlePreset(preset)}
                className={`preset-pill ${preset.isActive(filters) || sortBy === preset.sortKey ? 'active' : ''}`}
              >
                {preset.label}
              </button>
            ))}
          </div>

          {/* Sort bar */}
          <div
            className="sort-bar flex items-center justify-between px-3 py-2 mb-3 rounded"
          >
            <p className="text-xs text-muted">
              <span className="font-medium text-label">{sorted.length}</span>
              {' '}course{sorted.length !== 1 ? 's' : ''}
              <span className="text-muted">
                {' '}({filteredEval.length} with evals)
              </span>
            </p>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted">Sort:</span>
              <div className="select-wrap" style={{ width: 200 }}>
                <select
                  value={sortBy}
                  onChange={e => setSortBy(e.target.value)}
                  style={{ padding: '4px 28px 4px 8px', fontSize: 12 }}
                >
                  <option value="instructor_desc">Instructor Rating ↓</option>
                  <option value="course_rating_desc">Course Rating ↓</option>
                  <option value="workload_asc">Workload ↑ (lightest first)</option>
                  <option value="rigor_desc">Rigor ↓</option>
                  <option value="diverse_desc">Diverse Perspectives ↓</option>
                  <option value="bid_price_desc">Last Bid Price ↓</option>
                  <option value="name_asc">Course Name A–Z</option>
                </select>
              </div>
            </div>
          </div>

          {sorted.length === 0 ? (
            <div
              className="py-12 text-center rounded-lg"
              style={{ background: '#1a1a28', border: '1px solid #2a2a3e' }}
            >
              <p className="text-3xl mb-3">🔍</p>
              <p className="text-label font-medium mb-1">No courses match the current filters</p>
              <p className="text-xs text-muted">
                Try adjusting the year, terms, concentration, or removing some filters.
              </p>
            </div>
          ) : (
            sorted.map(c => <CourseCard key={c.id} course={c} />)
          )}
        </div>

        {/* Footer */}
        <div className="app-footer mt-8">
          Data from HKS QReports · {new Date().getFullYear()}
        </div>
      </main>
    </div>
  )
}
