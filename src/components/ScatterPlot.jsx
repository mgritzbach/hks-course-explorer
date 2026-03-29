import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  CartesianGrid,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

function dedupeCoTaught(courses) {
  const grouped = new Map()

  for (const course of courses) {
    const key = course.year === 0 ? course.id : `${course.course_code}||${course.year}||${course.term}`
    if (!grouped.has(key)) grouped.set(key, [course])
    else grouped.get(key).push(course)
  }

  return Array.from(grouped.values()).map((group) => {
    if (group.length === 1) return group[0]

    const metricsPct = {}
    const metricsRaw = {}

    for (const key of Object.keys(group[0].metrics_pct || {})) {
      let weightedSum = 0
      let weightCount = 0
      for (const course of group) {
        const value = course.metrics_pct?.[key]
        if (value != null) {
          const weight = course.n_respondents || 1
          weightedSum += value * weight
          weightCount += weight
        }
      }
      metricsPct[key] = weightCount > 0 ? Math.round((weightedSum / weightCount) * 10) / 10 : null
    }

    for (const key of Object.keys(group[0].metrics_raw || {})) {
      let weightedSum = 0
      let weightCount = 0
      for (const course of group) {
        const value = course.metrics_raw?.[key]
        if (value != null) {
          const weight = course.n_respondents || 1
          weightedSum += value * weight
          weightCount += weight
        }
      }
      metricsRaw[key] = weightCount > 0 ? Math.round((weightedSum / weightCount) * 100) / 100 : null
    }

    return {
      ...group[0],
      professor_display: [...new Set(group.map((course) => course.professor_display || course.professor).filter(Boolean))].join(', '),
      professor: group.map((course) => course.professor).join('; '),
      n_respondents: group.reduce((sum, course) => sum + (course.n_respondents || 0), 0) || null,
      metrics_pct: metricsPct,
      metrics_raw: metricsRaw,
      _coTaught: true,
      _coTaughtCount: group.length,
    }
  })
}

function getAxisMode(metricMeta, allDeduped, matchedDeduped) {
  if (!metricMeta?.bid_metric) {
    return { useRaw: false, domain: [0, 100], tickFmt: (value) => `${value}%` }
  }

  const rawValues = [...(allDeduped || []), ...(matchedDeduped || [])]
    .map((course) => course.metrics_raw?.[metricMeta.key])
    .filter((value) => value != null && value > 0)

  if (!rawValues.length) {
    return { useRaw: false, domain: [0, 100], tickFmt: (value) => `${value}%` }
  }

  const maxValue = Math.max(...rawValues)
  if (metricMeta.key === 'Bid_Price') {
    const domainMax = Math.max(Math.ceil(maxValue / 100) * 100, 200)
    return { useRaw: true, domain: [0, domainMax], tickFmt: (value) => `${value}` }
  }

  const domainMax = Math.max(Math.ceil(maxValue / 50) * 50, 50)
  return { useRaw: true, domain: [0, domainMax], tickFmt: (value) => `${value}` }
}

function normalizeBidPrice(price) {
  if (price == null) return null
  return Math.max(0, Math.min(100, (price / 1000) * 100))
}

function spreadRankPosition(index, total, domainMax) {
  if (total <= 1) return domainMax * 0.5
  const startPct = 14
  const endPct = 86
  const step = (endPct - startPct) / (total - 1)
  const positionPct = endPct - (index * step)
  return (positionPct / 100) * domainMax
}

function coverageWarning(courses, metricMeta) {
  if (!courses.length) return null

  const hasData = courses.filter((course) =>
    metricMeta.bid_metric ? course.metrics_raw?.[metricMeta.key] != null : course.metrics_pct?.[metricMeta.key] != null
  ).length
  const coverage = Math.round((hasData / courses.length) * 100)

  if (coverage === 100) return null
  if (coverage === 0) return { type: 'error', msg: `"${metricMeta.label}" was not collected for this year's evaluations.` }

  return {
    type: 'warn',
    msg: `"${metricMeta.label}" has data for ${hasData}/${courses.length} courses (${coverage}%) this year.`,
  }
}

function formatMetricValue(datum, valueKey, rawKey, rawModeKey) {
  const value = datum[valueKey]
  const rawValue = datum[rawKey]
  const rawMode = datum[rawModeKey]

  if (value == null) return null
  if (rawMode) return rawValue != null ? `${rawValue} pts` : `${Math.round(value)}`
  if (rawValue != null) return `${rawValue} pts (${Math.round(value)}%)`
  return `${Math.round(value)}%`
}

