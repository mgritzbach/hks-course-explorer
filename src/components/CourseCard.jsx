import { useNavigate } from 'react-router-dom'

function encodeProf(prof) {
  return encodeURIComponent(prof)
}

function pct(v) {
  if (v == null) return null
  return `${Math.round(v)}%`
}

function RatingBadge({ label, value, color }) {
  if (value == null) return null
  return (
    <div className="text-right text-xs leading-5">
      <span className="text-muted">{label}: </span>
      <span className="font-medium" style={{ color: color || '#c0c0d8' }}>{pct(value)}</span>
    </div>
  )
}

export default function CourseCard({ course }) {
  const navigate = useNavigate()

  const handleDetail = () => {
    navigate(`/courses?id=${encodeURIComponent(course.id)}`)
  }

  const registerUrl = course.course_url || '#'

  const instrPct  = course.metrics_pct?.Instructor_Rating
  const workPct   = course.metrics_pct?.Workload
  const coursePct = course.metrics_pct?.Course_Rating

  const descExcerpt = course.description
    ? course.description.length > 180
      ? course.description.slice(0, 180) + '…'
      : course.description
    : null

  const isBiddingOnly = !course.has_eval && course.has_bidding
  const noEval        = !course.has_eval && !course.has_bidding

  // Left border accent color
  const borderAccent = isBiddingOnly
    ? '#f59e0b'  // amber
    : noEval
      ? '#4a4a5e' // gray
      : '#38bdf8' // blue

  return (
    <div
      className="py-5 card-hover"
      style={{
        borderBottom: '1px solid #2a2a3e',
        borderLeft: `3px solid ${borderAccent}`,
        paddingLeft: 14,
      }}
    >
      {/* Title row */}
      <div className="flex items-start justify-between gap-4 mb-1">
        <h3 style={{ fontSize: 15, fontWeight: 600, lineHeight: 1.3 }}>
          <button
            onClick={handleDetail}
            className="text-left hover:underline"
            style={{ color: '#38bdf8' }}
          >
            <span className="font-bold" style={{ color: '#38bdf8' }}>{course.course_code}</span>
            <span className="text-label">: {course.course_name || '(Untitled)'}</span>
          </button>
          {course.is_stem && (
            <span
              className="ml-2 text-xs font-bold px-1.5 py-0.5 rounded inline-block"
              style={{ background: '#1e3a52', color: '#38bdf8', verticalAlign: 'middle', fontSize: 11 }}
            >
              [STEM]
            </span>
          )}
          {course.is_core && (
            <span
              className="ml-1 text-xs font-bold px-1.5 py-0.5 rounded inline-block"
              style={{ background: '#2a1f0e', color: '#f59e0b', verticalAlign: 'middle', fontSize: 11 }}
            >
              [Core]
            </span>
          )}
        </h3>

        {/* Ratings right-aligned */}
        <div className="shrink-0 min-w-[100px]">
          {isBiddingOnly ? (
            <div
              className="text-xs font-bold px-2 py-1 rounded text-right"
              style={{ background: '#2a1f0a', color: '#f59e0b', border: '1px solid #f59e0b44' }}
            >
              🟡 Bidding
              {course.last_bid_price != null && (
                <div className="font-normal text-muted" style={{ fontSize: 10, color: '#f59e0b' }}>
                  {course.last_bid_price} pts
                </div>
              )}
            </div>
          ) : noEval ? (
            <div className="text-xs text-muted text-right" style={{ fontSize: 11 }}>
              No eval data
            </div>
          ) : (
            <>
              <RatingBadge label="Instructor" value={instrPct}  color="#38bdf8" />
              <RatingBadge label="Course"     value={coursePct} color="#86efac" />
              <RatingBadge label="Workload"   value={workPct}   color="#c0c0d8" />
            </>
          )}
        </div>
      </div>

      {/* Instructor */}
      {course.professor_display && (
        <p className="text-sm text-label mb-0.5">
          <span className="text-muted">Instructor:</span>{' '}
          <button
            onClick={() => navigate(`/faculty?prof=${encodeProf(course.professor)}`)}
            className="hover:underline"
            style={{ color: '#93c5fd' }}
          >
            {course.professor_display}
          </button>
          {course.faculty_category && (
            <span className="text-muted ml-1" style={{ fontSize: 11 }}>({course.faculty_category})</span>
          )}
        </p>
      )}

      {/* Term / avg range */}
      <p className="text-xs text-muted mb-2">
        {course.is_average ? (
          <>
            <span
              className="px-1.5 py-0.5 rounded mr-1"
              style={{ background: '#1e2a4a', color: '#93c5fd', fontSize: 11 }}
            >
              ⭐ avg {course.year_range}
            </span>
            <span>
              {course.n_terms} term{course.n_terms !== 1 ? 's' : ''}
              {course.total_n_respondents != null && (
                <span className="ml-1 text-muted" style={{ fontSize: 10 }}>
                  (N={course.total_n_respondents})
                </span>
              )}
            </span>
            {course.ever_bidding && course.last_bid_price != null && (
              <span className="ml-2">
                | Last Bid: {course.last_bid_price} pts ({course.last_bid_acad || ''} {course.last_bid_term || ''})
              </span>
            )}
          </>
        ) : (
          <>
            {course.term && <span>Term: {course.term}</span>}
            {course.n_respondents != null && (
              <span className="ml-1" style={{ fontSize: 10 }}>
                (N={course.n_respondents})
              </span>
            )}
            {course.ever_bidding && course.last_bid_price != null && (
              <span className="ml-2">
                | Last Bid: {course.last_bid_price} pts ({course.last_bid_acad || ''} {course.last_bid_term || ''})
              </span>
            )}
          </>
        )}
      </p>

      {/* Bidding-only badge */}
      {isBiddingOnly && (
        <p
          className="text-xs font-medium px-2 py-1 rounded inline-block mb-2"
          style={{ background: '#2a1f0a', color: '#f59e0b', border: '1px solid #f59e0b33' }}
        >
          🟡 Bidding — no eval yet
          {course.last_bid_price != null && (
            <span className="ml-2 font-bold">{course.last_bid_price} pts</span>
          )}
        </p>
      )}

      {/* Description */}
      {descExcerpt && (
        <p className="text-xs text-muted mb-3 leading-relaxed">{descExcerpt}</p>
      )}

      {/* No-eval placeholder */}
      {noEval && !isBiddingOnly && (
        <p className="text-xs mb-2" style={{ color: '#5a5a7a', fontStyle: 'italic' }}>
          No evaluation data available
        </p>
      )}

      {/* Buttons */}
      <div className="flex gap-2">
        <button
          onClick={handleDetail}
          className="btn-details"
        >
          🔍 View Full Details
        </button>
        {course.course_url && (
          <a
            href={course.course_url}
            target="_blank"
            rel="noopener noreferrer"
            className="px-4 py-1.5 rounded text-xs font-medium text-label transition-opacity hover:opacity-80"
            style={{ background: '#2a2a3e' }}
          >
            🌐 Course Website
          </a>
        )}
      </div>
    </div>
  )
}
