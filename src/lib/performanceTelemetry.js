/** Free-tier production performance telemetry. */
export const POSTHOG_PERFORMANCE_OPTIONS = Object.freeze({
  capture_performance: Object.freeze({
    // The custom collector below is deterministic and privacy bounded. Keep
    // PostHog's mutable remote Web Vitals collector off to prevent duplicates.
    web_vitals: false,
  }),
})

export const WEB_VITAL_EVENT = 'app_web_vital'
export const WEB_VITAL_CAPTURE_OPTIONS = Object.freeze({
  transport: 'sendBeacon',
  send_instantly: true,
})

const SUPPORTED_WEB_VITALS = new Set(['CLS', 'INP', 'LCP'])
const SUPPORTED_RATINGS = new Set(['good', 'needs-improvement', 'poor'])
const SUPPORTED_NAVIGATION_TYPES = new Set([
  'navigate',
  'reload',
  'back-forward',
  'back-forward-cache',
  'prerender',
  'restore',
])

const MAX_WEB_VITAL_EVENTS_PER_DOCUMENT = 12
const webVitalsInitializations = new WeakMap()

function boundedRoute(route) {
  if (typeof route !== 'string' || !route.startsWith('/')) return '/'
  return route.split(/[?#]/, 1)[0].slice(0, 160) || '/'
}

/**
 * Convert a Google `web-vitals` result into a small, queryable event without
 * DOM attribution, URLs, query strings, or user-provided values.
 */
export function buildWebVitalProperties(metric, route = '/') {
  if (!SUPPORTED_WEB_VITALS.has(metric?.name)) return null
  if (!Number.isFinite(metric.value) || metric.value < 0) return null
  const precision = metric.name === 'CLS' ? 10_000 : 10

  return {
    metric: metric.name,
    // CLS is unitless and needs sub-millisecond-style precision. LCP and INP
    // are milliseconds, where a tenth is more than enough for RUM budgets.
    value: Math.round(metric.value * precision) / precision,
    rating: SUPPORTED_RATINGS.has(metric.rating) ? metric.rating : 'unknown',
    navigation_type: SUPPORTED_NAVIGATION_TYPES.has(metric.navigationType)
      ? metric.navigationType
      : 'other',
    route: boundedRoute(route),
  }
}

/**
 * Register real-user LCP, INP, and CLS collection exactly once per page load.
 * The tiny measurement library is dynamically imported so it never enters the
 * initial app bundle. Its standard build deliberately excludes DOM attribution.
 */
export function initializeWebVitalsTelemetry(
  captureMetric,
  {
    loadVitals = () => import('web-vitals'),
    currentRoute = () => (typeof window === 'undefined' ? '/' : window.location.pathname),
    scheduleLoad = (load) => {
      if (typeof window === 'undefined') return load()
      return new Promise((resolve, reject) => {
        const beginWhenIdle = () => {
          if (typeof window.requestIdleCallback === 'function') {
            window.requestIdleCallback(() => load().then(resolve, reject), { timeout: 3000 })
          } else {
            window.setTimeout(() => load().then(resolve, reject), 0)
          }
        }
        if (typeof window.requestAnimationFrame === 'function') {
          window.requestAnimationFrame(() => window.requestAnimationFrame(beginWhenIdle))
        } else {
          beginWhenIdle()
        }
      })
    },
  } = {},
) {
  if (typeof captureMetric !== 'function') return Promise.resolve(false)
  const existingInitialization = webVitalsInitializations.get(captureMetric)
  if (existingInitialization) return existingInitialization

  // Web Vitals describe this document navigation, not whichever SPA route is
  // active when a callback eventually fires.
  let navigationRoute = '/'
  try {
    navigationRoute = boundedRoute(currentRoute())
  } catch {
    // Analytics route metadata is optional and must never affect the app.
  }
  let reportCount = 0

  const initialization = Promise.resolve()
    .then(() => scheduleLoad(loadVitals))
    .then(({ onCLS, onINP, onLCP }) => {
      if (![onCLS, onINP, onLCP].every((callback) => typeof callback === 'function')) {
        throw new TypeError('web-vitals module is missing a required metric callback')
      }

      const report = (metric) => {
        if (reportCount >= MAX_WEB_VITAL_EVENTS_PER_DOCUMENT) return
        const properties = buildWebVitalProperties(metric, navigationRoute)
        if (properties) {
          reportCount += 1
          captureMetric(WEB_VITAL_EVENT, properties, WEB_VITAL_CAPTURE_OPTIONS)
        }
      }
      onCLS(report)
      onINP(report)
      onLCP(report)
      return true
    })
    .catch(() => {
      // Analytics must never affect application availability. Permit a later
      // retry if the optional measurement chunk failed to load transiently.
      webVitalsInitializations.delete(captureMetric)
      return false
    })

  webVitalsInitializations.set(captureMetric, initialization)
  return initialization
}

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
    cache_status: ['hit', 'snapshot'].includes(cacheStatus) ? cacheStatus : 'miss',
    route: typeof route === 'string' && route.startsWith('/') ? route : '/',
    success: success === true,
  }

  if (!properties.success) {
    properties.error_type = error?.name || 'Error'
  }
  return properties
}
