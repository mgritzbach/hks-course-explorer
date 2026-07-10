import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadPlan, savePlan } from '../lib/scheduleStorage.js'

afterEach(() => {
  window.localStorage.clear()
  vi.restoreAllMocks()
})

describe('scheduleStorage', () => {
  it('keeps plans locally and announces the updated plan without a remote dependency', async () => {
    const listener = vi.fn()
    window.addEventListener('hks-plan-updated', listener)

    const saved = await savePlan('Plan B', {
      courses: [{ courseCode: 'API-101', title: 'Policy Analysis' }],
    })

    expect(saved).toMatchObject({ name: 'Plan B', courses: [{ courseCode: 'API-101' }] })
    expect(saved.updatedAt).toEqual(expect.any(String))
    expect(loadPlan('Plan B')).toEqual(saved)
    expect(listener).toHaveBeenCalledOnce()
    expect(listener.mock.calls[0][0].detail).toEqual({ planName: 'Plan B' })

    window.removeEventListener('hks-plan-updated', listener)
  })
})
