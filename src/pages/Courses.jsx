import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip as RechartsTooltip, XAxis, YAxis } from 'recharts'

const LABEL_COLOR = { Outstanding: 'var(--success)', Excellent: '#86efac', Good: 'var(--gold)', Average: 'var(--warning)', Poor: 'var(--danger)' }
const WORKLOAD_COLOR = { 'Very Light': 'var(--blue)', Light: '#7fb1d1', Moderate: 'var(--gold)', Heavy: 'var(--warning)', 'Very Heavy': '#c95d4f' }
const TERM_LABELS = { Fall: 'Fall', Spring: 'Spring', January: 'Jan' }
const ALL_TERMS = ['Fall', 'Spring', 'January']

function pct(value) {
  return value != null ? `${Math.round(value)}%` : '-'
}

function getConcentration(code) {
  const match = code?.match(/^([A-Z]+)/)
  return match ? match[1] : 'Other'
}

function MetricRow({ label, value, higherBetter = true, neutral = false }) {
  if (value == null) return null
  const rounded = Math.round(value)
  let color
  if (neutral) color = 'var(--blue)'
  else if (higherBetter) color = rounded >= 75 ? 'var(--success)' : rounded >= 50 ? 'var(--gold)' : 'var(--danger)'
  else color = rounded <= 25 ? 'var(--success)' : rounded <= 50 ? 'var(--gold)' : 'var(--danger)'

  return (
    <div className="mb-3">
      <div className="mb-1 flex justify-between text-xs">
        <span className="text-muted">{label}</span>
        <span className="font-medium text-label">{rounded}%</span>
      </div>
      <div className="h-1.5 w-full rounded-full" style={{ background: 'var(--line)' }}>
        <div className="h-1.5 rounded-full" style={{ width: `${rounded}%`, background: color }} />
      </div>
    </div>
  )
}

