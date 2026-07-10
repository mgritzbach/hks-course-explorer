import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import CompletedCoursesPanel from '../components/CompletedCoursesPanel.jsx'

function renderPanel(overrides = {}) {
  const props = {
    allCourses: [
      {
        course_code: 'API-101',
        course_code_base: 'API-101',
        course_name: 'Policy Analysis',
        professor: 'Professor Example',
        year: 2025,
      },
      {
        course_code: 'API-101',
        course_code_base: 'API-101',
        course_name: 'Older Policy Analysis',
        year: 2024,
      },
    ],
    sectionInfoMap: new Map([
      ['DPI-200', { title: 'Evidence and Policy', credits: 2, instructors: ['Professor Data'] }],
    ]),
    completedCourses: [{ courseCode: 'API-102' }],
    normalizedCompletedCourses: [{ courseCode: 'API-102' }],
    completedCourseCodes: new Set(['API-102']),
    collapsed: false,
    onToggle: vi.fn(),
    onAddCompleted: vi.fn(),
    onRemoveCompleted: vi.fn(),
    ...overrides,
  }
  render(<CompletedCoursesPanel {...props} />)
  return props
}

describe('CompletedCoursesPanel', () => {
  it('keeps the completed list visible and delegates removal and collapse to the planner', () => {
    const props = renderPanel()

    fireEvent.click(screen.getByRole('button', { name: 'Un-complete API-102' }))
    fireEvent.click(screen.getByRole('button', { name: 'Toggle completed' }))

    expect(props.onRemoveCompleted).toHaveBeenCalledWith('API-102')
    expect(props.onToggle).toHaveBeenCalledOnce()
  })

  it('searches the latest deduplicated HKS catalogue result and delegates its completion', () => {
    const props = renderPanel()

    fireEvent.change(screen.getByRole('textbox', { name: 'Search courses already taken' }), {
      target: { value: 'policy' },
    })
    fireEvent.click(screen.getByRole('button', { name: /API-101.*Policy Analysis/i }))

    expect(props.onAddCompleted).toHaveBeenCalledWith({
      courseCode: 'API-101',
      title: 'Policy Analysis',
      instructors: ['Professor Example'],
      credits: 4,
      sections: [],
      enrichment: {},
    })
    expect(screen.getByRole('textbox', { name: 'Search courses already taken' }).value).toBe('')
  })

  it('uses the section data for a typed missing catalogue course and preserves quick-add fallback', () => {
    const props = renderPanel()
    const search = screen.getByRole('textbox', { name: 'Search courses already taken' })

    fireEvent.change(search, { target: { value: 'dpi 200' } })
    fireEvent.click(screen.getByRole('button', { name: /Add DPI-200 as done/ }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Quick add completed course code' }), {
      target: { value: 'custom 1' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))

    expect(props.onAddCompleted).toHaveBeenNthCalledWith(1, {
      courseCode: 'DPI-200',
      title: 'Evidence and Policy',
      credits: 2,
      sections: [],
      instructors: ['Professor Data'],
      enrichment: {},
    })
    expect(props.onAddCompleted).toHaveBeenNthCalledWith(2, {
      courseCode: 'CUSTOM 1',
      title: 'CUSTOM 1',
      credits: 4,
      sections: [],
      instructors: [],
      sessionDescription: '',
      enrichment: {},
    })
  })
})
