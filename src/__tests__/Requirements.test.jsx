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

  it('repairs credits from the selected catalogue offering and removes completed courses', async () => {
    window.localStorage.setItem(
      'hks_completed_courses',
      JSON.stringify([
        {
          courseCode: 'DPI-681-M',
          year: 2025,
          term: 'Spring',
          credits: 4,
          enrichment: { is_stem: true },
        },
      ]),
    )
    const courseCreditMap = new Map([
      ['DPI-681-M|2025|SPRING', 2],
      ['DPI-681-M', 2],
    ])

    render(<Requirements courseCreditMap={courseCreditMap} />)

    expect(screen.getByText('0 verified · 2 projected / 16 cr')).toBeTruthy()
    await waitFor(() => {
      const saved = JSON.parse(window.localStorage.getItem('hks_completed_courses'))
      expect(saved[0].credits).toBe(2)
    })

    fireEvent.change(screen.getByRole('combobox', { name: 'Grade for DPI-681-M' }), {
      target: { value: 'B-' },
    })
    await waitFor(() => {
      const saved = JSON.parse(window.localStorage.getItem('hks_completed_courses'))
      expect(saved[0].grade).toBe('B-')
    })

    fireEvent.click(screen.getAllByRole('button', { name: 'Remove completed course DPI-681-M' })[0])
    expect(JSON.parse(window.localStorage.getItem('hks_completed_courses'))).toEqual([])
  })

  it('lets MPP Year 1 students declare the PAC used by the official overlap allowance', () => {
    window.history.replaceState(null, '', '/requirements?p=MPP_Y1')

    render(<Requirements />)
    expect(screen.getByText('Declared MPP Policy Area of Concentration (PAC)')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'IGA' }))
    expect(window.localStorage.getItem('hks_pac_area')).toBe('IGA')
    expect(screen.getByRole('button', { name: 'IGA' }).getAttribute('aria-pressed')).toBe('true')
  })

  it('removes planned courses directly from My Courses', () => {
    savePlan('Plan A', [{ ...planCourse('IGA-108'), credits: 4 }])

    render(<Requirements />)
    fireEvent.click(screen.getAllByRole('button', { name: 'Remove IGA-108 from Plan A' })[0])

    expect(JSON.parse(window.localStorage.getItem('hks_plan_Plan A')).courses).toEqual([])
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
