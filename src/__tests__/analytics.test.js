import { beforeEach, describe, expect, it, vi } from 'vitest'

const init = vi.fn()
const posthogCapture = vi.fn()

vi.mock('posthog-js', () => ({
  default: { init, capture: posthogCapture },
}))

async function loadAnalytics() {
  vi.resetModules()
  return import('../lib/analytics.js')
}

describe('analytics adapter', () => {
  beforeEach(() => {
    init.mockClear()
    posthogCapture.mockClear()
    vi.unstubAllGlobals()
  })

  it('does nothing when analytics has no configured key', async () => {
    const analytics = await loadAnalytics()
    analytics.initializeAnalytics('', {})
    analytics.capture('ignored')
    await Promise.resolve()

    expect(init).not.toHaveBeenCalled()
    expect(posthogCapture).not.toHaveBeenCalled()
  })

  it('initializes the lazy client and forwards captures after it is ready', async () => {
    const analytics = await loadAnalytics()
    analytics.initializeAnalytics('public-key', { api_host: 'https://analytics.example.test' })
    await vi.waitFor(() => expect(init).toHaveBeenCalledOnce())
    const [key, options] = init.mock.calls[0]
    expect(key).toBe('public-key')
    expect(options.api_host).toBe('https://analytics.example.test')
    expect(
      options.before_send({
        event: 'course_shortlisted',
        properties: {
          $current_url: 'https://hks-course-explorer.org/?favs=private#results',
          $referrer: 'https://example.edu/search?student=private',
          $initial_referrer: '$direct',
          course_code: 'API-101',
        },
      }),
    ).toEqual({
      event: 'course_shortlisted',
      properties: {
        $current_url: 'https://hks-course-explorer.org/',
        $referrer: 'https://example.edu/search',
        $initial_referrer: '$direct',
        course_code: 'API-101',
      },
    })

    analytics.capture('course_shortlisted', { course_code: 'API-101' })
    await vi.waitFor(() =>
      expect(posthogCapture).toHaveBeenCalledWith('course_shortlisted', { course_code: 'API-101' }),
    )
  })

  it('waits for two paints and an idle boundary before loading the client', async () => {
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
    const analytics = await loadAnalytics()

    analytics.initializeAnalytics('public-key', {})
    await Promise.resolve()
    expect(init).not.toHaveBeenCalled()

    animationFrames.shift()(0)
    expect(init).not.toHaveBeenCalled()
    animationFrames.shift()(16)
    expect(init).not.toHaveBeenCalled()
    expect(idleCallbacks).toHaveLength(1)

    idleCallbacks.shift()({ didTimeout: false, timeRemaining: () => 10 })
    await vi.waitFor(() => expect(init).toHaveBeenCalledOnce())
    expect(init.mock.calls[0][0]).toBe('public-key')
    expect(init.mock.calls[0][1]).toMatchObject({ before_send: expect.any(Function) })
  })
})
