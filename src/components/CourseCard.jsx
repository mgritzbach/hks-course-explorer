import { useNavigate } from 'react-router-dom'

function encodeProf(professor) {
  return encodeURIComponent(professor)
}

function pct(value) {
  if (value == null) return null
  return `${Math.round(value)}%`
}

function RatingBadge({ label, value, color }) {
  if (value == null) return null
  return (
    <div className="text-xs leading-5 md:text-right">
      <span className="text-muted">{label}: </span>
      <span className="font-medium" style={{ color: color || '#c0c0d8' }}>{pct(value)}</span>
    </div>
  )
}

export default function CourseCard({ course, favs }) {
  const navigate = useNavigate()
  const starred = favs?.isFavorite(course.course_code_base)

  const instructorPct = course.metrics_pct?.Instructor_Rating
  const workloadPct = course.metrics_pct?.Workload
  const coursePct = course.metrics_pct?.Course_Rating
  const biddingOnly = !course.has_eval && course.has_bidding
  const noEval = !course.has_eval && !course.has_bidding

  const borderAccent = biddingOnly ? '#f59e0b' : noEval ? '#4a4a5e' : '#38bdf8'
  const descriptionExcerpt = course.description
    ? (course.description.length > 180 ? `${course.description.slice(0, 180)}...` : course.description)
    : null

  return (
    <div
      className="card-hover py-5"
      style={{
        borderBottom: '1px solid #2a2a3e',
        borderLeft: `3px solid ${borderAccent}`,
        paddingLeft: 14,
      }}
    >
      <div className="mb-2 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold leading-6 md:text-[15px]">
            <button
              onClick={() => navigate(`/courses?id=${encodeURIComponent(course.id)}`)}
              className="text-left hover:underline"
              style={{ color: '#38bdf8' }}
            >
              <span className="font-bold">{course.course_code}</span>
              <span className="text-label">: {course.course_name || '(Untitled)'}</span>
            </button>
          </h3>

          <div className="mt-2 flex flex-wrap gap-2">
            {course.is_stem && (
              <span className="rounded px-2 py-1 text-[10px] font-bold" style={{ background: '#1e3a52', color: '#38bdf8' }}>
                STEM
              </span>
            )}
            {course.is_core && (
              <span className="rounded px-2 py-1 text-[10px] font-bold" style={{ background: '#2a1f0e', color: '#f59e0b' }}>
                Core
              </span>
            )}
          </div>
        </div>

        <div className="min-w-0 md:min-w-[120px]">
          {biddingOnly ? (
            <div
              className="inline-flex rounded-lg border px-3 py-2 text-xs font-bold md:flex md:flex-col md:items-end"
              style={{ background: '#2a1f0a', color: '#f59e0b', borderColor: '#f59e0b44' }}
            >
              <span>Bidding</span>
              {course.last_bid_price != null && (
                <span className="font-normal md:mt-1" style={{ fontSize: 11, color: '#f8d27d' }}>
                  {course.last_bid_price} pts
                </span>
              )}
            </div>
          ) : noEval ? (
            <div className="text-xs text-muted">No eval data</div>
          ) : (
            <div className="grid gap-1">
              <RatingBadge label="Instructor" value={instructorPct} color="#38bdf8" />
              <RatingBadge label="Course" value={coursePct} color="#86efac" />
              <RatingBadge label="Workload" value={workloadPct} color="#c0c0d8" />
            </div>
          )}
        </div>
      </div>

      {course.professor_display && (
        <p className="mb-1 text-sm text-label">
          <span className="text-muted">Instructor:</span>{' '}
          <button
            onClick={() => navigate(`/faculty?prof=${encodeProf(course.professor)}`)}
            className="hover:underline"
            style={{ color: '#93c5fd' }}
          >
            {course.professor_display}
          </button>
          {course.faculty_category && <span className="ml-1 text-[11px] text-muted">({course.faculty_category})</span>}
        </p>
      )}

      <p className="mb-3 text-xs text-muted leading-5">
        {course.is_average ? (
          <>
            <span className="mr-2 rounded px-2 py-1 text-[11px]" style={{ background: '#1e2a4a', color: '#93c5fd' }}>
              avg {course.year_range}
            </span>
            <span>
              {course.n_terms} term{course.n_terms !== 1 ? 's' : ''}
              {course.total_n_respondents != null && <span className="ml-1">(N={course.total_n_respondents})</span>}
            </span>
            {course.ever_bidding && course.last_bid_price != null && (
              <span className="block pt-1 sm:inline sm:pl-2">
                Last Bid: {course.last_bid_price} pts ({course.last_bid_acad || ''} {course.last_bid_term || ''})
              </span>
            )}
          </>
        ) : (
          <>
            {course.term && <span>Term: {course.term}</span>}
            {course.n_respondents != null && <span className="ml-1">(N={course.n_respondents})</span>}
            {course.ever_bidding && course.last_bid_price != null && (
              <span className="block pt-1 sm:inline sm:pl-2">
                Last Bid: {course.last_bid_price} pts ({course.last_bid_acad || ''} {course.last_bid_term || ''})
              </span>
            )}
          </>
        )}
      </p>

      {biddingOnly && (
        <p
          className="mb-3 inline-flex items-center gap-2 rounded border px-3 py-1 text-xs font-medium"
          style={{ background: '#2a1f0a', color: '#f59e0b', borderColor: '#f59e0b33' }}
        >
          Bidding only
          {course.last_bid_price != null && <span className="font-bold">{course.last_bid_price} pts</span>}
        </p>
      )}

      {descriptionExcerpt && (
        <p className="mb-3 text-xs leading-relaxed text-muted">{descriptionExcerpt}</p>
      )}

      {noEval && !biddingOnly && (
        <p className="mb-2 text-xs italic" style={{ color: '#5a5a7a' }}>
          No evaluation data available
        </p>
      )}

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <button onClick={() => navigate(`/courses?id=${encodeURIComponent(course.id)}`)} className="btn-details">
          View Full Details
        </button>
        {course.course_url && (
          <a
            href={course.course_url}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded px-4 py-2 text-center text-xs font-medium text-label transition-opacity hover:opacity-80"
            style={{ background: '#2a2a3e' }}
          >
            Course Website
          </a>
        )}
        {favs && (
          <button
            onClick={() => favs.toggle(course.course_code_base)}
            title={starred ? 'Remove from shortlist' : 'Add to shortlist'}
            className="ml-auto rounded px-3 py-2 text-sm transition-colors"
            style={{ color: starred ? '#fbbf24' : '#4a4a6a', background: starred ? '#2a1f0a' : 'transparent' }}
          >
            {starred ? '★' : '☆'}
          </button>
        )}
      </div>
    </div>
  )
}
