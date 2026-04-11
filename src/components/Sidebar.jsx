import { useEffect, useRef, useState } from 'react'

const TERM_LABELS = { Fall: 'Fall', Spring: 'Spring', January: 'Jan' }

const HKS_RESOURCES = [
  {
    group: 'Data & Evaluations',
    links: [
      { label: 'Course Evals 2007–2023', url: 'https://docs.google.com/spreadsheets/d/1gAvxVSPGc2sF4Uv4CmHyFcNW9pRy8Pe_DfTHofBzhtI/edit?usp=sharing', auth: 'Google login' },
      { label: 'QReports (FAS)', url: 'https://qreports.fas.harvard.edu/browse/index', auth: 'HarvardKey' },
      { label: 'Professor Dashboard', url: 'https://public.tableau.com/app/profile/sean.norick.long/viz/HKSProfessorDashboard/IndividualPerformance-Dashboard', auth: null },
      { label: 'Bidding Results History', url: 'https://hu-my.sharepoint.com/:x:/g/personal/lilykang_hks_harvard_edu/EWo4fNnLBWBGuv1L9uhKLNMBpj4i25bA0BBWtGjQGkYMQw?e=WHVoc4', auth: 'HarvardKey' },
    ],
  },
  {
    group: 'Registration',
    links: [
      { label: 'my.harvard.edu', url: 'https://my.harvard.edu/', auth: null },
      { label: 'Course Registration', url: 'https://www.hks.harvard.edu/courses/course-registration', auth: null },
      { label: 'Academic Calendar', url: 'https://www.hks.harvard.edu/educational-programs/academic-calendars-policies/current-academic-calendar', auth: null },
      { label: 'Registrar', url: 'https://hub.hks.harvard.edu/s/article/Registrar-Contact-About-US', auth: 'HKS Hub' },
    ],
  },
  {
    group: 'Programs & Pathways',
    links: [
      { label: 'Degree Programs', url: 'https://hub.hks.harvard.edu/s/degree-programs', auth: 'HKS Hub' },
      { label: 'Certificate: MLDS', url: 'https://hub.hks.harvard.edu/s/article/Certificate-in-Management-Leadership-and-Decision-Sciences', auth: 'HKS Hub' },
      { label: 'Data & Research Pathway', url: 'https://hub.hks.harvard.edu/s/article/Data-and-Research-Methods-Pathway', auth: 'HKS Hub' },
    ],
  },
  {
    group: 'MIT Cross-Registration',
    links: [
      { label: 'How to Cross-Register', url: 'https://registrar.mit.edu/registration-academics/registration-information/cross-registration/harvard/instructions-harvard', auth: null },
      { label: 'MIT Course Catalog', url: 'https://student.mit.edu/catalog/extsearch.cgi', auth: null },
      { label: 'Hydrant (MIT Scheduler)', url: 'https://hydrant.mit.edu/', auth: null },
    ],
  },
]

function ResourcesSection() {
  const [open, setOpen] = useState(false)
  return (
    <div style={{ borderTop: '1px solid var(--line)', marginTop: 4 }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-4 py-3 transition-colors hover:bg-white/[0.03]"
      >
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--gold)' }}>
          🔗 HKS Resources
        </span>
        <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="px-3 pb-3 space-y-4">
          {HKS_RESOURCES.map((section) => (
            <div key={section.group}>
              <p style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--text-muted)', paddingLeft: 6, marginBottom: 3 }}>
                {section.group}
              </p>
              {section.links.map((link) => (
                <a
                  key={link.url}
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-between rounded-[10px] px-2.5 py-1.5 transition-colors hover:bg-white/5"
                  style={{ textDecoration: 'none' }}
                  title={link.auth ? `Requires ${link.auth}` : undefined}
                >
                  <span style={{ fontSize: 11.5, color: 'var(--text-soft)' }}>{link.label}</span>
                  <span style={{ fontSize: 9, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 3, flexShrink: 0, marginLeft: 6 }}>
                    {link.auth && <span title={`Requires ${link.auth}`}>🔒</span>}
                    <span style={{ opacity: 0.5 }}>↗</span>
                  </span>
                </a>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

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
                  className="flex items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold transition-all"
                  style={active
                    ? { background: 'var(--accent)', color: '#fff8f5', border: '1px solid transparent' }
                    : { border: '1px solid var(--line)', background: 'var(--panel-subtle)', color: 'var(--text-muted)' }}
                >
                  {TERM_LABELS[term]}
                  {active && <span style={{ fontSize: 9, opacity: 0.75 }}>✕</span>}
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
          <p className="mt-1.5 text-[10px] leading-tight" style={{ color: 'var(--text-muted)' }}>
            {metricMode === 'score'
              ? 'Avg rating ÷ 5 × 100% (absolute)'
              : 'Rank vs. all courses in dataset'}
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

      {/* HKS Resources */}
      <div className="mt-auto">
        <ResourcesSection />
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
            onClick={onReplayTour}
            className="mt-3 block text-xs transition-colors hover:text-label"
            style={{ color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
          >
            ↺ Replay tour
          </button>
        )}
      </div>
    </aside>
  )
}