function HistoryTable({ history }) {
  if (!history.length) {
    return (
      <div className="surface-card rounded-[22px] py-8 text-center">
        <p className="text-sm text-muted">No historical evaluation data found for this course.</p>
      </div>
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr style={{ borderBottom: '1px solid var(--line)' }}>
            {['Year', 'Term', 'Professor', 'Instructor %', 'Course %', 'Workload %', 'Rigor %', 'Diverse Persp. %', 'N'].map((header) => (
              <th key={header} className="whitespace-nowrap py-2 pr-4 text-left font-medium text-muted">{header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {history.map((row, index) => (
            <tr key={index} style={{ borderBottom: '1px solid var(--line)' }}>
              <td className="py-2 pr-4 text-label">{row.year}</td>
              <td className="py-2 pr-4 text-muted">{row.term}</td>
              <td className="py-2 pr-4 text-label">{row.professor_display || row.professor}</td>
              <td className="py-2 pr-4 font-medium" style={{ color: 'var(--accent-strong)' }}>{pct(row.metrics_pct?.Instructor_Rating)}</td>
              <td className="py-2 pr-4 text-label">{pct(row.metrics_pct?.Course_Rating)}</td>
              <td className="py-2 pr-4 text-label">{pct(row.metrics_pct?.Workload)}</td>
              <td className="py-2 pr-4 text-label">{pct(row.metrics_pct?.Rigor)}</td>
              <td className="py-2 pr-4 text-label">{pct(row.metrics_pct?.['Diverse Perspectives'])}</td>
              <td className="py-2 pr-4 text-muted">{row.n_respondents ?? '-'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function CopyButton({ text }) {
  const [copied, setCopied] = useState(false)

  return (
    <button
      onClick={() => navigator.clipboard.writeText(text).then(() => {
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      })}
      className="ml-2 rounded-xl border px-2 py-0.5 text-xs transition-colors"
      style={{
        borderColor: 'var(--line)',
        background: copied ? 'rgba(123, 176, 138, 0.14)' : 'var(--panel-subtle)',
        color: copied ? 'var(--success)' : 'var(--text-muted)',
      }}
    >
      {copied ? 'Copied' : 'Copy'}
    </button>
  )
}

function activeFilterCount(filters) {
  let count = 0
  if (filters.year !== 'all') count++
  if (filters.concentration !== 'All') count++
  if (filters.academicArea !== 'All') count++
  if (filters.coreFilter !== 'all') count++
  if (filters.isStemOnly) count++
  if (filters.gender !== 'all') count++
  if (filters.minInstructorPct !== 'any') count++
  if (filters.evalOnly) count++
  if (filters.year !== 'all' && (filters.terms.length !== ALL_TERMS.length || !ALL_TERMS.every((term) => filters.terms.includes(term)))) count++
  return count
}

function FilterSidebar({ filters, setFilters, meta, mobile = false, onClose = null }) {
  const update = (patch) => setFilters((current) => ({ ...current, ...patch }))
  const reset = () => setFilters({
    year: 'all',
    terms: [...ALL_TERMS],
    concentration: 'All',
    academicArea: 'All',
    coreFilter: 'all',
    isStemOnly: false,
    gender: 'all',
    minInstructorPct: 'any',
    evalOnly: false,
  })
  const toggleTerm = (term) => {
    const next = filters.terms.includes(term)
      ? filters.terms.filter((item) => item !== term)
      : [...filters.terms, term]
    if (next.length > 0) update({ terms: next })
  }

  return (
    <aside
      className="flex h-full shrink-0 flex-col overflow-y-auto"
      style={{
        width: mobile ? '100%' : 228,
        background: 'linear-gradient(180deg, var(--panel-strong), var(--panel-soft))',
        borderRight: '1px solid var(--line)',
      }}
    >
      <div className="px-4 pb-3 pt-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <p className="kicker">Filter Courses</p>
            {activeFilterCount(filters) > 0 && <span className="filter-badge">{activeFilterCount(filters)} active</span>}
          </div>
          {mobile && onClose && (
            <button onClick={onClose} className="rounded-full border px-2 py-1 text-[11px] text-muted hover:text-label" style={{ borderColor: 'var(--line)' }}>
              Close
            </button>
          )}
        </div>
      </div>

      <div className="filter-section px-4 py-3">
        <label className="filter-label mb-1 block">Year:</label>
        <div className="select-wrap">
          <select value={filters.year} onChange={(event) => update({ year: event.target.value === 'all' ? 'all' : parseInt(event.target.value, 10) })}>
            <option value="all">All Years</option>
            {[...meta.years].reverse().map((year) => (
              <option key={year} value={year}>{year === 2026 ? `${year} - Bidding` : year}</option>
            ))}
          </select>
        </div>
      </div>

      {filters.year !== 'all' && (
        <div className="filter-section px-4 py-3">
          <div className="mb-2 flex items-center justify-between">
            <label className="filter-label">Term:</label>
            <button onClick={() => update({ terms: [...ALL_TERMS] })} className="text-[10px] text-muted hover:text-label">All</button>
          </div>
          <div className="flex flex-wrap gap-1">
            {meta.terms.map((term) => {
              const active = filters.terms.includes(term)
              return (
                <button
                  key={term}
                  onClick={() => toggleTerm(term)}
                  className="flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium transition-colors"
                  style={active
                    ? { background: 'linear-gradient(180deg, rgba(165, 28, 48, 0.95), rgba(132, 18, 36, 0.95))', color: '#fff' }
                    : { border: '1px solid var(--line)', background: 'var(--panel-subtle)', color: 'var(--text-muted)' }}
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
        <label className="filter-label mb-1 block">Concentration:</label>
        <div className="select-wrap">
          <select value={filters.concentration} onChange={(event) => update({ concentration: event.target.value })}>
            <option value="All">All</option>
            {meta.concentrations.map((concentration) => <option key={concentration} value={concentration}>{concentration}</option>)}
          </select>
        </div>
      </div>

      {meta.academic_areas?.length > 0 && (
        <div className="filter-section px-4 py-3">
          <label className="filter-label mb-1 block">Academic Area:</label>
          <div className="select-wrap">
            <select value={filters.academicArea} onChange={(event) => update({ academicArea: event.target.value })}>
              <option value="All">All Areas</option>
              {meta.academic_areas.map((area) => <option key={area} value={area}>{area}</option>)}
            </select>
          </div>
        </div>
      )}

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
        <label className="flex items-center gap-2 text-xs text-label">
          <input type="checkbox" checked={filters.isStemOnly} onChange={(event) => update({ isStemOnly: event.target.checked })} className="h-3.5 w-3.5 cursor-pointer accent-accent" />
          Only STEM
        </label>
        <label className="flex items-center gap-2 text-xs text-label">
          <input type="checkbox" checked={filters.evalOnly} onChange={(event) => update({ evalOnly: event.target.checked })} className="h-3.5 w-3.5 cursor-pointer accent-accent" />
          Only with evals
        </label>
      </div>

      <div className="filter-section px-4 py-3">
        <button onClick={reset} className="w-full rounded-xl border py-2 text-xs text-muted hover:border-label hover:text-label" style={{ borderColor: 'var(--line)' }}>
          Reset Filters
        </button>
      </div>
    </aside>
  )
}

function BiddingTooltip({ active, payload }) {
  if (!active || !payload?.length) return null
  const point = payload[0].payload

  return (
    <div className="rounded-lg px-3 py-2 text-xs shadow-xl" style={{ background: 'var(--panel-strong)', border: '1px solid var(--line)' }}>
      <p className="mb-1 font-semibold text-label">{point.label}</p>
      {point.price != null && <p style={{ color: 'var(--accent-strong)' }}>Clearing price: <span className="font-bold">{point.price} pts</span></p>}
      {point.bids != null && <p className="text-muted">Bids: {point.bids}{point.cap != null ? ` / ${point.cap} seats` : ''}</p>}
      {point.over != null && point.over > 0 && <p style={{ color: 'var(--warning)' }}>+{point.over} oversubscribed</p>}
    </div>
  )
}

function BiddingTab({ biddingHistory, selected, navigate }) {
  if (biddingHistory.length === 0) {
    return (
      <div className="surface-card rounded-[22px] py-8 text-center">
        <p className="text-sm text-muted">This course has no bidding records.</p>
      </div>
    )
  }

  const termOrder = { Spring: 0, January: 1, Fall: 2 }
  const chartData = [...biddingHistory]
    .filter((row) => row.bid_clearing_price != null)
    .sort((a, b) => (a.year || 0) - (b.year || 0) || (termOrder[a.term] ?? 9) - (termOrder[b.term] ?? 9))
    .map((row) => ({
      label: `${row.term} ${row.year}`,
      price: row.bid_clearing_price,
      bids: row.bid_n_bids ?? null,
      cap: row.bid_capacity ?? null,
      over: row.bid_n_bids != null && row.bid_capacity != null ? Math.max(0, row.bid_n_bids - row.bid_capacity) : null,
    }))

  const dedupMap = new Map()
  for (const point of chartData) {
    if (!dedupMap.has(point.label) || point.price > dedupMap.get(point.label).price) dedupMap.set(point.label, point)
  }
  const trendData = [...dedupMap.values()]

  return (
    <div>
      <p className="mb-4 text-xs text-muted">
        Bidding history for <span style={{ color: 'var(--accent-strong)' }}>{selected.course_code_base}</span> ({biddingHistory.length} record{biddingHistory.length !== 1 ? 's' : ''})
      </p>

      {trendData.length >= 2 && (
        <div className="surface-card mb-6 rounded-[22px] p-4">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted">Clearing Price Trend</p>
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={trendData} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
              <XAxis dataKey="label" tick={{ fill: '#655458', fontSize: 10 }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fill: '#655458', fontSize: 10 }} tickLine={false} axisLine={false} domain={['auto', 'auto']} tickFormatter={(value) => `${value}`} width={36} />
              <RechartsTooltip content={<BiddingTooltip />} cursor={{ stroke: 'var(--accent-strong)', strokeWidth: 1, strokeDasharray: '3 3' }} />
              <Line type="monotone" dataKey="price" stroke="var(--accent-strong)" strokeWidth={2} dot={{ r: 4, fill: 'var(--accent-strong)', strokeWidth: 0 }} activeDot={{ r: 6 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr style={{ borderBottom: '1px solid var(--line)' }}>
              {['Year', 'Term', 'Instructor', 'Clearing Price', 'Capacity', 'Bids', 'Oversubscribed by'].map((header) => (
                <th key={header} className="whitespace-nowrap py-2 pr-4 text-left font-medium text-muted">{header}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {biddingHistory.map((row, index) => {
              const over = row.bid_n_bids != null && row.bid_capacity != null && row.bid_n_bids > row.bid_capacity ? row.bid_n_bids - row.bid_capacity : null
              return (
                <tr key={index} style={{ borderBottom: '1px solid var(--line)' }}>
                  <td className="py-2 pr-4 text-label">{row.year}</td>
                  <td className="py-2 pr-4 text-muted">{row.term}</td>
                  <td className="py-2 pr-4 text-label">
                    <button onClick={() => navigate(`/faculty?prof=${encodeURIComponent(row.professor)}`)} className="hover:underline" style={{ color: 'var(--blue)' }}>
                      {row.professor_display || row.professor}
                    </button>
                  </td>
                  <td className="py-2 pr-4 font-medium" style={{ color: 'var(--accent-strong)' }}>{row.bid_clearing_price != null ? `${row.bid_clearing_price} pts` : '-'}</td>
                  <td className="py-2 pr-4 text-label">{row.bid_capacity ?? '-'}</td>
                  <td className="py-2 pr-4 text-label">{row.bid_n_bids ?? '-'}</td>
                  <td className="py-2 pr-4">{over != null ? <span style={{ color: 'var(--warning)' }}>+{over}</span> : <span className="text-muted">-</span>}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default function Courses({ courses, meta, favs }) {
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState(searchParams.get('id') || null)
  const [openSections, setOpenSections] = useState({ details: true, performance: true, bidding: true })
  const [descOpen, setDescOpen] = useState(false)
  const [filterOpen, setFilterOpen] = useState(false)
  const [filters, setFilters] = useState({
    year: 'all',
    terms: [...ALL_TERMS],
    concentration: 'All',
    academicArea: 'All',
    coreFilter: 'all',
    isStemOnly: false,
    gender: 'all',
    minInstructorPct: 'any',
    evalOnly: false,
  })

  useEffect(() => {
    const id = searchParams.get('id')
    if (id) {
      setSelectedId(id)
    }
  }, [searchParams])

  const selected = useMemo(() => {
    if (!selectedId) return null
    let course = courses.find((item) => item.id === selectedId)
    if (!course) {
      const base = selectedId.split('||')[0]
      course = courses
        .filter((item) => item.course_code_base === base || item.course_code === base)
        .sort((a, b) => (b.year || 0) - (a.year || 0))[0]
    }
    return course || null
  }, [courses, selectedId])

  useEffect(() => {
    if (!selected) return
    setOpenSections({ details: true, performance: true, bidding: true })
  }, [selected?.id])

  useEffect(() => {
    if (selected?.description) setDescOpen(true)
  }, [selected])

  useEffect(() => {
    document.title = 'HKS Course Explorer'
  }, [])

  const allOptions = useMemo(() => {
    const map = new Map()
    for (const course of courses) {
      const key = course.course_code_base
      if (!map.has(key) || (course.year || 0) > (map.get(key).year || 0)) map.set(key, course)
    }
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
      if (filters.academicArea !== 'All' && course.academic_area !== filters.academicArea) return false
      if (filters.coreFilter === 'core' && !course.is_core) return false
      if (filters.coreFilter === 'no-core' && course.is_core) return false
      if (filters.isStemOnly && !course.is_stem) return false
      if (filters.gender !== 'all' && course.gender != null && course.gender !== filters.gender) return false
      if (minPct !== null) {
        const rating = course.metrics_pct?.Instructor_Rating
        if (rating != null && rating < minPct) return false
      }
      if (filters.evalOnly && !course.has_eval) return false
      return true
    })

    list = list.sort((a, b) => {
      const aBid = a.last_bid_price ?? -1
      const bBid = b.last_bid_price ?? -1
      if (aBid !== bBid) return bBid - aBid
      return (a.course_name || a.course_code || '').localeCompare(b.course_name || b.course_code || '')
    })

    if (!query) return list.slice(0, 100)
    const normalized = query.toLowerCase()
    return list.filter((course) =>
      (course.course_name || '').toLowerCase().includes(normalized) ||
      (course.course_code || '').toLowerCase().includes(normalized) ||
      (course.professor_display || '').toLowerCase().includes(normalized) ||
      (course.description || '').toLowerCase().includes(normalized) ||
      (course.academic_area || '').toLowerCase().includes(normalized)
    ).slice(0, 100)
  }, [allOptions, courses, filters, query])

  const topByBidding = useMemo(() => filteredOptions.filter((course) => course.last_bid_price != null).slice(0, 5), [filteredOptions])
  const history = useMemo(() => selected ? courses.filter((course) => course.course_code_base === selected.course_code_base && course.has_eval).sort((a, b) => (b.year || 0) - (a.year || 0) || (a.term || '').localeCompare(b.term || '')) : [], [courses, selected])
  const biddingHistory = useMemo(() => selected ? courses.filter((course) => course.course_code_base === selected.course_code_base && course.has_bidding).sort((a, b) => (b.year || 0) - (a.year || 0)) : [], [courses, selected])

  const instructorPct = selected?.metrics_pct?.Instructor_Rating
  const workloadPct = selected?.metrics_pct?.Workload
  const selectedCountText = `${history.length} historical record${history.length !== 1 ? 's' : ''}`

  return (
    <div className="flex h-full min-h-0 overflow-hidden">
      {filterOpen && <button className="mobile-drawer-overlay md:hidden" onClick={() => setFilterOpen(false)} aria-label="Close filters" />}
      <div className={`mobile-drawer md:hidden ${filterOpen ? 'open' : ''}`}>
        <FilterSidebar filters={filters} setFilters={setFilters} meta={meta} mobile onClose={() => setFilterOpen(false)} />
      </div>
      <div className="hidden md:block">
        <FilterSidebar filters={filters} setFilters={setFilters} meta={meta} />
      </div>
      <main className="flex min-w-0 flex-1 flex-col overflow-y-auto px-4 py-4 md:max-w-4xl md:px-8 md:py-6">
        <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="kicker mb-2">Deep dive</p>
            <h2 className="serif-display text-3xl font-semibold md:text-[2.4rem]" style={{ color: 'var(--text)' }}>Course Explorer</h2>
            <p className="mt-2 text-xs text-muted md:text-sm">Search one course at a time, then browse detail, performance, and bidding history.</p>
          </div>
          <button onClick={() => setFilterOpen(true)} className="rounded-full border px-3 py-2 text-xs font-medium text-label md:hidden" style={{ borderColor: 'var(--line)', background: 'var(--panel-subtle)' }}>
            Filters{activeFilterCount(filters) > 0 ? ` (${activeFilterCount(filters)})` : ''}
          </button>
        </div>

        <div className="relative mb-4">
          <label className="mb-1 block text-xs text-muted">Search by course or instructor</label>
          <input
            type="text"
            value={selected && !query ? `${selected.course_code}: ${selected.course_name} - ${selected.professor_display}` : query}
            placeholder="Start typing a course name, code, or instructor..."
            onChange={(event) => {
              setQuery(event.target.value)
              setSelectedId(null)
            }}
            className="w-full"
          />
          {query && (
            <div className="absolute z-40 mt-1 max-h-[300px] w-full overflow-y-auto rounded-[18px] shadow-xl" style={{ background: 'var(--panel-strong)', border: '1px solid var(--line)' }}>
              {filteredOptions.length === 0 ? <p className="px-4 py-3 text-xs text-muted">No results for "{query}"</p> : filteredOptions.map((course) => (
                <button
                  key={course.id}
                  onClick={() => {
                    setSelectedId(course.id)
                    setSearchParams({ id: course.id })
                    setActiveTab('details')
                    setDescOpen(false)
                    setQuery('')
                  }}
                  className="w-full px-4 py-3 text-left text-xs transition-colors hover:bg-[rgba(165,28,48,0.05)]"
                >
                  <span style={{ color: 'var(--accent-strong)' }}>{course.course_code}</span>
                  <span className="ml-2 text-label">{course.course_name}</span>
                  <span className="ml-2 text-muted">- {course.professor_display}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {!selected && (
          <div>
            <p className="mb-4 text-xs text-muted">Search or filter above to find a course, then tap into the full detail view.</p>
            {topByBidding.length > 0 && (
              <div className="surface-card rounded-[22px] p-4">
                <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted">Most Competitive Courses</p>
                <div className="flex flex-col gap-2">
                  {topByBidding.map((course, index) => (
                    <button
                      key={course.id}
                      onClick={() => { setSelectedId(course.id); setSearchParams({ id: course.id }) }}
                      className="flex flex-col gap-2 rounded-[18px] px-3 py-3 text-left transition-colors hover:bg-[rgba(165,28,48,0.05)] sm:flex-row sm:items-center sm:justify-between"
                      style={{ background: 'var(--panel-subtle)' }}
                    >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-xs font-bold" style={{ color: 'var(--accent-strong)' }}>#{index + 1} {course.course_code}</span>
                          <span className="text-xs text-label">{course.course_name}</span>
                        </div>
                        <p className="mt-1 text-xs text-muted">{course.professor_display}</p>
                      </div>
                      <span className="shrink-0 rounded-full px-2 py-1 text-xs font-bold" style={{ background: 'var(--gold-soft)', color: 'var(--gold)' }}>{course.last_bid_price} pts</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {selected && (
          <>
            <div className="mb-4 flex flex-wrap gap-4 text-xs text-muted">
              <span>{selectedCountText}</span>
              {biddingHistory.length > 0 && <span>{biddingHistory.length} bidding record{biddingHistory.length !== 1 ? 's' : ''}</span>}
              {selected.n_respondents != null && <span>N={selected.n_respondents} respondents</span>}
            </div>

            <div className="mb-3 rounded-[18px] border px-4 py-3" style={{ borderColor: 'var(--line)', background: 'var(--panel-subtle)' }}>
              <div className="flex flex-wrap gap-2 text-sm font-medium">
                <span style={{ color: 'var(--accent-strong)' }}>Course Details</span>
                <span className="text-muted">•</span>
                <span className="text-label">Past Performance</span>
                <span className="text-muted">•</span>
                <span className="text-label">Bidding History</span>
              </div>
            </div>

            <section className="mb-8">
              <button
                onClick={() => setOpenSections((current) => ({ ...current, details: !current.details }))}
                className="mb-4 flex w-full items-center justify-between rounded-[18px] border px-4 py-3 text-left"
                style={{ borderColor: 'var(--line)', background: 'var(--panel-subtle)' }}
              >
                <span className="text-sm font-semibold uppercase tracking-wider" style={{ color: 'var(--accent-strong)' }}>Course Details</span>
                <span className="text-xs text-muted">{openSections.details ? 'Hide' : 'Show'}</span>
              </button>
              {openSections.details && <div className="grid gap-4 lg:grid-cols-2">
                <div className="surface-card rounded-[22px] p-5">
                  <h4 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted">Course Information</h4>

                  <div className="mb-4 flex flex-wrap gap-2">
                    {selected.academic_area && <span className="rounded-full px-3 py-1 text-[10px] font-medium" style={{ background: 'var(--blue-soft)', color: 'var(--blue)' }}>{selected.academic_area}</span>}
                    {selected.is_stem && <span className="rounded-full px-3 py-1 text-[10px] font-bold" style={{ background: 'var(--blue-soft)', color: 'var(--blue)' }}>STEM</span>}
                    {selected.is_core && <span className="rounded-full px-3 py-1 text-[10px] font-bold" style={{ background: 'var(--gold-soft)', color: 'var(--gold)' }}>Core</span>}
                    {selected.cross_registration === true && <span className="rounded-full px-3 py-1 text-[10px] font-medium" style={{ background: 'rgba(123, 176, 138, 0.14)', color: 'var(--success)' }}>Cross-reg OK</span>}
                    {selected.cross_registration === false && <span className="rounded-full px-3 py-1 text-[10px] font-medium" style={{ background: 'rgba(216, 112, 112, 0.12)', color: 'var(--danger)' }}>No cross-reg</span>}
                  </div>

                  <div className="mb-4 flex flex-wrap items-center gap-2">
                    <span className="text-2xl font-bold tracking-tight" style={{ color: 'var(--accent-strong)' }}>{selected.course_code}</span>
                    <CopyButton text={selected.course_code_base || selected.course_code} />
                    {selected.term && <span className="text-sm text-muted">{selected.term} {selected.year}</span>}
                  </div>

                  {(selected.credits_min != null || selected.grading_basis) && (
                    <div className="mb-4 flex flex-wrap gap-5 text-sm">
                      {selected.credits_min != null && (
                        <div>
                          <span className="text-muted">Credits: </span>
                          <span className="text-label">{selected.credits_min === selected.credits_max ? selected.credits_min : `${selected.credits_min}-${selected.credits_max}`}</span>
                        </div>
                      )}
                      {selected.grading_basis && (
                        <div>
                          <span className="text-muted">Grading: </span>
                          <span className="text-label">{selected.grading_basis.replace('HKS ', '')}</span>
                        </div>
                      )}
                    </div>
                  )}

                  {(selected.meeting_days || selected.time_start) && (
                    <div className="mb-4 text-sm">
                      <span className="text-muted">Schedule: </span>
                      <span className="text-label">
                        {[selected.meeting_days, selected.time_start && selected.time_end ? `${selected.time_start}-${selected.time_end}` : selected.time_start].filter(Boolean).join(' ')}
                      </span>
                    </div>
                  )}

                  {selected.enrolled_cap != null && (
                    <div className="mb-4">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted">Enrollment ({selected.current_term || 'current'})</span>
                        <span className="text-label">{selected.enrolled_total ?? '?'} / {selected.enrolled_cap}</span>
                      </div>
                      <div className="mt-2 h-2 w-full rounded-full" style={{ background: 'var(--line)' }}>
                        <div
                          className="h-2 rounded-full transition-all"
                          style={{
                            width: `${Math.min(100, ((selected.enrolled_total || 0) / selected.enrolled_cap) * 100)}%`,
                            background: (selected.enrolled_total || 0) >= selected.enrolled_cap ? 'var(--danger)' : 'var(--accent-strong)',
                          }}
                        />
                      </div>
                      {selected.waitlist_total > 0 && <p className="mt-1 text-xs" style={{ color: 'var(--warning)' }}>{selected.waitlist_total} on waitlist</p>}
                    </div>
                  )}

                  {selected.professor_display && (
                    <div className="mb-4">
                      <p className="mb-1 text-[10px] uppercase tracking-wider text-muted">Instructor</p>
                      <button onClick={() => navigate(`/faculty?prof=${encodeURIComponent(selected.professor)}`)} className="text-left text-xl hover:underline" style={{ color: 'var(--blue)' }}>
                        {selected.professor_display}
                      </button>
                      {selected.faculty_title && <p className="text-sm text-muted">{selected.faculty_title}</p>}
                      {selected.faculty_category && <p className="text-sm text-muted">{selected.faculty_category}</p>}
                    </div>
                  )}

                  {selected.last_bid_price != null && (
                    <div className="border-t pt-4" style={{ borderColor: 'var(--line)' }}>
                      <p className="mb-3 text-[10px] uppercase tracking-wider text-muted">Last Bid ({selected.last_bid_acad} {selected.last_bid_term})</p>
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-muted">Clearing Price</span>
                        <span className="rounded-xl px-3 py-2 text-xl font-bold" style={{ background: 'var(--blue-soft)', color: 'var(--blue)' }}>{selected.last_bid_price} pts</span>
                      </div>
                      {selected.last_bid_capacity != null && <div className="mt-2 flex items-center justify-between text-sm"><span className="text-muted">Capacity</span><span className="text-label">{selected.last_bid_capacity}</span></div>}
                      {selected.last_bid_n_bids != null && <div className="mt-2 flex items-center justify-between text-sm"><span className="text-muted">Bids</span><span className="text-label">{selected.last_bid_n_bids}</span></div>}
                    </div>
                  )}
                </div>

                <div className="surface-card rounded-[22px] p-5">
                  <h4 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted">Student Experience</h4>
                  {instructorPct != null ? (
                    <div className="mb-4 rounded-[18px] p-4" style={{ background: 'var(--panel-subtle)' }}>
                      <p className="text-sm text-muted">Instructor Rating</p>
                      <p className="text-2xl font-bold" style={{ color: LABEL_COLOR[selected.instructor_label] || 'var(--accent-strong)' }}>{selected.instructor_label}</p>
                      <p className="text-sm text-muted">Better than {Math.round(instructorPct)}% of courses</p>
                    </div>
                  ) : <div className="mb-4 rounded-[18px] p-4 text-sm italic text-muted" style={{ background: 'var(--panel-subtle)' }}>No instructor rating data available</div>}
                  {workloadPct != null ? (
                    <div className="rounded-[18px] p-4" style={{ background: 'var(--panel-subtle)' }}>
                      <p className="text-sm text-muted">Course Workload</p>
                      <p className="text-2xl font-bold" style={{ color: WORKLOAD_COLOR[selected.workload_label] || 'var(--text-soft)' }}>{selected.workload_label}</p>
                      <p className="text-sm text-muted">More intensive than {Math.round(workloadPct)}% of courses</p>
                    </div>
                  ) : <div className="rounded-[18px] p-4 text-sm italic text-muted" style={{ background: 'var(--panel-subtle)' }}>No workload data available</div>}
                </div>

                <div className="surface-card rounded-[22px] p-5 lg:col-span-2">
                  <h4 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted">All Evaluation Metrics</h4>
                  {selected.has_eval ? (
                    <div className="grid gap-x-8 sm:grid-cols-2">
                      {meta.metrics.map((metric) => (
                        <MetricRow
                          key={metric.key}
                          label={metric.label}
                          value={selected.metrics_pct?.[metric.key]}
                          higherBetter={metric.higher_is_better}
                          neutral={metric.key === 'Workload' || metric.key === 'Rigor'}
                        />
                      ))}
                    </div>
                  ) : (
                    <div className="py-6 text-center">
                      <p className="text-sm text-muted">No evaluation data available for this course.</p>
                    </div>
                  )}
                </div>

                <div className="space-y-3 lg:col-span-2">
                  <div className="flex flex-wrap gap-3">
                    {selected.course_url && (
                      <a href={selected.course_url} target="_blank" rel="noopener noreferrer" className="btn-details inline-block">
                        Course Website
                      </a>
                    )}
                    {selected.instructor_profile_url && (
                      <a
                        href={selected.instructor_profile_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-block rounded-full border px-5 py-2.5 text-sm font-medium transition-colors hover:text-label"
                        style={{ borderColor: 'var(--line)', color: 'var(--text-soft)', background: 'var(--panel-subtle)' }}
                      >
                        Faculty Profile
                      </a>
                    )}
                    {favs && (() => {
                      const starred = favs.isFavorite(selected.course_code_base)
                      return (
                        <button
                          onClick={() => favs.toggle(selected.course_code_base)}
                          className="inline-flex items-center gap-1.5 rounded-full border px-4 py-2.5 text-sm font-medium transition-colors"
                          style={{
                            borderColor: starred ? 'rgba(212, 168, 106, 0.45)' : 'var(--line)',
                            color: starred ? 'var(--gold)' : 'var(--text-muted)',
                            background: starred ? 'var(--gold-soft)' : 'var(--panel-subtle)',
                          }}
                        >
                          {starred ? 'Shortlisted' : 'Add to Shortlist'}
                        </button>
                      )
                    })()}
                  </div>

                  {selected.description && (
                    <div className="overflow-hidden rounded-[22px]" style={{ border: '1px solid var(--line)' }}>
                      <button onClick={() => setDescOpen((current) => !current)} className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-medium text-label" style={{ background: 'var(--panel-strong)' }}>
                        <span>Course Description</span>
                        <span className="text-xs text-muted">{descOpen ? 'Hide' : 'Show'}</span>
                      </button>
                      {descOpen && <div className="px-4 py-4 text-base leading-relaxed text-label" style={{ background: 'var(--panel-subtle)' }}>{selected.description}</div>}
                    </div>
                  )}

                  {selected.prerequisites && (
                    <div className="surface-card rounded-[22px] px-4 py-4">
                      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted">Prerequisites & Restrictions</p>
                      <p className="text-sm leading-relaxed text-label">{selected.prerequisites}</p>
                    </div>
                  )}

                  {selected.section_notes?.length > 0 && (
                    <div className="surface-card rounded-[22px] px-4 py-4">
                      <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted">Section Notes</p>
                      {selected.section_notes.map((note, index) => <p key={index} className="mb-1 text-sm leading-relaxed text-label">{note}</p>)}
                    </div>
                  )}
                </div>
              </div>}
            </section>

            <section className="mb-8">
              <button
                onClick={() => setOpenSections((current) => ({ ...current, performance: !current.performance }))}
                className="mb-4 flex w-full items-center justify-between rounded-[18px] border px-4 py-3 text-left"
                style={{ borderColor: 'var(--line)', background: 'var(--panel-subtle)' }}
              >
                <span className="text-sm font-semibold uppercase tracking-wider" style={{ color: 'var(--accent-strong)' }}>Past Performance</span>
                <span className="text-xs text-muted">{openSections.performance ? 'Hide' : 'Show'}</span>
              </button>
              {openSections.performance && <div>
                {history.length === 0 ? (
                  <div className="surface-card rounded-[22px] py-8 text-center">
                    <p className="text-sm text-muted">No evaluation history found for this course.</p>
                  </div>
                ) : (
                  <>
                    <p className="mb-4 text-xs text-muted">
                      Showing all {history.length} evaluation record{history.length !== 1 ? 's' : ''} for <span style={{ color: 'var(--accent-strong)' }}>{selected.course_code_base}</span>.
                    </p>
                    <HistoryTable history={history} />
                  </>
                )}
              </div>}
            </section>

            <section>
              <button
                onClick={() => setOpenSections((current) => ({ ...current, bidding: !current.bidding }))}
                className="mb-4 flex w-full items-center justify-between rounded-[18px] border px-4 py-3 text-left"
                style={{ borderColor: 'var(--line)', background: 'var(--panel-subtle)' }}
              >
                <span className="text-sm font-semibold uppercase tracking-wider" style={{ color: 'var(--accent-strong)' }}>Bidding History</span>
                <span className="text-xs text-muted">{openSections.bidding ? 'Hide' : 'Show'}</span>
              </button>
              {openSections.bidding && <BiddingTab biddingHistory={biddingHistory} selected={selected} navigate={navigate} />}
            </section>
          </>
        )}

        <div className="app-footer mt-8">HKS Course Explorer by Michael Gritzbach MPA&apos;26 - Data from HKS QReports - {new Date().getFullYear()}</div>
      </main>
    </div>
  )
}
