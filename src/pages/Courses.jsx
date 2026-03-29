import { useState, useMemo, useEffect } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'

const LABEL_COLOR = {
  Outstanding: '#22c55e',
  Excellent:   '#86efac',
  Good:        '#facc15',
  Average:     '#f97316',
  Poor:        '#ef4444',
}
const WORKLOAD_COLOR = {
  'Very Light': '#22c55e',
  Light:        '#86efac',
  Moderate:     '#facc15',
  Heavy:        '#f97316',
  'Very Heavy': '#ef4444',
}

function pct(v) {
  return v != null ? `${Math.round(v)}%` : '—'
}

function getConc(code) {
  const m = code?.match(/^([A-Z]+)/)
  return m ? m[1] : 'Other'
}

function MetricRow({ label, value, higherBetter = true }) {
  if (value == null) return null
  const pctVal = Math.round(value)
  const barColor = higherBetter
    ? pctVal >= 75 ? '#22c55e' : pctVal >= 50 ? '#facc15' : '#ef4444'
    : pctVal <= 25 ? '#22c55e' : pctVal <= 50 ? '#facc15' : '#ef4444'

  return (
    <div className="mb-2">
      <div className="flex justify-between text-xs mb-0.5">
        <span className="text-muted">{label}</span>
        <span className="text-label font-medium">{pctVal}%</span>
      </div>
      <div className="w-full rounded-full h-1.5" style={{ background: '#2a2a3e' }}>
        <div
          className="h-1.5 rounded-full transition-all"
          style={{ width: `${pctVal}%`, background: barColor }}
        />
      </div>
    </div>
  )
}

