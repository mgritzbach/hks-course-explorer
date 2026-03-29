import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ScatterChart, Scatter, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine, ReferenceArea,
} from 'recharts'

// ── Helpers ──────────────────────────────────────────────────────────────────

// Deduplicate co-taught courses: same (course_code, year, term) with diff profs → one dot.
// Average records (year=0) and section courses (diff course_code) are left as-is.
function dedupeCoTaught(courses) {
  const map = new Map()
  for (const c of courses) {
    const key = c.year === 0
      ? c.id
      : `${c.course_code}||${c.year}||${c.term}`
    if (!map.has(key)) {
      map.set(key, [c])
    } else {
      map.get(key).push(c)
    }
  }

  return Array.from(map.values()).map(group => {
    if (group.length === 1) return group[0]

    const metrics_pct = {}
    const metrics_raw = {}
    for (const key of Object.keys(group[0].metrics_pct || {})) {
      let wSum = 0, wCnt = 0
      for (const c of group) {
        const v = c.metrics_pct?.[key]
        if (v != null) { const w = c.n_respondents || 1; wSum += v * w; wCnt += w }
      }
      metrics_pct[key] = wCnt > 0 ? Math.round(wSum / wCnt * 10) / 10 : null
    }
    for (const key of Object.keys(group[0].metrics_raw || {})) {
      let wSum = 0, wCnt = 0
      for (const c of group) {
        const v = c.metrics_raw?.[key]
        if (v != null) { const w = c.n_respondents || 1; wSum += v * w; wCnt += w }
      }
      metrics_raw[key] = wCnt > 0 ? Math.round(wSum / wCnt * 100) / 100 : null
    }

    const profNames = [...new Set(group.map(c => c.professor_display || c.professor).filter(Boolean))]
    const sumN = group.reduce((s, c) => s + (c.n_respondents || 0), 0)

    return {
      ...group[0],
      professor_display: profNames.join(', '),
      professor: group.map(c => c.professor).join('; '),
      n_respondents: sumN || null,
      metrics_pct,
      metrics_raw,
      _coTaught: true,
      _coTaughtCount: group.length,
    }
  })
}

// Determine axis configuration — raw values for bid metrics, percentile for everything else
function getAxisMode(metricMeta, allDeduped, matchedDeduped) {
  if (!metricMeta?.bid_metric) {
    return { useRaw: false, domain: [0, 100], tickFmt: v => `${v}%` }
  }
  const key = metricMeta.key
  const allRaw = [...(allDeduped || []), ...(matchedDeduped || [])]
    .map(c => c.metrics_raw?.[key])
    .filter(v => v != null && v > 0)
  if (!allRaw.length) return { useRaw: false, domain: [0, 100], tickFmt: v => `${v}%` }
  const maxVal = Math.max(...allRaw)
  if (key === 'Bid_Price') {
    const domainMax = Math.max(Math.ceil(maxVal / 100) * 100, 200)
    return { useRaw: true, domain: [0, domainMax], tickFmt: v => `${v}` }
  }
  // Bid_N_Bids or other count → round up to next 50
  const domainMax = Math.max(Math.ceil(maxVal / 50) * 50, 50)
  return { useRaw: true, domain: [0, domainMax], tickFmt: v => `${v}` }
}

// Deterministic pseudo-random position from course id string
function hashSpread(str, salt) {
  let h = 5381
  const s = str + salt
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h) ^ s.charCodeAt(i)
    h = h >>> 0
  }
  return 8 + (h % 840) / 10  // range 8–92
}

function coverageWarning(courses, metricMeta) {
  if (!courses.length) return null
  const key = metricMeta.key
  const isBid = !!metricMeta.bid_metric
  const hasData = courses.filter(c =>
    isBid ? c.metrics_raw?.[key] != null : c.metrics_pct?.[key] != null
  ).length
  const pct = Math.round((hasData / courses.length) * 100)
  if (pct === 100) return null
  const label = metricMeta.label
  if (pct === 0) return { type: 'error', msg: `"${label}" was not collected for this year's evaluations.` }
  return { type: 'warn', msg: `"${label}" has data for ${hasData}/${courses.length} courses (${pct}%) this year.` }
}

