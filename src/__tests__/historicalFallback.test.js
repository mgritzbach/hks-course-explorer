import { describe, expect, it } from 'vitest'
import { withHistoricalFallback } from '../lib/historicalFallback.js'
import { buildCourseMeta } from '../lib/courseMeta.js'

const current = {
  id: 'current',
  is_current_offering: true,
  course_code: 'API-101-A',
  course_code_base: 'API-101',
  year: 2027,
  term: 'Spring',
  professor_display: 'New Teacher',
  has_eval: false,
  has_bidding: false,
  metrics_raw: {},
  metrics_pct: {},
}
const old = {
  id: 'old',
  course_code: 'API-101-A',
  course_code_base: 'API-101',
  year: 2026,
  term: 'Spring',
  professor_display: 'Past Teacher',
  has_eval: true,
  has_bidding: true,
  metrics_raw: { Instructor_Rating: 4, Course_Rating: 4.5, Workload: 3, Bid_Price: 200 },
  metrics_pct: { Instructor_Rating: 80, Course_Rating: 90, Workload: 60, Bid_Price: 70 },
  last_bid_price: 200,
  bid_clearing_price: 200,
  n_respondents: 30,
}

describe('historical data fallback', () => {
  it('attributes bidding to its own record, never to a newer all-years cached bid', () => {
    const source = {
      ...old,
      year: 2023,
      term: 'Fall',
      bid_clearing_price: 100,
      bid_academic_year: '2023-2024',
      bid_capacity: 20,
      bid_n_bids: 25,
      last_bid_price: 900,
      last_bid_acad: '2024-2025',
      last_bid_term: 'Spring',
      last_bid_capacity: 80,
      last_bid_n_bids: 90,
    }
    const result = withHistoricalFallback({ ...current, year: 2024 }, [source])
    expect(result).toMatchObject({
      last_bid_price: 100,
      last_bid_acad: '2023-2024',
      last_bid_term: 'Fall',
      last_bid_capacity: 20,
      last_bid_n_bids: 25,
      bidding_source: { label: 'Fall 2023' },
    })
    expect(result.metrics_raw.Bid_Price).toBe(100)
    expect(
      withHistoricalFallback(current, [{ ...source, bid_clearing_price: null, metrics_raw: {} }])
        .bidding_source,
    ).toBeUndefined()
  })
  it('keeps current identity and explicitly attributes old evaluations and bidding independently', () => {
    const result = withHistoricalFallback(current, [old])
    expect(result).toMatchObject({
      year: 2027,
      professor_display: 'New Teacher',
      has_eval: true,
      has_bidding: true,
      metrics_raw: old.metrics_raw,
      evaluation_source: { year: 2026, term: 'Spring', professor: 'Past Teacher' },
      bidding_source: { year: 2026, label: 'Spring 2026' },
    })
    expect(current.metrics_raw).toEqual({})
    expect(buildCourseMeta([old, result])).toMatchObject({
      evaluation_year: 2026,
      bidding_year: 2026,
      overall_median_instructor: 4,
      year_medians_instructor: { 2026: 4 },
    })
  })

  it('prefers current evaluations while independently filling missing bidding', () => {
    const result = withHistoricalFallback(
      {
        ...current,
        has_eval: true,
        metrics_raw: { Course_Rating: 5 },
        metrics_pct: { Course_Rating: 99 },
      },
      [old],
    )
    expect(result.metrics_raw.Course_Rating).toBe(5)
    expect(result.evaluation_source).toBeUndefined()
    expect(result.bidding_source.year).toBe(2026)
    const currentBid = withHistoricalFallback(
      { ...current, has_bidding: true, last_bid_price: 900, bid_clearing_price: 900 },
      [old],
    )
    expect(currentBid.last_bid_price).toBe(900)
    expect(currentBid.bidding_source).toBeUndefined()
    expect(currentBid.evaluation_source.year).toBe(2026)
  })

  it('uses the latest available earlier year, never future records, aggregates, or another course', () => {
    const history = [
      old,
      { ...old, year: 2028 },
      { ...old, year: 2026, is_average: true },
      { ...old, year: 2026, course_code_base: 'OTHER' },
    ]
    expect(withHistoricalFallback(current, history).evaluation_source.year).toBe(2026)
    expect(withHistoricalFallback({ ...current, year: 2031 }, [old]).evaluation_source.year).toBe(
      2026,
    )
    expect(withHistoricalFallback(current, [])).toMatchObject({
      has_eval: false,
      has_bidding: false,
    })
  })

  it('selects evaluation and bid sources separately and prefers the same instructor within a source term', () => {
    const bidOnly = {
      ...old,
      id: 'bid',
      year: 2026,
      term: 'Fall',
      has_eval: false,
      last_bid_price: 350,
      bid_clearing_price: 350,
    }
    const matching = { ...old, id: 'same-teacher', professor_display: 'New Teacher' }
    const result = withHistoricalFallback(current, [old, bidOnly, matching])
    expect(result.evaluation_source.id).toBe('same-teacher')
    expect(result.bidding_source.id).toBe('bid')
    expect(result.last_bid_price).toBe(350)
  })
})