function CustomTooltip({ active, payload }) {
  if (!active || !payload?.length) return null
  const datum = payload[0]?.payload
  if (!datum || datum._noHover) return null

  return (
    <div
      className="rounded px-3 py-2 text-xs shadow-lg"
      style={{ background: '#1a1a2e', border: '1px solid #38bdf8', color: '#e0e0f0', maxWidth: 280 }}
    >
      <p className="mb-1 text-sm font-bold" style={{ color: '#38bdf8' }}>{datum.course_code}</p>
      <p className="mb-1 leading-snug">{datum.course_name}</p>
      <p className="mb-1 text-muted">
        {datum.professor_display || datum.professor}
        {datum._coTaught && <span className="ml-1 text-[10px]" style={{ color: '#a78bfa' }}>co-taught ({datum._coTaughtCount})</span>}
      </p>
      <p className="mb-2 text-muted">{datum.is_average ? `avg ${datum.year_range}` : `${datum.term} ${datum.year}`}</p>

      <div className="space-y-0.5">
        {datum._xVal != null && !datum._isBidOnly && (
          <p>
            {datum._xLabel}:{' '}
            <span className="font-medium">{formatMetricValue(datum, '_xVal', '_xRaw', '_xIsRaw')}</span>
          </p>
        )}
        {datum._yVal != null && !datum._isBidOnly && (
          <p>
            {datum._yLabel}:{' '}
            <span className="font-medium">{formatMetricValue(datum, '_yVal', '_yRaw', '_yIsRaw')}</span>
          </p>
        )}
        {datum._isBidOnly && (
          <p className="text-[10px]" style={{ color: '#fbbf24' }}>No eval data yet · ranked by bid competitiveness</p>
        )}
        {datum.metrics_pct?.Instructor_Rating != null && datum._xLabel !== 'Instructor Rating' && datum._yLabel !== 'Instructor Rating' && (
          <p>
            Instructor: <span className="font-medium" style={{ color: '#38bdf8' }}>{Math.round(datum.metrics_pct.Instructor_Rating)}%</span>
          </p>
        )}
      </div>

      <div className="mt-2 border-t border-[#2a2a3e] pt-2 space-y-0.5">
        <p className="text-muted">
          Bidding: <span className="font-medium" style={{ color: datum.ever_bidding ? '#e879a0' : '#8888aa' }}>{datum.ever_bidding ? 'Yes' : 'No'}</span>
        </p>
        {datum.last_bid_price != null && (
          <p className="text-muted">
            Last clearing price: <span className="font-medium text-label">{datum.last_bid_price} pts</span>
            {datum.last_bid_acad && <span className="ml-1 text-[10px]">({datum.last_bid_acad} {datum.last_bid_term || ''})</span>}
          </p>
        )}
        {datum.bid_clearing_price != null && datum.bid_clearing_price !== datum.last_bid_price && (
          <p className="text-muted">
            This term: <span className="font-medium text-label">{datum.bid_clearing_price} pts</span>
          </p>
        )}
      </div>

      <p className="mt-1 text-[10px]" style={{ color: '#60a5fa' }}>Click for pinned details</p>
    </div>
  )
}

function CustomDot({ cx, cy, payload, onClick }) {
  if (cx == null || cy == null) return null

  const color = payload._color || '#60a5fa'
  const opacity = payload._opacity ?? 1
  const size = payload._isBidOnly ? 7 : 6

  if (payload._isBidOnly) {
    const delta = size
    return (
      <polygon
        points={`${cx},${cy - delta} ${cx + delta},${cy} ${cx},${cy + delta} ${cx - delta},${cy}`}
        fill={color}
        fillOpacity={opacity}
        stroke="rgba(255,255,255,0.2)"
        strokeWidth={0.5}
        style={{ cursor: 'pointer' }}
        onClick={() => onClick && onClick(payload)}
      />
    )
  }

  return (
    <circle
      cx={cx}
      cy={cy}
      r={size}
      fill={color}
      fillOpacity={opacity}
      stroke="rgba(255,255,255,0.15)"
      strokeWidth={0.5}
      style={{ cursor: payload._noHover ? 'default' : 'pointer', pointerEvents: payload._noHover ? 'none' : 'auto' }}
      onClick={payload._noHover ? undefined : () => onClick && onClick(payload)}
    />
  )
}

