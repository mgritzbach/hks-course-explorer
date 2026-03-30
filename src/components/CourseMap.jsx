import { useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Plot from 'react-plotly.js'

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
  MLD: '#a78bfa',
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

function projectWeight(token, salt) {
  const hash = stableHash(`${salt}:${token}`)
  return ((hash % 2000) / 1000) - 1
}

function tokenize(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length >= 3 && !STOPWORDS.has(token))
}

function dedupeCourses(courses) {
  const grouped = new Map()

  for (const course of courses) {
    const key = course.year === 0
      ? `${course.course_code_base || course.course_code}||avg`
      : `${course.course_code_base || course.course_code}||${course.year}||${course.term}`
    if (!grouped.has(key)) grouped.set(key, [])
    grouped.get(key).push(course)
  }

  return Array.from(grouped.values()).map((group) => {
    const base = group[0]
    return {
      ...base,
      id: base.id,
      professor_display: [...new Set(group.map((course) => course.professor_display || course.professor).filter(Boolean))].join(', '),
      n_respondents: group.reduce((sum, course) => sum + (course.n_respondents || 0), 0) || null,
      ever_bidding: group.some((course) => course.ever_bidding),
      last_bid_price: Math.max(...group.map((course) => course.last_bid_price ?? -1)) >= 0
        ? Math.max(...group.map((course) => course.last_bid_price ?? -1))
        : null,
    }
  })
}

function buildCourseText(course) {
  return [
    course.course_name,
    course.description,
    course.concentration,
    course.academic_area,
    course.prerequisites,
    course.section_notes?.join(' '),
  ].filter(Boolean).join(' ')
}

function normalizeCoordinates(points) {
  if (!points.length) return []
  if (points.length === 1) return [{ ...points[0], mapX: 50, mapY: 50 }]

  const xs = points.map((point) => point.rawX)
  const ys = points.map((point) => point.rawY)
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  const spanX = Math.max(maxX - minX, 0.0001)
  const spanY = Math.max(maxY - minY, 0.0001)
  const padding = 8

  return points.map((point, index) => {
    const normalizedX = padding + ((point.rawX - minX) / spanX) * (100 - padding * 2)
    const normalizedY = padding + ((point.rawY - minY) / spanY) * (100 - padding * 2)
    const jitterX = ((stableHash(`${point.id}:jx`) % 1000) / 1000 - 0.5) * 1.4
    const jitterY = ((stableHash(`${point.id}:jy`) % 1000) / 1000 - 0.5) * 1.4

    return {
      ...point,
      mapX: Math.max(4, Math.min(96, normalizedX + (points.length <= 8 ? 0 : jitterX))),
      mapY: Math.max(4, Math.min(96, normalizedY + (points.length <= 8 ? 0 : jitterY))),
      labelIndex: index,
    }
  })
}

function buildDescriptionMap(courses) {
  const deduped = dedupeCourses(courses).filter((course) => buildCourseText(course).trim().length > 0)
  if (!deduped.length) return []

  const docs = deduped.map((course) => {
    const tokens = tokenize(buildCourseText(course))
    const counts = new Map()
    for (const token of tokens) counts.set(token, (counts.get(token) || 0) + 1)
    return { course, tokens, counts, total: tokens.length || 1 }
  })

  const docFrequency = new Map()
  for (const doc of docs) {
    for (const token of new Set(doc.tokens)) docFrequency.set(token, (docFrequency.get(token) || 0) + 1)
  }

  const maxDocFrequency = Math.max(2, Math.floor(docs.length * 0.72))
  const vocab = Array.from(docFrequency.entries())
    .filter(([, frequency]) => frequency >= 1 && frequency <= maxDocFrequency)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 220)
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

    rawX += projectWeight(course.concentration || 'other', 'group-x') * 0.16
    rawY += projectWeight(course.concentration || 'other', 'group-y') * 0.16

    return {
      ...course,
      rawX,
      rawY,
      prefix: (course.course_code || '').split('-')[0] || course.concentration || 'Other',
    }
  })

  return normalizeCoordinates(projected)
}

function countCoursesWithMapText(courses) {
  return dedupeCourses(courses).filter((course) => buildCourseText(course).trim().length > 0).length
}

