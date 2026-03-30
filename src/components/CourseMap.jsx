import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { ResponsiveContainer, Tooltip, Treemap } from 'recharts'

// Data-coded instructor rating colors — semantic, not theme-dependent
function instructorColor(percentile) {
  if (percentile == null) return 'rgba(255,255,255,0.08)'
  if (percentile >= 75) return '#16a34a'
  if (percentile >= 50) return '#65a30d'
  if (percentile >= 25) return '#ca8a04'
  return '#dc2626'
}

function averagePct(courses, key) {
  const values = courses.map((course) => course.metrics_pct?.[key]).filter((value) => value != null)
  if (!values.length) return null
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function CustomCell(props) {
  const { x, y, width, height, name, depth, data } = props
  if (width < 2 || height < 2) return null

  const concentrationNode = depth === 1
  const background = data?._color || (concentrationNode ? 'rgba(165,28,48,0.2)' : 'rgba(255,255,255,0.06)')
  const fontSize = concentrationNode ? Math.min(13, Math.max(9, width / 10)) : Math.min(11, Math.max(8, width / 12))
  const showText = width > 40 && height > 20

  return (
    <g>
      <rect
        x={x + 1}
        y={y + 1}
        width={Math.max(0, width - 2)}
        height={Math.max(0, height - 2)}
        fill={background}
        stroke="rgba(0,0,0,0.16)"
        strokeWidth={1}
        rx={3}
        style={{ cursor: concentrationNode ? 'default' : 'pointer' }}
      />
      {showText && (
        <text
          x={x + width / 2}
          y={y + height / 2}
          textAnchor="middle"
          dominantBaseline="middle"
          fill="rgba(255,255,255,0.9)"
          fontSize={fontSize}
          fontWeight={concentrationNode ? 700 : 400}
          style={{ pointerEvents: 'none', userSelect: 'none' }}
        >
          {name?.length > Math.floor(width / (fontSize * 0.6))
            ? `${name.slice(0, Math.floor(width / (fontSize * 0.6)) - 1)}…`
            : name}
        </text>
      )}
    </g>
  )
}

function CustomTooltip({ active, payload }) {
  if (!active || !payload?.length) return null
  const datum = payload[0]?.payload
  if (!datum || datum.depth === 0) return null

  if (datum.depth === 1) {
    return (
      <div
        className="rounded-2xl px-3 py-2 text-xs shadow-lg"
        style={{ background: 'var(--panel-strong)', border: '1px solid var(--line-strong)', color: 'var(--text)' }}
      >
        <p className="text-sm font-bold" style={{ color: 'var(--accent-strong)' }}>{datum.name}</p>
        <p className="text-muted">{datum.children?.length ?? 0} courses</p>
        {datum._avgPct != null && <p>Avg Instructor: <span className="font-medium">{Math.round(datum._avgPct)}%</span></p>}
      </div>
    )
  }

  const course = datum._course
  if (!course) return null

  return (
    <div
      className="rounded-2xl px-3 py-2 text-xs shadow-lg"
      style={{ background: 'var(--panel-strong)', border: '1px solid var(--line-strong)', color: 'var(--text)', maxWidth: 260 }}
    >
      <p className="font-bold" style={{ color: 'var(--accent-strong)' }}>{course.course_code}</p>
      <p className="mb-1 leading-snug text-label">{course.course_name}</p>
      <p className="mb-1 text-muted">{course.professor_display || course.professor}</p>
      <p className="mb-2 text-muted">{course.is_average ? `avg ${course.year_range}` : `${course.term} ${course.year}`}</p>
      <div className="space-y-0.5">
        {course.metrics_pct?.Instructor_Rating != null && (
          <p>Instructor: <span className="font-medium" style={{ color: 'var(--accent-strong)' }}>{Math.round(course.metrics_pct.Instructor_Rating)}%</span></p>
        )}
        {course.metrics_pct?.Course_Rating != null && (
          <p>Course: <span className="font-medium" style={{ color: 'var(--success)' }}>{Math.round(course.metrics_pct.Course_Rating)}%</span></p>
        )}
        {course.metrics_pct?.Workload != null && (
          <p>Workload: <span className="font-medium">{Math.round(course.metrics_pct.Workload)}%</span></p>
        )}
        {course.n_respondents != null && <p className="text-muted">N={course.n_respondents} respondents</p>}
      </div>
      <p className="mt-1 text-[10px]" style={{ color: 'var(--blue)' }}>Click to view details</p>
    </div>
  )
}

export default function CourseMap({ courses }) {
  const navigate = useNavigate()
  const chartHeight = courses.length > 0 ? 360 : 320

  const treeData = useMemo(() => {
    if (!courses.length) return []

    const byConcentration = {}
    for (const course of courses) {
      const concentration = course.concentration || 'Other'
      if (!byConcentration[concentration]) byConcentration[concentration] = []
      byConcentration[concentration].push(course)
    }

    return Object.entries(byConcentration)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([concentration, groupedCourses]) => {
        const avgInstructorPct = averagePct(groupedCourses, 'Instructor_Rating')
        return {
          name: `${concentration} (${groupedCourses.length})`,
          _avgPct: avgInstructorPct,
          _color: instructorColor(avgInstructorPct),
          children: groupedCourses.map((course) => ({
            name: course.course_code,
            value: Math.max(1, course.n_respondents || 1),
            _color: instructorColor(course.metrics_pct?.Instructor_Rating),
            _course: course,
            depth: 2,
          })),
        }
      })
  }, [courses])

  if (!courses.length) {
    return (
      <div
        className="flex items-center justify-center rounded-[22px] px-6 text-center"
        style={{ height: chartHeight, background: 'var(--panel-strong)', border: '1px solid var(--line)' }}
      >
        <div>
          <p className="mb-1 font-medium text-label">No courses to map</p>
          <p className="text-xs text-muted">Adjust your filters to see the course landscape.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="overflow-hidden rounded-[22px]" style={{ background: 'var(--panel-strong)', border: '1px solid var(--line)' }}>
      <div className="border-b px-5 py-4" style={{ borderColor: 'var(--line)' }}>
        <div className="mb-2 flex items-center justify-between">
          <p className="text-xs text-muted">
            <span className="font-semibold text-label">{courses.length}</span> courses
          </p>
          <p className="text-[10px] text-muted">Click any block to open details</p>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
          <span className="filter-label">Instructor Rating</span>
          {[
            { color: '#16a34a', label: 'Top 25%' },
            { color: '#65a30d', label: '25–50%' },
            { color: '#ca8a04', label: '50–75%' },
            { color: '#dc2626', label: 'Bottom 25%' },
            { color: 'rgba(255,255,255,0.08)', label: 'No data', border: '1px solid rgba(255,255,255,0.16)' },
          ].map(({ color, label, border }) => (
            <span key={label} className="flex items-center gap-1 text-[10px]">
              <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: color, border: border || 'none' }} />
              <span className="text-muted">{label}</span>
            </span>
          ))}
          <span className="text-[10px] text-muted">· Box size = N respondents</span>
        </div>
      </div>

      <div style={{ width: '100%', height: chartHeight }}>
        <ResponsiveContainer width="100%" height={chartHeight}>
          <Treemap
            data={treeData}
            dataKey="value"
            aspectRatio={4 / 3}
            isAnimationActive={false}
            content={<CustomCell />}
            onClick={(node) => {
              if (node?._course?.id) navigate(`/courses?id=${encodeURIComponent(node._course.id)}`)
            }}
          >
            <Tooltip content={<CustomTooltip />} />
          </Treemap>
        </ResponsiveContainer>
      </div>

      <div className="border-t px-5 py-3 text-[11px] text-muted" style={{ borderColor: 'var(--line)', background: 'rgba(0,0,0,0.06)' }}>
        Grouped by concentration · tap a block to open the full detail view
      </div>
    </div>
  )
}