function HistoryTable({ history }) {
  if (!history.length) return (
    <div
      className="py-8 text-center rounded-lg"
      style={{ background: '#1a1a28', border: '1px solid #2a2a3e' }}
    >
      <p className="text-muted text-sm">No historical evaluation data found for this course.</p>
    </div>
  )

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr style={{ borderBottom: '1px solid #2a2a3e' }}>
            {['Year', 'Term', 'Professor', 'Instructor %', 'Course %', 'Workload %', 'Rigor %', 'Diverse Persp. %', 'N'].map(h => (
              <th key={h} className="text-left py-1.5 pr-4 text-muted font-medium whitespace-nowrap">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {history.map((r, i) => (
            <tr key={i} style={{ borderBottom: '1px solid #1a1a28' }}>
              <td className="py-1.5 pr-4 text-label">{r.year}</td>
              <td className="py-1.5 pr-4 text-muted">{r.term}</td>
              <td className="py-1.5 pr-4 text-label">{r.professor_display || r.professor}</td>
              <td className="py-1.5 pr-4 font-medium" style={{ color: '#38bdf8' }}>
                {pct(r.metrics_pct?.Instructor_Rating)}
              </td>
              <td className="py-1.5 pr-4 text-label">{pct(r.metrics_pct?.Course_Rating)}</td>
              <td className="py-1.5 pr-4 text-label">{pct(r.metrics_pct?.Workload)}</td>
              <td className="py-1.5 pr-4 text-label">{pct(r.metrics_pct?.Rigor)}</td>
              <td className="py-1.5 pr-4 text-label">{pct(r.metrics_pct?.['Diverse Perspectives'])}</td>
              <td className="py-1.5 pr-4 text-muted">{r.n_respondents ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function CopyButton({ text }) {
  const [copied, setCopied] = useState(false)
  const handleCopy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }
  return (
    <button
      onClick={handleCopy}
      className="ml-2 text-xs px-2 py-0.5 rounded transition-colors"
      style={{
        background: copied ? '#1e3a22' : '#1a1a28',
        color: copied ? '#4ade80' : '#8888aa',
        border: '1px solid #2a2a3e',
      }}
    >
      {copied ? '✓ Copied' : '📋 Copy'}
    </button>
  )
}

// ── Filter sidebar ────────────────────────────────────────────────────────────

const TERM_LABELS = { Fall: 'Fall', Spring: 'Spring', January: 'Jan' }

function FilterSidebar({ filters, setFilters, meta }) {
  const update = (patch) => setFilters(f => ({ ...f, ...patch }))

  const toggleTerm = (term) => {
    const next = filters.terms.includes(term)
      ? filters.terms.filter(t => t !== term)
      : [...filters.terms, term]
    if (next.length > 0) update({ terms: next })
  }

  const reset = () => setFilters({
    year: 'all',
    terms: ['Fall', 'Spring', 'January'],
    concentration: 'All',
    coreFilter: 'all',
    isStemOnly: false,
    gender: 'all',
    minInstructorPct: 'any',
    evalOnly: false,
  })

  // Count active filters
  let activeCount = 0
  if (filters.year !== 'all') activeCount++
  if (filters.concentration !== 'All') activeCount++
  if (filters.coreFilter !== 'all') activeCount++
  if (filters.isStemOnly) activeCount++
  if (filters.gender !== 'all') activeCount++
  if (filters.minInstructorPct !== 'any') activeCount++
  if (filters.evalOnly) activeCount++
  if (filters.year !== 'all') {
    const allTerms = ['Fall', 'Spring', 'January']
    if (filters.terms.length !== 3 || !allTerms.every(t => filters.terms.includes(t))) activeCount++
  }

  return (
    <aside
      className="flex flex-col gap-0 overflow-y-auto shrink-0"
      style={{ width: 220, background: '#151521', borderRight: '1px solid #2a2a3e' }}
    >
      <div className="px-4 pt-4 pb-3">
        <div className="flex items-center gap-2">
          <p className="text-xs font-semibold text-red-400">🎯 Filter Courses</p>
          {activeCount > 0 && (
            <span className="filter-badge">{activeCount} active</span>
          )}
        </div>
      </div>

      {/* Year */}
      <div className="px-4 py-3 filter-section">
        <label className="filter-label block mb-1">Year:</label>
        <div className="select-wrap">
          <select value={filters.year} onChange={e => update({ year: e.target.value === 'all' ? 'all' : parseInt(e.target.value) })}>
            <option value="all">All Years</option>
            {[...meta.years].reverse().map(y => (
              <option key={y} value={y}>{y === 2026 ? `🔥 ${y} — Bidding` : y}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Terms (only if year is selected) */}
      {filters.year !== 'all' && (
        <div className="px-4 py-3 filter-section">
          <div className="flex items-center justify-between mb-2">
            <label className="filter-label">Term:</label>
            <button
              onClick={() => update({ terms: ['Fall', 'Spring', 'January'] })}
              className="text-[10px] text-muted hover:text-label"
            >All</button>
          </div>
          <div className="flex flex-wrap gap-1">
            {meta.terms.map(t => {
              const active = filters.terms.includes(t)
              return (
                <button
                  key={t}
                  onClick={() => toggleTerm(t)}
                  className={`flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-colors ${
                    active ? 'bg-red-600 text-white' : 'bg-[#1a1a28] text-muted border border-[#2a2a3e] hover:border-red-600'
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

      {/* Concentration */}
      <div className="px-4 py-3 filter-section">
        <label className="filter-label block mb-1">Concentration:</label>
        <div className="select-wrap">
          <select value={filters.concentration} onChange={e => update({ concentration: e.target.value })}>
            <option value="All">All</option>
            {meta.concentrations.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
      </div>

      {/* Core */}
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

      {/* Min Instructor Rating */}
      <div className="px-4 py-3 filter-section">
        <label className="filter-label block mb-1">Min Instructor Rating:</label>
        <div className="select-wrap">
          <select value={filters.minInstructorPct} onChange={e => update({ minInstructorPct: e.target.value })}>
            <option value="any">Any</option>
            <option value="75">Top 25% (≥75th pct)</option>
            <option value="50">Top 50% (≥50th pct)</option>
            <option value="25">Top 75% (≥25th pct)</option>
          </select>
        </div>
      </div>

      {/* Gender */}
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

      {/* Toggles */}
      <div className="px-4 py-3 filter-section flex flex-col gap-2.5">
        <div className="flex items-center gap-2">
          <input type="checkbox" id="cs-stem" checked={filters.isStemOnly}
            onChange={e => update({ isStemOnly: e.target.checked })}
            className="accent-accent w-3.5 h-3.5 cursor-pointer" />
          <label htmlFor="cs-stem" className="text-xs text-label cursor-pointer">Only STEM</label>
        </div>
        <div className="flex items-center gap-2">
          <input type="checkbox" id="cs-eval" checked={filters.evalOnly}
            onChange={e => update({ evalOnly: e.target.checked })}
            className="accent-accent w-3.5 h-3.5 cursor-pointer" />
          <label htmlFor="cs-eval" className="text-xs text-label cursor-pointer">Only with evals</label>
        </div>
      </div>

      {/* Reset */}
      <div className="px-4 py-3 filter-section">
        <button
          onClick={reset}
          className="w-full py-2 text-xs rounded border border-[#2a2a3e] text-muted hover:text-label hover:border-label transition-colors"
        >
          🔄 Reset Filters
        </button>
      </div>
    </aside>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function Courses({ courses, meta }) {
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()

  const [query, setQuery]         = useState('')
  const [selectedId, setSelectedId] = useState(searchParams.get('id') || null)
  const [activeTab, setActiveTab] = useState('details')
  const [descOpen, setDescOpen]   = useState(false)

  const [filters, setFilters] = useState({
    year: 'all',
    terms: ['Fall', 'Spring', 'January'],
    concentration: 'All',
    coreFilter: 'all',
    isStemOnly: false,
    gender: 'all',
    minInstructorPct: 'any',
    evalOnly: false,
  })

  // Sync URL param → selectedId
  useEffect(() => {
    const id = searchParams.get('id')
    if (id) { setSelectedId(id); setActiveTab('details') }
  }, [searchParams])

  useEffect(() => {
    document.title = 'HKS Course Explorer'
  }, [])

  // All unique course_code_base options (one per base, most recent)
  const allOptions = useMemo(() => {
    const map = new Map()
    for (const c of courses) {
      const key = c.course_code_base
      if (!map.has(key) || (c.year || 0) > (map.get(key).year || 0)) {
        map.set(key, c)
      }
    }
    return [...map.values()].sort((a, b) =>
      (a.course_name || a.course_code).localeCompare(b.course_name || b.course_code)
    )
  }, [courses])

  // Apply sidebar filters to options list
  const filteredOptions = useMemo(() => {
    const minPct = filters.minInstructorPct !== 'any' ? parseFloat(filters.minInstructorPct) : null

    let list = allOptions.filter(c => {
      if (filters.year !== 'all') {
        // Check if this course has a row in the selected year
        // The allOptions entry is the most recent, so check via courses array
        const hasYear = courses.some(r =>
          r.course_code_base === c.course_code_base &&
          r.year === filters.year &&
          filters.terms.includes(r.term)
        )
        if (!hasYear) return false
      }
      if (filters.concentration !== 'All' && getConc(c.course_code) !== filters.concentration) return false
      if (filters.coreFilter === 'core'    && !c.is_core)  return false
      if (filters.coreFilter === 'no-core' &&  c.is_core)  return false
      if (filters.isStemOnly && !c.is_stem)                return false
      if (filters.gender !== 'all' && c.gender != null && c.gender !== filters.gender) return false
      if (minPct !== null) {
        const ip = c.metrics_pct?.Instructor_Rating
        if (ip != null && ip < minPct) return false
      }
      if (filters.evalOnly && !c.has_eval) return false
      return true
    })

    if (!query) return list.slice(0, 100)
    const q = query.toLowerCase()
    return list
      .filter(c =>
        (c.course_name || '').toLowerCase().includes(q) ||
        (c.course_code || '').toLowerCase().includes(q) ||
        (c.professor_display || '').toLowerCase().includes(q)
      )
      .slice(0, 100)
  }, [allOptions, query, filters, courses])

  // Top 5 by bid price for "no selection" state
  const topByBidding = useMemo(() =>
    allOptions
      .filter(c => c.last_bid_price != null)
      .sort((a, b) => (b.last_bid_price || 0) - (a.last_bid_price || 0))
      .slice(0, 5),
    [allOptions]
  )

  // Selected course detail
  const selected = useMemo(() => {
    if (!selectedId) return null
    let c = courses.find(x => x.id === selectedId)
    if (!c) {
      const base = selectedId.split('||')[0]
      c = courses
        .filter(x => x.course_code_base === base || x.course_code === base)
        .sort((a, b) => (b.year || 0) - (a.year || 0))[0]
    }
    return c || null
  }, [selectedId, courses])

  const history = useMemo(() => {
    if (!selected) return []
    return courses
      .filter(c => c.course_code_base === selected.course_code_base && c.has_eval)
      .sort((a, b) => (b.year || 0) - (a.year || 0) || (a.term || '').localeCompare(b.term || ''))
  }, [selected, courses])

  const biddingHistory = useMemo(() => {
    if (!selected) return []
    return courses
      .filter(c => c.course_code_base === selected.course_code_base && c.has_bidding)
      .sort((a, b) => (b.year || 0) - (a.year || 0))
  }, [selected, courses])

  const handleSelect = (course) => {
    setSelectedId(course.id)
    setSearchParams({ id: course.id })
    setActiveTab('details')
    setDescOpen(false)
    setQuery('')
  }

  const instrPct = selected?.metrics_pct?.Instructor_Rating
  const workPct  = selected?.metrics_pct?.Workload
  const instrLbl = selected?.instructor_label
  const workLbl  = selected?.workload_label

  return (
    <div className="flex h-full overflow-hidden">

      {/* ── Filter sidebar ── */}
      <FilterSidebar filters={filters} setFilters={setFilters} meta={meta} />

      {/* ── Main content ── */}
      <main className="flex-1 overflow-y-auto px-8 py-6 max-w-4xl">
        <h2 className="text-xl font-bold text-white mb-4">📋 Course Explorer</h2>

        {/* Search box */}
        <div className="mb-4 relative">
          <label className="text-xs text-muted block mb-1">Search by course or instructor</label>
          <input
            type="text"
            value={selected && !query
              ? `${selected.course_code}: ${selected.course_name} — ${selected.professor_display}`
              : query}
            placeholder="Start typing a course name, code, or instructor…"
            onChange={e => { setQuery(e.target.value); setSelectedId(null) }}
            className="w-full"
          />
          {query && (
            <div
              className="absolute z-50 w-full mt-1 rounded-lg overflow-y-auto shadow-xl"
              style={{ background: '#1a1a28', border: '1px solid #2a2a3e', maxHeight: 300 }}
            >
              {filteredOptions.length === 0 ? (
                <p className="px-4 py-3 text-xs text-muted">No results for "{query}"</p>
              ) : filteredOptions.map(c => (
                <button
                  key={c.id}
                  onClick={() => handleSelect(c)}
                  className="w-full text-left px-4 py-2 text-xs hover:bg-[#2a2a3e] transition-colors"
                >
                  <span style={{ color: '#38bdf8' }}>{c.course_code}</span>
                  <span className="text-label ml-2">{c.course_name}</span>
                  <span className="text-muted ml-2">— {c.professor_display}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* ── No selection ── */}
        {!selected && (
          <div>
            <p className="text-xs text-muted mb-4">
              Search or filter above to find a course, then click to see full details.
            </p>
            {topByBidding.length > 0 && (
              <div className="rounded-lg p-4" style={{ background: '#1a1a28', border: '1px solid #2a2a3e' }}>
                <p className="text-xs font-semibold text-muted uppercase tracking-wider mb-3">
                  🏷 Most Competitive Courses (by last bid price)
                </p>
                <div className="flex flex-col gap-2">
                  {topByBidding.map((c, i) => (
                    <button
                      key={c.id}
                      onClick={() => handleSelect(c)}
                      className="flex items-center justify-between text-left px-3 py-2 rounded transition-colors hover:bg-[#2a2a3e]"
                      style={{ background: '#13131f' }}
                    >
                      <div>
                        <span className="text-xs font-bold mr-2" style={{ color: '#38bdf8' }}>
                          #{i+1} {c.course_code}
                        </span>
                        <span className="text-xs text-label">{c.course_name}</span>
                        <span className="text-xs text-muted ml-2">— {c.professor_display}</span>
                      </div>
                      <span className="text-xs font-bold px-2 py-0.5 rounded ml-4 shrink-0"
                        style={{ background: '#1e3a52', color: '#38bdf8' }}>
                        {c.last_bid_price} pts
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Course detail ── */}
        {selected && (
          <>
            <div className="flex gap-4 text-xs text-muted mb-4 flex-wrap">
              <span>👁 {history.length} historical record{history.length !== 1 ? 's' : ''}</span>
              {biddingHistory.length > 0 && (
                <span>🏷 {biddingHistory.length} bidding record{biddingHistory.length !== 1 ? 's' : ''}</span>
              )}
              {selected.n_respondents != null && (
                <span>👥 N={selected.n_respondents} respondents</span>
              )}
            </div>

            {/* Tabs */}
            <div className="flex gap-1 mb-5 border-b border-[#2a2a3e]">
              {[
                { key: 'details',     label: '📊 Course Details' },
                { key: 'performance', label: '📈 Past Performance' },
                { key: 'bidding',     label: '🏷 Bidding History' },
              ].map(tab => (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  className={`px-4 py-2 text-sm transition-colors ${
                    activeTab === tab.key ? 'text-white -mb-px' : 'text-muted hover:text-label'
                  }`}
                  style={activeTab === tab.key ? { borderBottom: '2px solid #38bdf8' } : undefined}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* ── DETAILS TAB ── */}
            {activeTab === 'details' && (
              <div className="grid grid-cols-2 gap-4">
                {/* Left: Course Info */}
                <div className="rounded-lg p-4" style={{ background: '#1a1a28', border: '1px solid #2a2a3e' }}>
                  <h4 className="text-xs font-semibold text-muted uppercase tracking-wider mb-3">
                    Course Information
                  </h4>
                  {selected.stem_school && (
                    <div className="mb-2">
                      <p className="text-[10px] text-muted uppercase tracking-wider">Academic Area</p>
                      <p className="text-sm text-label">{selected.stem_school}</p>
                    </div>
                  )}
                  <div className="mb-2">
                    <p className="text-[10px] text-muted uppercase tracking-wider">Course Details</p>
                    <div className="flex items-center flex-wrap gap-1 mt-0.5">
                      <span className="text-sm font-bold" style={{ color: '#38bdf8' }}>
                        {selected.course_code}
                      </span>
                      <CopyButton text={selected.course_code_base || selected.course_code} />
                      {selected.term && <span className="text-xs text-muted">• {selected.term}</span>}
                      {selected.is_stem && (
                        <span className="text-xs font-bold px-1.5 py-0.5 rounded"
                          style={{ background: '#1e3a52', color: '#38bdf8', fontSize: 10 }}>STEM</span>
                      )}
                      {selected.is_core && (
                        <span className="text-xs font-bold px-1.5 py-0.5 rounded"
                          style={{ background: '#2a1f0e', color: '#f59e0b', fontSize: 10 }}>Core</span>
                      )}
                    </div>
                  </div>
                  {selected.professor_display && (
                    <div className="mb-2">
                      <p className="text-[10px] text-muted uppercase tracking-wider">Instructor</p>
                      <button
                        onClick={() => navigate(`/faculty?prof=${encodeURIComponent(selected.professor)}`)}
                        className="text-sm hover:underline"
                        style={{ color: '#93c5fd' }}
                      >
                        {selected.professor_display}
                      </button>
                      {selected.faculty_title && (
                        <p className="text-xs text-muted">{selected.faculty_title}</p>
                      )}
                      {selected.faculty_category && (
                        <p className="text-xs text-muted">{selected.faculty_category}</p>
                      )}
                    </div>
                  )}
                  {selected.last_bid_price != null && (
                    <div className="mt-3 pt-3 border-t border-[#2a2a3e]">
                      <p className="text-[10px] text-muted uppercase tracking-wider mb-1">
                        Last Bid ({selected.last_bid_acad} {selected.last_bid_term})
                      </p>
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-muted">Clearing Price</span>
                        <span className="text-sm font-bold px-2 py-0.5 rounded"
                          style={{ background: '#1e3a52', color: '#38bdf8' }}>
                          {selected.last_bid_price} pts
                        </span>
                      </div>
                      {selected.last_bid_capacity != null && (
                        <div className="flex items-center justify-between mt-1">
                          <span className="text-xs text-muted">Capacity</span>
                          <span className="text-xs text-label">{selected.last_bid_capacity}</span>
                        </div>
                      )}
                      {selected.last_bid_n_bids != null && (
                        <div className="flex items-center justify-between mt-1">
                          <span className="text-xs text-muted">Bids</span>
                          <span className="text-xs text-label">{selected.last_bid_n_bids}</span>
                        </div>
                      )}
                      {selected.last_bid_n_bids != null && selected.last_bid_capacity != null && selected.last_bid_n_bids > selected.last_bid_capacity && (
                        <div className="flex items-center justify-between mt-1">
                          <span className="text-xs text-muted">Oversubscribed by</span>
                          <span className="text-xs font-medium" style={{ color: '#f97316' }}>
                            +{selected.last_bid_n_bids - selected.last_bid_capacity} students
                          </span>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Right: Student Experience */}
                <div className="rounded-lg p-4" style={{ background: '#1a1a28', border: '1px solid #2a2a3e' }}>
                  <h4 className="text-xs font-semibold text-muted uppercase tracking-wider mb-3">
                    Student Experience
                  </h4>
                  {instrPct != null ? (
                    <div className="mb-4 p-3 rounded" style={{ background: '#13131f' }}>
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="text-sm">🟢</span>
                        <span className="text-xs text-muted">Instructor Rating</span>
                      </div>
                      <p className="text-base font-bold" style={{ color: LABEL_COLOR[instrLbl] || '#38bdf8' }}>
                        {instrLbl}
                      </p>
                      <p className="text-xs text-muted">Better than {Math.round(instrPct)}% of courses</p>
                    </div>
                  ) : (
                    <div className="mb-4 p-3 rounded"
                      style={{ background: '#13131f', color: '#5a5a7a', fontStyle: 'italic', fontSize: 12 }}>
                      No instructor rating data available
                    </div>
                  )}
                  {workPct != null ? (
                    <div className="p-3 rounded" style={{ background: '#13131f' }}>
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="text-sm">⚪</span>
                        <span className="text-xs text-muted">Course Workload</span>
                      </div>
                      <p className="text-base font-bold" style={{ color: WORKLOAD_COLOR[workLbl] || '#c0c0d8' }}>
                        {workLbl}
                      </p>
                      <p className="text-xs text-muted">More intensive than {Math.round(workPct)}% of courses</p>
                    </div>
                  ) : (
                    <div className="p-3 rounded"
                      style={{ background: '#13131f', color: '#5a5a7a', fontStyle: 'italic', fontSize: 12 }}>
                      No workload data available
                    </div>
                  )}
                </div>

                {/* Full-width: all metrics */}
                <div className="col-span-2 rounded-lg p-4" style={{ background: '#1a1a28', border: '1px solid #2a2a3e' }}>
                  <h4 className="text-xs font-semibold text-muted uppercase tracking-wider mb-3">
                    All Evaluation Metrics (global percentile)
                  </h4>
                  {selected.has_eval ? (
                    <div className="grid grid-cols-2 gap-x-8">
                      {meta.metrics.map(m => (
                        <MetricRow
                          key={m.key}
                          label={m.label}
                          value={selected.metrics_pct?.[m.key]}
                          higherBetter={m.higher_is_better}
                        />
                      ))}
                    </div>
                  ) : (
                    <div className="py-6 text-center">
                      <p className="text-muted text-sm">No evaluation data available for this course.</p>
                      {selected.has_bidding && (
                        <p className="text-xs text-muted mt-1">This course has bidding data — check the Bidding History tab.</p>
                      )}
                    </div>
                  )}
                </div>

                {/* Course website + description */}
                <div className="col-span-2">
                  {selected.course_url && (
                    <div className="mb-4">
                      <a
                        href={selected.course_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-block px-6 py-2 rounded text-sm font-medium text-white transition-all hover:opacity-90"
                        style={{ background: '#2563eb' }}
                      >
                        🌐 Course Website
                      </a>
                    </div>
                  )}
                  {selected.description && (
                    <div className="rounded-lg overflow-hidden" style={{ border: '1px solid #2a2a3e' }}>
                      <button
                        onClick={() => setDescOpen(o => !o)}
                        className="w-full flex items-center justify-between px-4 py-3 text-sm text-label"
                        style={{ background: '#1a1a28' }}
                      >
                        <span>📖 Course Description</span>
                        <span>{descOpen ? '▲' : '▼'}</span>
                      </button>
                      {descOpen && (
                        <div className="px-4 py-3 text-sm text-muted leading-relaxed" style={{ background: '#13131f' }}>
                          {selected.description}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ── PAST PERFORMANCE TAB ── */}
            {activeTab === 'performance' && (
              <div>
                {history.length === 0 ? (
                  <div className="py-8 text-center rounded-lg" style={{ background: '#1a1a28', border: '1px solid #2a2a3e' }}>
                    <p className="text-muted text-sm">No evaluation history found for this course.</p>
                  </div>
                ) : (
                  <>
                    <p className="text-xs text-muted mb-4">
                      Showing all {history.length} evaluation record{history.length !== 1 ? 's' : ''} for{' '}
                      <span style={{ color: '#38bdf8' }}>{selected.course_code_base}</span>.
                      Percentiles are global (computed across all courses all years).
                    </p>
                    <HistoryTable history={history} />
                  </>
                )}
              </div>
            )}

            {/* ── BIDDING HISTORY TAB ── */}
            {activeTab === 'bidding' && (
              <div>
                <p className="text-xs text-muted mb-4">
                  Bidding history for{' '}
                  <span style={{ color: '#38bdf8' }}>{selected.course_code_base}</span>
                  {' '}({biddingHistory.length} record{biddingHistory.length !== 1 ? 's' : ''})
                </p>
                {biddingHistory.length === 0 ? (
                  <div className="py-8 text-center rounded-lg" style={{ background: '#1a1a28', border: '1px solid #2a2a3e' }}>
                    <p className="text-muted text-sm">This course has no bidding records.</p>
                    <p className="text-xs text-muted mt-1">It was not offered through the bidding system in any recorded year.</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr style={{ borderBottom: '1px solid #2a2a3e' }}>
                          {['Year', 'Term', 'Instructor', 'Clearing Price', 'Capacity', 'Bids', 'Oversubscribed by'].map(h => (
                            <th key={h} className="text-left py-1.5 pr-4 text-muted font-medium whitespace-nowrap">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {biddingHistory.map((r, i) => {
                          const over = (r.bid_n_bids != null && r.bid_capacity != null && r.bid_n_bids > r.bid_capacity)
                            ? r.bid_n_bids - r.bid_capacity : null
                          return (
                            <tr key={i} style={{ borderBottom: '1px solid #1a1a28' }}>
                              <td className="py-1.5 pr-4 text-label">{r.year}</td>
                              <td className="py-1.5 pr-4 text-muted">{r.term}</td>
                              <td className="py-1.5 pr-4 text-label">
                                <button
                                  onClick={() => navigate(`/faculty?prof=${encodeURIComponent(r.professor)}`)}
                                  className="hover:underline"
                                  style={{ color: '#93c5fd' }}
                                >
                                  {r.professor_display || r.professor}
                                </button>
                              </td>
                              <td className="py-1.5 pr-4 font-medium" style={{ color: '#38bdf8' }}>
                                {r.bid_clearing_price != null ? `${r.bid_clearing_price} pts` : '—'}
                              </td>
                              <td className="py-1.5 pr-4 text-label">{r.bid_capacity ?? '—'}</td>
                              <td className="py-1.5 pr-4 text-label">{r.bid_n_bids ?? '—'}</td>
                              <td className="py-1.5 pr-4">
                                {over != null
                                  ? <span className="font-medium" style={{ color: '#f97316' }}>+{over}</span>
                                  : <span className="text-muted">—</span>}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </>
        )}

        <div className="app-footer mt-8">
          Data from HKS QReports · {new Date().getFullYear()}
        </div>
      </main>
    </div>
  )
}
