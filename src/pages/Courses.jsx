import { useCallback, useEffect, useDeferredValue, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip as RechartsTooltip, XAxis, YAxis } from 'recharts'
import OnboardingTour from '../components/OnboardingTour.jsx'
import { formatMetric, fmtShort, modeUnit } from '../utils/formatMetric.js'
import { DEFAULT_PLAN, loadPlan, savePlan } from '../lib/scheduleStorage.js'

const COURSES_TOUR_STEPS = [
  {
    target: 'year-filter',
    title: 'Set the Year',
    body: 'Pick a year to scope results, or choose "All Years Average" for aggregated ratings across the full dataset.',
  },
  {
    target: 'course-search',
    title: 'Search Courses',
    body: 'Type a name, professor, or course code. Comma-separate terms to match any — e.g. "Levy, climate". Click a result to open its full profile.',
  },
  {
    target: 'top-bidding',
    title: 'Most Competitive Courses',
    body: 'Each badge shows the clearing price from the last bidding round — the minimum bid points needed to secure a seat. Higher price = more demand. Think of it like an auction.',
  },
]

const COURSE_DETAIL_TOUR_STEPS = [
  {
    target: 'tab-details',
    title: 'Course Details',
    body: 'Evaluation scores, course description, schedule, enrollment cap, and the instructor profile. The full picture for any offering.',
  },
  {
    target: 'tab-performance',
    title: 'Past Performance',
    body: 'How ratings trended year over year across all recorded offerings. Useful for spotting whether a course improved or declined over time.',
  },
  {
    target: 'tab-bidding',
    title: 'Bidding History',
    body: 'Every semester\'s clearing price, capacity, and number of bids. If bids exceeded capacity, the course was oversubscribed — calibrate how many points to commit accordingly.',
  },
  {
    target: 'course-student-experience',
    title: 'Student Experience at a Glance',
    body: 'The headline Instructor Rating (Outstanding → Poor) and Workload (Very Light → Very Heavy) let you quickly gauge fit. The score below each label shows the percentile vs. all courses.',
  },
  {
    target: 'course-metrics',
    title: 'All Evaluation Dimensions',
    body: 'Each bar is a percentile vs. every HKS course in the dataset. Green ≥ 75th, amber = median range, red ≤ 25th. Workload and Rigor use blue — higher isn\'t inherently better there.',
  },
  {
    target: 'course-bid-summary',
    title: 'Last Bid Snapshot',
    body: 'Clearing Price is the minimum bid that won a seat. If Bids > Capacity, the course was oversubscribed — not everyone who bid got in. Use this to calibrate how many points to commit.',
  },
  {
    target: 'course-shortlist-btn',
    title: 'Shortlist & Compare',
    body: 'Star a course to add it to your shortlist. Then visit the Compare tab to stack up to 5 courses side by side — ratings, workload, and bidding history all in one table.',
  },
]

const LABEL_COLOR = { Outstanding: 'var(--success)', Excellent: 'var(--success)', Good: 'var(--gold)', Average: 'var(--warning)', Poor: 'var(--danger)' }
const WORKLOAD_COLOR = { 'Very Light': 'var(--blue)', Light: 'var(--blue)', Moderate: 'var(--gold)', Heavy: 'var(--warning)', 'Very Heavy': 'var(--danger)' }
const TERM_LABELS = { Fall: 'Fall', Spring: 'Spring', January: 'Jan' }
const ALL_TERMS = ['Fall', 'Spring', 'January']

function getConcentration(code) {
  const match = code?.match(/^([A-Z]+)/)
  return match ? match[1] : 'Other'
}

function MetricRow({ label, value, higherBetter = true, neutral = false, metricMode = 'score' }) {
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
        <span className="font-medium text-label">{fmtShort(value, metricMode)}</span>
      </div>
      <div className="h-1.5 w-full rounded-full" style={{ background: 'var(--line)' }}>
        <div className="h-1.5 rounded-full" style={{ width: `${rounded}%`, background: color }} />
      </div>
    </div>
  )
}

