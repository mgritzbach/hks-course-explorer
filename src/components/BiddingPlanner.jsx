import { useEffect, useMemo, useState } from 'react'

const BUDGET_KEY = 'hks-bid-budget'

function loadBudget() {
  if (typeof window === 'undefined') return 1000
  try {
    const raw = Number(window.localStorage.getItem(BUDGET_KEY))
    return Number.isFinite(raw) && raw > 0 ? raw : 1000
  } catch {
    return 1000
  }
}

function roundToNearestFive(value) {
  return Math.round(value / 5) * 5
}

function getTermRank(term) {
  if (term === 'January') return 1
  if (term === 'Spring') return 2
  if (term === 'Summer') return 3
  if (term === 'Fall') return 4
  return 0
}

function getTrend(course, courses) {
  const history = (courses || [])
    .filter((item) => (item.course_code_base || item.course_code) === (course.course_code_base || course.course_code))
    .filter((item) => item.last_bid_price != null && item.last_bid_price > 0)
    .sort((a, b) => {
      if ((a.year || 0) !== (b.year || 0)) return (a.year || 0) - (b.year || 0)
      return getTermRank(a.term) - getTermRank(b.term)
    })

  if (history.length < 2) return '—'
  const previous = history[history.length - 2]?.last_bid_price
  const latest = history[history.length - 1]?.last_bid_price
  if (previous == null || latest == null || previous === latest) return '→'
  return latest > previous ? '↑' : '↓'
}

function getSuggestedBid(lastBidPrice) {
  const target = roundToNearestFive(lastBidPrice * 1.05)
  const low = roundToNearestFive(target - 15)
  const high = roundToNearestFive(target + 15)
  return {
    target,
    label: `${low}–${high}`,
  }
}

export default function BiddingPlanner({ courses, favs }) {
  const [budget, setBudget] = useState(loadBudget)

  useEffect(() => {
    try {
      window.localStorage.setItem(BUDGET_KEY, String(budget))
    } catch {
      return undefined
    }
    return undefined
  }, [budget])

  const shortlistedCourses = useMemo(() => {
    const favoriteCodes = favs?.favorites || new Set()
    const byBase = new Map()

    for (const course of courses || []) {
      const key = course.course_code_base || course.course_code
      if (!favoriteCodes.has(key)) continue
      if (!(course.last_bid_price > 0)) continue

      const current = byBase.get(key)
      if (!current || (course.year || 0) > (current.year || 0)) {
        byBase.set(key, course)
      }
    }

    return Array.from(byBase.values())
      .sort((a, b) => (b.last_bid_price || 0) - (a.last_bid_price || 0))
      .map((course) => {
        const suggested = getSuggestedBid(course.last_bid_price)
        return {
          key: course.course_code_base || course.course_code,
          name: course.course_name,
          lastBidPrice: course.last_bid_price,
          trend: getTrend(course, courses || []),
          suggested,
        }
      })
  }, [courses, favs])

  const suggestedTotal = shortlistedCourses.reduce((sum, course) => sum + course.suggested.target, 0)
  const statusColor = suggestedTotal <= budget
    ? 'var(--success)'
    : suggestedTotal <= budget * 1.1
      ? 'var(--gold)'
      : 'var(--danger)'

  if (shortlistedCourses.length === 0) {
    return (
      <div
        style={{
          border: '1px solid var(--line)',
          background: 'var(--panel-subtle)',
          borderRadius: 20,
          padding: 16,
          color: 'var(--text)',
        }}
      >
        Star courses with bidding history to build your strategy.
      </div>
    )
  }

  return (
    <div
      style={{
        border: '1px solid var(--line)',
        background: 'var(--panel-subtle)',
        borderRadius: 20,
        padding: 16,
        color: 'var(--text)',
      }}
    >
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 12,
          alignItems: 'end',
          justifyContent: 'space-between',
          marginBottom: 16,
        }}
      >
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6, color: 'var(--text)' }}>
          <span style={{ fontSize: 12 }}>Total budget</span>
          <input
            type="number"
            min="0"
            step="5"
            value={budget}
            onChange={(event) => setBudget(Math.max(0, Number(event.target.value) || 0))}
            style={{
              width: 140,
              border: '1px solid var(--line)',
              background: 'transparent',
              color: 'var(--text)',
              borderRadius: 10,
              padding: '8px 10px',
            }}
          />
        </label>

        <div
          style={{
            color: statusColor,
            fontSize: 12,
            fontWeight: 600,
            borderRadius: 999,
            padding: '6px 14px',
            background:
              statusColor === 'var(--success)'
                ? 'color-mix(in srgb, var(--success) 15%, transparent)'
                : statusColor === 'var(--gold)'
                  ? 'color-mix(in srgb, var(--gold) 15%, transparent)'
                  : 'color-mix(in srgb, var(--danger) 15%, transparent)',
          }}
        >
          Suggested total: {suggestedTotal} / {budget}
        </div>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--line)' }}>
              <th style={{ textAlign: 'left', padding: '8px 6px', fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Course name</th>
              <th style={{ textAlign: 'left', padding: '8px 6px', fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Last clearing price</th>
              <th style={{ textAlign: 'left', padding: '8px 6px', fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Trend</th>
              <th style={{ textAlign: 'left', padding: '8px 6px', fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Suggested bid</th>
            </tr>
          </thead>
          <tbody>
            {(shortlistedCourses || []).map((course) => (
              <tr key={course.key} style={{ borderBottom: '1px solid var(--line)' }}>
                <td style={{ padding: '8px 6px', fontSize: 13, color: 'var(--text)' }}>{course.name}</td>
                <td style={{ padding: '8px 6px', fontSize: 13, color: 'var(--text)' }}>{course.lastBidPrice}</td>
                <td style={{ padding: '8px 6px', fontSize: 13, color: 'var(--text)' }}>{course.trend}</td>
                <td style={{ padding: '8px 6px', fontSize: 13, color: 'var(--gold)' }}>{course.suggested.label}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
