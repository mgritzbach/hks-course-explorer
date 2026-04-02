import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'

const MAX_COURSES = 5

// All attributes available for comparison, grouped
const ATTRIBUTE_GROUPS = [
  {
    label: 'Evaluation Metrics',
    attrs: [
      { key: 'Instructor_Rating',    label: 'Instructor Rating',    type: 'pct', higherBetter: true },
      { key: 'Course_Rating',        label: 'Course Rating',        type: 'pct', higherBetter: true },
      { key: 'Workload',             label: 'Workload',             type: 'pct', higherBetter: false },
      { key: 'Rigor',                label: 'Rigor',                type: 'pct', higherBetter: true },
      { key: 'Diverse Perspectives', label: 'Diverse Perspectives', type: 'pct', higherBetter: true },
      { key: 'Feedback',             label: 'Feedback Quality',     type: 'pct', higherBetter: true },
      { key: 'Insights',             label: 'Insights',             type: 'pct', higherBetter: true },
      { key: 'Availability',         label: 'Availability',         type: 'pct', higherBetter: true },
      { key: 'Discussions',          label: 'Class Discussions',    type: 'pct', higherBetter: true },
      { key: 'Discussion Diversity', label: 'Discussion Diversity', type: 'pct', higherBetter: true },
      { key: 'Readings',             label: 'Readings',             type: 'pct', higherBetter: false },
      { key: 'Assignments',          label: 'Assignment Value',     type: 'pct', higherBetter: true },
    ],
  },
  {
    label: 'Course Info',
    attrs: [
      { key: 'concentration', label: 'Concentration',  type: 'text' },
      { key: 'is_core',       label: 'Core Course',    type: 'bool' },
      { key: 'is_stem',       label: 'STEM',           type: 'stem' },
      { key: 'n_respondents', label: 'N Respondents',  type: 'num' },
    ],
  },
  {
    label: 'Bidding',
    attrs: [
      { key: 'ever_bidding',    label: 'Has Bidding History', type: 'bool' },
      { key: 'last_bid_price',  label: 'Last Clearing Price', type: 'bid' },
    ],
  },
]

const DEFAULT_SELECTED = new Set([
  'Instructor_Rating', 'Course_Rating', 'Workload', 'Rigor',
  'Diverse Perspectives', 'concentration', 'is_core', 'ever_bidding', 'last_bid_price',
])

function pct(value) {
  if (value == null) return null
  return Math.round(value)
}

function getCellValue(course, attr, metricMode = 'score') {
  if (attr.type === 'pct') {
    return metricMode === 'score'
      ? course.metrics_score?.[attr.key] ?? null
      : course.metrics_pct?.[attr.key] ?? null
  }
  if (attr.type === 'text') return course[attr.key] ?? null
  if (attr.type === 'bool') return course[attr.key]
  if (attr.type === 'stem') return course.is_stem ? (course.stem_group ? `STEM ${course.stem_group}` : 'STEM') : null
  if (attr.type === 'num') return course[attr.key] ?? null
  if (attr.type === 'bid') return course.last_bid_price ?? null
  return null
}

function getBestIndex(courses, attr, metricMode = 'score') {
  if (!attr.higherBetter && attr.higherBetter !== false) return -1
  const values = courses.map((course) => getCellValue(course, attr, metricMode))
  const numValues = values.map((v) => (typeof v === 'number' ? v : null))
  const validValues = numValues.filter((v) => v != null)
  if (!validValues.length) return -1
  const best = attr.higherBetter ? Math.max(...validValues) : Math.min(...validValues)
  const bestIndex = numValues.findIndex((v) => v === best)
  return bestIndex
}

function MetricBar({ value, best, higherBetter }) {
  if (value == null) return <span className="text-muted">—</span>
  const isBest = best
  const rounded = Math.round(value)
  // Color based on whether the value is genuinely good or bad, not just "best in group"
  const barColor = higherBetter
    ? (rounded >= 75 ? 'var(--success)' : rounded >= 50 ? 'var(--gold)' : 'var(--danger)')
    : (rounded <= 25 ? 'var(--success)' : rounded <= 50 ? 'var(--gold)' : 'var(--danger)')

  return (
    <div className="flex items-center gap-2">
      <div className="relative h-1.5 flex-1 overflow-hidden rounded-full" style={{ background: `rgba(255,255,255,0.08)` }}>
        <div
          className="absolute left-0 top-0 h-full rounded-full transition-all"
          style={{ width: `${value}%`, background: barColor, opacity: isBest ? 0.85 : 0.45 }}
        />
      </div>
      <span
        className="w-10 shrink-0 text-right text-xs font-semibold"
        style={{ color: barColor, opacity: isBest ? 1 : 0.7 }}
      >
        {value}%
      </span>
    </div>
  )
}

