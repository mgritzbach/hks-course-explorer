import { describe, expect, it } from 'vitest'
import {
  buildCatalogueReadyProperties,
  POSTHOG_PERFORMANCE_OPTIONS,
} from '../lib/performanceTelemetry.js'

describe('production performance telemetry', () => {
  it('captures only the three corporate-readiness Web Vitals without attribution', () => {
    expect(POSTHOG_PERFORMANCE_OPTIONS).toEqual({
      capture_performance: {
        web_vitals: true,
        web_vitals_allowed_metrics: ['LCP', 'CLS', 'INP'],
        web_vitals_attribution: false,
      },
    })
  })

  it('builds a bounded successful catalogue-readiness event', () => {
    expect(
      buildCatalogueReadyProperties({
        startedAt: 100,
        endedAt: 351,
        rowCount: 5812,
        cacheStatus: 'hit',
        route: '/courses',
        success: true,
      }),
    ).toEqual({
      duration_ms: 251,
      row_count: 5812,
      cache_status: 'hit',
      route: '/courses',
      success: true,
    })
  })

  it('records only an error class and never the potentially sensitive message', () => {
    const properties = buildCatalogueReadyProperties({
      startedAt: 500,
      endedAt: 400,
      rowCount: -1,
      cacheStatus: 'unknown',
      route: 'not-a-route',
      success: false,
      error: new TypeError('private database response'),
    })

    expect(properties).toEqual({
      duration_ms: 0,
      row_count: 0,
      cache_status: 'miss',
      route: '/',
      success: false,
      error_type: 'TypeError',
    })
    expect(JSON.stringify(properties)).not.toContain('private database response')
  })
})
