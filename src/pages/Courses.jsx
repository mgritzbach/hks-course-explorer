import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'

const LABEL_COLOR = { Outstanding: '#22c55e', Excellent: '#86efac', Good: '#facc15', Average: '#f97316', Poor: '#ef4444' }
const WORKLOAD_COLOR = { 'Very Light': '#22c55e', Light: '#86efac', Moderate: '#facc15', Heavy: '#f97316', 'Very Heavy': '#ef4444' }
const TERM_LABELS = { Fall: 'Fall', Spring: 'Spring', January: 'Jan' }
const ALL_TERMS = ['Fall', 'Spring', 'January']

function pct(value) { return value != null ? `${Math.round(value)}%` : '-' }
function getConcentration(code) { const match = code?.match(/^([A-Z]+)/); return match ? match[1] : 'Other' }

function MetricRow({ label, value, higherBetter = true }) {
  if (value == null) return null
  const rounded = Math.round(value)
  const color = higherBetter ? (rounded >= 75 ? '#22c55e' : rounded >= 50 ? '#facc15' : '#ef4444') : (rounded <= 25 ? '#22c55e' : rounded <= 50 ? '#facc15' : '#ef4444')
  return (
    <div className="mb-2">
      <div className="mb-1 flex justify-between text-xs"><span className="text-muted">{label}</span><span className="font-medium text-label">{rounded}%</span></div>
      <div className="h-1.5 w-full rounded-full" style={{ background: '#2a2a3e' }}><div className="h-1.5 rounded-full" style={{ width: `${rounded}%`, background: color }} /></div>
    </div>
  )
}

function HistoryTable({ history }) {
  if (!history.length) return <div className="rounded-lg py-8 text-center" style={{ background: '#1a1a28', border: '1px solid #2a2a3e' }}><p className="text-sm text-muted">No historical evaluation data found for this course.</p></div>
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead><tr style={{ borderBottom: '1px solid #2a2a3e' }}>{['Year', 'Term', 'Professor', 'Instructor %', 'Course %', 'Workload %', 'Rigor %', 'Diverse Persp. %', 'N'].map((h) => <th key={h} className="whitespace-nowrap py-2 pr-4 text-left font-medium text-muted">{h}</th>)}</tr></thead>
        <tbody>{history.map((row, i) => <tr key={i} style={{ borderBottom: '1px solid #1a1a28' }}><td className="py-2 pr-4 text-label">{row.year}</td><td className="py-2 pr-4 text-muted">{row.term}</td><td className="py-2 pr-4 text-label">{row.professor_display || row.professor}</td><td className="py-2 pr-4 font-medium" style={{ color: '#38bdf8' }}>{pct(row.metrics_pct?.Instructor_Rating)}</td><td className="py-2 pr-4 text-label">{pct(row.metrics_pct?.Course_Rating)}</td><td className="py-2 pr-4 text-label">{pct(row.metrics_pct?.Workload)}</td><td className="py-2 pr-4 text-label">{pct(row.metrics_pct?.Rigor)}</td><td className="py-2 pr-4 text-label">{pct(row.metrics_pct?.['Diverse Perspectives'])}</td><td className="py-2 pr-4 text-muted">{row.n_respondents ?? '-'}</td></tr>)}</tbody>
      </table>
    </div>
  )
}

function CopyButton({ text }) {
  const [copied, setCopied] = useState(false)
  return <button onClick={() => navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000) })} className="ml-2 rounded border border-[#2a2a3e] px-2 py-0.5 text-xs transition-colors" style={{ background: copied ? '#1e3a22' : '#1a1a28', color: copied ? '#4ade80' : '#8888aa' }}>{copied ? 'Copied' : 'Copy'}</button>
}

function activeFilterCount(filters) {
  let count = 0
  if (filters.year !== 'all') count++
  if (filters.concentration !== 'All') count++
  if (filters.coreFilter !== 'all') count++
  if (filters.isStemOnly) count++
  if (filters.gender !== 'all') count++
  if (filters.minInstructorPct !== 'any') count++
  if (filters.evalOnly) count++
  if (filters.year !== 'all' && (filters.terms.length !== ALL_TERMS.length || !ALL_TERMS.every((t) => filters.terms.includes(t)))) count++
  return count
}

