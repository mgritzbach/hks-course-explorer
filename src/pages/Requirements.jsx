import { useEffect, useMemo, useRef, useState } from 'react'
import { DEFAULT_PLAN, loadPlan, savePlan } from '../lib/scheduleStorage.js'
import { computeProgress, findCompletingCourses, getPrograms } from '../lib/requirementsEngine.js'

const PROGRAM_STORAGE_KEY = 'hks_req_program'

function getUrlProgram() {
  if (typeof window === 'undefined') return null
  return new URLSearchParams(window.location.search).get('p') || null
}

const COLOR_MAP = {
  blue: 'var(--blue)',
  purple: 'var(--accent)',
  green: 'var(--success)',
  crimson: 'var(--accent)',
  gold: 'var(--gold)',
}

function ProgressBar({ value, color, label }) {
  const pct = Math.max(0, Math.min(100, value))
  return (
    <div
      role="progressbar"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label || `Progress: ${pct}%`}
      className="h-3 overflow-hidden rounded-full"
      style={{ background: 'var(--panel-strong)', border: '1px solid var(--line)' }}
    >
      <div
        className="h-full rounded-full transition-all"
        style={{
          width: `${pct}%`,
          background: color,
        }}
      />
    </div>
  )
}

function getPlanCourses() {
  const plan = loadPlan(DEFAULT_PLAN)
  return Array.isArray(plan?.courses) ? plan.courses : []
}

