import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Treemap, ResponsiveContainer, Tooltip } from 'recharts'

// Color based on instructor percentile
function instrColor(pct) {
  if (pct == null) return '#3a3a58'
  if (pct >= 75) return '#16a34a'
  if (pct >= 50) return '#65a30d'
  if (pct >= 25) return '#ca8a04'
  return '#dc2626'
}

function avgPct(courses, key) {
  const vals = courses.map(c => c.metrics_pct?.[key]).filter(v => v != null)
  if (!vals.length) return null
  return vals.reduce((s, v) => s + v, 0) / vals.length
}

// Custom content renderer for treemap cells
function CustomCell(props) {
  const { x, y, width, height, name, root, depth, value, data } = props
  if (width < 2 || height < 2) return null

  const isConc = depth === 1
  const bg = data?._color || (isConc ? '#1e2a4a' : '#2a2a3e')
  const textColor = '#ffffff'
  const fontSize = isConc ? Math.min(13, Math.max(9, width / 10)) : Math.min(11, Math.max(8, width / 12))
  const showText = width > 40 && height > 20

  return (
    <g>
      <rect
        x={x + 1} y={y + 1}
        width={Math.max(0, width - 2)}
        height={Math.max(0, height - 2)}
        fill={bg}
        stroke="#0f0f17"
        strokeWidth={1}
        rx={2}
        style={{ cursor: isConc ? 'default' : 'pointer' }}
      />
      {showText && (
        <text
          x={x + width / 2}
          y={y + height / 2}
          textAnchor="middle"
          dominantBaseline="middle"
          fill={textColor}
          fontSize={fontSize}
          fontWeight={isConc ? 700 : 400}
          style={{ pointerEvents: 'none', userSelect: 'none' }}
        >
          {name?.length > Math.floor(width / (fontSize * 0.6))
            ? name.slice(0, Math.floor(width / (fontSize * 0.6)) - 1) + '…'
            : name}
        </text>
      )}
    </g>
  )
}

function CustomTooltip({ active, payload }) {
  if (!active || !payload?.length) return null
  const d = payload[0]?.payload
  if (!d || d.depth === 0) return null

  if (d.depth === 1) {
    // Concentration node
    return (
      <div className="text-xs rounded px-3 py-2 shadow-lg"
        style={{ background: '#1a1a2e', border: '1px solid #38bdf8', color: '#e0e0f0' }}>
        <p className="font-bold text-sm" style={{ color: '#38bdf8' }}>{d.name}</p>
        <p className="text-muted">{d.children?.length ?? 0} courses</p>
        {d._avgPct != null && <p>Avg Instructor: <span className="font-medium">{Math.round(d._avgPct)}%</span></p>}
      </div>
    )
  }

  const c = d._course
  if (!c) return null
  return (
    <div className="text-xs rounded px-3 py-2 shadow-lg"
      style={{ background: '#1a1a2e', border: '1px solid #38bdf8', color: '#e0e0f0', maxWidth: 260 }}>
      <p className="font-bold" style={{ color: '#38bdf8' }}>{c.course_code}</p>
      <p className="mb-1 leading-snug">{c.course_name}</p>
      <p className="text-muted mb-1">{c.professor_display || c.professor}</p>
      <p className="text-muted mb-2">{c.is_average ? `avg ${c.year_range}` : `${c.term} ${c.year}`}</p>
      <div className="space-y-0.5">
        {c.metrics_pct?.Instructor_Rating != null && <p>Instructor: <span className="font-medium" style={{ color: '#38bdf8' }}>{Math.round(c.metrics_pct.Instructor_Rating)}%</span></p>}
        {c.metrics_pct?.Course_Rating    != null && <p>Course:     <span className="font-medium" style={{ color: '#86efac' }}>{Math.round(c.metrics_pct.Course_Rating)}%</span></p>}
        {c.metrics_pct?.Workload         != null && <p>Workload:   <span className="font-medium">{Math.round(c.metrics_pct.Workload)}%</span></p>}
        {c.n_respondents != null && <p className="text-muted">N={c.n_respondents} respondents</p>}
      </div>
      <p className="text-[10px] mt-1" style={{ color: '#60a5fa' }}>Click to view details</p>
    </div>
  )
}

export default function CourseMap({ courses }) {
  const navigate = useNavigate()

  const treeData = useMemo(() => {
    if (!courses.length) return []
    const byConc = {}
    for (const c of courses) {
      const conc = c.concentration || 'Other'
      if (!byConc[conc]) byConc[conc] = []
      byConc[conc].push(c)
    }

    return Object.entries(byConc)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([conc, arr]) => {
        const ap = avgPct(arr, 'Instructor_Rating')
        return {
          name: `${conc} (${arr.length})`,
          _avgPct: ap,
          _color: instrColor(ap),
          children: arr.map(c => ({
            name: c.course_code,
            value: Math.max(1, c.n_respondents || 1),
            _color: instrColor(c.metrics_pct?.Instructor_Rating),
            _course: c,
            depth: 2,
          })),
        }
      })
  }, [courses])

  const handleClick = (data) => {
    const c = data?._course
    if (c?.id) navigate(`/courses?id=${encodeURIComponent(c.id)}`)
  }

  if (!courses.length) {
    return (
      <div className="flex items-center justify-center rounded-lg text-center"
        style={{ height: 420, background: '#1a1a28', border: '1px solid #2a2a3e' }}>
        <div>
          <p className="text-4xl mb-3">🗺️</p>
          <p className="text-label font-medium mb-1">No courses to map</p>
          <p className="text-xs text-muted">Adjust your filters to see the course landscape.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="rounded-lg" style={{ background: '#1a1a28', border: '1px solid #2a2a3e' }}>
      {/* Header */}
      <div className="px-4 py-2 border-b border-[#2a2a3e] flex items-center justify-between flex-wrap gap-2">
        <p className="text-xs text-muted">
          <span className="font-medium text-label">{courses.length}</span> courses ·
          Box size = respondents · Color = Instructor Rating
        </p>
        <div className="flex items-center gap-3 text-[10px]">
          <span style={{ color: '#16a34a' }}>● Top 25%</span>
          <span style={{ color: '#65a30d' }}>● 25–50%</span>
          <span style={{ color: '#ca8a04' }}>● 50–75%</span>
          <span style={{ color: '#dc2626' }}>● Bottom 25%</span>
          <span style={{ color: '#3a3a58' }}>● No data</span>
        </div>
      </div>

      <div style={{ width: '100%', height: 420 }}>
        <ResponsiveContainer width="100%" height={420}>
          <Treemap
            data={treeData}
            dataKey="value"
            aspectRatio={4 / 3}
            isAnimationActive={false}
            content={<CustomCell />}
            onClick={handleClick}
          >
            <Tooltip content={<CustomTooltip />} />
          </Treemap>
        </ResponsiveContainer>
      </div>

      <div className="px-4 py-2 text-[11px] text-muted border-t border-[#2a2a3e]" style={{ background: '#13131f' }}>
        Grouped by concentration · Click any course box to view full details
      </div>
    </div>
  )
}