function FilterSidebar({ filters, setFilters, meta, mobile = false, onClose = null }) {
  const update = (patch) => setFilters((current) => ({ ...current, ...patch }))
  const reset = () => setFilters({ year: 'all', terms: [...ALL_TERMS], concentration: 'All', coreFilter: 'all', isStemOnly: false, gender: 'all', minInstructorPct: 'any', evalOnly: false })
  const toggleTerm = (term) => { const next = filters.terms.includes(term) ? filters.terms.filter((item) => item !== term) : [...filters.terms, term]; if (next.length > 0) update({ terms: next }) }
  return (
    <aside className="flex h-full flex-col overflow-y-auto shrink-0" style={{ width: mobile ? '100%' : 228, background: '#151521', borderRight: '1px solid #2a2a3e' }}>
      <div className="px-4 pb-3 pt-4"><div className="flex items-center justify-between gap-3"><div className="flex items-center gap-2"><p className="text-xs font-semibold text-red-400">Filter Courses</p>{activeFilterCount(filters) > 0 && <span className="filter-badge">{activeFilterCount(filters)} active</span>}</div>{mobile && onClose && <button onClick={onClose} className="rounded-full border border-[#2a2a3e] px-2 py-1 text-[11px] text-muted hover:text-white">Close</button>}</div></div>
      <div className="filter-section px-4 py-3"><label className="filter-label mb-1 block">Year:</label><div className="select-wrap"><select value={filters.year} onChange={(event) => update({ year: event.target.value === 'all' ? 'all' : parseInt(event.target.value, 10) })}><option value="all">All Years</option>{[...meta.years].reverse().map((year) => <option key={year} value={year}>{year === 2026 ? `${year} - Bidding` : year}</option>)}</select></div></div>
      {filters.year !== 'all' && <div className="filter-section px-4 py-3"><div className="mb-2 flex items-center justify-between"><label className="filter-label">Term:</label><button onClick={() => update({ terms: [...ALL_TERMS] })} className="text-[10px] text-muted hover:text-label">All</button></div><div className="flex flex-wrap gap-1">{meta.terms.map((term) => { const active = filters.terms.includes(term); return <button key={term} onClick={() => toggleTerm(term)} className={`flex items-center gap-1 rounded px-2 py-1 text-xs font-medium transition-colors ${active ? 'bg-red-600 text-white' : 'border border-[#2a2a3e] bg-[#1a1a28] text-muted hover:border-red-600'}`}>{TERM_LABELS[term]}{active && <span className="text-[10px] leading-none">x</span>}</button> })}</div></div>}
      <div className="filter-section px-4 py-3"><label className="filter-label mb-1 block">Concentration:</label><div className="select-wrap"><select value={filters.concentration} onChange={(event) => update({ concentration: event.target.value })}><option value="All">All</option>{meta.concentrations.map((c) => <option key={c} value={c}>{c}</option>)}</select></div></div>
      <div className="filter-section px-4 py-3"><label className="filter-label mb-1 block">Core Courses:</label><div className="select-wrap"><select value={filters.coreFilter} onChange={(event) => update({ coreFilter: event.target.value })}><option value="all">Show All</option><option value="core">Core Only</option><option value="no-core">No Core</option></select></div></div>
      <div className="filter-section px-4 py-3"><label className="filter-label mb-1 block">Min Instructor Rating:</label><div className="select-wrap"><select value={filters.minInstructorPct} onChange={(event) => update({ minInstructorPct: event.target.value })}><option value="any">Any</option><option value="75">Top 25% (&gt;=75th pct)</option><option value="50">Top 50% (&gt;=50th pct)</option><option value="25">Top 75% (&gt;=25th pct)</option></select></div></div>
      <div className="filter-section px-4 py-3"><label className="filter-label mb-1 block">Instructor Gender:</label><div className="select-wrap"><select value={filters.gender} onChange={(event) => update({ gender: event.target.value })}><option value="all">All</option><option value="M">Male instructors</option><option value="F">Female instructors</option></select></div></div>
      <div className="filter-section flex flex-col gap-2.5 px-4 py-3"><label className="flex items-center gap-2 text-xs text-label"><input type="checkbox" checked={filters.isStemOnly} onChange={(event) => update({ isStemOnly: event.target.checked })} className="h-3.5 w-3.5 cursor-pointer accent-accent" />Only STEM</label><label className="flex items-center gap-2 text-xs text-label"><input type="checkbox" checked={filters.evalOnly} onChange={(event) => update({ evalOnly: event.target.checked })} className="h-3.5 w-3.5 cursor-pointer accent-accent" />Only with evals</label></div>
      <div className="filter-section px-4 py-3"><button onClick={reset} className="w-full rounded border border-[#2a2a3e] py-2 text-xs text-muted hover:border-label hover:text-label">Reset Filters</button></div>
    </aside>
  )
}

