import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '..')
const coursesSource = readFileSync(resolve(root, 'pages/Courses.jsx'), 'utf8')
const chartSource = readFileSync(resolve(root, 'components/BiddingTrendChart.jsx'), 'utf8')

describe('Course Explorer bundle contract', () => {
  it('loads the bidding chart only after the history tab needs it', () => {
    expect(coursesSource).toContain("lazy(() => import('../components/BiddingTrendChart.jsx'))")
    expect(coursesSource).not.toContain("from 'recharts'")
    expect(chartSource).toContain("from 'recharts'")
    expect(chartSource).toContain('ResponsiveContainer')
  })
})
