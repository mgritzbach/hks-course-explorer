import { useMemo, useState } from 'react'
import { isHksCourseCode } from '../lib/hksCourseCodes.js'

/**
 * Presentation boundary for the completed-course sidebar.
 *
 * The Schedule Builder continues to own persistence, normalized collections,
 * and announcements. This component owns only the ephemeral search and quick
 * add input values and describes a requested add/remove through callbacks.
 */
export default function CompletedCoursesPanel({
  allCourses,
  sectionInfoMap,
  completedCourses,
  normalizedCompletedCourses,
  completedCourseCodes,
  collapsed,
  onToggle,
  onAddCompleted,
  onRemoveCompleted,
}) {
  const [searchQuery, setSearchQuery] = useState('')
  const [quickAddInput, setQuickAddInput] = useState('')

  const searchResults = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    if (!query) return []
    return (Array.isArray(allCourses) ? allCourses : [])
      .filter(
        (course) =>
          !course?.is_average && isHksCourseCode(course?.course_code_base || course?.course_code),
      )
      .filter((course) =>
        [course?.course_code, course?.course_name, course?.professor, course?.professor_display]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
          .includes(query),
      )
      .sort((a, b) => Number(b?.year || 0) - Number(a?.year || 0))
      .reduce(
        (result, course) => {
          const code = course.course_code_base || course.course_code
          if (!result.seen.has(code)) {
            result.seen.add(code)
            result.items.push(course)
          }
          return result
        },
        { seen: new Set(), items: [] },
      )
      .items.slice(0, 20)
  }, [allCourses, searchQuery])

  function addSearchResult(course) {
    const courseCode = course.course_code_base || course.course_code
    if (!completedCourseCodes.has(courseCode)) {
      onAddCompleted({
        courseCode,
        title: course.course_name,
        instructors: [course.professor_display || course.professor].filter(Boolean),
        credits: 4,
        sections: [],
        enrichment: {},
      })
    }
    setSearchQuery('')
  }

  function addTypedSearch() {
    const courseCode = searchQuery.trim().toUpperCase().replace(/\s+/g, '-')
    const sectionInfo = sectionInfoMap.get(courseCode)
    onAddCompleted({
      courseCode,
      title: sectionInfo?.title || courseCode,
      credits: sectionInfo?.credits ?? 4,
      sections: [],
      instructors: sectionInfo?.instructors || [],
      enrichment: {},
    })
    setSearchQuery('')
  }

  function addQuickCourse() {
    const courseCode = quickAddInput.trim().toUpperCase()
    if (!courseCode) return
    const matchingCourse = (Array.isArray(allCourses) ? allCourses : [])
      .filter((course) => !course?.is_average)
      .find((course) => {
        const code = String(course?.course_code_base || course?.course_code || '').toUpperCase()
        return (
          code === courseCode || code.startsWith(`${courseCode}-`) || courseCode.startsWith(code)
        )
      })

    if (matchingCourse) {
      onAddCompleted({
        courseCode: matchingCourse.course_code_base || matchingCourse.course_code,
        title: matchingCourse.course_name || courseCode,
        instructors: [matchingCourse.professor_display || matchingCourse.professor].filter(Boolean),
        credits:
          Number(
            matchingCourse.credits_min ?? matchingCourse.credits_max ?? matchingCourse.credits ?? 4,
          ) || 4,
        sections: [],
        is_stem: matchingCourse.is_stem,
        is_core: matchingCourse.is_core,
        metrics_pct: matchingCourse.metrics_pct,
        sessionDescription: '',
        enrichment: {
          is_stem: matchingCourse.is_stem,
          is_core: matchingCourse.is_core,
          metrics_pct: matchingCourse.metrics_pct,
          bid_clearing_price: matchingCourse.bid_clearing_price,
          last_bid_price: matchingCourse.last_bid_price,
        },
      })
    } else {
      onAddCompleted({
        courseCode,
        title: courseCode,
        credits: 4,
        sections: [],
        instructors: [],
        sessionDescription: '',
        enrichment: {},
      })
    }
    setQuickAddInput('')
  }

  return (
    <div className="p-4">
      <div
        className="mb-3 rounded-xl border px-3 py-2.5"
        style={{
          background: 'color-mix(in srgb, var(--success) 8%, var(--panel-soft))',
          borderColor: 'color-mix(in srgb, var(--success) 30%, var(--line))',
        }}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onToggle}
              className="flex h-4 w-4 items-center justify-center text-[10px] transition-transform"
              style={{
                color: 'var(--success)',
                transform: collapsed ? 'rotate(-90deg)' : 'rotate(0deg)',
              }}
              aria-label="Toggle completed"
            >
              ▾
            </button>
            <span style={{ fontSize: 15 }}>🎓</span>
            <p
              className="text-xs font-bold uppercase tracking-[0.12em]"
              style={{ color: 'var(--success)' }}
            >
              Already Taken
            </p>
          </div>
          <span
            className="rounded-full px-2 py-0.5 text-[11px] font-semibold"
            style={{
              background: 'color-mix(in srgb, var(--success) 15%, transparent)',
              color: 'var(--success)',
            }}
          >
            {completedCourses.length} course{completedCourses.length !== 1 ? 's' : ''}
          </span>
        </div>
        <p className="mt-1 text-[11px] leading-4" style={{ color: 'var(--text-muted)' }}>
          Log courses you've completed — they count toward your requirements tracker below.
        </p>
      </div>

      {completedCourses.length > 0 && (
        <div className="mb-3 space-y-1.5">
          {normalizedCompletedCourses.map((course) => (
            <div
              key={course.courseCode}
              className="flex items-center justify-between gap-2 rounded-xl border px-2.5 py-1.5"
              style={{
                background: 'color-mix(in srgb, var(--success) 6%, var(--panel-soft))',
                borderColor: 'color-mix(in srgb, var(--success) 25%, var(--line))',
              }}
            >
              <div className="flex min-w-0 items-center gap-2">
                <span className="text-[11px]" style={{ color: 'var(--success)' }}>
                  ✓
                </span>
                <span
                  className="truncate text-[11px] font-semibold"
                  style={{ color: 'var(--text-soft)' }}
                >
                  {course.courseCode}
                </span>
              </div>
              <button
                type="button"
                onClick={() => onRemoveCompleted(course.courseCode)}
                aria-label={`Un-complete ${course.courseCode}`}
                className="shrink-0 text-[11px] font-bold transition-opacity hover:opacity-70"
                style={{
                  color: 'var(--text-muted)',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                }}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      {!collapsed && (
        <>
          <div className="relative mb-2">
            <input
              type="text"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="🔍  Search courses you've taken…"
              className="w-full rounded-xl border px-3 py-2.5 text-xs outline-none transition-colors"
              style={{
                background: 'var(--panel-soft)',
                borderColor: searchQuery ? 'var(--success)' : 'var(--line-strong)',
                color: 'var(--text)',
              }}
              aria-label="Search courses already taken"
            />
            {searchResults.length > 0 && (
              <div
                className="absolute left-0 right-0 top-full z-30 mt-1 max-h-52 overflow-y-auto rounded-xl border shadow-lg"
                style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}
              >
                {searchResults.map((course) => {
                  const courseCode = course.course_code_base || course.course_code
                  const alreadyDone = completedCourseCodes.has(courseCode)
                  return (
                    <button
                      key={courseCode}
                      type="button"
                      onClick={() => addSearchResult(course)}
                      className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs transition-colors hover:bg-[var(--panel-soft)]"
                    >
                      <div className="min-w-0 flex-1 overflow-hidden">
                        <span className="font-semibold" style={{ color: 'var(--text)' }}>
                          {courseCode}
                        </span>
                        <span className="ml-2" style={{ color: 'var(--text-muted)' }}>
                          {course.course_name}
                        </span>
                      </div>
                      {alreadyDone ? (
                        <span
                          className="shrink-0 text-xs font-semibold"
                          style={{ color: 'var(--success)' }}
                        >
                          ✓ Added
                        </span>
                      ) : (
                        <span
                          className="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold"
                          style={{
                            background: 'color-mix(in srgb, var(--success) 12%, transparent)',
                            color: 'var(--success)',
                            border: '1px solid color-mix(in srgb, var(--success) 35%, transparent)',
                          }}
                        >
                          ✓ Mark done
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>
            )}
            {searchQuery.trim().length >= 2 && searchResults.length === 0 && (
              <div
                className="mt-1.5 flex items-center justify-between rounded-xl border px-3 py-1.5 text-xs"
                style={{ background: 'var(--panel-soft)', borderColor: 'var(--line)' }}
              >
                <span style={{ color: 'var(--text-muted)' }}>Not in Q-guide history</span>
                <button
                  type="button"
                  onClick={addTypedSearch}
                  className="rounded-full border px-2 py-0.5 text-[11px] font-semibold"
                  style={{
                    background: 'color-mix(in srgb, var(--success) 12%, transparent)',
                    color: 'var(--success)',
                    borderColor: 'color-mix(in srgb, var(--success) 35%, transparent)',
                  }}
                >
                  + Add {searchQuery.trim().toUpperCase().replace(/\s+/g, '-')} as done
                </button>
              </div>
            )}
          </div>
          <details className="mb-2">
            <summary
              className="cursor-pointer select-none text-[11px]"
              style={{ color: 'var(--text-muted)' }}
            >
              Add by course code
            </summary>
            <div className="mt-1.5 flex gap-2">
              <input
                type="text"
                value={quickAddInput}
                onChange={(event) => setQuickAddInput(event.target.value.toUpperCase())}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter') return
                  event.preventDefault()
                  addQuickCourse()
                }}
                placeholder="e.g. API-101"
                className="min-w-0 flex-1 rounded-xl border px-3 py-2 text-xs outline-none transition-colors"
                style={{
                  background: 'var(--panel-soft)',
                  borderColor: 'var(--line-strong)',
                  color: 'var(--text)',
                }}
                aria-label="Quick add completed course code"
              />
              <button
                type="button"
                onClick={addQuickCourse}
                disabled={!quickAddInput.trim()}
                className="shrink-0 rounded-xl border px-3 py-2 text-xs font-semibold transition-transform enabled:hover:-translate-y-[1px] disabled:cursor-default disabled:opacity-50"
                style={{
                  background: 'var(--accent-soft)',
                  borderColor: 'var(--line-strong)',
                  color: 'var(--text)',
                }}
              >
                Add
              </button>
            </div>
          </details>
          {completedCourses.length === 0 && (
            <p className="text-[11px] leading-5" style={{ color: 'var(--text-muted)' }}>
              Search above to mark courses as completed.
            </p>
          )}
        </>
      )}
    </div>
  )
}