export default function Courses({ courses, meta }) {
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState(searchParams.get('id') || null)
  const [activeTab, setActiveTab] = useState('details')
  const [descOpen, setDescOpen] = useState(false)
  const [filterOpen, setFilterOpen] = useState(false)
  const [filters, setFilters] = useState({ year: 'all', terms: [...ALL_TERMS], concentration: 'All', coreFilter: 'all', isStemOnly: false, gender: 'all', minInstructorPct: 'any', evalOnly: false })

  useEffect(() => { const id = searchParams.get('id'); if (id) { setSelectedId(id); setActiveTab('details') } }, [searchParams])
  useEffect(() => { document.title = 'HKS Course Explorer' }, [])

  const allOptions = useMemo(() => {
    const map = new Map()
    for (const course of courses) { const key = course.course_code_base; if (!map.has(key) || (course.year || 0) > (map.get(key).year || 0)) map.set(key, course) }
    return [...map.values()].sort((a, b) => (a.course_name || a.course_code).localeCompare(b.course_name || b.course_code))
  }, [courses])

  const filteredOptions = useMemo(() => {
    const minPct = filters.minInstructorPct !== 'any' ? parseFloat(filters.minInstructorPct) : null
    let list = allOptions.filter((course) => {
      if (filters.year !== 'all') {
        const hasYear = courses.some((row) => row.course_code_base === course.course_code_base && row.year === filters.year && filters.terms.includes(row.term))
        if (!hasYear) return false
      }
      if (filters.concentration !== 'All' && getConcentration(course.course_code) !== filters.concentration) return false
      if (filters.coreFilter === 'core' && !course.is_core) return false
      if (filters.coreFilter === 'no-core' && course.is_core) return false
      if (filters.isStemOnly && !course.is_stem) return false
      if (filters.gender !== 'all' && course.gender != null && course.gender !== filters.gender) return false
      if (minPct !== null) { const rating = course.metrics_pct?.Instructor_Rating; if (rating != null && rating < minPct) return false }
      if (filters.evalOnly && !course.has_eval) return false
      return true
    })
    if (!query) return list.slice(0, 100)
    const normalized = query.toLowerCase()
    return list.filter((course) => (course.course_name || '').toLowerCase().includes(normalized) || (course.course_code || '').toLowerCase().includes(normalized) || (course.professor_display || '').toLowerCase().includes(normalized)).slice(0, 100)
  }, [allOptions, courses, filters, query])

  const topByBidding = useMemo(() => allOptions.filter((course) => course.last_bid_price != null).sort((a, b) => (b.last_bid_price || 0) - (a.last_bid_price || 0)).slice(0, 5), [allOptions])

  const selected = useMemo(() => {
    if (!selectedId) return null
    let course = courses.find((item) => item.id === selectedId)
    if (!course) {
      const base = selectedId.split('||')[0]
      course = courses.filter((item) => item.course_code_base === base || item.course_code === base).sort((a, b) => (b.year || 0) - (a.year || 0))[0]
    }
    return course || null
  }, [courses, selectedId])

  const history = useMemo(() => selected ? courses.filter((course) => course.course_code_base === selected.course_code_base && course.has_eval).sort((a, b) => (b.year || 0) - (a.year || 0) || (a.term || '').localeCompare(b.term || '')) : [], [courses, selected])
  const biddingHistory = useMemo(() => selected ? courses.filter((course) => course.course_code_base === selected.course_code_base && course.has_bidding).sort((a, b) => (b.year || 0) - (a.year || 0)) : [], [courses, selected])

  const instructorPct = selected?.metrics_pct?.Instructor_Rating
  const workloadPct = selected?.metrics_pct?.Workload

  return (
    <div className="flex h-full min-h-0 overflow-hidden">
      {filterOpen && <button className="mobile-drawer-overlay md:hidden" onClick={() => setFilterOpen(false)} aria-label="Close filters" />}
      <div className={`mobile-drawer ${filterOpen ? 'open' : ''}`}><FilterSidebar filters={filters} setFilters={setFilters} meta={meta} mobile onClose={() => setFilterOpen(false)} /></div>
      <div className="hidden md:block"><FilterSidebar filters={filters} setFilters={setFilters} meta={meta} /></div>
      <main className="flex min-w-0 flex-1 flex-col overflow-y-auto px-4 py-4 md:max-w-4xl md:px-8 md:py-6">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-lg font-bold text-white md:text-2xl">Course Explorer</h2><p className="mt-1 text-xs text-muted md:text-sm">Search one course at a time, then browse detail, performance, and bidding history.</p></div><button onClick={() => setFilterOpen(true)} className="rounded-full border border-[#2a2a3e] bg-[#151521] px-3 py-2 text-xs font-medium text-white md:hidden">Filters{activeFilterCount(filters) > 0 ? ` (${activeFilterCount(filters)})` : ''}</button></div>
        <div className="relative mb-4"><label className="mb-1 block text-xs text-muted">Search by course or instructor</label><input type="text" value={selected && !query ? `${selected.course_code}: ${selected.course_name} - ${selected.professor_display}` : query} placeholder="Start typing a course name, code, or instructor..." onChange={(event) => { setQuery(event.target.value); setSelectedId(null) }} className="w-full" />{query && <div className="absolute z-40 mt-1 max-h-[300px] w-full overflow-y-auto rounded-lg shadow-xl" style={{ background: '#1a1a28', border: '1px solid #2a2a3e' }}>{filteredOptions.length === 0 ? <p className="px-4 py-3 text-xs text-muted">No results for "{query}"</p> : filteredOptions.map((course) => <button key={course.id} onClick={() => { setSelectedId(course.id); setSearchParams({ id: course.id }); setActiveTab('details'); setDescOpen(false); setQuery('') }} className="w-full px-4 py-3 text-left text-xs transition-colors hover:bg-[#2a2a3e]"><span style={{ color: '#38bdf8' }}>{course.course_code}</span><span className="ml-2 text-label">{course.course_name}</span><span className="ml-2 text-muted">- {course.professor_display}</span></button>)}</div>}</div>
        {!selected && <div><p className="mb-4 text-xs text-muted">Search or filter above to find a course, then tap into the full detail view.</p>{topByBidding.length > 0 && <div className="rounded-lg p-4" style={{ background: '#1a1a28', border: '1px solid #2a2a3e' }}><p className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted">Most Competitive Courses</p><div className="flex flex-col gap-2">{topByBidding.map((course, index) => <button key={course.id} onClick={() => { setSelectedId(course.id); setSearchParams({ id: course.id }) }} className="flex flex-col gap-2 rounded px-3 py-3 text-left transition-colors hover:bg-[#2a2a3e] sm:flex-row sm:items-center sm:justify-between" style={{ background: '#13131f' }}><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="text-xs font-bold" style={{ color: '#38bdf8' }}>#{index + 1} {course.course_code}</span><span className="text-xs text-label">{course.course_name}</span></div><p className="mt-1 text-xs text-muted">{course.professor_display}</p></div><span className="shrink-0 rounded px-2 py-1 text-xs font-bold" style={{ background: '#1e3a52', color: '#38bdf8' }}>{course.last_bid_price} pts</span></button>)}</div></div>}</div>}
        {selected && <>
          <div className="mb-4 flex flex-wrap gap-4 text-xs text-muted"><span>{history.length} historical record{history.length !== 1 ? 's' : ''}</span>{biddingHistory.length > 0 && <span>{biddingHistory.length} bidding record{biddingHistory.length !== 1 ? 's' : ''}</span>}{selected.n_respondents != null && <span>N={selected.n_respondents} respondents</span>}</div>
          <div className="mb-5 flex gap-2 overflow-x-auto border-b border-[#2a2a3e] pb-1">{[{ key: 'details', label: 'Course Details' }, { key: 'performance', label: 'Past Performance' }, { key: 'bidding', label: 'Bidding History' }].map((tab) => <button key={tab.key} onClick={() => setActiveTab(tab.key)} className={`whitespace-nowrap rounded-t-lg px-4 py-2 text-sm ${activeTab === tab.key ? 'text-white' : 'text-muted hover:text-label'}`} style={activeTab === tab.key ? { borderBottom: '2px solid #38bdf8' } : undefined}>{tab.label}</button>)}</div>
          {activeTab === 'details' && <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-lg p-4" style={{ background: '#1a1a28', border: '1px solid #2a2a3e' }}>
              <h4 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted">Course Information</h4>
              {selected.stem_school && <div className="mb-3"><p className="text-[10px] uppercase tracking-wider text-muted">Academic Area</p><p className="text-sm text-label">{selected.stem_school}</p></div>}
              <div className="mb-3"><p className="text-[10px] uppercase tracking-wider text-muted">Course Details</p><div className="mt-1 flex flex-wrap items-center gap-2"><span className="text-sm font-bold" style={{ color: '#38bdf8' }}>{selected.course_code}</span><CopyButton text={selected.course_code_base || selected.course_code} />{selected.term && <span className="text-xs text-muted">{selected.term}</span>}{selected.is_stem && <span className="rounded px-2 py-1 text-[10px] font-bold" style={{ background: '#1e3a52', color: '#38bdf8' }}>STEM</span>}{selected.is_core && <span className="rounded px-2 py-1 text-[10px] font-bold" style={{ background: '#2a1f0e', color: '#f59e0b' }}>Core</span>}</div></div>
              {selected.professor_display && <div className="mb-3"><p className="text-[10px] uppercase tracking-wider text-muted">Instructor</p><button onClick={() => navigate(`/faculty?prof=${encodeURIComponent(selected.professor)}`)} className="text-left text-sm hover:underline" style={{ color: '#93c5fd' }}>{selected.professor_display}</button>{selected.faculty_title && <p className="text-xs text-muted">{selected.faculty_title}</p>}{selected.faculty_category && <p className="text-xs text-muted">{selected.faculty_category}</p>}</div>}
              {selected.last_bid_price != null && <div className="mt-3 border-t border-[#2a2a3e] pt-3"><p className="mb-1 text-[10px] uppercase tracking-wider text-muted">Last Bid ({selected.last_bid_acad} {selected.last_bid_term})</p><div className="flex items-center justify-between"><span className="text-xs text-muted">Clearing Price</span><span className="rounded px-2 py-1 text-sm font-bold" style={{ background: '#1e3a52', color: '#38bdf8' }}>{selected.last_bid_price} pts</span></div>{selected.last_bid_capacity != null && <div className="mt-1 flex items-center justify-between"><span className="text-xs text-muted">Capacity</span><span className="text-xs text-label">{selected.last_bid_capacity}</span></div>}{selected.last_bid_n_bids != null && <div className="mt-1 flex items-center justify-between"><span className="text-xs text-muted">Bids</span><span className="text-xs text-label">{selected.last_bid_n_bids}</span></div>}</div>}
            </div>
            <div className="rounded-lg p-4" style={{ background: '#1a1a28', border: '1px solid #2a2a3e' }}>
              <h4 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted">Student Experience</h4>
              {instructorPct != null ? <div className="mb-4 rounded p-3" style={{ background: '#13131f' }}><p className="text-xs text-muted">Instructor Rating</p><p className="text-base font-bold" style={{ color: LABEL_COLOR[selected.instructor_label] || '#38bdf8' }}>{selected.instructor_label}</p><p className="text-xs text-muted">Better than {Math.round(instructorPct)}% of courses</p></div> : <div className="mb-4 rounded p-3 text-xs italic" style={{ background: '#13131f', color: '#5a5a7a' }}>No instructor rating data available</div>}
              {workloadPct != null ? <div className="rounded p-3" style={{ background: '#13131f' }}><p className="text-xs text-muted">Course Workload</p><p className="text-base font-bold" style={{ color: WORKLOAD_COLOR[selected.workload_label] || '#c0c0d8' }}>{selected.workload_label}</p><p className="text-xs text-muted">More intensive than {Math.round(workloadPct)}% of courses</p></div> : <div className="rounded p-3 text-xs italic" style={{ background: '#13131f', color: '#5a5a7a' }}>No workload data available</div>}
            </div>
            <div className="rounded-lg p-4 lg:col-span-2" style={{ background: '#1a1a28', border: '1px solid #2a2a3e' }}><h4 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted">All Evaluation Metrics</h4>{selected.has_eval ? <div className="grid gap-x-8 sm:grid-cols-2">{meta.metrics.map((metric) => <MetricRow key={metric.key} label={metric.label} value={selected.metrics_pct?.[metric.key]} higherBetter={metric.higher_is_better} />)}</div> : <div className="py-6 text-center"><p className="text-sm text-muted">No evaluation data available for this course.</p></div>}</div>
            <div className="lg:col-span-2">{selected.course_url && <div className="mb-4"><a href={selected.course_url} target="_blank" rel="noopener noreferrer" className="inline-block rounded px-6 py-2 text-sm font-medium text-white" style={{ background: '#2563eb' }}>Course Website</a></div>}{selected.description && <div className="overflow-hidden rounded-lg" style={{ border: '1px solid #2a2a3e' }}><button onClick={() => setDescOpen((current) => !current)} className="flex w-full items-center justify-between px-4 py-3 text-left text-sm text-label" style={{ background: '#1a1a28' }}><span>Course Description</span><span>{descOpen ? 'Hide' : 'Show'}</span></button>{descOpen && <div className="px-4 py-3 text-sm leading-relaxed text-muted" style={{ background: '#13131f' }}>{selected.description}</div>}</div>}</div>
          </div>}
          {activeTab === 'performance' && <div>{history.length === 0 ? <div className="rounded-lg py-8 text-center" style={{ background: '#1a1a28', border: '1px solid #2a2a3e' }}><p className="text-sm text-muted">No evaluation history found for this course.</p></div> : <><p className="mb-4 text-xs text-muted">Showing all {history.length} evaluation record{history.length !== 1 ? 's' : ''} for <span style={{ color: '#38bdf8' }}>{selected.course_code_base}</span>.</p><HistoryTable history={history} /></>}</div>}
          {activeTab === 'bidding' && <div><p className="mb-4 text-xs text-muted">Bidding history for <span style={{ color: '#38bdf8' }}>{selected.course_code_base}</span> ({biddingHistory.length} record{biddingHistory.length !== 1 ? 's' : ''})</p>{biddingHistory.length === 0 ? <div className="rounded-lg py-8 text-center" style={{ background: '#1a1a28', border: '1px solid #2a2a3e' }}><p className="text-sm text-muted">This course has no bidding records.</p></div> : <div className="overflow-x-auto"><table className="w-full text-xs"><thead><tr style={{ borderBottom: '1px solid #2a2a3e' }}>{['Year', 'Term', 'Instructor', 'Clearing Price', 'Capacity', 'Bids', 'Oversubscribed by'].map((h) => <th key={h} className="whitespace-nowrap py-2 pr-4 text-left font-medium text-muted">{h}</th>)}</tr></thead><tbody>{biddingHistory.map((row, i) => { const over = row.bid_n_bids != null && row.bid_capacity != null && row.bid_n_bids > row.bid_capacity ? row.bid_n_bids - row.bid_capacity : null; return <tr key={i} style={{ borderBottom: '1px solid #1a1a28' }}><td className="py-2 pr-4 text-label">{row.year}</td><td className="py-2 pr-4 text-muted">{row.term}</td><td className="py-2 pr-4 text-label"><button onClick={() => navigate(`/faculty?prof=${encodeURIComponent(row.professor)}`)} className="hover:underline" style={{ color: '#93c5fd' }}>{row.professor_display || row.professor}</button></td><td className="py-2 pr-4 font-medium" style={{ color: '#38bdf8' }}>{row.bid_clearing_price != null ? `${row.bid_clearing_price} pts` : '-'}</td><td className="py-2 pr-4 text-label">{row.bid_capacity ?? '-'}</td><td className="py-2 pr-4 text-label">{row.bid_n_bids ?? '-'}</td><td className="py-2 pr-4">{over != null ? <span style={{ color: '#f97316' }}>+{over}</span> : <span className="text-muted">-</span>}</td></tr> })}</tbody></table></div>}</div>}
        </>}
        <div className="app-footer mt-8">Data from HKS QReports · {new Date().getFullYear()}</div>
      </main>
    </div>
  )
}