function MapHoverCard({ datum }) {
  if (!datum) return null

  return (
    <div
      className="rounded-2xl px-3 py-2 text-xs shadow-lg"
      style={{
        background: 'var(--panel-strong)',
        border: '1px solid var(--line-strong)',
        color: 'var(--text)',
        width: 320,
        maxWidth: 'calc(100vw - 48px)',
        boxShadow: 'var(--shadow-lg)',
      }}
    >
      <p className="text-sm font-bold" style={{ color: 'var(--accent-strong)' }}>{datum.course_code}</p>
      <p className="mb-1 leading-snug text-label">{datum.course_name}</p>
      <p className="text-muted">{datum.professor_display || datum.professor}</p>
      <p className="mb-2 text-muted">{datum.is_average ? `avg ${datum.year_range}` : `${datum.term} ${datum.year}`}</p>
      <div className="space-y-0.5">
        {datum.metrics_pct?.Instructor_Rating != null && (
          <p>Instructor: <span className="font-medium" style={{ color: 'var(--accent-strong)' }}>{Math.round(datum.metrics_pct.Instructor_Rating)}%</span></p>
        )}
        {datum.metrics_pct?.Course_Rating != null && (
          <p>Course: <span className="font-medium" style={{ color: 'var(--success)' }}>{Math.round(datum.metrics_pct.Course_Rating)}%</span></p>
        )}
        {datum.metrics_pct?.Workload != null && (
          <p>Workload: <span className="font-medium text-label">{Math.round(datum.metrics_pct.Workload)}%</span></p>
        )}
        {datum.n_respondents != null && <p className="text-muted">N={datum.n_respondents} respondents</p>}
        {datum.ever_bidding && <p style={{ color: '#e6a4bb' }}>Has bidding history</p>}
      </div>
      <p className="mt-1 text-[10px]" style={{ color: 'var(--blue)' }}>Click to open course details</p>
    </div>
  )
}

