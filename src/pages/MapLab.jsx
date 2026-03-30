import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'

const STOPWORDS = new Set([
  'a', 'about', 'after', 'all', 'also', 'an', 'and', 'any', 'are', 'as', 'at', 'be', 'because', 'been', 'before',
  'being', 'between', 'both', 'but', 'by', 'can', 'course', 'courses', 'for', 'from', 'how', 'if', 'in', 'into',
  'is', 'it', 'its', 'may', 'more', 'not', 'of', 'on', 'or', 'our', 'policy', 'public', 'students', 'that', 'the',
  'their', 'them', 'there', 'these', 'this', 'through', 'to', 'using', 'we', 'what', 'when', 'which', 'who', 'will',
  'with', 'your',
])

const PREFIX_COLORS = {
  API: '#3b82f6',
  BGP: '#f59e0b',
  DEV: '#22c55e',
  DPI: '#ef4444',
  IGA: '#8b5cf6',
  MLD: '#a16207',
  SUP: '#ec4899',
}

function stableHash(text) {
  let hash = 2166136261
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function tokenize(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length >= 3 && !STOPWORDS.has(token))
}

function projectWeight(token, salt) {
  const hash = stableHash(`${salt}:${token}`)
  return ((hash % 2000) / 1000) - 1
}

function dedupeCourses(courses) {
  const grouped = new Map()

  for (const course of courses) {
    const key = course.course_code_base || course.course_code
    if (!grouped.has(key)) grouped.set(key, [])
    grouped.get(key).push(course)
  }

  return Array.from(grouped.values()).map((group) => {
    const sorted = [...group].sort((a, b) => (b.year || 0) - (a.year || 0))
    const base = sorted[0]
    return {
      ...base,
      professor_display: [...new Set(group.map((course) => course.professor_display || course.professor).filter(Boolean))].join(', '),
    }
  })
}

function buildCourseText(course) {
  return [
    course.course_name,
    course.description,
    course.concentration,
  ].filter(Boolean).join(' ')
}

function normalizePoints(points) {
  if (!points.length) return []

  const xs = points.map((point) => point.rawX)
  const ys = points.map((point) => point.rawY)
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  const spanX = Math.max(maxX - minX, 0.0001)
  const spanY = Math.max(maxY - minY, 0.0001)
  const padding = 7

  return points.map((point) => {
    const normalizedX = padding + ((point.rawX - minX) / spanX) * (100 - padding * 2)
    const normalizedY = padding + ((point.rawY - minY) / spanY) * (100 - padding * 2)
    const jitterX = ((stableHash(`${point.id}:jx`) % 1000) / 1000 - 0.5) * 1.5
    const jitterY = ((stableHash(`${point.id}:jy`) % 1000) / 1000 - 0.5) * 1.5

    return {
      ...point,
      x: Math.max(4, Math.min(96, normalizedX + jitterX)),
      y: Math.max(4, Math.min(96, normalizedY + jitterY)),
    }
  })
}

function buildSimilarityMap(courses) {
  const deduped = dedupeCourses(courses).filter((course) => buildCourseText(course).trim().length > 0)
  if (!deduped.length) return []

  const docs = deduped.map((course) => {
    const tokens = tokenize(buildCourseText(course))
    const counts = new Map()
    for (const token of tokens) counts.set(token, (counts.get(token) || 0) + 1)
    return { course, counts, tokens, total: tokens.length || 1 }
  })

  const docFrequency = new Map()
  for (const doc of docs) {
    for (const token of new Set(doc.tokens)) {
      docFrequency.set(token, (docFrequency.get(token) || 0) + 1)
    }
  }

  const vocab = Array.from(docFrequency.entries())
    .filter(([, frequency]) => frequency <= Math.max(2, Math.floor(docs.length * 0.7)))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 240)
    .map(([token]) => token)

  const vocabSet = new Set(vocab)
  const totalDocs = docs.length

  const projected = docs.map(({ course, counts, total }) => {
    let rawX = 0
    let rawY = 0
    let magnitude = 0

    for (const [token, count] of counts.entries()) {
      if (!vocabSet.has(token)) continue
      const tf = count / total
      const idf = Math.log((1 + totalDocs) / (1 + (docFrequency.get(token) || 1))) + 1
      const weight = tf * idf
      rawX += weight * projectWeight(token, 'x')
      rawY += weight * projectWeight(token, 'y')
      magnitude += weight
    }

    if (magnitude === 0) {
      rawX = projectWeight(course.course_code || course.id, 'fallback-x')
      rawY = projectWeight(course.course_code || course.id, 'fallback-y')
    } else {
      rawX /= magnitude
      rawY /= magnitude
    }

    rawX += projectWeight(course.concentration || 'other', 'concentration-x') * 0.28
    rawY += projectWeight(course.concentration || 'other', 'concentration-y') * 0.28

    return {
      ...course,
      rawX,
      rawY,
      prefix: (course.course_code || '').split('-')[0] || course.concentration || 'Other',
      color: PREFIX_COLORS[(course.course_code || '').split('-')[0]] || `hsl(${stableHash(course.concentration || 'other') % 360} 60% 58%)`,
    }
  })

  return normalizePoints(projected)
}

