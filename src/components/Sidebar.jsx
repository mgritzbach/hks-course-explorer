import { useEffect, useRef, useState } from 'react'

const TERM_LABELS = { Fall: 'Fall', Spring: 'Spring', January: 'Jan' }


function countActiveFilters(filters) {
  let count = 0
  if (filters.searchText.trim()) count++
  if (filters.concentration !== 'All') count++
  if (filters.coreFilter !== 'all') count++
  if (filters.stemGroup !== 'all') count++
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

export default function Sidebar({ filters, setFilters, meta, title = 'Search Courses', onClose = null, mobile = false, metricMode = 'score', setMetricMode = null, colorblindMode = false, setColorblindMode = null, onReplayTour = null }) {
  const [searchInput, setSearchInput] = useState(filters.searchText)
  const [tourPending, setTourPending] = useState(false)
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
      stemGroup: 'all',
      year: meta.default_year,
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
        background: 'linear-gradient(180deg, var(--panel-strong), var(--panel-soft))',
        borderRight: '1px solid var(--line)',
      }}
    >
      {/* Header */}
      <div className="px-4 pb-3 pt-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <p className="kicker">{title}</p>
            {activeCount > 0 && <span className="filter-badge">{activeCount}</span>}
          </div>
          {mobile && onClose && (
            <button
              type="button"
              onClick={onClose}
              className="rounded-full px-3 py-1 text-[11px] text-muted transition-colors hover:text-label"
              style={{ border: '1px solid var(--line)', background: 'var(--panel-subtle)' }}
            >
              Close
            </button>
          )}
        </div>

        <label className="filter-label mb-1.5 block">Keywords</label>
        <div className="search-input-wrap">
          <input
            type="text"
            value={searchInput}
            placeholder="Leadership, climate, Levy…"
            onChange={(event) => handleSearchChange(event.target.value)}
            onKeyDown={handleSearchKey}
          />
          {searchInput && (
            <button className="search-clear-btn" onClick={clearSearch} aria-label="Clear search">
              ×
            </button>
          )}
        </div>
      </div>

      {/* Year — primary filter, visually elevated */}
      <div data-tour="year-filter" className="px-4 py-3" style={{ background: 'rgba(165,28,48,0.07)', borderBottom: '1px solid var(--line)' }}>
        <div className="mb-2 flex items-center justify-between">
          <label className="filter-label font-semibold" style={{ color: 'var(--text)', fontSize: 11 }}>📅 Year</label>
          {filters.year !== 0 && (
            <button
              onClick={() => update({ year: 0 })}
              className="text-[10px] font-semibold transition-colors hover:text-label"
              style={{ color: 'var(--gold)' }}
              title="See weighted averages across all years"
            >
              All-time avg →
            </button>
          )}
        </div>
        <div className="select-wrap">
          <select
            value={filters.year}
            onChange={(event) => update({ year: parseInt(event.target.value, 10) })}
            style={{ fontWeight: 600, fontSize: 13 }}
          >
            <option value={0}>⊕ All Years Average</option>
            {[...meta.years].reverse().map((year) => (
              <option key={year} value={year}>
                {year === 2026 ? `${year} — Bidding` : year}
              </option>
            ))}
          </select>
        </div>
        {filters.year === 0 && (
          <p className="mt-1.5 text-[10px] leading-tight" style={{ color: 'var(--blue)' }}>
            Weighted averages across all years — best for comparing instructors long-term.
          </p>
        )}
        <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 8, textAlign: 'center' }}>
          Data: HKS evals through 2025 · Bidding 2024–25
        </div>
      </div>

      {/* Concentration */}
      <div className="filter-section px-4 py-3">
        <label className="filter-label mb-1.5 block">Concentration</label>
        <div className="select-wrap">
          <select value={filters.concentration} onChange={(event) => update({ concentration: event.target.value })}>
            <option value="All">All concentrations</option>
            {meta.concentrations.map((concentration) => (
              <option key={concentration} value={concentration}>{concentration}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Core */}
      <div className="filter-section px-4 py-3">
        <label className="filter-label mb-1.5 block">Core Courses</label>
        <div className="select-wrap">
          <select value={filters.coreFilter} onChange={(event) => update({ coreFilter: event.target.value })}>
            <option value="all">Show All</option>
            <option value="core">Core Only</option>
            <option value="no-core">Electives Only</option>
          </select>
        </div>
      </div>

      {/* Terms (only when a specific year is selected) */}
      {filters.year !== 0 && (
        <div className="filter-section px-4 py-3">
          <div className="mb-2 flex items-center justify-between">
            <label className="filter-label">Term</label>
            <button
              onClick={() => update({ terms: ['Fall', 'Spring', 'January'] })}
              className="text-[10px] text-muted transition-colors hover:text-label"
            >
              All
            </button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {meta.terms.map((term) => {
              const active = filters.terms.includes(term)
              return (
                <button
                  key={term}
                  onClick={() => toggleTerm(term)}
                  className="flex items-center gap-1.5 rounded-full px-3 py-2 text-xs font-semibold transition-all touch-manipulation min-h-[36px]"
                  style={active
                    ? { background: 'var(--accent)', color: '#fff8f5', border: '1px solid transparent' }
                    : { border: '1px solid var(--line)', background: 'var(--panel-subtle)', color: 'var(--text-muted)' }}
                >
                  {TERM_LABELS[term]}
                  {active && <span style={{ fontSize: 12, opacity: 0.85, lineHeight: 1 }}>✕</span>}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Min Instructor Rating */}
      <div className="filter-section px-4 py-3">
        <label className="filter-label mb-1.5 block">Min Instructor Rating</label>
        <div className="select-wrap">
          <select value={filters.minInstructorPct} onChange={(event) => update({ minInstructorPct: event.target.value })}>
            <option value="any">Any</option>
            <option value="75">Top 25% (≥75th pct)</option>
            <option value="50">Top 50% (≥50th pct)</option>
            <option value="25">Top 75% (≥25th pct)</option>
          </select>
        </div>
      </div>

      {/* STEM */}
      <div className="filter-section px-4 py-3">
        <label className="filter-label mb-1.5 block">STEM</label>
        <div className="select-wrap">
          <select value={filters.stemGroup} onChange={(event) => update({ stemGroup: event.target.value })}>
            <option value="all">All courses</option>
            <option value="stem">STEM only (A + B)</option>
            <option value="A">STEM A only</option>
            <option value="B">STEM B only</option>
          </select>
        </div>
      </div>

      {/* Checkboxes */}
      <div className="filter-section flex flex-col gap-3 px-4 py-3">
        <label className="flex cursor-pointer items-center gap-2.5">
          <input
            type="checkbox"
            checked={filters.evalOnly}
            onChange={(event) => update({ evalOnly: event.target.checked })}
            className="h-3.5 w-3.5 cursor-pointer"
            style={{ accentColor: 'var(--accent)' }}
          />
          <span className="text-xs text-label">Only courses with evals</span>
        </label>
      </div>

      {/* Metric display mode */}
      {setMetricMode && (
        <div className="filter-section px-4 py-3">
          <label className="filter-label mb-2 block">Metric Display</label>
          <div className="flex gap-1 rounded-full border p-0.5" style={{ borderColor: 'var(--line)', background: 'var(--panel-subtle)' }}>
            <button
              onClick={() => setMetricMode('score')}
              className="flex-1 rounded-full py-1.5 text-[11px] font-medium transition-colors"
              style={{
                background: metricMode === 'score' ? 'var(--accent)' : 'transparent',
                color: metricMode === 'score' ? '#fff' : 'var(--text-muted)',
              }}
            >
              Score
            </button>
            <button
              onClick={() => setMetricMode('percentile')}
              className="flex-1 rounded-full py-1.5 text-[11px] font-medium transition-colors"
              style={{
                background: metricMode === 'percentile' ? 'var(--blue)' : 'transparent',
                color: metricMode === 'percentile' ? '#fff' : 'var(--text-muted)',
              }}
            >
              Percentile
            </button>
          </div>
          <p className="mt-1.5 text-[11px] leading-snug" style={{ color: 'var(--text-muted)' }}>
            {metricMode === 'score'
              ? 'Absolute quality: avg rating ÷ 5 × 100. E.g. 4.2/5 → 84%.'
              : 'Relative rank: 80 pct = better than 80% of all courses.'}
          </p>
        </div>
      )}

      {/* Colorblind mode toggle */}
      {setColorblindMode && (
        <div className="filter-section px-4 py-3">
          <label className="filter-label mb-2 block">Accessibility</label>
          <label className="flex cursor-pointer items-center gap-2.5">
            <input
              type="checkbox"
              checked={colorblindMode}
              onChange={(e) => setColorblindMode(e.target.checked)}
              className="h-3.5 w-3.5 cursor-pointer"
              style={{ accentColor: 'var(--blue)' }}
            />
            <span className="text-xs text-label">Red-green colorblind mode</span>
          </label>
          {colorblindMode && (
            <p className="mt-1.5 text-[10px] leading-tight" style={{ color: 'var(--blue)' }}>
              Quadrants use blue/orange instead of green/red
            </p>
          )}
        </div>
      )}

      {/* Reset */}
      <div className="filter-section px-4 py-3">
        <button
          onClick={reset}
          className="w-full rounded-full py-2 text-xs font-semibold text-muted transition-all hover:text-label"
          style={{ border: '1px solid var(--line)', background: 'var(--panel-subtle)' }}
        >
          Reset All Filters
        </button>
      </div>

      {/* Footer */}
      <div className="border-t px-4 pb-5 pt-4" style={{ borderColor: 'var(--line)' }}>
        <div
          style={{
            fontSize: 10,
            color: 'var(--text-muted)',
            lineHeight: 1.6,
            paddingBottom: 8,
            borderBottom: '1px solid var(--line)',
            marginBottom: 8,
          }}
        >
          <div>Built by Michael Gritzbach</div>
          <div>MPA '26 · KSSG 2025 & 2026</div>
          <div>For future HKS generations</div>
        </div>
        <a
          href="mailto:mgritzbach@hks.harvard.edu"
          className="text-xs transition-colors hover:text-label"
          style={{ color: 'var(--gold)' }}
        >
          Contact
        </a>
        {onReplayTour && (
          <button
            type="button"
            disabled={tourPending}
            onClick={() => {
              setTourPending(true)
              setTimeout(() => {
                onReplayTour()
                setTourPending(false)
              }, 150)
            }}
            className="mt-3 block text-xs transition-colors hover:text-label touch-manipulation"
            style={{ color: tourPending ? 'var(--accent)' : 'var(--text-muted)', background: 'none', border: 'none', cursor: tourPending ? 'default' : 'pointer', padding: 0, opacity: tourPending ? 0.7 : 1 }}
          >
            {tourPending ? '↺ Starting…' : '↺ Replay tour'}
          </button>
        )}
      </div>
    </aside>
  )
}
