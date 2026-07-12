import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  buildCatalogueReadyProperties,
  buildWebVitalProperties,
  initializeWebVitalsTelemetry,
  POSTHOG_PERFORMANCE_OPTIONS,
  WEB_VITAL_EVENT,
} from '../lib/performanceTelemetry.js'

describe('production performance telemetry', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('disables PostHog built-in Web Vitals so the custom collector cannot duplicate them', () => {
    expect(POSTHOG_PERFORMANCE_OPTIONS).toEqual({
      capture_performance: {
        web_vitals: false,
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

  it('builds bounded Web Vital properties without URL queries or attribution', () => {
    expect(
      buildWebVitalProperties(
        {
          name: 'LCP',
          value: 1842.456,
          rating: 'good',
          navigationType: 'navigate',
          entries: [{ element: '<private DOM node>' }],
        },
        '/courses?student=private#results',
      ),
    ).toEqual({
      metric: 'LCP',
      value: 1842.5,
      rating: 'good',
      navigation_type: 'navigate',
      route: '/courses',
    })
  })

  it('rejects unsupported or invalid Web Vital payloads', () => {
    expect(buildWebVitalProperties({ name: 'FCP', value: 100, rating: 'good' })).toBeNull()
    expect(buildWebVitalProperties({ name: 'INP', value: Number.NaN, rating: 'poor' })).toBeNull()
  })

  it('registers LCP, INP, and CLS once and emits only bounded events', async () => {
    const handlers = {}
    const loadVitals = vi.fn(async () => ({
      onCLS: (handler) => (handlers.CLS = handler),
      onINP: (handler) => (handlers.INP = handler),
      onLCP: (handler) => (handlers.LCP = handler),
    }))
    const captureMetric = vi.fn()
    let route = '/compare?favs=private'

    await initializeWebVitalsTelemetry(captureMetric, {
      loadVitals,
      currentRoute: () => route,
      scheduleLoad: (load) => load(),
    })
    route = '/courses'
    handlers.CLS({ name: 'CLS', value: 0.013456, rating: 'good', navigationType: 'reload' })
    handlers.INP({ name: 'INP', value: 219.95, rating: 'needs-improvement' })
    handlers.LCP({ name: 'LCP', value: 3210, rating: 'poor', navigationType: 'unknown' })

    expect(captureMetric).toHaveBeenCalledTimes(3)
    expect(captureMetric).toHaveBeenNthCalledWith(1, WEB_VITAL_EVENT, {
      metric: 'CLS',
      value: 0.0135,
      rating: 'good',
      navigation_type: 'reload',
      route: '/compare',
    })
    expect(captureMetric).toHaveBeenNthCalledWith(2, WEB_VITAL_EVENT, {
      metric: 'INP',
      value: 220,
      rating: 'needs-improvement',
      navigation_type: 'other',
      route: '/compare',
    })
    expect(captureMetric).toHaveBeenNthCalledWith(3, WEB_VITAL_EVENT, {
      metric: 'LCP',
      value: 3210,
      rating: 'poor',
      navigation_type: 'other',
      route: '/compare',
    })

    await initializeWebVitalsTelemetry(captureMetric, { loadVitals })
    expect(Object.keys(handlers)).toHaveLength(3)
    expect(loadVitals).toHaveBeenCalledTimes(1)
  })

  it('binds BFCache re-reports to the document route and enforces the hard event cap', async () => {
    const handlers = {}
    const captureMetric = vi.fn()
    let route = '/courses?favs=private'

    await initializeWebVitalsTelemetry(captureMetric, {
      loadVitals: async () => ({
        onCLS: (handler) => (handlers.CLS = handler),
        onINP: (handler) => (handlers.INP = handler),
        onLCP: (handler) => (handlers.LCP = handler),
      }),
      currentRoute: () => route,
      scheduleLoad: (load) => load(),
    })
    route = '/compare'

    for (let index = 0; index < 20; index += 1) {
      handlers.LCP({
        name: 'LCP',
        value: 900 + index,
        rating: 'good',
        navigationType: 'back-forward-cache',
      })
    }
    expect(captureMetric).toHaveBeenCalledTimes(12)
    expect(captureMetric).toHaveBeenLastCalledWith(WEB_VITAL_EVENT, {
      metric: 'LCP',
      value: 911,
      rating: 'good',
      navigation_type: 'back-forward-cache',
      route: '/courses',
    })
  })

  it('binds metrics to the document route and retries after an optional chunk failure', async () => {
    const captureMetric = vi.fn()
    const loadVitals = vi
      .fn()
      .mockRejectedValueOnce(new Error('transient chunk failure'))
      .mockResolvedValueOnce({ onCLS: vi.fn(), onINP: vi.fn(), onLCP: vi.fn() })
    let route = '/courses'

    await expect(
      initializeWebVitalsTelemetry(captureMetric, {
        loadVitals,
        currentRoute: () => route,
        scheduleLoad: (load) => load(),
      }),
    ).resolves.toBe(false)
    route = '/compare'
    await expect(
      initializeWebVitalsTelemetry(captureMetric, {
        loadVitals,
        currentRoute: () => route,
        scheduleLoad: (load) => load(),
      }),
    ).resolves.toBe(true)
    expect(loadVitals).toHaveBeenCalledTimes(2)
  })

  it('loads the measurement chunk only after two paints and an idle boundary', async () => {
    const animationFrames = []
    const idleCallbacks = []
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn((callback) => {
        animationFrames.push(callback)
        return animationFrames.length
      }),
    )
    vi.stubGlobal(
      'requestIdleCallback',
      vi.fn((callback) => {
        idleCallbacks.push(callback)
        return idleCallbacks.length
      }),
    )
    const loadVitals = vi.fn(async () => ({ onCLS: vi.fn(), onINP: vi.fn(), onLCP: vi.fn() }))

    const initialized = initializeWebVitalsTelemetry(vi.fn(), { loadVitals })
    await Promise.resolve()
    expect(loadVitals).not.toHaveBeenCalled()
    expect(animationFrames).toHaveLength(1)

    animationFrames.shift()(0)
    expect(loadVitals).not.toHaveBeenCalled()
    expect(animationFrames).toHaveLength(1)
    animationFrames.shift()(16)
    expect(loadVitals).not.toHaveBeenCalled()
    expect(idleCallbacks).toHaveLength(1)

    idleCallbacks.shift()({ didTimeout: false, timeRemaining: () => 10 })
    await expect(initialized).resolves.toBe(true)
    expect(loadVitals).toHaveBeenCalledTimes(1)
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
