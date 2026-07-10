import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import Requirements from '../pages/Requirements.jsx'

const planCourse = (courseCode) => ({
  course_code: courseCode,
  course_name: `Course ${courseCode}`,
})

function savePlan(name, courses) {
  window.localStorage.setItem(
    `hks_plan_${name}`,
    JSON.stringify({ name, courses, updatedAt: null }),
  )
}

function findPlanSummary(count, plan) {
  return screen.getByText(
    (_, element) => element?.textContent?.replace(/\s+/g, ' ').trim() === `📋 ${count} in ${plan}`,
  )
}

describe('Requirements', () => {
  beforeEach(() => {
    window.localStorage.clear()
    window.history.replaceState(null, '', '/')
  })

  afterEach(() => {
    window.localStorage.clear()
    window.history.replaceState(null, '', '/')
  })

  it('refreshes scheduled and completed state after plan and storage updates', async () => {
    savePlan('Plan A', [planCourse('API-101')])
    savePlan('Plan B', [planCourse('API-201'), planCourse('API-202')])

    render(<Requirements />)

    expect(findPlanSummary(1, 'Plan A')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Plan B' }))
    await waitFor(() => expect(findPlanSummary(2, 'Plan B')).toBeTruthy())

    savePlan('Plan B', [planCourse('API-201'), planCourse('API-202'), planCourse('API-203')])
    await act(async () => {
      window.dispatchEvent(new CustomEvent('hks-plan-updated', { detail: { planName: 'Plan B' } }))
    })
    await waitFor(() => expect(findPlanSummary(3, 'Plan B')).toBeTruthy())

    window.localStorage.setItem('hks_completed_courses', JSON.stringify([planCourse('API-201')]))
    await act(async () => {
      window.dispatchEvent(new StorageEvent('storage', { key: 'hks_completed_courses' }))
    })
    await waitFor(() => expect(screen.getByText('+ 1 completed course')).toBeTruthy())
  })
})
