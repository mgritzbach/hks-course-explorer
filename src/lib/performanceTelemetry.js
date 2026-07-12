/**
 * Free-tier production performance telemetry.
 *
 * Web Vitals are aggregated when possible into PostHog `$web_vitals` events
 * without DOM attribution. This avoids retaining detached elements in the SPA.
 */
export const POSTHOG_PERFORMANCE_OPTIONS = Object.freeze({
  capture_performance: Object.freeze({
    web_vitals: true,
    web_vitals_allowed_metrics: Object.freeze(['LCP', 'CLS', 'INP']),
    web_vitals_attribution: false,
  }),
})

/** Build a bounded, non-sensitive catalogue readiness event. */
export function buildCatalogueReadyProperties({
  startedAt,
  endedAt,
  rowCount,
  cacheStatus,
  route,
  success,
  error,
}) {
  const duration = Number.isFinite(endedAt - startedAt) ? Math.max(0, endedAt - startedAt) : 0
  const properties = {
    duration_ms: Math.round(duration),
    row_count: Number.isInteger(rowCount) && rowCount >= 0 ? rowCount : 0,
    cache_status: cacheStatus === 'hit' ? 'hit' : 'miss',
    route: typeof route === 'string' && route.startsWith('/') ? route : '/',
    success: success === true,
  }

  if (!properties.success) {
    properties.error_type = error?.name || 'Error'
  }
  return properties
}