function CourseChip({ course, onRemove }) {
  return (
    <div
      className="flex items-center gap-2 rounded-2xl border px-3 py-2 text-xs"
      style={{ background: 'var(--panel-subtle)', borderColor: 'var(--line)' }}
    >
      <span className="font-bold" style={{ color: 'var(--accent-strong)' }}>{course.course_code}</span>
      <span className="max-w-[120px] truncate text-muted">{course.course_name}</span>
      <button
        onClick={() => onRemove(course.id)}
        className="ml-1 rounded-full px-1 text-muted transition-colors hover:text-label"
        style={{ fontSize: 14, lineHeight: 1 }}
      >
        ×
      </button>
    </div>
  )
}

export default function Compare({ courses, meta, favs, metricMode = 'score' }) {
  const navigate = useNavigate()
  const [selected, setSelected] = useState([]) // array of course ids
  const [searchText, setSearchText] = useState('')
  const [selectedAttrs, setSelectedAttrs] = useState(DEFAULT_SELECTED)
  const [attrPanelOpen, setAttrPanelOpen] = useState(false)

  // Dedupe to averages if available, else latest year
  const candidatePool = useMemo(() => {
    const byBase = new Map()
    for (const course of courses) {
      if (!course.has_eval) continue
      const key = course.course_code_base || course.course_code
      if (!byBase.has(key)) byBase.set(key, [])
      byBase.get(key).push(course)
    }
    const result = []
    for (const group of byBase.values()) {
      const avg = group.find((c) => c.is_average)
      if (avg) { result.push(avg); continue }
      const latest = group.reduce((best, c) => (c.year > (best.year || 0) ? c : best), group[0])
      result.push(latest)
    }
    return result.sort((a, b) => (a.course_name || '').localeCompare(b.course_name || ''))
  }, [courses])

  const selectedCourses = useMemo(
    () => selected.map((id) => candidatePool.find((c) => c.id === id)).filter(Boolean),
    [selected, candidatePool]
  )

  const shortlistCourses = useMemo(() => {
    if (!favs?.count) return []
    return candidatePool.filter((c) => favs.isFavorite(c.course_code_base))
  }, [candidatePool, favs])

  const searchResults = useMemo(() => {
    if (!searchText.trim()) return []
    const terms = searchText.toLowerCase().split(',').map((t) => t.trim()).filter(Boolean)
    return candidatePool
      .filter((c) => !selected.includes(c.id))
      .filter((c) => {
        const haystack = [c.course_name, c.course_code, c.professor_display, c.concentration].join(' ').toLowerCase()
        return terms.some((t) => haystack.includes(t))
      })
      .slice(0, 8)
  }, [searchText, candidatePool, selected])

  const addCourse = (id) => {
    if (selected.length >= MAX_COURSES || selected.includes(id)) return
    setSelected((prev) => [...prev, id])
    setSearchText('')
  }

  const removeCourse = (id) => setSelected((prev) => prev.filter((s) => s !== id))

  const toggleAttr = (key) => {
    setSelectedAttrs((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const allAttrs = ATTRIBUTE_GROUPS.flatMap((g) => g.attrs).filter((a) => selectedAttrs.has(a.key))

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto px-4 py-4 md:px-6 md:py-6">
      {/* Header */}
      <div className="panel-shell mb-5 overflow-hidden">
        <div className="px-5 py-5 md:px-7 md:py-6">
          <p className="kicker mb-2">Side-by-side analysis</p>
          <h1 className="serif-display text-3xl font-semibold md:text-[2.5rem]" style={{ color: 'var(--text)' }}>
            Compare Courses
          </h1>
          <p className="mt-2 max-w-2xl text-sm" style={{ color: 'var(--text-soft)' }}>
            Select up to {MAX_COURSES} courses and choose which attributes to compare side by side.
          </p>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_auto]">
        {/* Left: selector + results */}
        <div className="space-y-4">
          {/* Search & shortlist */}
          <div className="surface-card rounded-[22px] p-5">
            <p className="filter-label mb-3">Add Courses ({selected.length}/{MAX_COURSES})</p>

            {/* Selected chips */}
            {selectedCourses.length > 0 && (
              <div className="mb-3 flex flex-wrap gap-2">
                {selectedCourses.map((course) => (
                  <CourseChip key={course.id} course={course} onRemove={removeCourse} />
                ))}
              </div>
            )}

            {/* Search input */}
            {selected.length < MAX_COURSES && (
              <div className="relative">
                <input
                  type="text"
                  value={searchText}
                  onChange={(e) => setSearchText(e.target.value)}
                  placeholder="Search by name, code, professor…"
                  style={{ marginBottom: 0 }}
                />
                {searchText && (
                  <button
                    onClick={() => setSearchText('')}
                    className="search-clear-btn"
                    aria-label="Clear"
                  >×</button>
                )}
                {searchResults.length > 0 && (
                  <div
                    className="absolute left-0 right-0 top-full z-20 mt-1 overflow-hidden rounded-[18px] shadow-xl"
                    style={{ background: 'var(--panel-strong)', border: '1px solid var(--line-strong)' }}
                  >
                    {searchResults.map((course) => (
                      <button
                        key={course.id}
                        onClick={() => addCourse(course.id)}
                        className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-white/5"
                        style={{ borderBottom: '1px solid var(--line)' }}
                      >
                        <span className="mt-0.5 shrink-0 text-xs font-bold" style={{ color: 'var(--accent-strong)' }}>
                          {course.course_code}
                        </span>
                        <div className="min-w-0">
                          <p className="truncate text-xs font-medium text-label">{course.course_name}</p>
                          <p className="truncate text-[11px] text-muted">{course.professor_display}</p>
                        </div>
                        <span className="ml-auto shrink-0 text-[11px] text-muted">
                          {course.is_average ? `avg` : `${course.year}`}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Quick-add from shortlist */}
            {shortlistCourses.length > 0 && (
              <div className="mt-4">
                <p className="filter-label mb-2">From your shortlist</p>
                <div className="flex flex-wrap gap-2">
                  {shortlistCourses.map((course) => {
                    const alreadyAdded = selected.includes(course.id)
                    return (
                      <button
                        key={course.id}
                        onClick={() => addCourse(course.id)}
                        disabled={alreadyAdded || selected.length >= MAX_COURSES}
                        className="rounded-full px-3 py-1.5 text-[11px] font-semibold transition-all"
                        style={alreadyAdded
                          ? { background: 'var(--accent-soft)', border: '1px solid rgba(165,28,48,0.3)', color: 'var(--accent-strong)', opacity: 0.6 }
                          : { background: 'var(--panel-subtle)', border: '1px solid var(--line)', color: 'var(--text-muted)', cursor: 'pointer' }}
                      >
                        {alreadyAdded ? '✓ ' : '+ '}{course.course_code}
                      </button>
                    )
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Attribute selector */}
          <div className="surface-card rounded-[22px] p-5">
            <button
              onClick={() => setAttrPanelOpen((v) => !v)}
              className="flex w-full items-center justify-between"
            >
              <span className="filter-label">Attributes to Compare ({selectedAttrs.size} selected)</span>
              <span className="text-xs text-muted">{attrPanelOpen ? '▲ Hide' : '▼ Show'}</span>
            </button>
            {attrPanelOpen && (
              <div className="mt-4 space-y-5">
                {ATTRIBUTE_GROUPS.map((group) => (
                  <div key={group.label}>
                    <p className="filter-label mb-2">{group.label}</p>
                    <div className="flex flex-wrap gap-2">
                      {group.attrs.map((attr) => {
                        const on = selectedAttrs.has(attr.key)
                        return (
                          <button
                            key={attr.key}
                            onClick={() => toggleAttr(attr.key)}
                            className="rounded-full px-3 py-1.5 text-[11px] font-semibold transition-all"
                            style={on
                              ? { background: 'var(--accent-soft)', border: '1px solid rgba(165,28,48,0.3)', color: 'var(--accent-strong)' }
                              : { background: 'var(--panel-subtle)', border: '1px solid var(--line)', color: 'var(--text-muted)' }}
                          >
                            {attr.label}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right: quick guide when empty */}
        {selectedCourses.length === 0 && (
          <div
            className="hidden rounded-[22px] px-6 py-8 text-center lg:flex lg:flex-col lg:items-center lg:justify-center"
            style={{ minWidth: 220, background: 'var(--panel-subtle)', border: '1px solid var(--line)' }}
          >
            <p className="mb-2 text-3xl">⇄</p>
            <p className="mb-1 font-medium text-label">No courses selected</p>
            <p className="max-w-[160px] text-[11px] text-muted">Search above or pick from your shortlist to start comparing.</p>
          </div>
        )}
      </div>

      {/* Comparison table */}
      {selectedCourses.length >= 2 && allAttrs.length > 0 && (
        <div className="overflow-x-auto" style={{ minWidth: `${200 + selectedCourses.length * 160}px` }}>
          <div className="surface-card mt-5 overflow-hidden rounded-[22px]">
            {/* Course headers */}
            <div
              className="grid border-b"
              style={{
                gridTemplateColumns: `200px repeat(${selectedCourses.length}, minmax(160px, 1fr))`,
                borderColor: 'var(--line)',
                background: 'var(--panel-subtle)',
              }}
            >
            <div className="border-r px-4 py-4" style={{ borderColor: 'var(--line)' }}>
              <p className="filter-label">Attribute</p>
            </div>
            {selectedCourses.map((course) => (
              <div
                key={course.id}
                className="border-r px-3 py-3 last:border-r-0"
                style={{ borderColor: 'var(--line)' }}
              >
                <button
                  onClick={() => navigate(`/courses?id=${encodeURIComponent(course.id)}`)}
                  className="block text-left transition-opacity hover:opacity-80"
                >
                  <p className="text-xs font-bold" style={{ color: 'var(--accent-strong)' }}>{course.course_code}</p>
                  <p className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-label">{course.course_name}</p>
                  <p className="mt-1 truncate text-[10px] text-muted">{course.professor_display}</p>
                  <p className="text-[10px] text-muted">
                    {course.is_average ? `avg ${course.year_range}` : `${course.term} ${course.year}`}
                  </p>
                </button>
                <button
                  onClick={() => removeCourse(course.id)}
                  className="mt-2 text-[10px] text-muted transition-colors hover:text-label"
                >
                  Remove ×
                </button>
              </div>
            ))}
          </div>

            {/* Attribute rows */}
            {allAttrs.map((attr, attrIdx) => {
              const bestIndex = getBestIndex(selectedCourses, attr, metricMode)
              return (
                <div
                  key={attr.key}
                  className="grid border-b last:border-b-0"
                  style={{
                    gridTemplateColumns: `200px repeat(${selectedCourses.length}, minmax(160px, 1fr))`,
                    borderColor: 'var(--line)',
                    background: attrIdx % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.012)',
                  }}
                >
                {/* Attr label */}
                <div
                  className="border-r px-4 py-3"
                  style={{ borderColor: 'var(--line)', display: 'flex', alignItems: 'center' }}
                >
                  <div>
                    <p className="text-[11px] font-semibold text-label">{attr.label}</p>
                    {attr.type === 'pct' && (
                      <p className="text-[10px] text-muted">
                        {attr.higherBetter ? 'higher better' : 'lower better'}
                      </p>
                    )}
                  </div>
                </div>

                {/* Course cells */}
                {selectedCourses.map((course, courseIdx) => {
                  const value = getCellValue(course, attr, metricMode)
                  const isBest = courseIdx === bestIndex

                  return (
                    <div
                      key={course.id}
                      className="border-r px-3 py-3 last:border-r-0"
                      style={{
                        borderColor: 'var(--line)',
                        background: isBest ? (attr.higherBetter ? 'rgba(123,176,138,0.06)' : 'rgba(165,28,48,0.06)') : 'transparent',
                      }}
                    >
                      {attr.type === 'pct' ? (
                        <MetricBar
                          value={pct(value)}
                          best={isBest}
                          higherBetter={attr.higherBetter}
                        />
                      ) : attr.type === 'bool' ? (
                        <span
                          className="text-xs font-semibold"
                          style={{ color: value ? 'var(--success)' : 'var(--text-muted)' }}
                        >
                          {value ? 'Yes' : 'No'}
                        </span>
                      ) : attr.type === 'bid' ? (
                        <span className="text-xs font-semibold" style={{ color: value ? 'var(--gold)' : 'var(--text-muted)' }}>
                          {value != null ? `${value} pts` : '—'}
                        </span>
                      ) : (
                        <span className="text-xs" style={{ color: value ? 'var(--text-soft)' : 'var(--text-muted)' }}>
                          {value ?? '—'}
                        </span>
                      )}
                    </div>
                  )
                })}
              </div>
            )
          })}
            </div>
          </div>
      )}

      {selectedCourses.length === 1 && (
        <div className="mt-4 rounded-[18px] px-4 py-3 text-center text-sm text-muted" style={{ background: 'var(--panel-subtle)', border: '1px solid var(--line)' }}>
          Add at least one more course to see the comparison.
        </div>
      )}

      <div className="app-footer mt-8">
        HKS Course Explorer by Michael Gritzbach MPA&apos;26 · Data from HKS QReports · {new Date().getFullYear()}
      </div>
    </div>
  )
}
