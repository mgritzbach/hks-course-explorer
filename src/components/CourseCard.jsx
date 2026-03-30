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
      <span className="font-medium" style={{ color: color || 'var(--text-soft)' }}>{pct(value)}</span>
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

  const borderAccent = biddingOnly ? 'var(--gold)' : noEval ? 'rgba(243, 233, 226, 0.2)' : 'var(--accent)'
  const descriptionExcerpt = course.description
    ? (course.description.length > 180 ? `${course.description.slice(0, 180)}...` : course.description)
    : null

  return (
    <div
      className="card-hover surface-card mb-3 py-5"
      style={{
        borderLeft: `3px solid ${borderAccent}`,
        paddingLeft: 16,
        paddingRight: 16,
        background: 'linear-gradient(180deg, rgba(255,255,255,0.028), rgba(255,255,255,0.016))',
      }}
    >
      <div className="mb-3 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0 flex-1">
          <div className="mb-2 flex flex-wrap gap-2">
            {course.is_stem && (
              <span className="rounded-full px-2.5 py-1 text-[10px] font-bold" style={{ background: 'var(--blue-soft)', color: 'var(--blue)' }}>
                STEM
              </span>
            )}
            {course.is_core && (
              <span className="rounded-full px-2.5 py-1 text-[10px] font-bold" style={{ background: 'var(--gold-soft)', color: 'var(--gold)' }}>
                Core
              </span>
            )}
            {biddingOnly && (
              <span className="rounded-full px-2.5 py-1 text-[10px] font-bold" style={{ background: 'var(--gold-soft)', color: 'var(--gold)' }}>
                Bidding pressure
              </span>
            )}
          </div>

          <h3 className="serif-display text-lg font-semibold leading-6 md:text-[22px]" style={{ color: 'var(--text)' }}>
            <button
              onClick={() => navigate(`/courses?id=${encodeURIComponent(course.id)}`)}
              className="text-left transition-opacity hover:opacity-85"
            >
              <span style={{ color: biddingOnly ? 'var(--gold)' : 'var(--accent-strong)' }}>{course.course_code}</span>
              <span style={{ color: biddingOnly ? 'var(--gold)' : 'var(--accent-strong)' }}>:</span>
              <span style={{ color: 'var(--text)' }}>{` ${course.course_name || '(Untitled)'}`}</span>
            </button>
          </h3>
        </div>

        <div className="min-w-0 md:min-w-[140px]">
          {biddingOnly ? (
            <div
              className="inline-flex rounded-2xl border px-3 py-2 text-xs font-bold md:flex md:flex-col md:items-end"
              style={{ background: 'var(--gold-soft)', color: 'var(--gold)', borderColor: 'rgba(212, 168, 106, 0.24)' }}
            >
              <span>Most Competitive</span>
              {course.last_bid_price != null && (
                <span className="font-normal md:mt-1" style={{ fontSize: 11, color: 'var(--gold)' }}>
                  {course.last_bid_price} pts
                </span>
              )}
            </div>
          ) : noEval ? (
            <div className="text-xs" style={{ color: 'var(--text-muted)' }}>No eval data</div>
          ) : (
            <div className="grid gap-1">
              <RatingBadge label="Instructor" value={instructorPct} color="var(--accent-strong)" />
              <RatingBadge label="Course" value={coursePct} color="var(--success)" />
              <RatingBadge label="Workload" value={workloadPct} color="var(--text-soft)" />
            </div>
          )}
        </div>
      </div>

      {course.professor_display && (
        <p className="mb-2 text-sm" style={{ color: 'var(--text-soft)' }}>
          <span style={{ color: 'var(--text-muted)' }}>Instructor:</span>{' '}
          <button
            onClick={() => navigate(`/faculty?prof=${encodeProf(course.professor)}`)}
            className="hover:underline"
            style={{ color: 'var(--blue)' }}
          >
            {course.professor_display}
          </button>
          {course.faculty_category && <span className="ml-1 text-[11px]" style={{ color: 'var(--text-muted)' }}>({course.faculty_category})</span>}
        </p>
      )}

      <p className="mb-3 text-xs leading-5" style={{ color: 'var(--text-muted)' }}>
        {course.is_average ? (
          <>
            <span className="mr-2 rounded-full px-2 py-1 text-[11px]" style={{ background: 'var(--panel-subtle)', color: 'var(--blue)' }}>
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

      {descriptionExcerpt && (
        <p className="mb-4 text-xs leading-relaxed" style={{ color: 'var(--text-soft)' }}>{descriptionExcerpt}</p>
      )}

      {noEval && !biddingOnly && (
        <p className="mb-3 text-xs italic" style={{ color: 'var(--text-muted)' }}>
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
            className="rounded-full border px-4 py-2 text-center text-xs font-medium transition-opacity hover:opacity-80"
            style={{ background: 'var(--panel-subtle)', borderColor: 'var(--line)', color: 'var(--text)' }}
          >
            Course Website
          </a>
        )}
        {favs && (
          <button
            onClick={() => favs.toggle(course.course_code_base)}
            title={starred ? 'Remove from shortlist' : 'Add to shortlist'}
            className="ml-auto rounded-full px-3 py-2 text-sm transition-colors"
            style={{
              color: starred ? 'var(--gold)' : 'var(--text-muted)',
              background: starred ? 'var(--gold-soft)' : 'transparent',
              border: `1px solid ${starred ? 'rgba(212, 168, 106, 0.22)' : 'transparent'}`,
            }}
          >
            {starred ? '★' : '☆'}
          </button>
        )}
      </div>
    </div>
  )
}
