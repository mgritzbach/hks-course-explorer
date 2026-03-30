import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Plot from 'react-plotly.js'

const MIN_ZOOM_SPAN_RATIO = 0.015

function clampDomain(nextDomain, baseDomain) {
  const baseSpan = baseDomain[1] - baseDomain[0]
  const nextSpan = nextDomain[1] - nextDomain[0]
  if (nextSpan >= baseSpan) return [...baseDomain]

  let start = nextDomain[0]
  let end = nextDomain[1]

  if (start < baseDomain[0]) {
    end += baseDomain[0] - start
    start = baseDomain[0]
  }
  if (end > baseDomain[1]) {
    start -= end - baseDomain[1]
    end = baseDomain[1]
  }

  return [start, end]
}

function zoomNumericDomain(currentDomain, baseDomain, factor, anchorValue = null) {
  const activeDomain = currentDomain || baseDomain
  const activeSpan = activeDomain[1] - activeDomain[0]
  const baseSpan = baseDomain[1] - baseDomain[0]
  const minSpan = baseSpan * MIN_ZOOM_SPAN_RATIO
  const nextSpan = Math.min(baseSpan, Math.max(minSpan, activeSpan * factor))
  const anchor = anchorValue ?? (activeDomain[0] + activeDomain[1]) / 2
  const anchorRatio = activeSpan === 0 ? 0.5 : (anchor - activeDomain[0]) / activeSpan
  const nextStart = anchor - (nextSpan * anchorRatio)
  return clampDomain([nextStart, nextStart + nextSpan], baseDomain)
}

function panNumericDomain(currentDomain, baseDomain, deltaValue) {
  const activeDomain = currentDomain || baseDomain
  return clampDomain([activeDomain[0] + deltaValue, activeDomain[1] + deltaValue], baseDomain)
}

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
      className="rounded-2xl px-3 py-2 text-xs shadow-lg"
      style={{
        background: 'var(--panel-strong)',
        border: '1px solid var(--line-strong)',
        color: 'var(--text)',
        maxWidth: 280,
        boxShadow: 'var(--shadow-lg)',
      }}
    >
      <p className="mb-1 text-sm font-bold" style={{ color: datum._isBidOnly ? 'var(--gold)' : 'var(--accent-strong)' }}>{datum.course_code}</p>
      <p className="mb-1 leading-snug text-label">{datum.course_name}</p>
      <p className="mb-1 text-muted">
        {datum.professor_display || datum.professor}
        {datum._coTaught && <span className="ml-1 text-[10px]" style={{ color: 'var(--blue)' }}>co-taught ({datum._coTaughtCount})</span>}
      </p>
      <p className="mb-2 text-muted">{datum.is_average ? `avg ${datum.year_range}` : `${datum.term} ${datum.year}`}</p>

      <div className="space-y-0.5">
        {datum._xVal != null && !datum._isBidOnly && (
          <p>{datum._xLabel}: <span className="font-medium">{formatMetricValue(datum, '_xVal', '_xRaw', '_xIsRaw')}</span></p>
        )}
        {datum._yVal != null && !datum._isBidOnly && (
          <p>{datum._yLabel}: <span className="font-medium">{formatMetricValue(datum, '_yVal', '_yRaw', '_yIsRaw')}</span></p>
        )}
        {datum._isBidOnly && <p className="text-[10px]" style={{ color: 'var(--gold)' }}>No eval data yet · ranked by bid competitiveness</p>}
        {datum.metrics_pct?.Instructor_Rating != null && datum._xLabel !== 'Instructor Rating' && datum._yLabel !== 'Instructor Rating' && (
          <p>Instructor: <span className="font-medium" style={{ color: 'var(--blue)' }}>{Math.round(datum.metrics_pct.Instructor_Rating)}%</span></p>
        )}
      </div>

      <div className="mt-2 space-y-0.5 border-t pt-2" style={{ borderColor: 'var(--line)' }}>
        {datum.n_respondents != null && (
          <p className="text-muted">
            N=<span className="font-medium text-label">{datum.n_respondents}</span>
            <span className="ml-1 text-[10px]" style={{ color: 'var(--text-muted)' }}>survey respondents</span>
          </p>
        )}
        <p className="text-muted">
          Bidding: <span className="font-medium" style={{ color: datum.ever_bidding ? '#e6a4bb' : 'var(--text-muted)' }}>{datum.ever_bidding ? 'Yes' : 'No'}</span>
        </p>
        {datum.last_bid_price != null && (
          <p className="text-muted">
            Last clearing price: <span className="font-medium text-label">{datum.last_bid_price} pts</span>
          </p>
        )}
      </div>

      <p className="mt-1 text-[10px]" style={{ color: 'var(--blue)' }}>Click to pin and preview details below</p>
    </div>
  )
}