export default function CourseMap({ courses }) {
  const navigate = useNavigate()
  const wrapperRef = useRef(null)
  const [hoverState, setHoverState] = useState(null)
  const points = useMemo(() => buildDescriptionMap(courses), [courses])
  const sourceCourseCount = useMemo(() => countCoursesWithMapText(courses), [courses])
  const omittedCourseCount = Math.max(0, dedupeCourses(courses).length - sourceCourseCount)

  const legend = useMemo(() => {
    const prefixes = [...new Set(points.map((point) => point.prefix))].sort()
    return prefixes.map((prefix) => ({
      prefix,
      color: PREFIX_COLORS[prefix] || `hsl(${stableHash(prefix) % 360} 62% 58%)`,
    }))
  }, [points])

  const traces = useMemo(() => {
    if (!points.length) return []
    return legend.map(({ prefix, color }) => {
      const groupPoints = points.filter((point) => point.prefix === prefix)
      return {
        type: 'scattergl',
        mode: 'markers',
        name: prefix,
        x: groupPoints.map((point) => point.mapX),
        y: groupPoints.map((point) => point.mapY),
        customdata: groupPoints,
        hoverinfo: 'none',
        showlegend: true,
        marker: {
          size: groupPoints.map((point) => (point.ever_bidding ? 13 : 10)),
          color,
          opacity: 0.92,
          line: {
            width: groupPoints.map((point) => (point.ever_bidding ? 3 : 1)),
            color: groupPoints.map((point) => (point.ever_bidding ? '#f4a5c4' : 'rgba(255,255,255,0.18)')),
          },
        },
      }
    })
  }, [legend, points])

  const layout = useMemo(() => ({
    autosize: true,
    paper_bgcolor: 'rgba(0,0,0,0)',
    plot_bgcolor: 'rgba(0,0,0,0)',
    margin: { t: 10, r: 20, b: 10, l: 10 },
    dragmode: 'pan',
    hovermode: 'closest',
    showlegend: true,
    legend: {
      orientation: 'v',
      x: 1.01,
      xanchor: 'left',
      y: 0.98,
      font: { color: '#d8cdc5', size: 11 },
      bgcolor: 'rgba(0,0,0,0)',
    },
    xaxis: {
      range: [0, 100],
      visible: false,
      fixedrange: false,
      minallowed: 0,
      maxallowed: 100,
    },
    yaxis: {
      range: [0, 100],
      visible: false,
      fixedrange: false,
      minallowed: 0,
      maxallowed: 100,
      scaleanchor: 'x',
      scaleratio: 1,
    },
  }), [])

  const config = useMemo(() => ({
    responsive: true,
    displaylogo: false,
    scrollZoom: true,
    doubleClick: 'reset',
    modeBarButtonsToRemove: [
      'select2d',
      'lasso2d',
      'hoverClosestCartesian',
      'hoverCompareCartesian',
      'toggleSpikelines',
      'autoScale2d',
    ],
  }), [])

  const handleHover = (event) => {
    const point = event?.points?.[0]
    const datum = point?.customdata
    const nativeEvent = event?.event
    const wrapper = wrapperRef.current
    if (!datum?.id || !nativeEvent || !wrapper) return

    const bounds = wrapper.getBoundingClientRect()
    const cardWidth = 320
    const cardHeight = 210
    let left = nativeEvent.clientX - bounds.left + 14
    let top = nativeEvent.clientY - bounds.top - cardHeight / 2
    left = Math.max(12, Math.min(left, bounds.width - cardWidth - 12))
    top = Math.max(12, Math.min(top, bounds.height - cardHeight - 12))
    setHoverState({ datum, left, top })
  }

  if (!points.length) {
    return (
      <div
        className="flex items-center justify-center rounded-[22px] px-6 text-center"
        style={{ minHeight: 420, background: 'var(--panel-strong)', border: '1px solid var(--line)' }}
      >
        <div>
          <p className="mb-1 font-medium text-label">No courses to map</p>
          <p className="text-xs text-muted">Try filters with richer descriptions to see the similarity landscape.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="overflow-hidden rounded-[24px]" style={{ background: 'var(--panel-strong)', border: '1px solid var(--line)' }}>
      <div className="border-b px-5 py-4" style={{ borderColor: 'var(--line)' }}>
        <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <p className="text-sm font-semibold text-label">Course Similarity Map</p>
              <span
                className="rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em]"
                style={{ background: 'var(--accent-soft)', color: 'var(--accent-strong)' }}
              >
                {points.length} mapped
              </span>
            </div>
            <p className="max-w-3xl text-sm text-muted">
              This view places courses closer together when their descriptions, titles, prerequisites, and section notes use similar language.
            </p>
          </div>
          <p className="text-[10px] text-muted">Zoom, pan, and click any point to open course details</p>
        </div>

        <div className="grid gap-2 text-[12px] text-muted md:grid-cols-3">
          <p>Nearby points indicate related course content.</p>
          <p>Prefix color shows the course family.</p>
          <p>Pink outlines mark courses with bidding history.</p>
        </div>

        <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-muted">
          <span className="rounded-full px-2.5 py-1" style={{ background: 'var(--panel-subtle)', border: '1px solid var(--line)' }}>
            Based on text from {sourceCourseCount} course{sourceCourseCount !== 1 ? 's' : ''}
          </span>
          {omittedCourseCount > 0 && (
            <span className="rounded-full px-2.5 py-1" style={{ background: 'var(--panel-subtle)', border: '1px solid var(--line)' }}>
              {omittedCourseCount} omitted without enough descriptive text
            </span>
          )}
        </div>
      </div>

      <div
        ref={wrapperRef}
        style={{ position: 'relative', width: '100%', height: 560 }}
      >
        <Plot
          data={traces}
          layout={layout}
          config={config}
          useResizeHandler
          onHover={handleHover}
          onUnhover={() => setHoverState(null)}
          onClick={(event) => {
            const datum = event?.points?.[0]?.customdata
            if (datum?.id) navigate(`/courses?id=${encodeURIComponent(datum.id)}`)
          }}
          style={{ width: '100%', height: '100%' }}
        />

        {hoverState?.datum && (
          <div style={{ position: 'absolute', left: hoverState.left, top: hoverState.top, zIndex: 6, pointerEvents: 'none' }}>
            <MapHoverCard datum={hoverState.datum} />
          </div>
        )}
      </div>
    </div>
  )
}
