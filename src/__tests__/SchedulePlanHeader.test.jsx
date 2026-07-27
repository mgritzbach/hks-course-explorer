import { createRef } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import SchedulePlanHeader from '../components/SchedulePlanHeader.jsx'

function renderHeader(overrides = {}) {
  const props = {
    plans: ['Fall Plan', 'Spring Plan'],
    activePlan: 'Fall Plan',
    onSwitchPlan: vi.fn(),
    termOptions: ['Q1', 'FULL'],
    term: 'FULL',
    onTermChange: vi.fn(),
    showWeekends: false,
    onToggleWeekends: vi.fn(),
    importInputRef: createRef(),
    csvImportInputRef: createRef(),
    csvMsg: null,
    onExportCsv: vi.fn(),
    onImportCsv: vi.fn(),
    onRequestCsvImport: vi.fn(),
    onLoadPlan: vi.fn(),
    saveLoadMsg: null,
    onSavePlan: vi.fn(),
    onRequestLoad: vi.fn(),
    hasCourses: true,
    copyPlanMsg: null,
    onCopyPlan: vi.fn(),
    exportMsg: null,
    onExport: vi.fn(),
    ...overrides,
  }
  render(<SchedulePlanHeader {...props} />)
  return props
}

describe('SchedulePlanHeader', () => {
  it('forwards plan, term, and weekend controls to parent orchestration', () => {
    const props = renderHeader()
    fireEvent.click(screen.getByRole('button', { name: 'Spring Plan' }))
    fireEvent.click(screen.getByRole('button', { name: 'Q1' }))
    fireEvent.click(screen.getByRole('button', { name: '+ Weekends' }))

    expect(props.onSwitchPlan).toHaveBeenCalledWith('Spring Plan')
    expect(props.onTermChange).toHaveBeenCalledWith('Q1')
    expect(props.onToggleWeekends).toHaveBeenCalledOnce()
  })

  it('retains all plan persistence and export controls when courses exist', () => {
    const props = renderHeader()
    fireEvent.click(screen.getByRole('button', { name: /save/i }))
    fireEvent.click(screen.getByRole('button', { name: /load/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }))
    fireEvent.click(screen.getByRole('button', { name: 'Import CSV' }))
    fireEvent.click(screen.getByRole('button', { name: /copy plan/i }))
    fireEvent.click(screen.getByRole('button', { name: /export ical/i }))

    expect(props.onSavePlan).toHaveBeenCalledOnce()
    expect(props.onRequestLoad).toHaveBeenCalledOnce()
    expect(props.onCopyPlan).toHaveBeenCalledOnce()
    expect(props.onExportCsv).toHaveBeenCalledOnce()
    expect(props.onRequestCsvImport).toHaveBeenCalledOnce()
    expect(props.onExport).toHaveBeenCalledOnce()
  })
})
