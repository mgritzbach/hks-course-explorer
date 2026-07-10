import { describe, expect, it, vi } from 'vitest'

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
    await vi.waitFor(() =>
      expect(init).toHaveBeenCalledWith('public-key', {
        api_host: 'https://analytics.example.test',
      }),
    )

    analytics.capture('course_shortlisted', { course_code: 'API-101' })
    await vi.waitFor(() =>
      expect(posthogCapture).toHaveBeenCalledWith('course_shortlisted', { course_code: 'API-101' }),
    )
  })
})
