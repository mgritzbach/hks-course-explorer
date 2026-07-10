// Pure data and axis helpers for the course scatter plot. This module has no
// React or Plotly dependency, so chart behavior can be tested independently.

export const MIN_ZOOM_SPAN_RATIO = 0.015
export const SCATTER_JITTER = 0.015

export function hashJitter(str, scale = 1) {
  let hash = 5381
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) ^ str.charCodeAt(i)
    hash = hash & hash
  }
  return ((hash % 1000) / 1000) * scale * 2 - scale
}

export function buildHoverTemplate(isBidOnly = false) {
  return isBidOnly
    ? '<b>%{customdata.course_name}</b><br>%{customdata.course_code}<br>%{customdata.professor_display}<extra></extra>'
    : '<b>%{customdata.course_name}</b><br>%{customdata.course_code}<br>%{customdata.professor_display}<extra></extra>'
}

export function getAxisTitle(metric, metricMode) {
  if (metric?.key === 'Workload') return 'Workload Intensity (score/100)'
  if (metric?.key === 'Instructor_Rating') return 'Instructor Quality (score/100)'
  const suffix = metricMode === 'score' ? 'score/100' : 'percentile'
  return `${metric?.label || 'Metric'} (${suffix})`
}

export function clampDomain(nextDomain, baseDomain) {
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

export function isBaseOrWiderDomain(nextDomain, baseDomain) {
  const epsilon = 0.0001
  const baseSpan = baseDomain[1] - baseDomain[0]
  const nextSpan = nextDomain[1] - nextDomain[0]
  return nextSpan >= baseSpan - epsilon
}

export function zoomNumericDomain(currentDomain, baseDomain, factor, anchorValue = null) {
  const activeDomain = currentDomain || baseDomain
  const activeSpan = activeDomain[1] - activeDomain[0]
  const baseSpan = baseDomain[1] - baseDomain[0]
  const minSpan = baseSpan * MIN_ZOOM_SPAN_RATIO
  const nextSpan = Math.min(baseSpan, Math.max(minSpan, activeSpan * factor))
  const anchor = anchorValue ?? (activeDomain[0] + activeDomain[1]) / 2
  const anchorRatio = activeSpan === 0 ? 0.5 : (anchor - activeDomain[0]) / activeSpan
  const nextStart = anchor - nextSpan * anchorRatio
  return clampDomain([nextStart, nextStart + nextSpan], baseDomain)
}

export function panNumericDomain(currentDomain, baseDomain, deltaValue) {
  const activeDomain = currentDomain || baseDomain
  return clampDomain([activeDomain[0] + deltaValue, activeDomain[1] + deltaValue], baseDomain)
}

export function dedupeCoTaught(courses) {
  const grouped = new Map()
  for (const course of courses) {
    const key =
      course.year === 0 ? course.id : `${course.course_code}||${course.year}||${course.term}`
    if (!grouped.has(key)) grouped.set(key, [course])
    else grouped.get(key).push(course)
  }

  return Array.from(grouped.values()).map((group) => {
    if (group.length === 1) return group[0]
    const metricsPct = weightedMetrics(group, 'metrics_pct', 10)
    const metricsRaw = weightedMetrics(group, 'metrics_raw', 100)
    return {
      ...group[0],
      professor_display: [
        ...new Set(
          group.map((course) => course.professor_display || course.professor).filter(Boolean),
        ),
      ].join(', '),
      professor: group.map((course) => course.professor).join('; '),
      n_respondents: group.reduce((sum, course) => sum + (course.n_respondents || 0), 0) || null,
      metrics_pct: metricsPct,
      metrics_raw: metricsRaw,
      _coTaught: true,
      _coTaughtCount: group.length,
    }
  })
}

function weightedMetrics(group, field, precision) {
  const result = {}
  for (const key of Object.keys(group[0][field] || {})) {
    let weightedSum = 0
    let weightCount = 0
    for (const course of group) {
      const value = course[field]?.[key]
      if (value != null) {
        const weight = course.n_respondents || 1
        weightedSum += value * weight
        weightCount += weight
      }
    }
    result[key] =
      weightCount > 0 ? Math.round((weightedSum / weightCount) * precision) / precision : null
  }
  return result
}

export function getAxisMode(metricMeta, allDeduped, matchedDeduped) {
  if (!metricMeta?.bid_metric) return percentageAxisMode()
  const rawValues = [...(allDeduped || []), ...(matchedDeduped || [])]
    .map((course) => course.metrics_raw?.[metricMeta.key])
    .filter((value) => value != null && value > 0)
  if (!rawValues.length) return percentageAxisMode()

  const maxValue = Math.max(...rawValues)
  if (metricMeta.key === 'Bid_Price') {
    const domainMax = Math.max(Math.ceil(maxValue / 100) * 100, 200)
    return { useRaw: true, domain: [0, domainMax], tickFmt: (value) => `${value}` }
  }
  const domainMax = Math.max(Math.ceil(maxValue / 50) * 50, 50)
  return { useRaw: true, domain: [0, domainMax], tickFmt: (value) => `${value}` }
}

function percentageAxisMode() {
  return { useRaw: false, domain: [0, 100], tickFmt: (value) => `${value}%` }
}

export function normalizeBidPrice(price) {
  if (price == null) return null
  return Math.max(0, Math.min(100, (price / 1000) * 100))
}

export function spreadRankPosition(index, total, domainMax) {
  if (total <= 1) return domainMax * 0.5
  const startPct = 14
  const endPct = 86
  const step = (endPct - startPct) / (total - 1)
  const positionPct = endPct - index * step
  return (positionPct / 100) * domainMax
}

export function coverageWarning(courses, metricMeta) {
  if (!courses.length) return null
  const hasData = courses.filter((course) =>
    metricMeta.bid_metric
      ? course.metrics_raw?.[metricMeta.key] != null
      : course.metrics_pct?.[metricMeta.key] != null,
  ).length
  const coverage = Math.round((hasData / courses.length) * 100)
  if (coverage === 100) return null
  if (coverage === 0)
    return {
      type: 'error',
      msg: `"${metricMeta.label}" was not collected for this year's evaluations.`,
    }
  return {
    type: 'warn',
    msg: `"${metricMeta.label}" has data for ${hasData}/${courses.length} courses (${coverage}%) this year.`,
  }
}

export function formatMetricValue(datum, valueKey, rawKey, rawModeKey, metricMode = 'score') {
  const value = datum[valueKey]
  const rawValue = datum[rawKey]
  const rawMode = datum[rawModeKey]
  if (value == null) return null
  if (rawMode) return rawValue != null ? `${rawValue} pts` : `${Math.round(value)}`
  const suffix = metricMode === 'score' ? '%' : ' pct'
  if (rawValue != null) return `${rawValue} pts (${Math.round(value)}${suffix})`
  return `${Math.round(value)}${suffix}`
}
