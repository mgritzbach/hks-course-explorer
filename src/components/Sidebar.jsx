import { useEffect, useRef, useState } from 'react'

const TERM_LABELS = { Fall: 'Fall', Spring: 'Spring', January: 'Jan' }

function countActiveFilters(filters) {
  let count = 0
  if (filters.searchText.trim()) count++
  if (filters.concentration !== 'All') count++
  if (filters.coreFilter !== 'all') count++
  if (filters.isStemOnly) count++
  if (filters.gender !== 'all') count++
  if (filters.minInstructorPct !== 'any') count++
  if (filters.evalOnly) count++
  if (filters.year !== 0) {
    const allTerms = ['Fall', 'Spring', 'January']
    if (filters.terms.length !== allTerms.length || !allTerms.every((term) => filters.terms.includes(term))) {
      count++
    }
  }
  return count
}

export default function Sidebar({ filters, setFilters, meta, title = 'Search Courses', onClose = null, mobile = false }) {
  const [searchInput, setSearchInput] = useState(filters.searchText)
  const debounceRef = useRef(null)

  const update = (patch) => setFilters((current) => ({ ...current, ...patch }))

  useEffect(() => {
    setSearchInput(filters.searchText)
  }, [filters.searchText])

  useEffect(() => () => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
  }, [])

  const handleSearchChange = (value) => {
    setSearchInput(value)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      update({ searchText: value })
    }, 300)
  }

  const handleSearchKey = (event) => {
    if (event.key === 'Enter') {
      if (debounceRef.current) clearTimeout(debounceRef.current)
      update({ searchText: searchInput })
    }
  }

  const clearSearch = () => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    setSearchInput('')
    update({ searchText: '' })
  }

  const toggleTerm = (term) => {
    const nextTerms = filters.terms.includes(term)
      ? filters.terms.filter((item) => item !== term)
      : [...filters.terms, term]

    if (nextTerms.length > 0) update({ terms: nextTerms })
  }

  const reset = () => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    setSearchInput('')
    setFilters((current) => ({
      ...current,
      searchText: '',
      concentration: 'All',
      coreFilter: 'all',
      terms: ['Fall', 'Spring', 'January'],
      isStemOnly: false,
      year: meta.default_year,
      gender: 'all',
      minInstructorPct: 'any',
      evalOnly: false,
    }))
  }

  const activeCount = countActiveFilters(filters)

  return (
    <aside
      className="flex h-full flex-col overflow-y-auto shrink-0"
      style={{
        width: mobile ? '100%' : 248,
        background: '#151521',
        borderRight: '1px solid #2a2a3e',
      }}
    >
      <div className="px-4 pb-3 pt-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <p className="text-xs font-semibold text-red-400">{title}</p>
            {activeCount > 0 && <span className="filter-badge">{activeCount} active</span>}
          </div>
          {mobile && onClose && (
            <button
              type="button"
              onClick={onClose}
              className="rounded-full border border-[#2a2a3e] px-2 py-1 text-[11px] text-muted transition-colors hover:text-white"
            >
              Close
            </button>
          )}
        </div>

        <label className="filter-label mb-1 block">Keywords (comma-separated):</label>
        <div className="search-input-wrap">
          <input
            type="text"
            value={searchInput}
            placeholder="Leadership, climate, Levy"
            onChange={(event) => handleSearchChange(event.target.value)}
            onKeyDown={handleSearchKey}
          />
          {searchInput && (
            <button className="search-clear-btn" onClick={clearSearch} aria-label="Clear search">
              x
            </button>
          )}
        </div>
      </div>

      <div className="filter-section px-4 py-3">
        <label className="filter-label mb-1 block">Year:</label>
        <div className="select-wrap">
          <select value={filters.year} onChange={(event) => update({ year: parseInt(event.target.value, 10) })}>
            <option value={0}>All Years (Avg)</option>
            {[...meta.years].reverse().map((year) => (
              <option key={year} value={year}>
                {year === 2026 ? `${year} - Bidding` : year}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="filter-section px-4 py-3">
        <label className="filter-label mb-1 block">Concentration:</label>
        <div className="select-wrap">
          <select value={filters.concentration} onChange={(event) => update({ concentration: event.target.value })}>
            <option value="All">All</option>
            {meta.concentrations.map((concentration) => (
              <option key={concentration} value={concentration}>{concentration}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="filter-section px-4 py-3">
        <label className="filter-label mb-1 block">Core Courses:</label>
        <div className="select-wrap">
          <select value={filters.coreFilter} onChange={(event) => update({ coreFilter: event.target.value })}>
            <option value="all">Show All</option>
            <option value="core">Core Only</option>
            <option value="no-core">No Core</option>
          </select>
        </div>
      </div>

      {filters.year !== 0 && (
        <div className="filter-section px-4 py-3">
          <div className="mb-2 flex items-center justify-between">
            <label className="filter-label">Term:</label>
            <button onClick={() => update({ terms: ['Fall', 'Spring', 'January'] })} className="text-[10px] text-muted hover:text-label">
              All
            </button>
          </div>
          <div className="flex flex-wrap gap-1">
            {meta.terms.map((term) => {
              const active = filters.terms.includes(term)
              return (
                <button
                  key={term}
                  onClick={() => toggleTerm(term)}
                  className={`flex items-center gap-1 rounded px-2 py-1 text-xs font-medium transition-colors ${
                    active ? 'bg-red-600 text-white' : 'border border-[#2a2a3e] bg-[#1a1a28] text-muted hover:border-red-600'
                  }`}
                >
                  {TERM_LABELS[term]}
                  {active && <span className="text-[10px] leading-none">x</span>}
                </button>
              )
            })}
          </div>
        </div>
      )}

      <div className="filter-section px-4 py-3">
        <label className="filter-label mb-1 block">Min Instructor Rating:</label>
        <div className="select-wrap">
          <select value={filters.minInstructorPct} onChange={(event) => update({ minInstructorPct: event.target.value })}>
            <option value="any">Any</option>
            <option value="75">Top 25% (&gt;=75th pct)</option>
            <option value="50">Top 50% (&gt;=50th pct)</option>
            <option value="25">Top 75% (&gt;=25th pct)</option>
          </select>
        </div>
      </div>

      <div className="filter-section px-4 py-3">
        <label className="filter-label mb-1 block">Instructor Gender:</label>
        <div className="select-wrap">
          <select value={filters.gender} onChange={(event) => update({ gender: event.target.value })}>
            <option value="all">All</option>
            <option value="M">Male instructors</option>
            <option value="F">Female instructors</option>
          </select>
        </div>
      </div>

      <div className="filter-section flex flex-col gap-2.5 px-4 py-3">
        <div className="flex items-center gap-2">
          <input
            id="stem-check"
            type="checkbox"
            checked={filters.isStemOnly}
            onChange={(event) => update({ isStemOnly: event.target.checked })}
            className="h-3.5 w-3.5 cursor-pointer accent-accent"
          />
          <label htmlFor="stem-check" className="cursor-pointer text-xs text-label">Only STEM</label>
        </div>

        <div className="flex items-center gap-2">
          <input
            id="eval-check"
            type="checkbox"
            checked={filters.evalOnly}
            onChange={(event) => update({ evalOnly: event.target.checked })}
            className="h-3.5 w-3.5 cursor-pointer accent-accent"
          />
          <label htmlFor="eval-check" className="cursor-pointer text-xs text-label">Only with evals</label>
        </div>
      </div>

      <div className="filter-section px-4 py-3">
        <button
          onClick={reset}
          className="w-full rounded border border-[#2a2a3e] py-2 text-xs text-muted transition-colors hover:border-label hover:text-label"
        >
          Reset All Filters
        </button>
      </div>

      <div className="mt-auto border-t border-[#2a2a3e] px-4 pb-4 pt-4">
        <a href="mailto:feedback@hks.harvard.edu" className="text-xs text-accent hover:underline">
          Share Feedback
        </a>
      </div>
    </aside>
  )
}