export default function Requirements({ courses = [] }) {
  const programs = useMemo(() => getPrograms(), [])
  const [selectedProgram, setSelectedProgram] = useState(() => {
    if (typeof window === 'undefined') return programs[0]?.id || ''
    const urlProgram = getUrlProgram()
    const validIds = new Set(Object.keys(programs).map ? programs.map((p) => p.id) : [])
    if (urlProgram && (validIds.size === 0 || validIds.has(urlProgram))) return urlProgram
    return window.localStorage.getItem(PROGRAM_STORAGE_KEY) || programs[0]?.id || ''
  })
  const [scheduledCourses, setScheduledCourses] = useState(() => getPlanCourses())
  const [openSuggestions, setOpenSuggestions] = useState({})
  const [addedToPlan, setAddedToPlan] = useState(() => {
    const codes = new Set(getPlanCourses().map((c) => c?.course_code_base || c?.course_code || c?.courseCode || c?.code).filter(Boolean))
    return codes
  })
  const [copyMsg, setCopyMsg] = useState(null)
  const copyTimeoutRef = useRef(null)

  const addCourseToPlan = (course) => {
    const plan = loadPlan(DEFAULT_PLAN)
    const courseCode = course?.course_code_base || course?.course_code || course?.courseCode || course?.code
    if (!courseCode) return
    const already = plan.courses.some((c) => (c?.course_code_base || c?.course_code || c?.courseCode || c?.code) === courseCode)
    if (already) return
    const nextCourses = [...plan.courses, course]
    savePlan(DEFAULT_PLAN, { ...plan, courses: nextCourses })
    setAddedToPlan((prev) => new Set([...prev, courseCode]))
    setScheduledCourses(nextCourses)
  }

  useEffect(() => {
    return () => { if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current) }
  }, [])

  const copyShareLink = () => {
    const url = new URL(window.location.href)
    url.searchParams.set('p', selectedProgram)
    navigator.clipboard.writeText(url.toString()).then(() => {
      if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current)
      setCopyMsg('Copied!')
      copyTimeoutRef.current = setTimeout(() => setCopyMsg(null), 2500)
    }).catch(() => {
      if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current)
      setCopyMsg('Copy failed')
      copyTimeoutRef.current = setTimeout(() => setCopyMsg(null), 2500)
    })
  }

  useEffect(() => {
    if (typeof window === 'undefined') return undefined

    // Keep URL param in sync so the page is bookmarkable/shareable
    const url = new URL(window.location.href)
    url.searchParams.set('p', selectedProgram)
    window.history.replaceState(null, '', url.toString())

    window.localStorage.setItem(PROGRAM_STORAGE_KEY, selectedProgram)

    const syncPlanCourses = () => {
      setScheduledCourses(getPlanCourses())
    }
    const handleStorage = (event) => {
      if (event.key === `hks_plan_${DEFAULT_PLAN}`) {
        syncPlanCourses()
      }
    }

    window.addEventListener('focus', syncPlanCourses)
    document.addEventListener('visibilitychange', syncPlanCourses)
    window.addEventListener('storage', handleStorage)
    return () => {
      window.removeEventListener('focus', syncPlanCourses)
      document.removeEventListener('visibilitychange', syncPlanCourses)
      window.removeEventListener('storage', handleStorage)
    }
  }, [selectedProgram])

  const progress = useMemo(
    () => computeProgress(selectedProgram, scheduledCourses),
    [scheduledCourses, selectedProgram]
  )

  const suggestionMap = useMemo(() => {
    if (!progress) return {}

    return Object.fromEntries(
      progress.categories.map((category) => [
        category.id,
        findCompletingCourses(selectedProgram, scheduledCourses, courses, category.id),
      ])
    )
  }, [courses, progress, scheduledCourses, selectedProgram])

  if (!progress) {
    return (
      <div className="h-full overflow-y-auto px-6 py-10 md:px-10">
        <p style={{ color: 'var(--text-muted)' }}>No program definitions available.</p>
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto px-6 py-8 md:px-10">
      <div className="mx-auto flex max-w-6xl flex-col gap-6">
        <div
          className="rounded-[28px] p-6"
          style={{ background: 'var(--panel)', border: '1px solid var(--line)' }}
        >
          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="kicker">Hidden Feature</p>
              <h1 className="serif-display mt-2 text-4xl font-semibold" style={{ color: 'var(--text)' }}>
                Requirements Tracker
              </h1>
              <p className="mt-3 max-w-2xl text-sm leading-6" style={{ color: 'var(--text-muted)' }}>
                Progress is calculated from courses saved in <span style={{ color: 'var(--text)' }}>{DEFAULT_PLAN}</span>.
                {' '}Add courses in the{' '}
                <a href="/schedule-builder" style={{ color: 'var(--accent)', fontWeight: 600 }}>Schedule Builder</a>
                {' '}to track fulfillment live.
              </p>
            </div>

            <div className="w-full max-w-sm">
              <label htmlFor="req-program-select" className="mb-2 block text-xs font-semibold uppercase tracking-[0.12em]" style={{ color: 'var(--text-muted)' }}>
                Program
              </label>
              <div className="flex gap-2">
                <div className="select-wrap flex-1">
                  <select id="req-program-select" value={selectedProgram} onChange={(event) => setSelectedProgram(event.target.value)}>
                    {programs.map((program) => (
                      <option key={program.id} value={program.id}>
                        {program.label}
                      </option>
                    ))}
                  </select>
                </div>
                <button
                  type="button"
                  onClick={copyShareLink}
                  title="Copy shareable link to this program view"
                  className="shrink-0 rounded-[14px] border px-3 py-2 text-sm font-semibold transition-all hover:-translate-y-[1px]"
                  style={{
                    background: copyMsg === 'Copied!' ? 'rgba(123,176,138,0.15)' : 'var(--panel-strong)',
                    borderColor: copyMsg === 'Copied!' ? 'var(--success)' : 'var(--line-strong)',
                    color: copyMsg === 'Copied!' ? 'var(--success)' : 'var(--text-muted)',
                    minWidth: 44,
                  }}
                >
                  {copyMsg === 'Copied!' ? '✓' : copyMsg ? '!' : '🔗'}
                </button>
              </div>
            </div>
          </div>

          <div className="mt-6 grid gap-4 md:grid-cols-[1.4fr,0.8fr]">
            <div>
              <div className="mb-2 flex items-center justify-between gap-3 text-sm">
                <span style={{ color: 'var(--text-soft)' }}>
                  Overall credit progress
                </span>
                <span style={{ color: 'var(--text)' }}>
                  {progress.overallAppliedCredits} / {progress.totalRequiredCredits} credits
                </span>
              </div>
              <ProgressBar value={progress.overallPercent} color="var(--gold)" label={`Overall: ${progress.overallAppliedCredits} of ${progress.totalRequiredCredits} credits`} />
            </div>

            <div
              className="rounded-[22px] p-4"
              style={{ background: 'var(--panel-strong)', border: '1px solid var(--line)' }}
            >
              <p className="text-xs font-semibold uppercase tracking-[0.12em]" style={{ color: 'var(--text-muted)' }}>
                Plan Snapshot
              </p>
              <p className="mt-3 text-2xl font-semibold" style={{ color: 'var(--text)' }}>
                {scheduledCourses.length}
              </p>
              <p className="mt-1 text-sm" style={{ color: 'var(--text-muted)' }}>
                scheduled course{scheduledCourses.length === 1 ? '' : 's'} loaded from local storage
              </p>
              {scheduledCourses.length === 0 && (
                <a
                  href="/schedule-builder"
                  className="mt-4 inline-flex text-sm font-semibold transition-transform hover:-translate-y-[1px]"
                  style={{ color: 'var(--accent)' }}
                >
                  Build your schedule →
                </a>
              )}
            </div>
          </div>
        </div>

        <div className="grid gap-5 lg:grid-cols-2">
          {progress.categories.map((category) => {
            const accentColor = COLOR_MAP[category.color] || 'var(--accent)'
            const suggestions = suggestionMap[category.id] || []
            const showSuggestions = openSuggestions[category.id]

            return (
              <section
                key={category.id}
                className="rounded-[24px] p-5"
                style={{
                  background: category.isComplete
                    ? 'linear-gradient(160deg, rgba(123,176,138,0.07), var(--panel))'
                    : 'var(--panel)',
                  border: `1px solid ${category.isComplete ? 'rgba(123,176,138,0.3)' : 'var(--line)'}`,
                }}
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.12em]" style={{ color: accentColor }}>
                      {category.sublabel}
                    </p>
                    <h2 className="mt-2 text-xl font-semibold" style={{ color: 'var(--text)' }}>
                      {category.label}
                    </h2>
                  </div>
                  <div
                    className="rounded-full px-3 py-1 text-xs font-semibold"
                    style={{
                      background: category.isComplete ? 'rgba(123,176,138,0.18)' : 'var(--accent-soft)',
                      color: category.isComplete ? 'var(--success)' : 'var(--text)',
                    }}
                  >
                    {category.isComplete ? '✓ ' : ''}{category.appliedCredits} / {category.requiredCredits} cr
                  </div>
                </div>

                <p className="mt-3 text-sm leading-6" style={{ color: 'var(--text-muted)' }}>
                  {category.note}
                </p>
                {category.chosenArea && (
                  <p className="mt-2 text-xs font-semibold uppercase tracking-[0.12em]" style={{ color: 'var(--text-soft)' }}>
                    PAC area currently tracking: {category.chosenArea}
                  </p>
                )}

                <div className="mt-4">
                  <ProgressBar value={category.percent} color={accentColor} label={`${category.label}: ${category.appliedCredits} of ${category.requiredCredits} credits`} />
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  {category.selectedCourses.length > 0 ? (
                    category.selectedCourses.map((course) => (
                      <span
                        key={`${category.id}-${course._index}`}
                        className="rounded-full px-3 py-1 text-xs"
                        style={{ background: 'var(--panel-strong)', border: '1px solid var(--line)', color: 'var(--text-soft)' }}
                      >
                        {course._courseCode}
                      </span>
                    ))
                  ) : (
                    <span className="text-sm" style={{ color: 'var(--text-muted)' }}>
                      No matching scheduled courses yet.
                    </span>
                  )}
                </div>

                <div className="mt-5 flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    aria-expanded={showSuggestions}
                    aria-controls={`suggestions-${category.id}`}
                    onClick={() => {
                      setOpenSuggestions((current) => ({
                        ...current,
                        [category.id]: !current[category.id],
                      }))
                    }}
                    className="rounded-full px-4 py-2 text-sm font-semibold transition-transform hover:-translate-y-[1px]"
                    style={{ background: 'var(--gold-soft)', color: 'var(--text)', border: '1px solid var(--line)' }}
                  >
                    {showSuggestions ? 'Hide suggestions' : 'Find completing courses'}
                  </button>
                  <a
                    href="/schedule-builder"
                    className="rounded-full px-4 py-2 text-sm font-semibold transition-transform hover:-translate-y-[1px]"
                    style={{ background: 'var(--panel-strong)', color: 'var(--text-soft)', border: '1px solid var(--line)' }}
                  >
                    Open in Schedule Builder →
                  </a>
                  <span className="text-xs uppercase tracking-[0.12em]" style={{ color: category.isComplete ? 'var(--success)' : 'var(--warning)' }}>
                    {category.isComplete ? '✓ Complete' : `${category.remainingCredits} cr remaining`}
                  </span>
                </div>

                {showSuggestions && (
                  <div id={`suggestions-${category.id}`} className="mt-4 rounded-[20px] p-4" style={{ background: 'var(--panel-strong)', border: '1px solid var(--line)' }}>
                    <p className="text-xs font-semibold uppercase tracking-[0.12em]" style={{ color: 'var(--text-muted)' }}>
                      Suggested matches
                    </p>
                    <div className="mt-3 space-y-3">
                      {suggestions.length > 0 ? (
                        suggestions.map(({ course }, index) => {
                          const courseCode = course?.course_code_base || course?.course_code || course?.code
                          const isAdded = addedToPlan.has(courseCode)
                          return (
                            <div key={`${category.id}-suggestion-${index}`} className="rounded-[16px] p-3" style={{ background: 'var(--panel)', border: '1px solid var(--line)' }}>
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0 flex-1">
                                  <p className="text-sm font-semibold" style={{ color: 'var(--text)' }}>
                                    {courseCode}
                                  </p>
                                  <p className="mt-1 text-sm" style={{ color: 'var(--text-soft)' }}>
                                    {course.course_name || course.title || 'Untitled course'}
                                  </p>
                                  <p className="mt-1 text-xs" style={{ color: 'var(--text-muted)' }}>
                                    {course.term} {course.year}{course.professor_display ? ` · ${course.professor_display}` : ''}
                                  </p>
                                </div>
                                <button
                                  type="button"
                                  disabled={isAdded}
                                  onClick={() => addCourseToPlan(course)}
                                  className="shrink-0 rounded-full border px-3 py-1.5 text-xs font-semibold transition-transform enabled:hover:-translate-y-[1px] disabled:cursor-default"
                                  style={{
                                    background: isAdded ? 'rgba(123,176,138,0.15)' : 'var(--accent-soft)',
                                    borderColor: isAdded ? 'var(--success)' : 'var(--line-strong)',
                                    color: isAdded ? 'var(--success)' : 'var(--text)',
                                  }}
                                >
                                  {isAdded ? 'Added ✓' : '+ Plan A'}
                                </button>
                              </div>
                            </div>
                          )
                        })
                      ) : (
                        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                          No additional matching courses found in the current catalog data.
                        </p>
                      )}
                    </div>
                  </div>
                )}
              </section>
            )
          })}
        </div>
      </div>
    </div>
  )
}
