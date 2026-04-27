import { useEffect, useRef, useState } from 'react'

const TERM_LABELS = { Fall: 'Fall', Spring: 'Spring', January: 'Jan' }
const DAY_OPTIONS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']
const TIME_OF_DAY_OPTIONS = [
  { label: 'Morning', value: 'morning' },
  { label: 'Afternoon', value: 'afternoon' },
  { label: 'Evening', value: 'evening' },
]


function countActiveFilters(filters) {
  let count = 0
  if (filters.searchText.trim()) count++
  if (filters.concentration !== 'All') count++
  if (filters.coreFilter !== 'all') count++
  if (filters.stemGroup !== 'all') count++
  if (filters.minInstructorPct !== 'any') count++
  if (filters.evalOnly) count++
  if (filters.days?.length) count++
  if (filters.timeOfDay?.length) count++
  if (filters.hideNoSchedule) count++
  if (filters.year !== 0) {
    const allTerms = ['Fall', 'Spring', 'January']
    if (filters.terms.length !== allTerms.length || !allTerms.every((term) => filters.terms.includes(term))) {
      count++
    }
  }
  return count
}

export default function Sidebar({ filters, setFilters, meta, title = 'Search Courses', onClose = null, mobile = false, metricMode = 'score', setMetricMode = null, colorblindMode = false, setColorblindMode = null, onReplayTour = null, searchRef = null }) {
  const containerRef = useRef(null)
  const [searchInput, setSearchInput] = useState(filters.searchText)
  const [tourPending, setTourPending] = useState(false)
  const debounceRef = useRef(null)
  const openTimeoutRef = useRef(null)
  const lastTriggerRef = useRef(null)
  const lastOpenStateRef = useRef(false)

  const update = (patch) => setFilters((current) => ({ ...current, ...patch }))

  useEffect(() => {
    setSearchInput(filters.searchText)
  }, [filters.searchText])

  useEffect(() => () => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
  }, [])

  useEffect(() => {
    if (!mobile || !containerRef.current) return undefined

    const drawer = containerRef.current.closest('.mobile-drawer')
    if (!drawer) return undefined

    const focusFirstElement = () => {
      const focusable = containerRef.current?.querySelector(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )
      focusable?.focus()
    }

    const syncDrawerFocus = () => {
      const isOpen = drawer.classList.contains('open')

      if (isOpen && !lastOpenStateRef.current) {
        lastTriggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
        if (openTimeoutRef.current) clearTimeout(openTimeoutRef.current)
        openTimeoutRef.current = setTimeout(focusFirstElement, 50)
      }

      if (!isOpen && lastOpenStateRef.current && lastTriggerRef.current instanceof HTMLElement) {
        lastTriggerRef.current.focus()
      }

      lastOpenStateRef.current = isOpen
    }

    syncDrawerFocus()
    const observer = new MutationObserver(syncDrawerFocus)
    observer.observe(drawer, { attributes: true, attributeFilter: ['class'] })

    return () => {
      observer.disconnect()
      if (openTimeoutRef.current) clearTimeout(openTimeoutRef.current)
    }
  }, [mobile])

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

  const toggleArrayFilter = (key, value) => {
    const currentValues = filters[key] || []
    const nextValues = currentValues.includes(value)
      ? currentValues.filter((item) => item !== value)
      : [...currentValues, value]
    update({ [key]: nextValues })
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
      days: [],
      timeOfDay: [],
      hideNoSchedule: false,
    }))
  }

  const activeCount = countActiveFilters(filters)

  return (
    <aside
      ref={containerRef}
      data-tour="search-sidebar"
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
              className="rounded-full px-4 py-2 text-xs font-semibold transition-colors hover:text-label"
              style={{ border: '1px solid var(--line)', background: 'var(--panel-subtle)', color: 'var(--text-muted)', minHeight: 40 }}
              aria-label="Close filter panel"
            >
              Done ✓
            </button>
          )}
        </div>

        <div className="mb-1.5 flex items-center justify-between">
          <label className="filter-label">Keywords</label>
          <span className="hidden rounded border px-1.5 py-0.5 text-[10px] font-mono text-muted md:inline" style={{ borderColor: 'var(--line)', background: 'var(--panel-strong)' }}>/</span>
        </div>
        <div className="search-input-wrap">
          <input
            ref={searchRef}
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
          Data: HKS evals through {meta.default_year} · Bidding {meta.default_year - 1}–{String(meta.default_year).slice(-2)}
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
                  aria-pressed={active}
                  className="flex items-center gap-1.5 rounded-full px-3 py-2 text-xs font-semibold transition-all touch-manipulation min-h-[44px]"
                  style={active
                    ? { background: 'var(--accent)', color: '#fff8f5', border: '1px solid transparent' }
                    : { border: '1px solid var(--line)', background: 'var(--panel-subtle)', color: 'var(--text-muted)' }}
                >
                  {TERM_LABELS[term]}
                  {active && <span aria-hidden="true" style={{ fontSize: 12, opacity: 0.85, lineHeight: 1 }}>✕</span>}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {filters.year !== 0 && (
        <div className="filter-section px-4 py-3">
          <div className="mb-2 flex items-center justify-between">
            <label className="filter-label">Days</label>
            <button
              onClick={() => update({ days: [] })}
              className="text-[10px] text-muted transition-colors hover:text-label"
            >
              All
            </button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {DAY_OPTIONS.map((day) => {
              const active = filters.days.includes(day)
              return (
                <button
                  key={day}
                  onClick={() => toggleArrayFilter('days', day)}
                  aria-pressed={active}
                  className="flex items-center gap-1.5 rounded-full px-3 py-2 text-xs font-semibold transition-all touch-manipulation min-h-[44px]"
                  style={active
                    ? { background: 'var(--accent)', color: '#fff8f5', border: '1px solid transparent' }
                    : { border: '1px solid var(--line)', background: 'var(--panel-subtle)', color: 'var(--text-muted)' }}
                >
                  {day}
                  {active && <span aria-hidden="true" style={{ fontSize: 12, opacity: 0.85, lineHeight: 1 }}>✕</span>}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {filters.year !== 0 && (
        <div className="filter-section px-4 py-3">
          <div className="mb-2 flex items-center justify-between">
            <label className="filter-label">Time of Day</label>
            <button
              onClick={() => update({ timeOfDay: [] })}
              className="text-[10px] text-muted transition-colors hover:text-label"
            >
              All
            </button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {TIME_OF_DAY_OPTIONS.map((option) => {
              const active = filters.timeOfDay.includes(option.value)
              return (
                <button
                  key={option.value}
                  onClick={() => toggleArrayFilter('timeOfDay', option.value)}
                  aria-pressed={active}
                  className="flex items-center gap-1.5 rounded-full px-3 py-2 text-xs font-semibold transition-all touch-manipulation min-h-[44px]"
                  style={active
                    ? { background: 'var(--accent)', color: '#fff8f5', border: '1px solid transparent' }
                    : { border: '1px solid var(--line)', background: 'var(--panel-subtle)', color: 'var(--text-muted)' }}
                >
                  {option.label}
                  {active && <span aria-hidden="true" style={{ fontSize: 12, opacity: 0.85, lineHeight: 1 }}>✕</span>}
                </button>
              )
            })}
          </div>
          <label className="mt-3 flex cursor-pointer items-center gap-2.5">
            <input
              type="checkbox"
              checked={filters.hideNoSchedule || false}
              onChange={(e) => update({ hideNoSchedule: e.target.checked })}
              className="h-3.5 w-3.5 cursor-pointer"
              style={{ accentColor: 'var(--accent)' }}
            />
            <span className="text-xs text-label">Hide courses without schedule info</span>
          </label>
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
          <div data-tour="metric-toggle" className="flex gap-1 rounded-full border p-0.5" style={{ borderColor: 'var(--line)', background: 'var(--panel-subtle)' }}>
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
        <a
          href="https://github.com/mgritzbach/hks-course-explorer/releases/download/v1.0-android/HKS-Course-Explorer-v1.0.apk"
          className="mt-2 flex items-center gap-1.5 text-xs transition-colors hover:text-label"
          style={{ color: 'var(--text-muted)' }}
          title="Download Android APK (9.7 MB)"
          aria-label="Download Android app"
        >
          <span aria-hidden="true">🤖</span> Android app ↓
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