function HistoryTable({ history, metricMode = 'score' }) {
  if (!history.length) {
    return (
      <div className="surface-card rounded-[22px] py-8 text-center">
        <p className="text-sm text-muted">No historical evaluation data found for this course.</p>
      </div>
    )
  }

  const unit = modeUnit(metricMode)
  const headers = ['Year', 'Term', 'Professor', `Instructor (${unit})`, `Course (${unit})`, `Workload (${unit})`, `Rigor (${unit})`, `Diverse Persp. (${unit})`, 'N']

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr style={{ borderBottom: '1px solid var(--line)' }}>
            {headers.map((header) => (
              <th key={header} className="whitespace-nowrap py-2 pr-4 text-left font-medium text-muted">{header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {history.map((row, index) => {
            const src = metricMode === 'score' ? row.metrics_score : row.metrics_pct
            return (
              <tr key={index} style={{ borderBottom: '1px solid var(--line)' }}>
                <td className="py-2 pr-4 text-label">{row.year}</td>
                <td className="py-2 pr-4 text-muted">{row.term}</td>
                <td className="py-2 pr-4 text-label">{row.professor_display || row.professor}</td>
                <td className="py-2 pr-4 font-medium" style={{ color: 'var(--accent-strong)' }}>{fmtShort(src?.Instructor_Rating, metricMode)}</td>
                <td className="py-2 pr-4 text-label">{fmtShort(src?.Course_Rating, metricMode)}</td>
                <td className="py-2 pr-4 text-label">{fmtShort(src?.Workload, metricMode)}</td>
                <td className="py-2 pr-4 text-label">{fmtShort(src?.Rigor, metricMode)}</td>
                <td className="py-2 pr-4 text-label">{fmtShort(src?.['Diverse Perspectives'], metricMode)}</td>
                <td className="py-2 pr-4 text-muted">{row.n_respondents ?? '-'}</td>
              </tr>
            )
          })}
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
  if (filters.stemGroup !== 'all') count++
  if (filters.minInstructorPct !== 'any') count++
  if (filters.evalOnly) count++
  if (filters.year !== 'all' && (filters.terms.length !== ALL_TERMS.length || !ALL_TERMS.every((term) => filters.terms.includes(term)))) count++
  return count
}

function FilterSidebar({ filters, setFilters, meta, mobile = false, onClose = null, metricMode = 'score', setMetricMode = null, onReplayTour = null }) {
  const [tourPending, setTourPending] = useState(false)
  const update = (patch) => setFilters((current) => ({ ...current, ...patch }))
  const reset = () => setFilters({
    year: 'all',
    terms: [...ALL_TERMS],
    concentration: 'All',
    academicArea: 'All',
    coreFilter: 'all',
    stemGroup: 'all',
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

      <div data-tour="year-filter" className="filter-section px-4 py-3">
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
                  className="flex items-center gap-1.5 rounded-full px-3 py-2 text-xs font-medium transition-colors touch-manipulation min-h-[44px]"
                  style={active
                    ? { background: 'linear-gradient(180deg, rgba(165, 28, 48, 0.95), rgba(132, 18, 36, 0.95))', color: '#fff' }
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
        <label className="filter-label mb-1 block">STEM Group:</label>
        <div className="select-wrap">
          <select value={filters.stemGroup} onChange={(event) => update({ stemGroup: event.target.value })}>
            <option value="all">All</option>
            <option value="A">STEM A</option>
            <option value="B">STEM B</option>
          </select>
        </div>
      </div>

      <div className="filter-section flex flex-col gap-2.5 px-4 py-3">
        <label className="flex items-center gap-2 text-xs text-label">
          <input type="checkbox" checked={filters.evalOnly} onChange={(event) => update({ evalOnly: event.target.checked })} className="h-3.5 w-3.5 cursor-pointer accent-accent" />
          Only with evals
        </label>
      </div>

      {setMetricMode && (
        <div className="filter-section px-4 py-3">
          <label className="filter-label mb-2 block">Metric Display</label>
          <div className="flex gap-1 rounded-full border p-0.5" style={{ borderColor: 'var(--line)', background: 'var(--panel-subtle)' }}>
            <button
              onClick={() => setMetricMode('score')}
              className="flex-1 rounded-full py-1.5 text-[11px] font-medium transition-colors"
              style={{ background: metricMode === 'score' ? 'var(--accent)' : 'transparent', color: metricMode === 'score' ? '#fff' : 'var(--text-muted)' }}
            >Score</button>
            <button
              onClick={() => setMetricMode('percentile')}
              className="flex-1 rounded-full py-1.5 text-[11px] font-medium transition-colors"
              style={{ background: metricMode === 'percentile' ? 'var(--blue)' : 'transparent', color: metricMode === 'percentile' ? '#fff' : 'var(--text-muted)' }}
            >Percentile</button>
          </div>
          <p className="mt-1.5 text-[11px] leading-snug" style={{ color: 'var(--text-muted)' }}>
            {metricMode === 'score' ? 'Absolute quality: avg rating ÷ 5 × 100. E.g. 4.2/5 → 84%.' : 'Relative rank: 80 pct = better than 80% of all courses.'}
          </p>
        </div>
      )}

      <div className="filter-section px-4 py-3">
        <button onClick={reset} className="w-full rounded-xl border py-2 text-xs text-muted hover:border-label hover:text-label" style={{ borderColor: 'var(--line)' }}>
          Reset Filters
        </button>
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
            className="mt-3 block w-full text-xs transition-colors hover:text-label touch-manipulation"
            style={{ color: tourPending ? 'var(--accent)' : 'var(--text-muted)', background: 'none', border: 'none', cursor: tourPending ? 'default' : 'pointer', padding: 0, opacity: tourPending ? 0.7 : 1 }}
          >
            {tourPending ? '↺ Starting…' : '↺ Replay tour'}
          </button>
        )}
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

  const tickColor = document.documentElement.getAttribute('data-theme') === 'light' ? 'rgba(0,0,0,0.45)' : 'rgba(243,233,226,0.5)'
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
  const avgBidPrice = chartData.length
    ? Math.round((chartData.reduce((sum, point) => sum + point.price, 0) / chartData.length) * 10) / 10
    : null

  return (
    <div>
      <p className="mb-4 text-xs text-muted">
        Bidding history for <span style={{ color: 'var(--accent-strong)' }}>{selected.course_code_base}</span> ({biddingHistory.length} record{biddingHistory.length !== 1 ? 's' : ''})
        {avgBidPrice != null && <span className="ml-2">· Avg clearing price <span className="text-label">{avgBidPrice} pts</span></span>}
      </p>

      {trendData.length >= 2 && (
        <div className="surface-card mb-6 rounded-[22px] p-4">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted">Clearing Price Trend</p>
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={trendData} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
              <XAxis dataKey="label" tick={{ fill: tickColor, fontSize: 10 }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fill: tickColor, fontSize: 10 }} tickLine={false} axisLine={false} domain={['auto', 'auto']} tickFormatter={(value) => `${value}`} width={36} />
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

export default function Courses({ courses, meta, favs, metricMode = 'score', setMetricMode }) {
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
  const [query, setQuery] = useState(() => searchParams.get('q') || '')
  const [selectedId, setSelectedId] = useState(searchParams.get('id') || null)
  const [activeTab, setActiveTab] = useState('details')
  const [descOpen, setDescOpen] = useState(false)
  const [filterOpen, setFilterOpen] = useState(false)
  const [replayTour, setReplayTour] = useState(false)
  const [showRaw, setShowRaw] = useState(false)
  const [planCodes, setPlanCodes] = useState(() => {
    const plan = loadPlan(DEFAULT_PLAN)
    return new Set((plan.courses || []).map((c) => c?.course_code_base || c?.course_code || c?.courseCode).filter(Boolean))
  })

  const addToPlan = useCallback((course) => {
    const code = course?.course_code_base || course?.course_code
    if (!code || planCodes.has(code)) return
    const plan = loadPlan(DEFAULT_PLAN)
    savePlan(DEFAULT_PLAN, { ...plan, courses: [...(plan.courses || []), course] })
    setPlanCodes((prev) => new Set([...prev, code]))
  }, [planCodes])

  // "/" shortcut focuses the search input (skip if already in an input/textarea)
  const searchInputRef = useRef(null)
  useEffect(() => {
    const handler = (event) => {
      if (event.key !== '/') return
      const tag = document.activeElement?.tagName?.toLowerCase()
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return
      event.preventDefault()
      searchInputRef.current?.focus()
      searchInputRef.current?.select()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [])

  const handleReplayTour = () => {
    localStorage.removeItem('hks-tour-courses')
    localStorage.removeItem('hks-tour-course-detail')
    setReplayTour(true)
  }

  const handleTourStepChange = (stepIndex) => {
    // Step 0 targets 'year-filter' which lives in the filter sidebar drawer
    if (stepIndex === 0) setFilterOpen(true)
    else setFilterOpen(false)
  }

  const [filters, setFilters] = useState(() => {
    const rawYear = searchParams.get('y')
    return {
      year: rawYear && rawYear !== 'all' ? parseInt(rawYear, 10) : 'all',
      terms: [...ALL_TERMS],
      concentration: searchParams.get('c') || 'All',
      academicArea: 'All',
      coreFilter: 'all',
      stemGroup: 'all',
      minInstructorPct: 'any',
      evalOnly: false,
    }
  })

  // Keep key filter state in URL so filtered views are shareable
  useEffect(() => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      if (filters.year !== 'all') next.set('y', String(filters.year))
      else next.delete('y')
      if (filters.concentration !== 'All') next.set('c', filters.concentration)
      else next.delete('c')
      return next
    }, { replace: true })
  }, [filters.year, filters.concentration]) // eslint-disable-line react-hooks/exhaustive-deps

  // Sync search query to URL (debounce-style: only write non-empty values)
  useEffect(() => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      if (query) next.set('q', query)
      else next.delete('q')
      return next
    }, { replace: true })
  }, [query]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const id = searchParams.get('id')
    if (id) {
      setSelectedId(id)
      setActiveTab('details')
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

  const deferredFilters = useDeferredValue(filters)

  const filteredOptions = useMemo(() => {
    const minPct = deferredFilters.minInstructorPct !== 'any' ? parseFloat(deferredFilters.minInstructorPct) : null
    let list = allOptions.filter((course) => {
      if (deferredFilters.year !== 'all') {
        const hasYear = courses.some((row) => row.course_code_base === course.course_code_base && row.year === deferredFilters.year && deferredFilters.terms.includes(row.term))
        if (!hasYear) return false
      }
      if (deferredFilters.concentration !== 'All' && getConcentration(course.course_code) !== deferredFilters.concentration) return false
      if (deferredFilters.academicArea !== 'All' && course.academic_area !== deferredFilters.academicArea) return false
      if (deferredFilters.coreFilter === 'core' && !course.is_core) return false
      if (deferredFilters.coreFilter === 'no-core' && course.is_core) return false
      if (deferredFilters.stemGroup === 'A' && course.stem_group !== 'A') return false
      if (deferredFilters.stemGroup === 'B' && course.stem_group !== 'B') return false
      if (minPct !== null) {
        const rating = course.metrics_pct?.Instructor_Rating
        if (rating != null && rating < minPct) return false
      }
      if (deferredFilters.evalOnly && !course.has_eval) return false
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
  }, [allOptions, courses, deferredFilters, query])

  const topByBidding = useMemo(() => filteredOptions.filter((course) => course.last_bid_price != null).slice(0, 5), [filteredOptions])
  const history = useMemo(() => selected ? courses.filter((course) => course.course_code_base === selected.course_code_base && course.has_eval).sort((a, b) => (b.year || 0) - (a.year || 0) || (a.term || '').localeCompare(b.term || '')) : [], [courses, selected])
  const biddingHistory = useMemo(() => selected ? courses.filter((course) => course.course_code_base === selected.course_code_base && course.has_bidding).sort((a, b) => (b.year || 0) - (a.year || 0)) : [], [courses, selected])

  const metricSrc = metricMode === 'score' ? selected?.metrics_score : selected?.metrics_pct
  const instructorPct = metricSrc?.Instructor_Rating
  const workloadPct = metricSrc?.Workload
  const selectedCountText = `${history.length} historical record${history.length !== 1 ? 's' : ''}`

  return (
    <div className="flex h-full min-h-0 overflow-hidden">
      <OnboardingTour steps={COURSES_TOUR_STEPS} storageKey="hks-tour-courses" autoStart={replayTour} onDone={() => { setReplayTour(false); setFilterOpen(false) }} onStepChange={handleTourStepChange} />
      {selected && <OnboardingTour steps={COURSE_DETAIL_TOUR_STEPS} storageKey="hks-tour-course-detail" />}
      {filterOpen && <button className="mobile-drawer-overlay md:hidden" onClick={() => setFilterOpen(false)} aria-label="Close filters" />}
      <div className={`mobile-drawer md:hidden ${filterOpen ? 'open' : ''}`}>
        <FilterSidebar filters={filters} setFilters={setFilters} meta={meta} mobile onClose={() => setFilterOpen(false)} metricMode={metricMode} setMetricMode={setMetricMode} onReplayTour={handleReplayTour} />
      </div>
      <div className="hidden md:block">
        <FilterSidebar filters={filters} setFilters={setFilters} meta={meta} metricMode={metricMode} setMetricMode={setMetricMode} onReplayTour={handleReplayTour} />
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

        <div data-tour="course-search" className="relative mb-4">
          <div className="mb-1 flex items-center justify-between">
            <label className="text-xs text-muted">Search by course or instructor</label>
            <span className="hidden rounded border px-1.5 py-0.5 text-[10px] font-mono text-muted md:inline" style={{ borderColor: 'var(--line)', background: 'var(--panel-strong)' }}>/</span>
          </div>
          <input
            ref={searchInputRef}
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
            <p className="mb-4 text-xs text-muted">
              {filteredOptions.length === allOptions.length
                ? `${allOptions.length.toLocaleString()} unique courses`
                : `${filteredOptions.length.toLocaleString()} of ${allOptions.length.toLocaleString()} courses match`
              }{' · '}Search or filter above to open the full detail view.
            </p>
            {topByBidding.length > 0 && (
              <div data-tour="top-bidding" className="surface-card rounded-[22px] p-4">
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
          <div data-tour="course-detail">
            <button
              onClick={() => { setSelectedId(null); setSearchParams({}); setQuery('') }}
              className="mb-4 flex items-center gap-1.5 text-xs text-muted transition-colors hover:text-label"
              style={{ minHeight: 44, padding: '8px 0' }}
            >
              <span>←</span> <span>Back to course search</span>
            </button>
            <div className="mb-4 flex flex-wrap gap-4 text-xs text-muted">
              <span>{selectedCountText}</span>
              {biddingHistory.length > 0 && <span>{biddingHistory.length} bidding record{biddingHistory.length !== 1 ? 's' : ''}</span>}
              {selected.n_respondents != null && <span>N={selected.n_respondents} respondents</span>}
            </div>

            <div className="mb-6 flex gap-2 overflow-x-auto border-b pb-3" style={{ borderColor: 'var(--line)', scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch' }}>
              {[
                ['details', 'Course Details', 'tab-details'],
                ['performance', 'Past Performance', 'tab-performance'],
                ['bidding', 'Bidding History', 'tab-bidding'],
              ].map(([key, label, tourKey]) => {
                const active = activeTab === key
                return (
                  <button
                    key={key}
                    data-tour={tourKey}
                    onClick={() => setActiveTab(key)}
                    className="rounded-full border px-4 py-2 text-sm font-semibold transition-colors shrink-0"
                    style={active
                      ? {
                          borderColor: 'rgba(165, 28, 48, 0.28)',
                          background: 'linear-gradient(180deg, rgba(165, 28, 48, 0.16), rgba(165, 28, 48, 0.08))',
                          color: 'var(--accent-strong)',
                          boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06)',
                          minHeight: 44,
                        }
                      : {
                          borderColor: 'transparent',
                          background: 'transparent',
                          color: 'var(--text-muted)',
                          minHeight: 44,
                        }}
                  >
                    {label}
                  </button>
                )
              })}
            </div>

            {activeTab === 'details' && (
              <section className="mb-8">
                <div className="grid gap-4 lg:grid-cols-2">
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
                      {selected.historical_code && (
                        <span className="rounded-full px-2 py-0.5 text-[10px] font-medium" style={{ background: 'var(--panel-subtle)', color: 'var(--text-muted)', border: '1px solid var(--line)' }}>
                          formerly {selected.historical_code}
                        </span>
                      )}
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
                      <div data-tour="course-bid-summary" className="border-t pt-4" style={{ borderColor: 'var(--line)' }}>
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

                  <div data-tour="course-student-experience" className="surface-card rounded-[22px] p-5">
                    <h4 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted">Student Experience</h4>
                    {instructorPct != null ? (
                      <div className="mb-4 rounded-[18px] p-4" style={{ background: 'var(--panel-subtle)' }}>
                        <p className="text-sm text-muted">Instructor Rating</p>
                        <p className="text-2xl font-bold" style={{ color: LABEL_COLOR[selected.instructor_label] || 'var(--accent-strong)' }}>{selected.instructor_label}</p>
                        {metricMode === 'score' ? (
                          <p className="text-sm text-muted">
                            Score: <span className="font-medium" style={{ color: 'var(--accent-strong)' }}>{Math.round(instructorPct)}%</span>
                            {selected.metrics_raw?.Instructor_Rating != null && (
                              <span className="ml-2 text-[11px]" style={{ color: 'var(--text-muted)' }}>
                                ({selected.metrics_raw.Instructor_Rating.toFixed(2)}/5
                                {meta.year_medians_instructor?.[String(selected.year)] != null && (
                                  <span style={{ opacity: 0.75 }}> · yr med {meta.year_medians_instructor[String(selected.year)].toFixed(2)}</span>
                                )}
                                )
                              </span>
                            )}
                          </p>
                        ) : (
                          <p className="text-sm text-muted">
                            Better than {Math.round(instructorPct)} pct of courses
                            {selected.metrics_raw?.Instructor_Rating != null && (
                              <span className="ml-2 text-[11px]" style={{ color: 'var(--text-muted)' }}>
                                ({selected.metrics_raw.Instructor_Rating.toFixed(2)}/5
                                {meta.year_medians_instructor?.[String(selected.year)] != null && (
                                  <span style={{ opacity: 0.75 }}> · yr med {meta.year_medians_instructor[String(selected.year)].toFixed(2)}</span>
                                )}
                                )
                              </span>
                            )}
                          </p>
                        )}
                      </div>
                    ) : <div className="mb-4 rounded-[18px] p-4 text-sm italic text-muted" style={{ background: 'var(--panel-subtle)' }}>No instructor rating data available</div>}
                    {workloadPct != null ? (
                      <div className="rounded-[18px] p-4" style={{ background: 'var(--panel-subtle)' }}>
                        <p className="text-sm text-muted">Course Workload</p>
                        <p className="text-2xl font-bold" style={{ color: WORKLOAD_COLOR[selected.workload_label] || 'var(--text-soft)' }}>{selected.workload_label}</p>
                        {metricMode === 'score' ? (
                          <p className="text-sm text-muted">
                            Score: <span className="font-medium">{Math.round(workloadPct)}%</span>
                            {selected.metrics_raw?.Workload != null && (
                              <span className="ml-2 text-[11px]">({selected.metrics_raw.Workload.toFixed(2)}/5)</span>
                            )}
                          </p>
                        ) : (
                          <p className="text-sm text-muted">
                            More intensive than <span className="font-medium">{Math.round(workloadPct)} pct</span> of courses
                            {selected.metrics_raw?.Workload != null && (
                              <span className="ml-2 text-[11px]">({selected.metrics_raw.Workload.toFixed(2)}/5)</span>
                            )}
                          </p>
                        )}
                      </div>
                    ) : <div className="rounded-[18px] p-4 text-sm italic text-muted" style={{ background: 'var(--panel-subtle)' }}>No workload data available</div>}
                  </div>

                  <div data-tour="course-metrics" className="surface-card rounded-[22px] p-5 lg:col-span-2">
                    <div className="mb-3 flex items-center justify-between">
                      <h4 className="text-xs font-semibold uppercase tracking-wider text-muted">All Evaluation Metrics</h4>
                      <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                        {metricMode === 'score' ? 'Avg ÷ 5 × 100%' : 'Percentile vs. all courses'}
                      </span>
                    </div>
                    {selected.has_eval ? (
                      <>
                        <div className="grid gap-x-8 sm:grid-cols-2">
                          {meta.metrics.filter((m) => !m.bid_metric).map((metric) => (
                            <MetricRow
                              key={metric.key}
                              label={metric.label}
                              value={metricMode === 'score' ? selected.metrics_score?.[metric.key] : selected.metrics_pct?.[metric.key]}
                              higherBetter={metric.higher_is_better}
                              neutral={metric.key === 'Workload' || metric.key === 'Rigor'}
                              metricMode={metricMode}
                            />
                          ))}
                        </div>
                        {/* Raw 0-5 averages */}
                        <div className="mt-4">
                          <button
                            onClick={() => setShowRaw((v) => !v)}
                            className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[11px] font-medium transition-colors touch-manipulation min-h-[36px]"
                            onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--panel-subtle)' }}
                            onMouseLeave={(e) => { e.currentTarget.style.background = '' }}
                            style={{ color: 'var(--blue)' }}
                          >
                            <span style={{ display: 'inline-block', transform: showRaw ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.18s', fontSize: 9, lineHeight: 1 }}>▶</span>
                            Show raw averages (0–5 scale)
                          </button>
                          {showRaw && (
                            <div className="mt-3 grid gap-x-8 gap-y-1 sm:grid-cols-2">
                              {meta.metrics.filter((m) => !m.bid_metric).map((metric) => {
                                const raw = selected.metrics_raw?.[metric.key]
                                if (raw == null) return null
                                return (
                                  <div key={metric.key} className="flex items-center justify-between py-1 text-xs" style={{ borderBottom: '1px solid var(--line)' }}>
                                    <span className="text-muted">{metric.label}</span>
                                    <span className="font-medium tabular-nums" style={{ color: 'var(--text-soft)' }}>{raw.toFixed(2)} / 5</span>
                                  </div>
                                )
                              })}
                            </div>
                          )}
                        </div>
                      </>
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
                            data-tour="course-shortlist-btn"
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
                      {(() => {
                        const inPlan = planCodes.has(selected.course_code_base || selected.course_code)
                        return (
                          <button
                            onClick={() => addToPlan(selected)}
                            disabled={inPlan}
                            className="inline-flex items-center gap-1.5 rounded-full border px-4 py-2.5 text-sm font-medium transition-colors disabled:cursor-default"
                            style={{
                              borderColor: inPlan ? 'rgba(123,176,138,0.4)' : 'var(--line)',
                              color: inPlan ? 'var(--success)' : 'var(--text-muted)',
                              background: inPlan ? 'rgba(123,176,138,0.10)' : 'var(--panel-subtle)',
                            }}
                            title={inPlan ? 'Already in Plan A — open Schedule Builder to manage' : 'Add to Plan A in Schedule Builder'}
                          >
                            {inPlan ? '✓ In Plan A' : '+ Plan A'}
                          </button>
                        )
                      })()}
                      <button
                        onClick={() => navigate(`/compare?ids=${encodeURIComponent(selected.course_code_base || selected.course_code)}`)}
                        className="inline-flex items-center gap-1.5 rounded-full border px-4 py-2.5 text-sm font-medium transition-colors hover:text-label"
                        style={{ borderColor: 'var(--line)', color: 'var(--text-muted)', background: 'var(--panel-subtle)' }}
                        title="Open in Compare tab to stack against other courses"
                      >
                        ⇄ Compare
                      </button>
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
                </div>
              </section>
            )}

            {activeTab === 'performance' && (
              <section className="mb-8">
                <div>
                  {history.length === 0 ? (
                    <div className="surface-card rounded-[22px] py-8 text-center">
                      <p className="text-sm text-muted">No evaluation history found for this course.</p>
                    </div>
                  ) : (
                    <>
                      <p className="mb-4 text-xs text-muted">
                        Showing all {history.length} evaluation record{history.length !== 1 ? 's' : ''} for <span style={{ color: 'var(--accent-strong)' }}>{selected.course_code_base}</span>.
                      </p>
                      <HistoryTable history={history} metricMode={metricMode} />
                    </>
                  )}
                </div>
              </section>
            )}

            {activeTab === 'bidding' && (
              <section>
                <BiddingTab biddingHistory={biddingHistory} selected={selected} navigate={navigate} />
              </section>
            )}
          </div>
        )}

        <div className="app-footer mt-8">HKS Course Explorer by <a href="https://www.linkedin.com/in/michael-gritzbach/" target="_blank" rel="noopener noreferrer" style={{ color: 'inherit' }}>Michael Gritzbach</a> VUS&apos;18, MPA&apos;26 · {new Date().getFullYear()}</div>
      </main>
    </div>
  )
}