function CustomDot({ cx, cy, payload, onClick }) {
  if (cx == null || cy == null) return null

  const color = payload._color || 'var(--blue)'
  const opacity = payload._opacity ?? 1
  const size = payload._isBidOnly ? 7 : 6

  if (payload._isBidOnly) {
    const delta = size
    return (
      <polygon
        points={`${cx},${cy - delta} ${cx + delta},${cy} ${cx},${cy + delta} ${cx - delta},${cy}`}
        fill={color}
        fillOpacity={opacity}
        stroke="rgba(255,255,255,0.22)"
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
      stroke="rgba(255,255,255,0.18)"
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
  const chartWrapperRef = useRef(null)
  const [zoomedX, setZoomedX] = useState(null)
  const [zoomedY, setZoomedY] = useState(null)

  const allCoursesDeduped = useMemo(() => dedupeCoTaught(allCourses), [allCourses])
  const matchedCoursesDeduped = useMemo(() => dedupeCoTaught(matchedCourses), [matchedCourses])

  const xMeta = metrics.find((metric) => metric.key === xMetric) || metrics[0]
  const yMeta = metrics.find((metric) => metric.key === yMetric) || metrics[2]
  const xHigherBetter = xMeta.higher_is_better
  const yHigherBetter = yMeta.higher_is_better
  const xMode = useMemo(() => getAxisMode(xMeta, allCoursesDeduped, matchedCoursesDeduped), [allCoursesDeduped, matchedCoursesDeduped, xMeta])
  const yMode = useMemo(() => getAxisMode(yMeta, allCoursesDeduped, matchedCoursesDeduped), [allCoursesDeduped, matchedCoursesDeduped, yMeta])
  const showQuadrants = !xMeta.bid_metric && !yMeta.bid_metric

  const effectiveXDomain = zoomedX || xMode.domain
  const effectiveYDomain = zoomedY || yMode.domain
  const isZoomed = zoomedX != null || zoomedY != null

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
        _color: 'rgba(205, 191, 181, 0.18)',
        _opacity: 0.48,
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
        _color: course.ever_bidding ? '#d78aa7' : '#a51c30',
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
          _color: '#d4a86a',
          _opacity: 0.92,
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

  // Reset zoom when axis metrics change
  useEffect(() => {
    setZoomedX(null)
    setZoomedY(null)
  }, [xMetric, yMetric])

  const handleZoomButton = (direction) => {
    const factor = direction === 'in' ? 0.72 : 1.38
    setZoomedX((current) => zoomNumericDomain(current, xMode.domain, factor))
    setZoomedY((current) => zoomNumericDomain(current, yMode.domain, factor))
  }

  const resetZoom = () => {
    setZoomedX(null)
    setZoomedY(null)
  }

  const handlePlotRelayout = (event) => {
    if (!event) return
    if (event['xaxis.autorange'] || event['yaxis.autorange']) {
      resetZoom()
      return
    }

    const nextX = event['xaxis.range[0]'] != null && event['xaxis.range[1]'] != null
      ? [Number(event['xaxis.range[0]']), Number(event['xaxis.range[1]'])]
      : null
    const nextY = event['yaxis.range[0]'] != null && event['yaxis.range[1]'] != null
      ? [Number(event['yaxis.range[0]']), Number(event['yaxis.range[1]'])]
      : null

    if (nextX) setZoomedX(clampDomain(nextX, xMode.domain))
    if (nextY) setZoomedY(clampDomain(nextY, yMode.domain))
  }

  const buildHoverHtml = (datum) => {
    const titleColor = datum._isBidOnly ? 'var(--gold)' : 'var(--accent-strong)'
    const xLine = datum._isBidOnly || datum._xVal == null
      ? ''
      : `<div>${datum._xLabel}: <b>${formatMetricValue(datum, '_xVal', '_xRaw', '_xIsRaw')}</b></div>`
    const yLine = datum._isBidOnly || datum._yVal == null
      ? ''
      : `<div>${datum._yLabel}: <b>${formatMetricValue(datum, '_yVal', '_yRaw', '_yIsRaw')}</b></div>`
    const bidOnlyLine = datum._isBidOnly
      ? `<div style="color:var(--gold);font-size:10px;">No eval data yet · ranked by bid competitiveness</div>`
      : ''
    const respondents = datum.n_respondents != null
      ? `<div>N=<b>${datum.n_respondents}</b> survey respondents</div>`
      : ''
    const lastBid = datum.last_bid_price != null
      ? `<div>Last clearing price: <b>${datum.last_bid_price} pts</b></div>`
      : ''

    return `
      <div style="max-width:280px;">
        <div style="font-weight:700;font-size:14px;color:${titleColor};">${datum.course_code}</div>
        <div style="color:var(--text-soft);margin-top:2px;">${datum.course_name}</div>
        <div style="color:var(--text-muted);margin-top:4px;">${datum.professor_display || datum.professor}</div>
        <div style="color:var(--text-muted);margin-top:2px;">${datum.is_average ? `avg ${datum.year_range}` : `${datum.term} ${datum.year}`}</div>
        <div style="margin-top:8px;">${xLine}${yLine}${bidOnlyLine}</div>
        <div style="margin-top:8px;padding-top:8px;border-top:1px solid var(--line);color:var(--text-muted);">
          ${respondents}
          <div>Bidding: <b>${datum.ever_bidding ? 'Yes' : 'No'}</b></div>
          ${lastBid}
        </div>
        <div style="margin-top:6px;color:var(--blue);font-size:10px;">Click to pin and preview details below</div>
      </div>
    `
  }

  const plotData = useMemo(() => {
    const traces = []

    if (showQuadrants) {
      traces.push({
        type: 'scatter',
        mode: 'markers',
        x: [],
        y: [],
        hoverinfo: 'skip',
        showlegend: false,
      })
    }

    if (bgData.length) {
      traces.push({
        type: 'scattergl',
        mode: 'markers',
        x: bgData.map((datum) => datum._xVal),
        y: bgData.map((datum) => datum._yVal),
        hoverinfo: 'skip',
        showlegend: false,
        marker: {
          size: 9,
          color: 'rgba(205, 191, 181, 0.22)',
        },
      })
    }

    if (matchedData.length) {
      traces.push({
        type: 'scattergl',
        mode: 'markers',
        x: matchedData.map((datum) => datum._xVal),
        y: matchedData.map((datum) => datum._yVal),
        text: matchedData.map(buildHoverHtml),
        customdata: matchedData,
        hovertemplate: '%{text}<extra></extra>',
        showlegend: false,
        marker: {
          size: 11,
          color: matchedData.map((datum) => datum._color),
          line: { color: 'rgba(255,255,255,0.16)', width: 0.8 },
        },
      })
    }

    if (bidOnlyData.length) {
      traces.push({
        type: 'scattergl',
        mode: 'markers',
        x: bidOnlyData.map((datum) => datum._xVal),
        y: bidOnlyData.map((datum) => datum._yVal),
        text: bidOnlyData.map(buildHoverHtml),
        customdata: bidOnlyData,
        hovertemplate: '%{text}<extra></extra>',
        showlegend: false,
        marker: {
          size: 12,
          symbol: 'diamond',
          color: '#d4a86a',
          line: { color: 'rgba(255,255,255,0.22)', width: 0.8 },
        },
      })
    }

    return traces
  }, [bgData, bidOnlyData, matchedData, showQuadrants])

  const plotLayout = useMemo(() => {
    const shapes = []
    if (showQuadrants) {
      shapes.push(
        {
          type: 'rect',
          xref: 'x',
          yref: 'y',
          x0: greenX0,
          x1: greenX1,
          y0: greenY0,
          y1: greenY1,
          fillcolor: 'rgba(123, 176, 138, 0.11)',
          line: { width: 0 },
          layer: 'below',
        },
        {
          type: 'rect',
          xref: 'x',
          yref: 'y',
          x0: redX0,
          x1: redX1,
          y0: redY0,
          y1: redY1,
          fillcolor: 'rgba(165, 28, 48, 0.11)',
          line: { width: 0 },
          layer: 'below',
        },
      )

      if (!isZoomed) {
        shapes.push(
          {
            type: 'line',
            xref: 'x',
            yref: 'y',
            x0: 50,
            x1: 50,
            y0: effectiveYDomain[0],
            y1: effectiveYDomain[1],
            line: { color: 'rgba(243, 233, 226, 0.28)', dash: 'dot', width: 1 },
            layer: 'below',
          },
          {
            type: 'line',
            xref: 'x',
            yref: 'y',
            x0: effectiveXDomain[0],
            x1: effectiveXDomain[1],
            y0: 50,
            y1: 50,
            line: { color: 'rgba(243, 233, 226, 0.28)', dash: 'dot', width: 1 },
            layer: 'below',
          },
        )
      }
    }

    return {
      autosize: true,
      margin: { t: 12, r: 18, b: 44, l: 54 },
      paper_bgcolor: 'rgba(0,0,0,0)',
      plot_bgcolor: 'rgba(0,0,0,0)',
      dragmode: 'pan',
      hovermode: 'closest',
      shapes,
      xaxis: {
        range: effectiveXDomain,
        fixedrange: false,
        tickfont: { color: 'var(--text-muted)', size: 11 },
        ticksuffix: xMode.useRaw ? '' : '%',
        showline: true,
        linecolor: 'rgba(243, 233, 226, 0.2)',
        tickcolor: 'rgba(243, 233, 226, 0.2)',
        gridcolor: 'rgba(243, 233, 226, 0.06)',
        zeroline: false,
        title: { text: xMeta.label, font: { color: 'var(--text-muted)', size: 12 } },
      },
      yaxis: {
        range: effectiveYDomain,
        fixedrange: false,
        tickfont: { color: 'var(--text-muted)', size: 11 },
        ticksuffix: yMode.useRaw ? '' : '%',
        showline: true,
        linecolor: 'rgba(243, 233, 226, 0.2)',
        tickcolor: 'rgba(243, 233, 226, 0.2)',
        gridcolor: 'rgba(243, 233, 226, 0.06)',
        zeroline: false,
        title: { text: yMeta.label, font: { color: 'var(--text-muted)', size: 12 } },
      },
      hoverlabel: {
        bgcolor: 'var(--panel-strong)',
        bordercolor: 'var(--line-strong)',
        font: { color: 'var(--text)', size: 12 },
      },
    }
  }, [effectiveXDomain, effectiveYDomain, greenX0, greenX1, greenY0, greenY1, isZoomed, redX0, redX1, redY0, redY1, showQuadrants, xMeta.label, xMode.useRaw, yMeta.label, yMode.useRaw])

  const plotConfig = useMemo(() => ({
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

  const AxisSelectors = () => (
    <div className="grid gap-3 border-b px-4 py-4 md:grid-cols-2" style={{ borderColor: 'var(--line)' }}>
      <div>
        <p className="mb-1 text-[10px] text-muted">
          Y-Axis: {yHigherBetter ? 'Higher is better' : 'Lower is better'}
          {yMode.useRaw && <span className="ml-1" style={{ color: 'var(--gold)' }}>raw values</span>}
        </p>
        <div className="select-wrap">
          <select value={yMetric} onChange={(event) => onYChange(event.target.value)}>
            {metrics.map((metric) => (
              <option key={metric.key} value={metric.key}>{metric.label}</option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <p className="mb-1 text-[10px] text-muted">
          X-Axis: {xHigherBetter ? 'Higher is better' : 'Lower is better'}
          {xMode.useRaw && <span className="ml-1" style={{ color: 'var(--gold)' }}>raw values</span>}
        </p>
        <div className="select-wrap">
          <select value={xMetric} onChange={(event) => onXChange(event.target.value)}>
            {metrics.map((metric) => (
              <option key={metric.key} value={metric.key}>{metric.label}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex items-center gap-2 md:col-span-2">
        <button
          onClick={() => handleZoomButton('out')}
          className="rounded-full px-2.5 py-1 text-[11px] font-semibold transition-colors hover:text-label"
          style={{ border: '1px solid var(--line)', background: 'var(--panel-subtle)', color: 'var(--text-muted)' }}
        >
          -
        </button>
        <button
          onClick={() => handleZoomButton('in')}
          className="rounded-full px-2.5 py-1 text-[11px] font-semibold transition-colors hover:text-label"
          style={{ border: '1px solid var(--line)', background: 'var(--panel-subtle)', color: 'var(--text-muted)' }}
        >
          +
        </button>
        {isZoomed && (
          <>
            <span className="text-[10px]" style={{ color: 'var(--blue)' }}>Zoomed in</span>
            <button
              onClick={resetZoom}
              className="rounded-full px-2.5 py-1 text-[10px] font-semibold transition-colors hover:text-label"
              style={{ border: '1px solid var(--line)', background: 'var(--panel-subtle)', color: 'var(--text-muted)' }}
            >
              Reset zoom
            </button>
          </>
        )}
      </div>
    </div>
  )

  if (allEmpty) {
    return (
      <div className="surface-card shrink-0 rounded-[24px]" style={{ display: 'flex', flexDirection: 'column' }}>
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
    <div className="surface-card shrink-0 rounded-[24px]" style={{ overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <AxisSelectors />

      <div
        ref={chartWrapperRef}
        style={{ width: '100%', height: chartHeight, flexShrink: 0, position: 'relative' }}
      >
        <Plot
          data={plotData}
          layout={plotLayout}
          config={plotConfig}
          useResizeHandler
          onRelayout={handlePlotRelayout}
          onClick={(event) => {
            const datum = event?.points?.[0]?.customdata
            if (datum?.id) setPinnedDatum(datum)
          }}
          style={{ width: '100%', height: `${chartHeight}px` }}
        />
      </div>

      {pinnedDatum && (
        <div className="border-t px-4 py-4" style={{ borderColor: 'var(--line)', background: 'var(--panel-subtle)' }}>
          <div className="mb-3 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-bold" style={{ color: pinnedDatum._isBidOnly ? 'var(--gold)' : 'var(--accent-strong)' }}>{pinnedDatum.course_code}</p>
              <p className="text-sm text-label">{pinnedDatum.course_name}</p>
              <p className="mt-1 text-xs text-muted">{pinnedDatum.professor_display || pinnedDatum.professor}</p>
            </div>
            <button
              onClick={() => setPinnedDatum(null)}
              className="rounded-full border px-3 py-1 text-[11px] text-muted hover:text-label"
              style={{ borderColor: 'var(--line)' }}
            >
              Close
            </button>
          </div>

          <div className="space-y-1 text-xs text-muted">
            <p>{pinnedDatum.is_average ? `Average ${pinnedDatum.year_range}` : `${pinnedDatum.term} ${pinnedDatum.year}`}</p>
            {pinnedDatum._xVal != null && <p>{pinnedDatum._xLabel}: <span className="text-label">{formatMetricValue(pinnedDatum, '_xVal', '_xRaw', '_xIsRaw')}</span></p>}
            {pinnedDatum._yVal != null && <p>{pinnedDatum._yLabel}: <span className="text-label">{formatMetricValue(pinnedDatum, '_yVal', '_yRaw', '_yIsRaw')}</span></p>}
            {pinnedDatum.n_respondents != null && <p>N=<span className="text-label">{pinnedDatum.n_respondents}</span> survey respondents</p>}
            {pinnedDatum.last_bid_price != null && <p>Last clearing price: <span className="text-label">{pinnedDatum.last_bid_price} pts</span></p>}
          </div>

          <div className="mt-3">
            <button onClick={() => navigate(`/courses?id=${encodeURIComponent(pinnedDatum.id)}`)} className="btn-details">
              Go to Course Details
            </button>
          </div>
        </div>
      )}

      {warnings.map((warning, index) => (
        <div
          key={`${warning.msg}-${index}`}
          className="flex items-center gap-2 border-t px-4 py-2 text-xs"
          style={{
            borderColor: 'var(--line)',
            background: warning.type === 'error' ? 'rgba(216, 112, 112, 0.12)' : 'rgba(217, 155, 78, 0.12)',
            color: warning.type === 'error' ? 'var(--danger)' : 'var(--warning)',
          }}
        >
          <span>Warning:</span>
          <span>{warning.msg}</span>
        </div>
      ))}

      <div className="border-t px-4 py-3 text-xs" style={{ borderColor: 'var(--line)', background: 'rgba(255,255,255,0.015)' }}>
        <p className="mb-2 font-medium text-label">How to read this</p>
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {showQuadrants && (
            <>
              <p className="text-muted"><span className="font-medium" style={{ color: 'var(--success)' }}>Green quadrant</span> = stronger on both axes</p>
              <p className="text-muted"><span className="font-medium" style={{ color: 'var(--accent-strong)' }}>Crimson quadrant</span> = weaker on both axes</p>
            </>
          )}
          <p className="text-muted"><span className="font-medium" style={{ color: '#d78aa7' }}>Rose</span> = ever went to bidding</p>
          {bidOnlyData.length > 0 && (
            <p className="text-muted">
              <span className="font-medium" style={{ color: 'var(--gold)' }}>Amber diamond</span> = bidding now, no eval yet, evenly spread by competitiveness rank
            </p>
          )}
        </div>
        <p className="mt-2 text-[11px] text-muted">
          Click a point to preview details · use + / - or pinch to zoom · drag or two-finger pan to move
          {isZoomed && <span style={{ color: 'var(--blue)' }}> · zoomed</span>}
          {` · ${matchedData.length} course${matchedData.length !== 1 ? 's' : ''} shown`}
          {bidOnlyData.length > 0 && ` · ${bidOnlyData.length} bidding only`}
          {bgData.length > 0 && ` · ${bgData.length} additional context points`}
        </p>
        <p className="mt-1 text-[10px] text-muted md:hidden" style={{ color: 'var(--text-muted)' }}>
          Tip: rotate to landscape for a larger chart on mobile.
        </p>
      </div>
    </div>
  )
}