export default function ScatterPlot({
  allCourses,
  matchedCourses,
  biddingOnlyCourses,
  xMetric,
  yMetric,
  metrics,
  onXChange,
  onYChange,
}) {
  const navigate = useNavigate()
  const [pinnedDatum, setPinnedDatum] = useState(null)

  const allCoursesDeduped = useMemo(() => dedupeCoTaught(allCourses), [allCourses])
  const matchedCoursesDeduped = useMemo(() => dedupeCoTaught(matchedCourses), [matchedCourses])

  const xMeta = metrics.find((metric) => metric.key === xMetric) || metrics[0]
  const yMeta = metrics.find((metric) => metric.key === yMetric) || metrics[2]
  const xHigherBetter = xMeta.higher_is_better
  const yHigherBetter = yMeta.higher_is_better
  const xMode = useMemo(() => getAxisMode(xMeta, allCoursesDeduped, matchedCoursesDeduped), [allCoursesDeduped, matchedCoursesDeduped, xMeta])
  const yMode = useMemo(() => getAxisMode(yMeta, allCoursesDeduped, matchedCoursesDeduped), [allCoursesDeduped, matchedCoursesDeduped, yMeta])
  const showQuadrants = !xMeta.bid_metric && !yMeta.bid_metric

  const warnings = [
    coverageWarning(allCoursesDeduped, xMeta),
    coverageWarning(allCoursesDeduped, yMeta),
  ].filter(Boolean)

  const matchedIds = useMemo(() => new Set(matchedCoursesDeduped.map((course) => course.id)), [matchedCoursesDeduped])

  const getValue = (course, mode, key) => (mode.useRaw ? course.metrics_raw?.[key] ?? null : course.metrics_pct?.[key] ?? null)

  const bgData = useMemo(() => (
    allCoursesDeduped
      .filter((course) => !matchedIds.has(course.id) && getValue(course, xMode, xMetric) != null && getValue(course, yMode, yMetric) != null)
      .map((course) => ({
        ...course,
        _xVal: getValue(course, xMode, xMetric),
        _yVal: getValue(course, yMode, yMetric),
        _color: 'rgba(130,130,160,0.18)',
        _opacity: 0.5,
        _noHover: true,
      }))
  ), [allCoursesDeduped, matchedIds, xMetric, xMode, yMetric, yMode])

  const matchedData = useMemo(() => (
    matchedCoursesDeduped
      .filter((course) => getValue(course, xMode, xMetric) != null && getValue(course, yMode, yMetric) != null)
      .map((course) => ({
        ...course,
        _xVal: getValue(course, xMode, xMetric),
        _yVal: getValue(course, yMode, yMetric),
        _xRaw: !xMode.useRaw && xMeta.bid_metric ? course.metrics_raw?.[xMetric] ?? null : null,
        _yRaw: !yMode.useRaw && yMeta.bid_metric ? course.metrics_raw?.[yMetric] ?? null : null,
        _xIsRaw: xMode.useRaw,
        _yIsRaw: yMode.useRaw,
        _xLabel: xMeta.label,
        _yLabel: yMeta.label,
        _color: course.ever_bidding ? '#e879a0' : '#60a5fa',
        _opacity: 1,
      }))
  ), [matchedCoursesDeduped, xMeta, xMetric, xMode, yMeta, yMetric, yMode])

  const bidOnlyData = useMemo(() => (
    (biddingOnlyCourses || [])
      .filter((course) => course.last_bid_price != null)
      .sort((a, b) => {
        if ((b.last_bid_price ?? -1) !== (a.last_bid_price ?? -1)) return (b.last_bid_price ?? -1) - (a.last_bid_price ?? -1)
        return (a.course_name || a.course_code || '').localeCompare(b.course_name || b.course_code || '')
      })
      .map((course, index, rankedCourses) => {
        const normalizedBid = normalizeBidPrice(course.last_bid_price)
        const rankX = spreadRankPosition(index, rankedCourses.length, xMode.useRaw ? xMode.domain[1] : 100)
        const rankY = spreadRankPosition(index, rankedCourses.length, yMode.useRaw ? yMode.domain[1] : 100)
        const axisBidValueX = xMeta.bid_metric ? (xMode.useRaw ? course.last_bid_price ?? null : normalizedBid) : rankX
        const axisBidValueY = yMeta.bid_metric ? (yMode.useRaw ? course.last_bid_price ?? null : normalizedBid) : rankY

        return {
          ...course,
          _xVal: axisBidValueX,
          _yVal: axisBidValueY,
          _xRaw: xMeta.bid_metric ? (course.last_bid_price ?? null) : null,
          _yRaw: yMeta.bid_metric ? (course.last_bid_price ?? null) : null,
          _xIsRaw: xMode.useRaw,
          _yIsRaw: yMode.useRaw,
          _xLabel: xMeta.label,
          _yLabel: yMeta.label,
          _color: '#fbbf24',
          _opacity: 0.9,
          _isBidOnly: true,
          _bidRank: index + 1,
        }
      })
      .filter((course) => course._xVal != null && course._yVal != null)
  ), [biddingOnlyCourses, xMeta.bid_metric, xMode.domain, xMode.useRaw, yMeta.bid_metric, yMode.domain, yMode.useRaw])

  const allEmpty = allCoursesDeduped.length === 0 && bidOnlyData.length === 0
  const chartHeight = 340
  const greenX0 = xHigherBetter ? 50 : 0
  const greenX1 = xHigherBetter ? 100 : 50
  const greenY0 = yHigherBetter ? 50 : 0
  const greenY1 = yHigherBetter ? 100 : 50
  const redX0 = xHigherBetter ? 0 : 50
  const redX1 = xHigherBetter ? 50 : 100
  const redY0 = yHigherBetter ? 0 : 50
  const redY1 = yHigherBetter ? 50 : 100

  useEffect(() => {
    if (!pinnedDatum) return

    const stillExists = [...matchedData, ...bidOnlyData].some((datum) => datum.id === pinnedDatum.id)
    if (!stillExists) setPinnedDatum(null)
  }, [bidOnlyData, matchedData, pinnedDatum])

  const AxisSelectors = () => (
    <div className="grid gap-3 border-b border-[#2a2a3e] px-3 py-3 md:grid-cols-2">
      <div>
        <p className="mb-1 text-[10px] text-muted">
          Y-Axis: {yHigherBetter ? 'Higher is better' : 'Lower is better'}
          {yMode.useRaw && <span className="ml-1" style={{ color: '#fbbf24' }}>raw values</span>}
        </p>
        <div className="select-wrap">
          <select value={yMetric} onChange={(event) => onYChange(event.target.value)} style={{ background: '#13131f' }}>
            {metrics.map((metric) => (
              <option key={metric.key} value={metric.key}>{metric.label}</option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <p className="mb-1 text-[10px] text-muted">
          X-Axis: {xHigherBetter ? 'Higher is better' : 'Lower is better'}
          {xMode.useRaw && <span className="ml-1" style={{ color: '#fbbf24' }}>raw values</span>}
        </p>
        <div className="select-wrap">
          <select value={xMetric} onChange={(event) => onXChange(event.target.value)} style={{ background: '#13131f' }}>
            {metrics.map((metric) => (
              <option key={metric.key} value={metric.key}>{metric.label}</option>
            ))}
          </select>
        </div>
      </div>
    </div>
  )

  if (allEmpty) {
    return (
      <div
        className="shrink-0 rounded-lg"
        style={{ background: '#1a1a28', border: '1px solid #2a2a3e', display: 'flex', flexDirection: 'column' }}
      >
        <AxisSelectors />
        <div className="flex items-center justify-center px-8 text-center" style={{ height: 300 }}>
          <div>
            <p className="mb-2 font-medium text-label">No courses match the current filters</p>
            <p className="text-xs text-muted">Try adjusting the year, terms, or other filters.</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div
      className="shrink-0 rounded-lg"
      style={{ background: '#1a1a28', border: '1px solid #2a2a3e', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}
    >
      <AxisSelectors />

      <div style={{ width: '100%', height: chartHeight, flexShrink: 0 }}>
        <ResponsiveContainer width="100%" height={chartHeight}>
          <ScatterChart margin={{ top: 10, right: 12, bottom: 28, left: 0 }}>
            {showQuadrants && (
              <>
                <ReferenceArea x1={greenX0} x2={greenX1} y1={greenY0} y2={greenY1} fill="rgba(100,220,130,0.07)" />
                <ReferenceArea x1={redX0} x2={redX1} y1={redY0} y2={redY1} fill="rgba(255,80,80,0.07)" />
              </>
            )}

            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />

            <XAxis
              type="number"
              dataKey="_xVal"
              domain={xMode.domain}
              tickFormatter={xMode.tickFmt}
              tick={{ fill: '#8888aa', fontSize: 11 }}
              axisLine={{ stroke: 'rgba(255,255,255,0.2)' }}
              tickLine={false}
              label={{ value: xMeta.label, position: 'insideBottom', offset: -10, fill: '#c0c0d8', fontSize: 11 }}
            />
            <YAxis
              type="number"
              dataKey="_yVal"
              domain={yMode.domain}
              tickFormatter={yMode.tickFmt}
              tick={{ fill: '#8888aa', fontSize: 11 }}
              axisLine={{ stroke: 'rgba(255,255,255,0.2)' }}
              tickLine={false}
              width={44}
            />

            {showQuadrants && (
              <>
                <ReferenceLine x={50} stroke="rgba(200,200,220,0.3)" strokeDasharray="4 4" />
                <ReferenceLine y={50} stroke="rgba(200,200,220,0.3)" strokeDasharray="4 4" />
              </>
            )}

            <Tooltip content={<CustomTooltip />} cursor={{ strokeDasharray: '3 3', stroke: '#38bdf8' }} />
            <Scatter data={bgData} isAnimationActive={false} shape={<CustomDot onClick={(payload) => payload?.id && setPinnedDatum(payload)} />} />
            <Scatter data={matchedData} isAnimationActive={false} shape={<CustomDot onClick={(payload) => payload?.id && setPinnedDatum(payload)} />} />
            <Scatter data={bidOnlyData} isAnimationActive={false} shape={<CustomDot onClick={(payload) => payload?.id && setPinnedDatum(payload)} />} />
          </ScatterChart>
        </ResponsiveContainer>
      </div>

      {pinnedDatum && (
        <div className="border-t border-[#2a2a3e] px-4 py-4" style={{ background: '#151521' }}>
          <div className="mb-3 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-bold" style={{ color: '#38bdf8' }}>{pinnedDatum.course_code}</p>
              <p className="text-sm text-label">{pinnedDatum.course_name}</p>
              <p className="mt-1 text-xs text-muted">{pinnedDatum.professor_display || pinnedDatum.professor}</p>
            </div>
            <button
              onClick={() => setPinnedDatum(null)}
              className="rounded border border-[#2a2a3e] px-2 py-1 text-[11px] text-muted hover:text-white"
            >
              Close
            </button>
          </div>

          <div className="space-y-1 text-xs text-muted">
            <p>{pinnedDatum.is_average ? `Average ${pinnedDatum.year_range}` : `${pinnedDatum.term} ${pinnedDatum.year}`}</p>
            {pinnedDatum._xVal != null && (
              <p>
                {pinnedDatum._xLabel}: <span className="text-label">{formatMetricValue(pinnedDatum, '_xVal', '_xRaw', '_xIsRaw')}</span>
              </p>
            )}
            {pinnedDatum._yVal != null && (
              <p>
                {pinnedDatum._yLabel}: <span className="text-label">{formatMetricValue(pinnedDatum, '_yVal', '_yRaw', '_yIsRaw')}</span>
              </p>
            )}
            {pinnedDatum.last_bid_price != null && (
              <p>Last clearing price: <span className="text-label">{pinnedDatum.last_bid_price} pts</span></p>
            )}
          </div>

          <div className="mt-3">
            <button
              onClick={() => navigate(`/courses?id=${encodeURIComponent(pinnedDatum.id)}`)}
              className="btn-details"
            >
              Go to Course Details
            </button>
          </div>
        </div>
      )}

      {warnings.map((warning, index) => (
        <div
          key={`${warning.msg}-${index}`}
          className="flex items-center gap-2 border-t border-[#2a2a3e] px-4 py-2 text-xs"
          style={{
            background: warning.type === 'error' ? '#2a1010' : '#2a2010',
            color: warning.type === 'error' ? '#f87171' : '#fbbf24',
          }}
        >
          <span>Warning:</span>
          <span>{warning.msg}</span>
        </div>
      ))}

      <div className="border-t border-[#2a2a3e] px-4 py-3 text-xs" style={{ background: '#13131f' }}>
        <p className="mb-2 font-medium text-label">How to read this</p>
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {showQuadrants && (
            <>
              <p className="text-muted"><span className="font-medium text-green-400">Green quadrant</span> = stronger on both axes</p>
              <p className="text-muted"><span className="font-medium text-red-400">Red quadrant</span> = weaker on both axes</p>
            </>
          )}
          <p className="text-muted"><span className="font-medium" style={{ color: '#e879a0' }}>Pink</span> = ever went to bidding</p>
          {bidOnlyData.length > 0 && (
            <p className="text-muted">
              <span className="font-medium" style={{ color: '#fbbf24' }}>Amber diamond</span> = bidding now, no eval yet, evenly spread by competitiveness rank
            </p>
          )}
        </div>
        <p className="mt-2 text-[11px] text-muted">
          Click a point to preview details. {matchedData.length} course{matchedData.length !== 1 ? 's' : ''} shown
          {bidOnlyData.length > 0 && ` · ${bidOnlyData.length} bidding only`}
          {bgData.length > 0 && ` · ${bgData.length} additional context points`}
        </p>
      </div>
    </div>
  )
}