// ── Tooltip ──────────────────────────────────────────────────────────────────

function CustomTooltip({ active, payload }) {
  if (!active || !payload?.length) return null
  const d = payload[0]?.payload
  if (!d || d._noHover) return null

  return (
    <div
      className="text-xs rounded px-3 py-2 shadow-lg"
      style={{ background: '#1a1a2e', border: '1px solid #38bdf8', color: '#e0e0f0', maxWidth: 280 }}
    >
      <p className="font-bold text-sm mb-1" style={{ color: '#38bdf8' }}>{d.course_code}</p>
      <p className="mb-1 leading-snug">{d.course_name}</p>
      <p className="text-muted mb-1">
        {d.professor_display || d.professor}
        {d._coTaught && <span className="ml-1 text-[10px]" style={{ color: '#a78bfa' }}>· co-taught ({d._coTaughtCount})</span>}
      </p>
      <p className="text-muted mb-2">{d.is_average ? `avg ${d.year_range}` : `${d.term} ${d.year}`}</p>

      {d._isBidOnly ? (
        <p style={{ color: '#fbbf24' }}>🟡 Bidding — no eval yet
          {d.last_bid_price != null && <span className="ml-1 font-bold">{d.last_bid_price} pts</span>}
        </p>
      ) : (
        <div className="space-y-0.5">
          {d._xVal != null && (
            <p>{d._xLabel}: <span className="font-medium">
              {d._xRaw != null ? `${d._xRaw} pts (${Math.round(d._xVal)}%)` : `${Math.round(d._xVal)}${d._xIsRaw ? '' : '%'}`}
            </span></p>
          )}
          {d._yVal != null && (
            <p>{d._yLabel}: <span className="font-medium">
              {d._yRaw != null ? `${d._yRaw} pts (${Math.round(d._yVal)}%)` : `${Math.round(d._yVal)}${d._yIsRaw ? '' : '%'}`}
            </span></p>
          )}
          {d.metrics_pct?.Instructor_Rating != null && d._xLabel !== 'Instructor Rating' && d._yLabel !== 'Instructor Rating' && (
            <p>Instructor: <span className="font-medium" style={{ color: '#38bdf8' }}>{Math.round(d.metrics_pct.Instructor_Rating)}%</span></p>
          )}
        </div>
      )}

      {/* Bidding section */}
      <div className="mt-2 pt-2 border-t border-[#2a2a3e]">
        {d.ever_bidding ? (
          <>
            <p style={{ color: '#fbbf24' }}>🏷 Went to bidding</p>
            {d.last_bid_price != null && (
              <p className="text-muted">
                Last bid: <span className="font-medium text-label">{d.last_bid_price} pts</span>
                {d.last_bid_acad && <span className="text-[10px] ml-1">({d.last_bid_acad} {d.last_bid_term || ''})</span>}
              </p>
            )}
            {d.bid_clearing_price != null && d.bid_clearing_price !== d.last_bid_price && (
              <p className="text-muted">
                This term: <span className="font-medium text-label">{d.bid_clearing_price} pts</span>
              </p>
            )}
          </>
        ) : (
          <p className="text-muted text-[10px]">No bidding history</p>
        )}
      </div>

      <p className="text-[10px] mt-1" style={{ color: '#60a5fa' }}>Click to view details</p>
    </div>
  )
}

// ── Dot renderer ─────────────────────────────────────────────────────────────