function distance(a, b) {
  const dx = a.x - b.x
  const dy = a.y - b.y
  return Math.sqrt(dx * dx + dy * dy)
}

export default function MapLab({ courses }) {
  const navigate = useNavigate()
  const [selectedId, setSelectedId] = useState(null)
  const [filters, setFilters] = useState({
    searchText: '',
    concentration: 'All',
    year: 'all',
    evalOnly: false,
  })

  const concentrations = useMemo(
    () => [...new Set(courses.map((course) => course.concentration).filter(Boolean))].sort(),
    [courses],
  )

  const years = useMemo(
    () => [...new Set(courses.map((course) => course.year).filter((year) => year != null && year !== 0))].sort((a, b) => b - a),
    [courses],
  )

  const filteredCourses = useMemo(() => {
    const search = filters.searchText.trim().toLowerCase()
    return courses.filter((course) => {
      if (filters.concentration !== 'All' && course.concentration !== filters.concentration) return false
      if (filters.year !== 'all' && course.year !== filters.year) return false
      if (filters.evalOnly && !course.has_eval) return false

      if (search) {
        const haystack = [
          course.course_code,
          course.course_name,
          course.description,
          course.concentration,
          course.professor_display,
          course.professor,
        ].filter(Boolean).join(' ').toLowerCase()
        if (!haystack.includes(search)) return false
      }

      return true
    })
  }, [courses, filters])

  const points = useMemo(() => buildSimilarityMap(filteredCourses), [filteredCourses])

  const selected = useMemo(
    () => points.find((point) => point.id === selectedId) || points[0] || null,
    [points, selectedId],
  )

  const neighbors = useMemo(() => {
    if (!selected) return []
    return points
      .filter((point) => point.id !== selected.id)
      .map((point) => ({ ...point, similarityDistance: distance(selected, point) }))
      .sort((a, b) => a.similarityDistance - b.similarityDistance)
      .slice(0, 8)
  }, [points, selected])

  const concentrationCounts = useMemo(() => {
    const grouped = new Map()
    for (const point of points) {
      const key = point.concentration || 'Other'
      grouped.set(key, (grouped.get(key) || 0) + 1)
    }
    return [...grouped.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6)
  }, [points])

  if (!points.length) {
    return (
      <main className="flex h-full min-w-0 flex-1 flex-col overflow-y-auto px-4 py-4 md:px-6 md:py-6">
        <div className="surface-card rounded-[24px] px-6 py-10 text-center">
          <p className="mb-2 text-lg font-semibold text-label">Map Lab Placeholder</p>
          <p className="text-sm text-muted">No courses with enough title, description, and concentration text were available to generate the test map.</p>
        </div>
      </main>
    )
  }

  return (
    <main className="flex h-full min-w-0 flex-1 flex-col overflow-y-auto px-4 py-4 md:px-6 md:py-6">
      <section className="panel-shell mb-5 overflow-hidden">
        <div className="flex flex-wrap items-start justify-between gap-4 px-5 py-5 md:px-7 md:py-7">
          <div className="min-w-0 flex-1">
            <p className="kicker mb-2">Separate testing page</p>
            <h1 className="serif-display text-3xl font-semibold md:text-[2.5rem]" style={{ color: 'var(--text)' }}>
              Course Map Lab
            </h1>
            <p className="mt-3 max-w-3xl text-sm md:text-[15px]" style={{ color: 'var(--text-soft)' }}>
              This is a standalone prototype map built from scratch for testing. Similarity is based on course title, course description, and concentration.
            </p>
          </div>
          <div className="rounded-2xl border px-4 py-3 text-xs md:text-sm" style={{ borderColor: 'var(--line)', background: 'rgba(255,255,255,0.025)' }}>
            <span style={{ color: 'var(--text-muted)' }}>Prototype coverage</span>
            <p className="mt-1 font-medium" style={{ color: 'var(--text)' }}>{points.length} courses mapped</p>
          </div>
        </div>

        <div className="flex flex-wrap gap-3 border-t px-5 py-4 md:px-7" style={{ borderColor: 'var(--line)', background: 'rgba(255,255,255,0.015)' }}>
          <div className="rounded-2xl border px-4 py-3 text-xs md:text-sm" style={{ borderColor: 'var(--line)', background: 'rgba(255,255,255,0.025)' }}>
            <span style={{ color: 'var(--text-muted)' }}>Input signals</span>
            <p className="mt-1 font-medium" style={{ color: 'var(--text)' }}>Title + description + concentration</p>
          </div>
          <div className="rounded-2xl border px-4 py-3 text-xs md:text-sm" style={{ borderColor: 'var(--line)', background: 'rgba(255,255,255,0.025)' }}>
            <span style={{ color: 'var(--text-muted)' }}>Rendering</span>
            <p className="mt-1 font-medium" style={{ color: 'var(--text)' }}>Custom SVG placeholder map</p>
          </div>
          <div className="rounded-2xl border px-4 py-3 text-xs md:text-sm" style={{ borderColor: 'var(--line)', background: 'rgba(255,255,255,0.025)' }}>
            <span style={{ color: 'var(--text-muted)' }}>Test goal</span>
            <p className="mt-1 font-medium" style={{ color: 'var(--text)' }}>Reliable first visible version</p>
          </div>
        </div>

        <div className="grid gap-3 border-t px-5 py-4 md:grid-cols-4 md:px-7" style={{ borderColor: 'var(--line)', background: 'rgba(255,255,255,0.01)' }}>
          <div>
            <p className="mb-1 text-[10px] uppercase tracking-[0.14em] text-muted">Search</p>
            <input
              type="text"
              value={filters.searchText}
              onChange={(event) => setFilters((current) => ({ ...current, searchText: event.target.value }))}
              placeholder="Climate, negotiation, data..."
            />
          </div>
          <div>
            <p className="mb-1 text-[10px] uppercase tracking-[0.14em] text-muted">Concentration</p>
            <div className="select-wrap">
              <select
                value={filters.concentration}
                onChange={(event) => setFilters((current) => ({ ...current, concentration: event.target.value }))}
              >
                <option value="All">All concentrations</option>
                {concentrations.map((concentration) => (
                  <option key={concentration} value={concentration}>{concentration}</option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <p className="mb-1 text-[10px] uppercase tracking-[0.14em] text-muted">Year</p>
            <div className="select-wrap">
              <select
                value={filters.year}
                onChange={(event) => setFilters((current) => ({
                  ...current,
                  year: event.target.value === 'all' ? 'all' : Number(event.target.value),
                }))}
              >
                <option value="all">All years</option>
                {years.map((year) => (
                  <option key={year} value={year}>{year}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="flex items-end">
            <label className="flex items-center gap-2 text-xs text-label">
              <input
                type="checkbox"
                checked={filters.evalOnly}
                onChange={(event) => setFilters((current) => ({ ...current, evalOnly: event.target.checked }))}
                className="h-3.5 w-3.5 cursor-pointer accent-accent"
              />
              Only courses with evals
            </label>
          </div>
        </div>
      </section>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
        <section className="surface-card rounded-[24px] p-4 md:p-5">
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-label">Prototype Similarity Map</p>
              <p className="mt-1 text-xs text-muted">Click any dot to inspect a course and review nearby neighbors.</p>
            </div>
            <div className="rounded-full px-3 py-1 text-[11px] font-medium" style={{ background: 'var(--panel-subtle)', border: '1px solid var(--line)', color: 'var(--text-muted)' }}>
              Placeholder version for testing
            </div>
          </div>

          <div className="overflow-hidden rounded-[22px]" style={{ border: '1px solid var(--line)', background: 'linear-gradient(180deg, rgba(255,255,255,0.018), rgba(255,255,255,0.008))' }}>
            <svg viewBox="0 0 1000 720" className="block h-auto w-full">
              <defs>
                <linearGradient id="mapBg" x1="0" x2="1" y1="0" y2="1">
                  <stop offset="0%" stopColor="rgba(165, 28, 48, 0.14)" />
                  <stop offset="55%" stopColor="rgba(255, 255, 255, 0.02)" />
                  <stop offset="100%" stopColor="rgba(61, 110, 138, 0.1)" />
                </linearGradient>
              </defs>

              <rect x="0" y="0" width="1000" height="720" fill="url(#mapBg)" />

              {points.map((point) => {
                const isSelected = selected?.id === point.id
                const cx = point.x * 10
                const cy = point.y * 7.2
                const radius = isSelected ? 11 : 7
                return (
                  <g key={point.id}>
                    {isSelected && <circle cx={cx} cy={cy} r="19" fill="rgba(243,235,226,0.08)" />}
                    <circle
                      cx={cx}
                      cy={cy}
                      r={radius}
                      fill={point.color}
                      stroke={isSelected ? '#f3ebe2' : 'rgba(243,235,226,0.18)'}
                      strokeWidth={isSelected ? 3 : 1.25}
                      style={{ cursor: 'pointer' }}
                      onClick={() => setSelectedId(point.id)}
                    />
                  </g>
                )
              })}
            </svg>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            {concentrationCounts.map(([concentration, count]) => (
              <span
                key={concentration}
                className="rounded-full px-3 py-1 text-[11px] font-medium"
                style={{ background: 'var(--panel-subtle)', border: '1px solid var(--line)', color: 'var(--text-muted)' }}
              >
                {concentration}: {count}
              </span>
            ))}
          </div>
        </section>

        <aside className="flex flex-col gap-5">
          <section className="surface-card rounded-[24px] p-5">
            <p className="mb-3 text-sm font-semibold text-label">Selected Course</p>
            {selected ? (
              <>
                <p className="text-sm font-bold" style={{ color: 'var(--accent-strong)' }}>{selected.course_code}</p>
                <p className="mt-1 text-base text-label">{selected.course_name}</p>
                <p className="mt-2 text-sm text-muted">{selected.professor_display || selected.professor || 'Instructor unavailable'}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {selected.concentration && (
                    <span className="rounded-full px-2.5 py-1 text-[10px] font-medium" style={{ background: 'var(--blue-soft)', color: 'var(--blue)' }}>
                      {selected.concentration}
                    </span>
                  )}
                  {selected.term && selected.year && (
                    <span className="rounded-full px-2.5 py-1 text-[10px] font-medium" style={{ background: 'var(--panel-subtle)', border: '1px solid var(--line)', color: 'var(--text-muted)' }}>
                      {selected.term} {selected.year}
                    </span>
                  )}
                </div>
                <p className="mt-4 text-sm leading-6 text-label">
                  {selected.description || 'No description available for this course.'}
                </p>
                <button onClick={() => navigate(`/courses?id=${encodeURIComponent(selected.id)}`)} className="btn-details mt-4">
                  Open Course Details
                </button>
              </>
            ) : (
              <p className="text-sm text-muted">Choose a point on the map to inspect it.</p>
            )}
          </section>

          <section className="surface-card rounded-[24px] p-5">
            <p className="mb-3 text-sm font-semibold text-label">Nearest Neighbors</p>
            <div className="flex flex-col gap-2">
              {neighbors.map((neighbor) => (
                <button
                  key={neighbor.id}
                  onClick={() => setSelectedId(neighbor.id)}
                  className="rounded-[18px] px-3 py-3 text-left transition-colors hover:bg-[rgba(165,28,48,0.05)]"
                  style={{ background: 'var(--panel-subtle)' }}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-bold" style={{ color: 'var(--accent-strong)' }}>{neighbor.course_code}</span>
                    <span className="text-[10px] text-muted">{neighbor.similarityDistance.toFixed(1)} away</span>
                  </div>
                  <p className="mt-1 text-xs text-label">{neighbor.course_name}</p>
                  <p className="mt-1 text-[11px] text-muted">{neighbor.concentration || 'No concentration'}</p>
                </button>
              ))}
            </div>
          </section>
        </aside>
      </div>
    </main>
  )
}
