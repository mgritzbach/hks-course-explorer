import { describe, expect, it } from 'vitest'
import { UI_COMPLEXITY_BASELINES, evaluateUiComplexityBaselines } from '../check_ui_complexity.mjs'

function atBaseline() {
  return Object.fromEntries(
    Object.entries(UI_COMPLEXITY_BASELINES).map(([file, functions]) => [
      file,
      Object.fromEntries(Object.entries(functions)),
    ]),
  )
}

describe('check_ui_complexity', () => {
  it('allows every protected UI function at or below its documented baseline', () => {
    const observed = atBaseline()
    observed['src/App.jsx'].App = 1

    expect(evaluateUiComplexityBaselines(observed)).toEqual([])
  })

  it('fails a complexity increase deterministically', () => {
    const observed = atBaseline()
    observed['src/pages/Courses.jsx'].Courses = 101

    expect(evaluateUiComplexityBaselines(observed)).toEqual([
      {
        file: 'src/pages/Courses.jsx',
        name: 'Courses',
        complexity: 101,
        limit: 100,
      },
    ])
  })

  it('fails a missing protected function deterministically', () => {
    const observed = atBaseline()
    delete observed['src/components/ScatterPlot.jsx'].ScatterPlot

    expect(evaluateUiComplexityBaselines(observed)).toEqual([
      {
        file: 'src/components/ScatterPlot.jsx',
        name: 'ScatterPlot',
        complexity: null,
        limit: 69,
      },
    ])
  })
})
