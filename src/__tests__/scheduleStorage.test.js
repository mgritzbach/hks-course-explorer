import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadCompleted, loadPlan, saveCompleted, savePlan } from '../lib/scheduleStorage.js'

afterEach(() => {
  window.localStorage.clear()
  vi.restoreAllMocks()
})

describe('scheduleStorage', () => {
  it('repairs duplicate section variants at the persistence boundary', async () => {
    const duplicates = [
      { courseCode: 'DPI-681-M', credits: 2 },
      { courseCode: 'DPI-681-M-001', credits: 2, grade: 'B-' },
      { courseCode: 'DPI-681-M-A', credits: 2 },
    ]

    const savedPlan = await savePlan('Plan A', { courses: duplicates })
    saveCompleted(duplicates)

    expect(savedPlan.courses).toHaveLength(1)
    expect(loadPlan('Plan A').courses).toHaveLength(1)
    expect(loadCompleted()).toHaveLength(1)
    expect(loadCompleted()[0].grade).toBe('B-')
  })

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
