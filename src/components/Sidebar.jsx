import { useState, useRef, useEffect } from 'react'

const TERM_LABELS = { Fall: 'Fall', Spring: 'Spring', January: 'Jan' }

// Count active (non-default) filters
function countActiveFilters(filters, meta) {
  let count = 0
  if (filters.searchText.trim())              count++
  if (filters.concentration !== 'All')        count++
  if (filters.coreFilter !== 'all')           count++
  if (filters.isStemOnly)                     count++
  if (filters.gender !== 'all')               count++
  if (filters.minInstructorPct !== 'any')     count++
  if (filters.evalOnly)                       count++
  // terms non-default only in year mode
  if (filters.year !== 0) {
    const allTerms = ['Fall', 'Spring', 'January']
    if (filters.terms.length !== allTerms.length || !allTerms.every(t => filters.terms.includes(t))) {
      count++
    }
  }
  return count
}

export default function Sidebar({ filters, setFilters, meta }) {
  const [searchInput, setSearchInput] = useState(filters.searchText)
  const debounceRef = useRef(null)

  const update = (patch) => setFilters(f => ({ ...f, ...patch }))

  // Keep local input in sync when filters are reset externally
  useEffect(() => {
    setSearchInput(filters.searchText)
  }, [filters.searchText])

  // Debounced search
  const handleSearchChange = (val) => {
    setSearchInput(val)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      update({ searchText: val })
    }, 300)
  }

  const handleSearchKey = (e) => {
    if (e.key === 'Enter') {
      if (debounceRef.current) clearTimeout(debounceRef.current)
      update({ searchText: searchInput })
    }
  }

  const clearSearch = () => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    setSearchInput('')
    update({ searchText: '' })
  }

  // Term tag toggle
  const toggleTerm = (term) => {
    const next = filters.terms.includes(term)
      ? filters.terms.filter(t => t !== term)
      : [...filters.terms, term]
    if (next.length > 0) update({ terms: next })
  }

  const reset = () => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    setSearchInput('')
    setFilters(f => ({
      ...f,
      searchText:        '',
      concentration:     'All',
      coreFilter:        'all',
      terms:             ['Fall', 'Spring', 'January'],
      isStemOnly:        false,
      year:              meta.default_year,
      gender:            'all',
      minInstructorPct:  'any',
      evalOnly:          false,
    }))
  }

  const activeCount = countActiveFilters(filters, meta)

  return (
    <aside
      className="flex flex-col gap-0 overflow-y-auto shrink-0"
      style={{
        width: 248,
        background: '#151521',
        borderRight: '1px solid #2a2a3e',
      }}
    >
      {/* ── Header ── */}
      <div className="px-4 pt-4 pb-3">
        <div className="flex items-center gap-2 mb-3">
          <p className="text-xs font-semibold text-red-400">🎯 Search Courses</p>
          {activeCount > 0 && (
            <span className="filter-badge">{activeCount} active</span>
          )}
        </div>

        {/* Text search with debounce + clear button */}
        <label className="filter-label block mb-1">
          Keywords (comma-separated):
        </label>
        <div className="search-input-wrap">
          <input
            type="text"
            value={searchInput}
            placeholder="Leadership, climate, Levy"
            onChange={e => handleSearchChange(e.target.value)}
            onKeyDown={handleSearchKey}
          />
          {searchInput && (
            <button
              className="search-clear-btn"
              onClick={clearSearch}
              aria-label="Clear search"
            >
              ×
            </button>
          )}
        </div>
      </div>

      {/* ── Year ── */}
      <div className="px-4 py-3 filter-section">
        <label className="filter-label block mb-1">Year:</label>
        <div className="select-wrap">
          <select value={filters.year} onChange={e => update({ year: parseInt(e.target.value) })}>
            <option value={0}>⭐ All Years (Avg)</option>
            {[...meta.years].reverse().map(y => (
              <option key={y} value={y}>
                {y === 2026 ? `🔥 ${y} — Bidding` : y}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* ── Concentration ── */}
      <div className="px-4 py-3 filter-section">
        <label className="filter-label block mb-1">Concentration:</label>
        <div className="select-wrap">
          <select value={filters.concentration} onChange={e => update({ concentration: e.target.value })}>
            <option value="All">All</option>
            {meta.concentrations.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
      </div>

      {/* ── Core courses ── */}
      <div className="px-4 py-3 filter-section">
        <label className="filter-label block mb-1">Core Courses:</label>
        <div className="select-wrap">
          <select value={filters.coreFilter} onChange={e => update({ coreFilter: e.target.value })}>
            <option value="all">Show All</option>
            <option value="core">Core Only</option>
            <option value="no-core">No Core</option>
          </select>
        </div>
      </div>

      {/* ── Term tags — hidden in avg mode ── */}
      {filters.year !== 0 && (
        <div className="px-4 py-3 filter-section">
          <div className="flex items-center justify-between mb-2">
            <label className="filter-label">Term:</label>
            <button
              onClick={() => update({ terms: ['Fall', 'Spring', 'January'] })}
              className="text-[10px] text-muted hover:text-label"
            >
              All
            </button>
          </div>
          <div className="flex flex-wrap gap-1">
            {meta.terms.map(t => {
              const active = filters.terms.includes(t)
              return (
                <button
                  key={t}
                  onClick={() => toggleTerm(t)}
                  className={`flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-colors ${
                    active
                      ? 'bg-red-600 text-white'
                      : 'bg-[#1a1a28] text-muted border border-[#2a2a3e] hover:border-red-600'
                  }`}
                >
                  {TERM_LABELS[t]}
                  {active && <span className="text-[10px] leading-none">×</span>}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* ── Min Instructor Rating ── */}
      <div className="px-4 py-3 filter-section">
        <label className="filter-label block mb-1">Min Instructor Rating:</label>
        <div className="select-wrap">
          <select
            value={filters.minInstructorPct}
            onChange={e => update({ minInstructorPct: e.target.value })}
          >
            <option value="any">Any</option>
            <option value="75">Top 25% (≥75th pct)</option>
            <option value="50">Top 50% (≥50th pct)</option>
            <option value="25">Top 75% (≥25th pct)</option>
          </select>
        </div>
      </div>

      {/* ── Gender filter ── */}
      <div className="px-4 py-3 filter-section">
        <label className="filter-label block mb-1">Instructor Gender:</label>
        <div className="select-wrap">
          <select value={filters.gender} onChange={e => update({ gender: e.target.value })}>
            <option value="all">All</option>
            <option value="M">Male instructors</option>
            <option value="F">Female instructors</option>
          </select>
        </div>
      </div>

      {/* ── Toggles ── */}
      <div className="px-4 py-3 filter-section flex flex-col gap-2.5">
        {/* Only STEM */}
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id="stem-check"
            checked={filters.isStemOnly}
            onChange={e => update({ isStemOnly: e.target.checked })}
            className="accent-accent w-3.5 h-3.5 cursor-pointer"
          />
          <label htmlFor="stem-check" className="text-xs text-label cursor-pointer">
            Only STEM
          </label>
        </div>

        {/* Only with evals */}
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id="eval-check"
            checked={filters.evalOnly}
            onChange={e => update({ evalOnly: e.target.checked })}
            className="accent-accent w-3.5 h-3.5 cursor-pointer"
          />
          <label htmlFor="eval-check" className="text-xs text-label cursor-pointer">
            Only with evals
          </label>
        </div>
      </div>

      {/* ── Reset ── */}
      <div className="px-4 py-3 filter-section">
        <button
          onClick={reset}
          className="w-full py-2 text-xs rounded border border-[#2a2a3e] text-muted hover:text-label hover:border-label transition-colors"
        >
          🔄 Reset All Filters
        </button>
      </div>

      {/* ── Spacer + feedback ── */}
      <div className="mt-auto px-4 pt-4 pb-4 border-t border-[#2a2a3e]">
        <a
          href="mailto:feedback@hks.harvard.edu"
          className="text-xs text-accent hover:underline"
        >
          👋 Share Feedback
        </a>
      </div>
    </aside>
  )
}
