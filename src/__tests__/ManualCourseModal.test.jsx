import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import ManualCourseModal from '../components/ManualCourseModal.jsx'

function renderModal(overrides = {}) {
  const props = {
    initial: { code: '' },
    onAdd: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  }
  render(<ManualCourseModal {...props} />)
  return props
}

describe('ManualCourseModal', () => {
  it('normalizes and returns the complete manual cross-registration course contract', () => {
    const props = renderModal()

    fireEvent.change(screen.getByLabelText('Course code'), { target: { value: 'mit 6.001' } })
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Intro to Computing' } })
    fireEvent.change(screen.getByLabelText('Instructor'), {
      target: { value: 'Professor Example' },
    })
    fireEvent.click(screen.getByRole('button', { name: '3 cr' }))
    fireEvent.click(screen.getByRole('button', { name: 'MON' }))
    fireEvent.click(screen.getByRole('button', { name: 'WED' }))
    fireEvent.change(screen.getByLabelText('Start time'), { target: { value: '09:30' } })
    fireEvent.change(screen.getByLabelText('End time'), { target: { value: '11:00' } })
    fireEvent.change(screen.getByLabelText('Location'), { target: { value: 'E52-123' } })
    fireEvent.click(screen.getByRole('button', { name: 'STEM' }))
    fireEvent.click(screen.getByRole('button', { name: 'Core' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add to schedule' }))

    expect(props.onAdd).toHaveBeenCalledWith({
      courseCode: 'MIT-6.001',
      title: 'Intro to Computing',
      instructors: ['Professor Example'],
      credits: 3,
      sections: [],
      meeting_days: 'MON/WED',
      time_start: '09:30',
      time_end: '11:00',
      location: 'E52-123',
      sessionDescription: '',
      enrichment: { is_stem: true, is_core: true, metrics_pct: null },
      _crossRegManual: true,
    })
  })

  it('closes from the close control, backdrop, and Escape key', () => {
    const props = renderModal()

    fireEvent.click(screen.getByRole('button', { name: 'Close manual course form' }))
    fireEvent.click(screen.getByRole('dialog'))
    fireEvent.keyDown(window, { key: 'Escape' })

    expect(props.onClose).toHaveBeenCalledTimes(3)
  })
})
