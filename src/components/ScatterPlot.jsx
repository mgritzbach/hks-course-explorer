import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  SCATTER_JITTER,
  buildHoverTemplate,
  clampDomain,
  coverageWarning,
  dedupeCoTaught,
  formatMetricValue,
  getAxisMode,
  getAxisTitle,
  hashJitter,
  isBaseOrWiderDomain,
  normalizeBidPrice,
  spreadRankPosition,
  zoomNumericDomain,
} from '../lib/scatterData.js'
import Plot from '../lib/plotlyComponent.js'
import ScatterControls from './ScatterControls.jsx'

function _CustomTooltip({ active, payload }) {
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
      <p
        className="mb-1 text-sm font-bold"
        style={{ color: datum._isBidOnly ? 'var(--gold)' : 'var(--accent-strong)' }}
      >
        {datum.course_code}
      </p>
      <p className="mb-1 leading-snug text-label">{datum.course_name}</p>
      <p className="mb-1 text-muted">
        {datum.professor_display || datum.professor}
        {datum._coTaught && (
          <span className="ml-1 text-[10px]" style={{ color: 'var(--blue)' }}>
            co-taught ({datum._coTaughtCount})
          </span>
        )}
      </p>
      <p className="mb-2 text-muted">
        {datum.is_average ? `avg ${datum.year_range}` : `${datum.term} ${datum.year}`}
      </p>

      <div className="space-y-0.5">
        {datum._xVal != null && !datum._isBidOnly && (
          <p>
            {datum._xLabel}:{' '}
            <span className="font-medium">
              {formatMetricValue(datum, '_xVal', '_xRaw', '_xIsRaw')}
            </span>
          </p>
        )}
        {datum._yVal != null && !datum._isBidOnly && (
          <p>
            {datum._yLabel}:{' '}
            <span className="font-medium">
              {formatMetricValue(datum, '_yVal', '_yRaw', '_yIsRaw')}
            </span>
          </p>
        )}
        {datum._isBidOnly && (
          <p className="text-[10px]" style={{ color: 'var(--gold)' }}>
            No eval data yet · ranked by bid competitiveness
          </p>
        )}
        {datum.metrics_pct?.Instructor_Rating != null &&
          datum._xLabel !== 'Instructor Rating' &&
          datum._yLabel !== 'Instructor Rating' && (
            <p>
              Instructor:{' '}
              <span className="font-medium" style={{ color: 'var(--blue)' }}>
                {Math.round(datum.metrics_pct.Instructor_Rating)} pct
              </span>
            </p>
          )}
      </div>

      <div className="mt-2 space-y-0.5 border-t pt-2" style={{ borderColor: 'var(--line)' }}>
        {datum.n_respondents != null && (
          <p className="text-muted">
            N=<span className="font-medium text-label">{datum.n_respondents}</span>
            <span className="ml-1 text-[10px]" style={{ color: 'var(--text-muted)' }}>
              survey respondents
            </span>
          </p>
        )}
        <p className="text-muted">
          Bidding:{' '}
          <span
            className="font-medium"
            style={{ color: datum.ever_bidding ? '#e6a4bb' : 'var(--text-muted)' }}
          >
            {datum.ever_bidding ? 'Yes' : 'No'}
          </span>
        </p>
        {datum.last_bid_price != null && (
          <p className="text-muted">
            Last clearing price:{' '}
            <span className="font-medium text-label">{datum.last_bid_price} pts</span>
          </p>
        )}
      </div>

      <p className="mt-1 text-[10px]" style={{ color: 'var(--blue)' }}>
        Click to pin and preview details below
      </p>
    </div>
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
  metricMode = 'score',
  colorblindMode = false,
  isLight = false,
  favs,
}) {
  const navigate = useNavigate()
  const { favorites, toggle: toggleFav } = favs
  const [pinnedDatum, setPinnedDatum] = useState(null)
  const [hoverState, setHoverState] = useState(null)
  const chartWrapperRef = useRef(null)
  const [zoomedX, setZoomedX] = useState(null)
  const [zoomedY, setZoomedY] = useState(null)
  const [viewResetRevision, setViewResetRevision] = useState(0)

  const allCoursesDeduped = useMemo(() => dedupeCoTaught(allCourses), [allCourses])
  const matchedCoursesDeduped = useMemo(() => dedupeCoTaught(matchedCourses), [matchedCourses])
  const matchedViewKey = useMemo(
    () =>
      matchedCoursesDeduped
        .map((course) => course.id)
        .sort()
        .join('|'),
    [matchedCoursesDeduped],
  )

  // A new preset, metric, or dataset represents a new chart view. Do not
  // carry a pan/zoom range or pinned point across incompatible coordinates.
  useEffect(() => {
    setZoomedX(null)
    setZoomedY(null)
    setViewResetRevision((revision) => revision + 1)
    setPinnedDatum(null)
    setHoverState(null)
  }, [matchedViewKey, metricMode, xMetric, yMetric])

  const xMeta = metrics.find((metric) => metric.key === xMetric) || metrics[0]
  const yMeta = metrics.find((metric) => metric.key === yMetric) || metrics[2]
  const xHigherBetter = xMeta.higher_is_better
  const yHigherBetter = yMeta.higher_is_better
  const xMode = useMemo(
    () => getAxisMode(xMeta, allCoursesDeduped, matchedCoursesDeduped),
    [allCoursesDeduped, matchedCoursesDeduped, xMeta],
  )
  const yMode = useMemo(
    () => getAxisMode(yMeta, allCoursesDeduped, matchedCoursesDeduped),
    [allCoursesDeduped, matchedCoursesDeduped, yMeta],
  )
  const showQuadrants = !xMeta.bid_metric && !yMeta.bid_metric

  const effectiveXDomain = zoomedX || xMode.domain
  const effectiveYDomain = zoomedY || yMode.domain
  const isZoomed = zoomedX != null || zoomedY != null

  const warnings = [
    coverageWarning(allCoursesDeduped, xMeta),
    coverageWarning(allCoursesDeduped, yMeta),
  ].filter(Boolean)

  const matchedIds = useMemo(
    () => new Set(matchedCoursesDeduped.map((course) => course.id)),
    [matchedCoursesDeduped],
  )
  const getValue = useCallback(
    (course, axisMode, key) => {
      if (axisMode.useRaw) return course.metrics_raw?.[key] ?? null
      if (metricMode === 'score') return course.metrics_score?.[key] ?? null
      return course.metrics_pct?.[key] ?? null
    },
    [metricMode],
  )

  const bgData = useMemo(
    () =>
      allCoursesDeduped
        .filter(
          (course) =>
            !matchedIds.has(course.id) &&
            getValue(course, xMode, xMetric) != null &&
            getValue(course, yMode, yMetric) != null,
        )
        .map((course) => {
          const rawX = getValue(course, xMode, xMetric)
          const rawY = getValue(course, yMode, yMetric)
          const jx = xMode.useRaw ? 0 : hashJitter(course.id + 'x', SCATTER_JITTER)
          const jy = yMode.useRaw ? 0 : hashJitter(course.id + 'y', SCATTER_JITTER)
          return {
            ...course,
            _xVal: Math.max(xMode.domain[0], Math.min(xMode.domain[1], rawX + jx)),
            _yVal: Math.max(yMode.domain[0], Math.min(yMode.domain[1], rawY + jy)),
            _color: 'rgba(205, 191, 181, 0.18)',
            _opacity: 0.48,
            _noHover: true,
          }
        }),
    [allCoursesDeduped, getValue, matchedIds, xMetric, xMode, yMetric, yMode],
  )

  const matchedData = useMemo(
    () =>
      matchedCoursesDeduped
        .filter(
          (course) =>
            getValue(course, xMode, xMetric) != null && getValue(course, yMode, yMetric) != null,
        )
        .map((course) => {
          const rawX = getValue(course, xMode, xMetric)
          const rawY = getValue(course, yMode, yMetric)
          const jx = xMode.useRaw ? 0 : hashJitter(course.id + 'x', SCATTER_JITTER)
          const jy = yMode.useRaw ? 0 : hashJitter(course.id + 'y', SCATTER_JITTER)
          const code = course.course_code_base || course.course_code
          const starred = favorites?.has(code) ?? false
          return {
            ...course,
            _xVal: Math.max(xMode.domain[0], Math.min(xMode.domain[1], rawX + jx)),
            _yVal: Math.max(yMode.domain[0], Math.min(yMode.domain[1], rawY + jy)),
            _xRaw:
              !xMode.useRaw && xMeta.bid_metric ? (course.metrics_raw?.[xMetric] ?? null) : null,
            _yRaw:
              !yMode.useRaw && yMeta.bid_metric ? (course.metrics_raw?.[yMetric] ?? null) : null,
            _xRaw05: !xMode.useRaw ? (course.metrics_raw?.[xMetric] ?? null) : null,
            _yRaw05: !yMode.useRaw ? (course.metrics_raw?.[yMetric] ?? null) : null,
            _xIsRaw: xMode.useRaw,
            _yIsRaw: yMode.useRaw,
            _xLabel: xMeta.label,
            _yLabel: yMeta.label,
            _color: course.ever_bidding ? '#d78aa7' : '#a51c30',
            _opacity: 1,
            _starred: starred,
          }
        }),
    [favorites, getValue, matchedCoursesDeduped, xMeta, xMetric, xMode, yMeta, yMetric, yMode],
  )

  const bidOnlyData = useMemo(
    () =>
      (biddingOnlyCourses || [])
        .filter((course) => course.last_bid_price != null)
        .sort((a, b) => {
          if ((b.last_bid_price ?? -1) !== (a.last_bid_price ?? -1))
            return (b.last_bid_price ?? -1) - (a.last_bid_price ?? -1)
          return (a.course_name || a.course_code || '').localeCompare(
            b.course_name || b.course_code || '',
          )
        })
        .map((course, index, rankedCourses) => {
          const normalizedBid = normalizeBidPrice(course.last_bid_price)
          const rankX = spreadRankPosition(
            index,
            rankedCourses.length,
            xMode.useRaw ? xMode.domain[1] : 100,
          )
          const rankY = spreadRankPosition(
            index,
            rankedCourses.length,
            yMode.useRaw ? yMode.domain[1] : 100,
          )
          const axisBidValueX = xMeta.bid_metric
            ? xMode.useRaw
              ? (course.last_bid_price ?? null)
              : normalizedBid
            : rankX
          const axisBidValueY = yMeta.bid_metric
            ? yMode.useRaw
              ? (course.last_bid_price ?? null)
              : normalizedBid
            : rankY

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
        .filter((course) => course._xVal != null && course._yVal != null),
    [
      biddingOnlyCourses,
      xMeta.bid_metric,
      xMeta.label,
      xMode.domain,
      xMode.useRaw,
      yMeta.bid_metric,
      yMeta.label,
      yMode.domain,
      yMode.useRaw,
    ],
  )

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

    const stillExists = [...matchedData, ...bidOnlyData].some(
      (datum) => datum.id === pinnedDatum.id,
    )
    if (!stillExists) setPinnedDatum(null)
  }, [bidOnlyData, matchedData, pinnedDatum])

  // Reset zoom when axis metrics change
  useEffect(() => {
    setZoomedX(null)
    setZoomedY(null)
  }, [xMetric, yMetric])

  useEffect(() => {
    const el = chartWrapperRef.current
    if (!el) return undefined

    let lastDist = null

    const onTouchMove = (e) => {
      if (e.touches.length !== 2) return
      e.preventDefault()
      const dx = e.touches[0].clientX - e.touches[1].clientX
      const dy = e.touches[0].clientY - e.touches[1].clientY
      const dist = Math.sqrt(dx * dx + dy * dy)

      if (lastDist !== null && Math.abs(dist - lastDist) > 1) {
        const factor = lastDist / dist
        setZoomedX((current) => zoomNumericDomain(current, xMode.domain, factor))
        setZoomedY((current) => zoomNumericDomain(current, yMode.domain, factor))
      }

      lastDist = dist
    }

    const onTouchEnd = () => {
      lastDist = null
    }

    el.addEventListener('touchmove', onTouchMove, { passive: false })
    el.addEventListener('touchend', onTouchEnd, { passive: true })

    return () => {
      el.removeEventListener('touchmove', onTouchMove)
      el.removeEventListener('touchend', onTouchEnd)
    }
  }, [xMode.domain, yMode.domain])

  const handleZoomButton = (direction) => {
    const factor = direction === 'in' ? 0.72 : 1.38
    setZoomedX((current) => zoomNumericDomain(current, xMode.domain, factor))
    setZoomedY((current) => zoomNumericDomain(current, yMode.domain, factor))
  }

  const resetZoom = () => {
    setZoomedX(null)
    setZoomedY(null)
    // Force Plotly to discard any internal pan/autorange state even when the
    // React ranges are already at their base values.
    setViewResetRevision((revision) => revision + 1)
  }

  const handlePlotRelayout = (event) => {
    if (!event) return
    if (event['xaxis.autorange'] || event['yaxis.autorange']) {
      resetZoom()
      return
    }

    const nextX =
      event['xaxis.range[0]'] != null && event['xaxis.range[1]'] != null
        ? [Number(event['xaxis.range[0]']), Number(event['xaxis.range[1]'])]
        : null
    const nextY =
      event['yaxis.range[0]'] != null && event['yaxis.range[1]'] != null
        ? [Number(event['yaxis.range[0]']), Number(event['yaxis.range[1]'])]
        : null

    if (
      nextX &&
      nextY &&
      isBaseOrWiderDomain(nextX, xMode.domain) &&
      isBaseOrWiderDomain(nextY, yMode.domain)
    ) {
      resetZoom()
      return
    }

    if (nextX) setZoomedX(clampDomain(nextX, xMode.domain))
    if (nextY) setZoomedY(clampDomain(nextY, yMode.domain))
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
      const hasStarred = matchedData.some((datum) => datum._starred)
      traces.push({
        type: 'scattergl',
        mode: 'markers',
        x: matchedData.map((datum) => datum._xVal),
        y: matchedData.map((datum) => datum._yVal),
        customdata: matchedData,
        hovertemplate: buildHoverTemplate(),
        showlegend: false,
        marker: {
          size: hasStarred ? matchedData.map((datum) => (datum._starred ? 14 : 10)) : 11,
          color: matchedData.map((datum) => (datum._starred ? '#d4a86a' : datum._color)),
          opacity: 0.55,
          line: {
            color: hasStarred
              ? matchedData.map((datum) =>
                  datum._starred
                    ? '#b8873a'
                    : isLight
                      ? 'rgba(0,0,0,0.15)'
                      : 'rgba(255,255,255,0.16)',
                )
              : isLight
                ? 'rgba(0,0,0,0.15)'
                : 'rgba(255,255,255,0.16)',
            width: hasStarred ? matchedData.map((datum) => (datum._starred ? 2 : 0.8)) : 0.8,
          },
        },
      })
    }

    if (bidOnlyData.length) {
      traces.push({
        type: 'scattergl',
        mode: 'markers',
        x: bidOnlyData.map((datum) => datum._xVal),
        y: bidOnlyData.map((datum) => datum._yVal),
        customdata: bidOnlyData,
        hovertemplate: buildHoverTemplate(true),
        showlegend: false,
        marker: {
          size: 12,
          symbol: 'diamond',
          color: '#d4a86a',
          opacity: 0.55,
          line: { color: isLight ? 'rgba(0,0,0,0.18)' : 'rgba(255,255,255,0.22)', width: 0.8 },
        },
      })
    }

    return traces
  }, [bgData, bidOnlyData, isLight, matchedData, showQuadrants])

  // Task 5: Colorblind-safe palette — blue/orange instead of green/red
  const quadGoodColor = colorblindMode ? 'rgba(66, 133, 244, 0.18)' : 'rgba(123, 176, 138, 0.18)'
  const quadBadColor = colorblindMode ? 'rgba(255, 152, 0, 0.18)' : 'rgba(165, 28, 48, 0.18)'
  const quadGoodBorder = colorblindMode ? 'rgba(66, 133, 244, 0.35)' : 'rgba(123, 176, 138, 0.35)'
  const quadBadBorder = colorblindMode ? 'rgba(255, 152, 0, 0.35)' : 'rgba(165, 28, 48, 0.35)'
  const legendGoodLabel = colorblindMode ? 'var(--blue)' : 'var(--success)'
  const legendBadLabel = colorblindMode ? 'var(--gold)' : 'var(--accent-strong)'

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
          fillcolor: quadGoodColor,
          line: { color: quadGoodBorder, width: 1 },
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
          fillcolor: quadBadColor,
          line: { color: quadBadBorder, width: 1 },
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
            line: {
              color: isLight ? 'rgba(0,0,0,0.25)' : 'rgba(243, 233, 226, 0.28)',
              dash: 'dot',
              width: 1,
            },
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
            line: {
              color: isLight ? 'rgba(0,0,0,0.25)' : 'rgba(243, 233, 226, 0.28)',
              dash: 'dot',
              width: 1,
            },
            layer: 'below',
          },
        )
      }
    }

    return {
      autosize: true,
      // Plotly otherwise preserves an out-of-date internal pan range even
      // after React supplies a new controlled range.
      uirevision: `${xMetric}-${yMetric}-${metricMode}-${matchedViewKey}-${viewResetRevision}-${effectiveXDomain.join(':')}-${effectiveYDomain.join(':')}`,
      // Leave enough room for vertical labels such as "Course Rating
      // (percentile)" instead of letting them crowd the plot edge.
      margin: { t: 44, r: 18, b: 44, l: 78 },
      paper_bgcolor: 'rgba(0,0,0,0)',
      plot_bgcolor: 'rgba(0,0,0,0)',
      dragmode: 'pan',
      hovermode: 'closest',
      shapes,
      xaxis: {
        range: effectiveXDomain,
        fixedrange: false,
        minallowed: xMode.domain[0],
        maxallowed: xMode.domain[1],
        tickfont: { color: 'var(--text-muted)', size: 11 },
        ticksuffix: xMode.useRaw ? '' : metricMode === 'score' ? '%' : ' pct',
        showline: true,
        linecolor: isLight ? 'rgba(0,0,0,0.18)' : 'rgba(243, 233, 226, 0.2)',
        tickcolor: isLight ? 'rgba(0,0,0,0.18)' : 'rgba(243, 233, 226, 0.2)',
        gridcolor: isLight ? 'rgba(0,0,0,0.07)' : 'rgba(243, 233, 226, 0.06)',
        zeroline: false,
        title: {
          text: getAxisTitle(xMeta, metricMode),
          font: { color: 'var(--text-muted)', size: 12 },
        },
      },
      yaxis: {
        range: effectiveYDomain,
        fixedrange: false,
        minallowed: yMode.domain[0],
        maxallowed: yMode.domain[1],
        tickfont: { color: 'var(--text-muted)', size: 11 },
        ticksuffix: yMode.useRaw ? '' : metricMode === 'score' ? '%' : ' pct',
        showline: true,
        linecolor: isLight ? 'rgba(0,0,0,0.18)' : 'rgba(243, 233, 226, 0.2)',
        tickcolor: isLight ? 'rgba(0,0,0,0.18)' : 'rgba(243, 233, 226, 0.2)',
        gridcolor: isLight ? 'rgba(0,0,0,0.07)' : 'rgba(243, 233, 226, 0.06)',
        zeroline: false,
        title: {
          text: getAxisTitle(yMeta, metricMode),
          font: { color: 'var(--text-muted)', size: 12 },
        },
      },
      hoverlabel: {
        bgcolor: 'var(--panel-strong)',
        bordercolor: 'var(--line-strong)',
        font: { color: 'var(--text)', size: 12 },
      },
      annotations:
        showQuadrants && !isZoomed && xMeta.key === 'Workload' && yMeta.key === 'Instructor_Rating'
          ? [
              {
                xref: 'paper',
                yref: 'paper',
                x: 0.08,
                y: 0.92,
                text: 'Easy A',
                showarrow: false,
                font: { size: 10, color: 'var(--text-muted)' },
              },
              {
                xref: 'paper',
                yref: 'paper',
                x: 0.92,
                y: 0.92,
                text: 'Worth It',
                showarrow: false,
                font: { size: 10, color: 'var(--text-muted)' },
              },
              {
                xref: 'paper',
                yref: 'paper',
                x: 0.08,
                y: 0.08,
                text: 'Skip',
                showarrow: false,
                font: { size: 10, color: 'var(--text-muted)' },
              },
              {
                xref: 'paper',
                yref: 'paper',
                x: 0.92,
                y: 0.08,
                text: 'Brutal',
                showarrow: false,
                font: { size: 10, color: 'var(--text-muted)' },
              },
            ]
          : [],
    }
  }, [
    effectiveXDomain,
    effectiveYDomain,
    greenX0,
    greenX1,
    greenY0,
    greenY1,
    isLight,
    isZoomed,
    metricMode,
    matchedViewKey,
    quadBadBorder,
    quadBadColor,
    quadGoodBorder,
    quadGoodColor,
    redX0,
    redX1,
    redY0,
    redY1,
    showQuadrants,
    xMeta,
    xMetric,
    xMode.domain,
    xMode.useRaw,
    yMeta,
    yMetric,
    yMode.domain,
    yMode.useRaw,
    viewResetRevision,
  ])

  const plotConfig = useMemo(
    () => ({
      responsive: true,
      displaylogo: false,
      displayModeBar: false,
      scrollZoom: false,
      doubleClick: 'reset',
      modeBarButtonsToRemove: [
        'select2d',
        'lasso2d',
        'hoverClosestCartesian',
        'hoverCompareCartesian',
        'toggleSpikelines',
        'autoScale2d',
      ],
    }),
    [],
  )

  const handlePlotHover = (event) => {
    const point = event?.points?.[0]
    const datum = point?.customdata
    const nativeEvent = event?.event
    const wrapper = chartWrapperRef.current
    if (!datum?.id || !nativeEvent || !wrapper) return

    const bounds = wrapper.getBoundingClientRect()
    const tooltipWidth = 320
    const tooltipHeight = 220
    const offset = 14

    let left = nativeEvent.clientX - bounds.left + offset
    let top = nativeEvent.clientY - bounds.top - tooltipHeight / 2

    left = Math.max(12, Math.min(left, bounds.width - tooltipWidth - 12))
    top = Math.max(12, Math.min(top, bounds.height - tooltipHeight - 12))

    setHoverState({ datum, left, top })
  }

  const clearHover = () => setHoverState(null)

  const AxisSelectors = () => (
    <div
      className="grid gap-3 border-b px-4 py-4 md:grid-cols-2"
      style={{ borderColor: 'var(--line)' }}
    >
      <div>
        <p className="mb-1 text-[10px] text-muted">
          Y-Axis: {yHigherBetter ? 'Higher is better' : 'Lower is better'}
          {yMode.useRaw && (
            <span className="ml-1" style={{ color: 'var(--gold)' }}>
              raw values
            </span>
          )}
        </p>
        <div className="select-wrap">
          <select
            aria-label="Y-axis metric"
            value={yMetric}
            onChange={(event) => onYChange(event.target.value)}
          >
            {metrics.map((metric) => (
              <option key={metric.key} value={metric.key}>
                {metric.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <p className="mb-1 text-[10px] text-muted">
          X-Axis: {xHigherBetter ? 'Higher is better' : 'Lower is better'}
          {xMode.useRaw && (
            <span className="ml-1" style={{ color: 'var(--gold)' }}>
              raw values
            </span>
          )}
        </p>
        <div className="select-wrap">
          <select
            aria-label="X-axis metric"
            value={xMetric}
            onChange={(event) => onXChange(event.target.value)}
          >
            {metrics.map((metric) => (
              <option key={metric.key} value={metric.key}>
                {metric.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <ScatterControls
        isZoomed={isZoomed}
        onZoomOut={() => handleZoomButton('out')}
        onZoomIn={() => handleZoomButton('in')}
        onReset={resetZoom}
      />
    </div>
  )

  if (allEmpty) {
    return (
      <div
        className="surface-card shrink-0 rounded-[24px]"
        style={{ display: 'flex', flexDirection: 'column' }}
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
      className="surface-card shrink-0 rounded-[24px]"
      style={{ overflow: 'hidden', display: 'flex', flexDirection: 'column' }}
    >
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
          onHover={handlePlotHover}
          onUnhover={clearHover}
          onClick={(event) => {
            const datum = event?.points?.[0]?.customdata
            if (datum?.id) setPinnedDatum(datum)
          }}
          style={{ width: '100%', height: `${chartHeight}px` }}
        />

        {hoverState?.datum && (
          <div
            className="rounded-2xl px-3 py-2 text-xs shadow-lg"
            style={{
              position: 'absolute',
              left: hoverState.left,
              top: hoverState.top,
              width: 320,
              maxWidth: 'calc(100% - 24px)',
              background: 'var(--panel-strong)',
              border: '1px solid var(--line-strong)',
              color: 'var(--text)',
              boxShadow: 'var(--shadow-lg)',
              pointerEvents: 'none',
              zIndex: 5,
            }}
          >
            <p
              className="mb-1 text-sm font-bold"
              style={{
                color: hoverState.datum._isBidOnly ? 'var(--gold)' : 'var(--accent-strong)',
              }}
            >
              {hoverState.datum.course_code}
            </p>
            <p className="mb-1 leading-snug text-label">{hoverState.datum.course_name}</p>
            <p className="mb-1 text-muted">
              {hoverState.datum.professor_display || hoverState.datum.professor}
              {hoverState.datum._coTaught && (
                <span className="ml-1 text-[10px]" style={{ color: 'var(--blue)' }}>
                  co-taught ({hoverState.datum._coTaughtCount})
                </span>
              )}
            </p>
            <p className="mb-0.5 text-muted">
              {hoverState.datum.is_average
                ? `avg ${hoverState.datum.year_range}`
                : `${hoverState.datum.term} ${hoverState.datum.year}`}
            </p>
            {hoverState.datum.concentration && (
              <p className="mb-2 text-[10px]" style={{ color: 'var(--text-muted)' }}>
                {hoverState.datum.concentration}
              </p>
            )}

            <div className="space-y-0.5">
              {hoverState.datum._xVal != null && !hoverState.datum._isBidOnly && (
                <p>
                  {hoverState.datum._xLabel}:{' '}
                  <span className="font-medium">
                    {formatMetricValue(hoverState.datum, '_xVal', '_xRaw', '_xIsRaw', metricMode)}
                  </span>
                  {hoverState.datum._xRaw05 != null && (
                    <span className="ml-1 text-[10px]" style={{ color: 'var(--text-muted)' }}>
                      ({hoverState.datum._xRaw05.toFixed(1)}/5)
                    </span>
                  )}
                </p>
              )}
              {hoverState.datum._yVal != null && !hoverState.datum._isBidOnly && (
                <p>
                  {hoverState.datum._yLabel}:{' '}
                  <span className="font-medium">
                    {formatMetricValue(hoverState.datum, '_yVal', '_yRaw', '_yIsRaw', metricMode)}
                  </span>
                  {hoverState.datum._yRaw05 != null && (
                    <span className="ml-1 text-[10px]" style={{ color: 'var(--text-muted)' }}>
                      ({hoverState.datum._yRaw05.toFixed(1)}/5)
                    </span>
                  )}
                </p>
              )}
              {hoverState.datum._isBidOnly && (
                <p className="text-[10px]" style={{ color: 'var(--gold)' }}>
                  No eval data yet · ranked by bid competitiveness
                </p>
              )}
              {hoverState.datum.metrics_pct?.Instructor_Rating != null &&
                hoverState.datum._xLabel !== 'Instructor Rating' &&
                hoverState.datum._yLabel !== 'Instructor Rating' && (
                  <p>
                    Instructor:{' '}
                    <span className="font-medium" style={{ color: 'var(--blue)' }}>
                      {metricMode === 'score'
                        ? `${Math.round(hoverState.datum.metrics_score?.Instructor_Rating ?? hoverState.datum.metrics_pct.Instructor_Rating)}%`
                        : `${Math.round(hoverState.datum.metrics_pct.Instructor_Rating)} pct`}
                    </span>
                  </p>
                )}
            </div>

            <div className="mt-2 space-y-0.5 border-t pt-2" style={{ borderColor: 'var(--line)' }}>
              {hoverState.datum.n_respondents != null && (
                <p className="text-muted">
                  N=<span className="font-medium text-label">{hoverState.datum.n_respondents}</span>
                  <span className="ml-1 text-[10px]" style={{ color: 'var(--text-muted)' }}>
                    survey respondents
                  </span>
                </p>
              )}
              <p className="text-muted">
                Bidding:{' '}
                <span
                  className="font-medium"
                  style={{ color: hoverState.datum.ever_bidding ? '#e6a4bb' : 'var(--text-muted)' }}
                >
                  {hoverState.datum.ever_bidding ? 'Yes' : 'No'}
                </span>
              </p>
              {hoverState.datum.last_bid_price != null && (
                <p className="text-muted">
                  Last clearing price:{' '}
                  <span className="font-medium text-label">
                    {hoverState.datum.last_bid_price} pts
                  </span>
                </p>
              )}
            </div>

            <p className="mt-1 text-[10px]" style={{ color: 'var(--blue)' }}>
              Click to pin and preview details below
            </p>
          </div>
        )}
      </div>

      {pinnedDatum && (
        <div
          className="border-t px-4 py-4"
          style={{ borderColor: 'var(--line)', background: 'var(--panel-subtle)' }}
        >
          <div className="mb-3 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p
                className="text-sm font-bold"
                style={{ color: pinnedDatum._isBidOnly ? 'var(--gold)' : 'var(--accent-strong)' }}
              >
                {pinnedDatum.course_code}
              </p>
              <p className="text-sm text-label">{pinnedDatum.course_name}</p>
              <p className="mt-0.5 text-xs text-muted">
                {pinnedDatum.professor_display || pinnedDatum.professor}
              </p>
              {pinnedDatum.concentration && (
                <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                  {pinnedDatum.concentration}
                </p>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {(() => {
                const code = pinnedDatum.course_code_base || pinnedDatum.course_code
                const starred = favorites?.has(code)
                return (
                  <button
                    onClick={() => toggleFav(code)}
                    title={starred ? 'Remove from shortlist' : 'Add to shortlist'}
                    aria-label={starred ? 'Remove from shortlist' : 'Add to shortlist'}
                    className="rounded-full border px-2.5 py-1 text-sm transition-colors"
                    style={{
                      borderColor: starred ? 'var(--gold)' : 'var(--line)',
                      color: starred ? 'var(--gold)' : 'var(--text-muted)',
                    }}
                  >
                    {starred ? '★' : '☆'}
                  </button>
                )
              })()}
              <button
                onClick={() => setPinnedDatum(null)}
                aria-label="Close course panel"
                title="Close"
                className="rounded-full border px-3 py-1 text-[11px] text-muted hover:text-label"
                style={{ borderColor: 'var(--line)' }}
              >
                ✕
              </button>
            </div>
          </div>

          <div className="space-y-1 text-xs text-muted">
            <p>
              {pinnedDatum.is_average
                ? `Average ${pinnedDatum.year_range}`
                : `${pinnedDatum.term} ${pinnedDatum.year}`}
            </p>
            {pinnedDatum._xVal != null && (
              <p>
                {pinnedDatum._xLabel}:{' '}
                <span className="text-label">
                  {formatMetricValue(pinnedDatum, '_xVal', '_xRaw', '_xIsRaw', metricMode)}
                </span>
              </p>
            )}
            {pinnedDatum._yVal != null && (
              <p>
                {pinnedDatum._yLabel}:{' '}
                <span className="text-label">
                  {formatMetricValue(pinnedDatum, '_yVal', '_yRaw', '_yIsRaw', metricMode)}
                </span>
              </p>
            )}
            {pinnedDatum.n_respondents != null && (
              <p>
                N=<span className="text-label">{pinnedDatum.n_respondents}</span> survey respondents
              </p>
            )}
            {pinnedDatum.last_bid_price != null && (
              <p>
                Last clearing price:{' '}
                <span className="text-label">{pinnedDatum.last_bid_price} pts</span>
              </p>
            )}
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            <button
              onClick={() => navigate(`/courses?id=${encodeURIComponent(pinnedDatum.id)}`)}
              className="btn-details"
            >
              Course Details
            </button>
            <button
              onClick={() =>
                navigate(
                  `/compare?ids=${encodeURIComponent(pinnedDatum.course_code_base || pinnedDatum.course_code)}`,
                )
              }
              className="rounded-full border px-4 py-2 text-sm font-medium transition-colors hover:text-label"
              style={{
                borderColor: 'var(--line)',
                color: 'var(--text-muted)',
                background: 'var(--panel-soft)',
              }}
            >
              ⇄ Compare
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
            background: warning.type === 'error' ? 'var(--danger-soft)' : 'var(--warning-soft)',
            color: warning.type === 'error' ? 'var(--danger)' : 'var(--warning)',
          }}
        >
          <span>Warning:</span>
          <span>{warning.msg}</span>
        </div>
      ))}

      <div
        className="border-t px-4 py-3 text-xs"
        style={{ borderColor: 'var(--line)', background: 'var(--panel-subtle)' }}
      >
        <p className="mb-2 font-medium text-label">How to read this</p>
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {showQuadrants && (
            <>
              <p className="text-muted">
                <span className="font-medium" style={{ color: legendGoodLabel }}>
                  {colorblindMode ? 'Blue' : 'Green'} quadrant
                </span>{' '}
                = stronger on both axes
              </p>
              <p className="text-muted">
                <span className="font-medium" style={{ color: legendBadLabel }}>
                  {colorblindMode ? 'Orange' : 'Crimson'} quadrant
                </span>{' '}
                = weaker on both axes
              </p>
            </>
          )}
          <p className="text-muted">
            <span className="font-medium" style={{ color: '#d78aa7' }}>
              Rose
            </span>{' '}
            = ever went to bidding
          </p>
          {matchedData.some((d) => d._starred) && (
            <p className="text-muted">
              <span className="font-medium" style={{ color: 'var(--gold)' }}>
                ★ Gold outline
              </span>{' '}
              = in your shortlist
            </p>
          )}
          {bidOnlyData.length > 0 && (
            <p className="text-muted">
              <span className="font-medium" style={{ color: 'var(--gold)' }}>
                Amber diamond
              </span>{' '}
              = bidding now, no eval yet, evenly spread by competitiveness rank
            </p>
          )}
        </div>
        <p className="mt-2 text-[11px] text-muted">
          Click a point to preview details · use + / - or pinch to zoom · drag or two-finger pan to
          move
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