function CustomDot(props) {
  const { cx, cy, payload, onClick } = props
  if (cx == null || cy == null) return null
  const color   = payload._color || '#60a5fa'
  const opacity = payload._opacity ?? 1
  const size    = payload._isBidOnly ? 7 : 6
  const noHover = !!payload._noHover

  if (payload._isBidOnly) {
    const d = size
    return (
      <polygon
        points={`${cx},${cy - d} ${cx + d},${cy} ${cx},${cy + d} ${cx - d},${cy}`}
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
      cx={cx} cy={cy} r={size}
      fill={color}
      fillOpacity={opacity}
      stroke="rgba(255,255,255,0.15)"
      strokeWidth={0.5}
      style={{
        cursor: noHover ? 'default' : 'pointer',
        pointerEvents: noHover ? 'none' : 'auto',
      }}
      onClick={noHover ? undefined : () => onClick && onClick(payload)}
    />
  )
}

// ── Main component ────────────────────────────────────────────────────────────

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

  // Deduplicate co-taught courses (same course_code/year/term, different professors)
  const allCoursesDeduped     = useMemo(() => dedupeCoTaught(allCourses),     [allCourses])
  const matchedCoursesDeduped = useMemo(() => dedupeCoTaught(matchedCourses), [matchedCourses])

  const xMeta = metrics.find(m => m.key === xMetric) || metrics[0]
  const yMeta = metrics.find(m => m.key === yMetric) || metrics[2]
  const xHIB  = xMeta.higher_is_better
  const yHIB  = yMeta.higher_is_better

  // Axis modes: percentile (0-100%) vs raw values (bid pts, count)
  const xMode = useMemo(() => getAxisMode(xMeta, allCoursesDeduped, matchedCoursesDeduped),
    [xMeta, allCoursesDeduped, matchedCoursesDeduped])
  const yMode = useMemo(() => getAxisMode(yMeta, allCoursesDeduped, matchedCoursesDeduped),
    [yMeta, allCoursesDeduped, matchedCoursesDeduped])

  // Only show quadrant shading/median lines when both axes are percentile metrics
  const showQuadrants = !xMeta.bid_metric && !yMeta.bid_metric

  const xWarn = useMemo(() => coverageWarning(allCoursesDeduped, xMeta), [allCoursesDeduped, xMeta])
  const yWarn = useMemo(() => coverageWarning(allCoursesDeduped, yMeta), [allCoursesDeduped, yMeta])
  const warnings = [xWarn, yWarn].filter(Boolean)

  const matchedIds = useMemo(() => new Set(matchedCoursesDeduped.map(c => c.id)), [matchedCoursesDeduped])

  // Helper: get the coordinate value for a course given axis mode and metric
  const getVal = (c, mode, key) => mode.useRaw ? (c.metrics_raw?.[key] ?? null) : (c.metrics_pct?.[key] ?? null)

  // Background (unmatched) dots — no hover, no click
  const bgData = useMemo(() =>
    allCoursesDeduped
      .filter(c => !matchedIds.has(c.id) && getVal(c, xMode, xMetric) != null && getVal(c, yMode, yMetric) != null)
      .map(c => ({
        ...c,
        _xVal: getVal(c, xMode, xMetric),
        _yVal: getVal(c, yMode, yMetric),
        _color: 'rgba(130,130,160,0.18)',
        _opacity: 0.5,
        _noHover: true,
      })),
    [allCoursesDeduped, matchedIds, xMetric, yMetric, xMode, yMode]
  )

  // Matched courses — colored, hoverable
  const matchedData = useMemo(() =>
    matchedCoursesDeduped
      .filter(c => getVal(c, xMode, xMetric) != null && getVal(c, yMode, yMetric) != null)
      .map(c => ({
        ...c,
        _xVal: getVal(c, xMode, xMetric),
        _yVal: getVal(c, yMode, yMetric),
        // For tooltip: show raw pts alongside % only when axis is in pct mode
        _xRaw: (!xMode.useRaw && xMeta.bid_metric) ? (c.metrics_raw?.[xMetric] ?? null) : null,
        _yRaw: (!yMode.useRaw && yMeta.bid_metric) ? (c.metrics_raw?.[yMetric] ?? null) : null,
        _xIsRaw: xMode.useRaw,
        _yIsRaw: yMode.useRaw,
        _xLabel: xMeta.label,
        _yLabel: yMeta.label,
        _color: c.ever_bidding ? '#e879a0' : '#60a5fa',
        _opacity: 1,
      })),
    [matchedCoursesDeduped, xMetric, yMetric, xMode, yMode, xMeta, yMeta]
  )

  // Bidding-only (no eval) — amber diamonds
  const bidOnlyData = useMemo(() =>
    (biddingOnlyCourses || []).map(c => {
      const xReal = getVal(c, xMode, xMetric)
      const yReal = getVal(c, yMode, yMetric)
      const useBothReal = xReal != null && yReal != null
      // Scale hash spread to the axis domain range
      const xSpread = hashSpread(c.id, 'x') * xMode.domain[1] / 100
      const ySpread = hashSpread(c.id, 'y') * yMode.domain[1] / 100
      return {
        ...c,
        _xVal:    useBothReal ? xReal : xSpread,
        _yVal:    useBothReal ? yReal : ySpread,
        _xLabel:  xMeta.label,
        _yLabel:  yMeta.label,
        _color:   '#fbbf24',
        _opacity: 0.9,
        _isBidOnly: true,
        _positionedReal: useBothReal,
      }
    }),
    [biddingOnlyCourses, xMetric, yMetric, xMode, yMode, xMeta.label, yMeta.label]
  )

  const hasBidOnly  = (biddingOnlyCourses || []).length > 0
  const allEmpty    = allCoursesDeduped.length === 0 && !hasBidOnly

  const handleDotClick = (payload) => {
    if (payload?.id) navigate(`/courses?id=${encodeURIComponent(payload.id)}`)
  }

  // Quadrant shading corners (only for percentile axes)
  const greenX0 = xHIB ? 50 : 0,  greenX1 = xHIB ? 100 : 50
  const greenY0 = yHIB ? 50 : 0,  greenY1 = yHIB ? 100 : 50
  const redX0   = xHIB ? 0  : 50, redX1   = xHIB ? 50  : 100
  const redY0   = yHIB ? 0  : 50, redY1   = yHIB ? 50  : 100

  const AxisSelectors = () => (
    <div className="flex gap-4 px-3 py-2 border-b border-[#2a2a3e]">
      <div className="flex-1">
        <p className="text-[10px] text-muted mb-1">
          Y-Axis: {yHIB ? 'Higher is better ↑' : 'Lower is better ↓'}
          {yMode.useRaw && <span className="ml-1 text-[10px]" style={{ color: '#fbbf24' }}>— raw values</span>}
        </p>
        <div className="select-wrap">
          <select value={yMetric} onChange={e => onYChange(e.target.value)} style={{ background: '#13131f' }}>
            {metrics.map(m => (
              <option key={m.key} value={m.key}>{m.label} {m.higher_is_better ? '↑' : '↓'}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="flex-1">
        <p className="text-[10px] text-muted mb-1">
          X-Axis: {xHIB ? 'Higher is better ↑' : 'Lower is better ↓'}
          {xMode.useRaw && <span className="ml-1 text-[10px]" style={{ color: '#fbbf24' }}>— raw values</span>}
        </p>
        <div className="select-wrap">
          <select value={xMetric} onChange={e => onXChange(e.target.value)} style={{ background: '#13131f' }}>
            {metrics.map(m => (
              <option key={m.key} value={m.key}>{m.label} {m.higher_is_better ? '↑' : '↓'}</option>
            ))}
          </select>
        </div>
      </div>
    </div>
  )

  if (allEmpty && !hasBidOnly) {
    return (
      <div className="rounded-lg" style={{ background: '#1a1a28', border: '1px solid #2a2a3e' }}>
        <AxisSelectors />
        <div className="flex items-center justify-center text-center" style={{ height: 320, padding: '0 32px' }}>
          <div>
            <p className="text-4xl mb-4">📉</p>
            <p className="text-label font-medium mb-2">No courses match the current filters</p>
            <p className="text-xs text-muted">Try adjusting the year, terms, or other filters.</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="rounded-lg" style={{ background: '#1a1a28', border: '1px solid #2a2a3e', overflow: 'visible' }}>
      <AxisSelectors />

      <div style={{ width: '100%', height: 360 }}>
        <ResponsiveContainer width="100%" height={360}>
          <ScatterChart margin={{ top: 10, right: 20, bottom: 30, left: 20 }}>

            {/* Quadrant shading — only for percentile axes */}
            {showQuadrants && (
              <>
                <ReferenceArea x1={greenX0} x2={greenX1} y1={greenY0} y2={greenY1} fill="rgba(100,220,130,0.07)" />
                <ReferenceArea x1={redX0}   x2={redX1}   y1={redY0}   y2={redY1}   fill="rgba(255,80,80,0.07)" />
              </>
            )}

            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />

            <XAxis
              type="number" dataKey="_xVal" domain={xMode.domain} name={xMeta.label}
              tickFormatter={xMode.tickFmt} tick={{ fill: '#8888aa', fontSize: 11 }}
              axisLine={{ stroke: 'rgba(255,255,255,0.2)' }} tickLine={false}
              label={{ value: `${xMeta.label} ${xHIB ? '↑' : '↓'}`, position: 'insideBottom', offset: -12, fill: '#c0c0d8', fontSize: 12 }}
            />
            <YAxis
              type="number" dataKey="_yVal" domain={yMode.domain} name={yMeta.label}
              tickFormatter={yMode.tickFmt} tick={{ fill: '#8888aa', fontSize: 11 }}
              axisLine={{ stroke: 'rgba(255,255,255,0.2)' }} tickLine={false}
              label={{ value: `${yMeta.label} ${yHIB ? '↑' : '↓'}`, angle: -90, position: 'insideLeft', offset: 10, fill: '#c0c0d8', fontSize: 12 }}
            />

            {/* Median lines — only for percentile axes */}
            {showQuadrants && (
              <>
                <ReferenceLine x={50} stroke="rgba(200,200,220,0.3)" strokeDasharray="4 4" />
                <ReferenceLine y={50} stroke="rgba(200,200,220,0.3)" strokeDasharray="4 4" />
              </>
            )}

            <Tooltip content={<CustomTooltip />} cursor={{ strokeDasharray: '3 3', stroke: '#38bdf8' }} />

            {/* Background dots (grey, no interaction) */}
            <Scatter data={bgData} isAnimationActive={false} shape={<CustomDot onClick={handleDotClick} />} />

            {/* Matched courses */}
            <Scatter data={matchedData} isAnimationActive={false} shape={<CustomDot onClick={handleDotClick} />} />

            {/* Bidding-only (no eval) */}
            <Scatter data={bidOnlyData} isAnimationActive={false} shape={<CustomDot onClick={handleDotClick} />} />

          </ScatterChart>
        </ResponsiveContainer>
      </div>

      {/* Coverage warnings */}
      {warnings.map((w, i) => (
        <div key={i} className="px-4 py-2 text-xs flex items-center gap-2"
          style={{
            background: w.type === 'error' ? '#2a1010' : '#2a2010',
            borderTop: '1px solid #2a2a3e',
            color: w.type === 'error' ? '#f87171' : '#fbbf24',
          }}
        >
          ⚠ {w.msg}
        </div>
      ))}

      {/* Legend */}
      <div className="px-4 py-3 text-xs border-t border-[#2a2a3e]" style={{ background: '#13131f' }}>
        <p className="text-label font-medium mb-1">How to read this:</p>
        <div className="flex flex-wrap gap-x-4 gap-y-0.5">
          {showQuadrants && (
            <>
              <p className="text-muted">
                <span className="text-green-400 font-medium">Green quadrant</span> = {xHIB ? 'high' : 'low'} {xMeta.label} + {yHIB ? 'high' : 'low'} {yMeta.label} (better)
              </p>
              <p className="text-muted">
                <span className="text-red-400 font-medium">Red quadrant</span> = worse on both
              </p>
            </>
          )}
          <p className="text-muted">
            <span className="font-medium" style={{ color: '#e879a0' }}>Pink</span> = ever went to bidding
          </p>
          {bidOnlyData.length > 0 && (
            <p className="text-muted">
              <span className="font-medium" style={{ color: '#fbbf24' }}>Amber ◆</span> = bidding now, no eval yet
              {bidOnlyData.some(d => d._positionedReal)
                ? ' (positions = actual bid data)'
                : ' (positions illustrative — select Bid Price axis for real coords)'}
            </p>
          )}
        </div>
        <p className="text-muted text-[11px] mt-1">
          Click any dot to view course details ·{' '}
          {matchedData.length} course{matchedData.length !== 1 ? 's' : ''} shown
          {bidOnlyData.length > 0 && ` · ${bidOnlyData.length} bidding-only`}
          {bgData.length > 0 && ` · ${bgData.length} others (grey, no hover)`}
        </p>
      </div>
    </div>
  )
}
