import { describe, expect, it } from 'vitest'
import {
  buildHoverTemplate,
  clampDomain,
  coverageWarning,
  dedupeCoTaught,
  formatMetricValue,
  getAxisMode,
  getAxisTitle,
  hashJitter,
  isBaseOrWiderDomain,
  normalizeBidPrice,
  panNumericDomain,
  spreadRankPosition,
  zoomNumericDomain,
} from '../lib/scatterData.js'

describe('scatter data helpers', () => {
  it('keeps deterministic jitter, axis titles, and hover templates stable', () => {
    expect(hashJitter('API-101x', 0.015)).toBe(hashJitter('API-101x', 0.015))
    expect(hashJitter('API-101x', 0.015)).not.toBe(hashJitter('API-101y', 0.015))
    expect(getAxisTitle({ key: 'Workload' }, 'percentile')).toBe('Workload Intensity (score/100)')
    expect(getAxisTitle({ label: 'Rigor' }, 'score')).toBe('Rigor (score/100)')
    expect(buildHoverTemplate()).toContain('%{customdata.course_name}')
  })

  it('clamps, zooms, and pans numeric domains without crossing their base range', () => {
    expect(clampDomain([-10, 20], [0, 100])).toEqual([0, 30])
    expect(clampDomain([-10, 120], [0, 100])).toEqual([0, 100])
    expect(zoomNumericDomain([0, 100], [0, 100], 0.5)).toEqual([25, 75])
    expect(panNumericDomain([25, 75], [0, 100], 40)).toEqual([50, 100])
    expect(isBaseOrWiderDomain([0, 100], [0, 100])).toBe(true)
  })

  it('deduplicates co-taught sections with weighted metric averages', () => {
    const [merged, untouched] = dedupeCoTaught([
      {
        id: 'a',
        course_code: 'API-101',
        year: 2025,
        term: 'Fall',
        professor: 'A',
        n_respondents: 2,
        metrics_pct: { Instructor_Rating: 50 },
        metrics_raw: { Instructor_Rating: 2 },
      },
      {
        id: 'b',
        course_code: 'API-101',
        year: 2025,
        term: 'Fall',
        professor: 'B',
        n_respondents: 6,
        metrics_pct: { Instructor_Rating: 90 },
        metrics_raw: { Instructor_Rating: 4 },
      },
      {
        id: 'c',
        course_code: 'BGP-201',
        year: 2025,
        term: 'Fall',
        professor: 'C',
        metrics_pct: {},
        metrics_raw: {},
      },
    ])

    expect(merged).toMatchObject({
      professor_display: 'A, B',
      professor: 'A; B',
      n_respondents: 8,
      metrics_pct: { Instructor_Rating: 80 },
      metrics_raw: { Instructor_Rating: 3.5 },
      _coTaught: true,
      _coTaughtCount: 2,
    })
    expect(untouched.id).toBe('c')
  })

  it('selects raw bid axes only when live bid values are present', () => {
    const fallback = getAxisMode({ key: 'Bid_Price', bid_metric: true }, [], [])
    expect(fallback).toMatchObject({ useRaw: false, domain: [0, 100] })
    expect(fallback.tickFmt(20)).toBe('20%')

    const bidPrice = getAxisMode(
      { key: 'Bid_Price', bid_metric: true },
      [{ metrics_raw: { Bid_Price: 230 } }],
      [],
    )
    expect(bidPrice).toMatchObject({ useRaw: true, domain: [0, 300] })
    expect(bidPrice.tickFmt(300)).toBe('300')
  })

  it('preserves bid ranking, coverage notices, and display formatting', () => {
    expect(normalizeBidPrice(500)).toBe(50)
    expect(normalizeBidPrice(2000)).toBe(100)
    expect(spreadRankPosition(0, 3, 100)).toBe(86)
    expect(spreadRankPosition(2, 3, 100)).toBeCloseTo(14)
    expect(
      coverageWarning([{ metrics_pct: { Rigor: 70 } }, { metrics_pct: {} }], {
        key: 'Rigor',
        label: 'Rigor',
        bid_metric: false,
      }),
    ).toMatchObject({ type: 'warn', msg: '"Rigor" has data for 1/2 courses (50%) this year.' })
    expect(
      formatMetricValue({ value: 82.4, raw: 4.12, rawMode: false }, 'value', 'raw', 'rawMode'),
    ).toBe('4.12 pts (82%)')
    expect(
      formatMetricValue({ value: 82.4, raw: 200, rawMode: true }, 'value', 'raw', 'rawMode'),
    ).toBe('200 pts')
  })
})
