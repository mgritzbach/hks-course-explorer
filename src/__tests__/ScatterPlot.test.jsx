import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import ScatterPlot from '../components/ScatterPlot.jsx'

vi.mock('../lib/plotlyComponent.js', () => ({
  default: ({ data, layout, onClick }) => {
    const datum = data.flatMap((trace) => trace.customdata || [])[0]
    return (
      <div>
        <button
          data-testid="plot-point"
          onClick={() => onClick({ points: [{ customdata: datum }] })}
        >
          point
        </button>
        <output data-testid="x-range">{layout.xaxis.range.join(',')}</output>
        <output data-testid="y-range">{layout.yaxis.range.join(',')}</output>
      </div>
    )
  },
}))

const metrics = [
  { key: 'Course_Rating', label: 'Course Rating', higher_is_better: true },
  { key: 'Workload', label: 'Workload', higher_is_better: false },
]

const course = {
  id: 'api-101',
  course_code: 'API-101',
  course_code_base: 'API-101',
  course_name: 'Policy Analysis',
  professor_display: 'Ada Analyst',
  metrics_score: { Course_Rating: 80, Workload: 60 },
  metrics_pct: { Course_Rating: 75, Workload: 55 },
  metrics_raw: { Course_Rating: 4, Workload: 3 },
}

function PlotHarness({ metricMode = 'score', matchedCourses = [course], favs }) {
  return (
    <MemoryRouter>
      <ScatterPlot
        allCourses={[course]}
        matchedCourses={matchedCourses}
        biddingOnlyCourses={[]}
        xMetric="Workload"
        yMetric="Course_Rating"
        metrics={metrics}
        onXChange={vi.fn()}
        onYChange={vi.fn()}
        metricMode={metricMode}
        favs={favs}
      />
    </MemoryRouter>
  )
}

describe('ScatterPlot production regressions', () => {
  it('uses the shared shortlist handler for a pinned graph course', () => {
    const favs = { favorites: new Set(), toggle: vi.fn() }
    render(<PlotHarness favs={favs} />)
    fireEvent.click(screen.getByTestId('plot-point'))
    fireEvent.click(screen.getByRole('button', { name: 'Add to shortlist' }))
    expect(favs.toggle).toHaveBeenCalledWith('API-101')
  })

  it('resets the controlled chart range when the metric mode changes', async () => {
    const favs = { favorites: new Set(), toggle: vi.fn() }
    const { rerender } = render(<PlotHarness favs={favs} />)
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }))
    expect(screen.getByTestId('x-range').textContent).not.toBe('0,100')

    rerender(<PlotHarness metricMode="percentile" favs={favs} />)

    await waitFor(() => expect(screen.getByTestId('x-range').textContent).toBe('0,100'))
    expect(screen.getByTestId('y-range').textContent).toBe('0,100')
    expect(screen.queryByText('Zoomed in')).toBeNull()
  })

  it('provides an always-visible reset above the graph that restores both axes', async () => {
    const favs = { favorites: new Set(), toggle: vi.fn() }
    render(<PlotHarness favs={favs} />)

    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }))
    expect(screen.getByTestId('x-range').textContent).not.toBe('0,100')
    fireEvent.click(screen.getByRole('button', { name: 'Reset axes' }))

    await waitFor(() => expect(screen.getByTestId('x-range').textContent).toBe('0,100'))
    expect(screen.getByTestId('y-range').textContent).toBe('0,100')
  })
})
