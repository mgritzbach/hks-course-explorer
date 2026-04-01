import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'

function pct(value) { return value != null ? `${Math.round(value)}%` : '-' }

function MetricBar({ label, value, higherBetter = true, neutral = false }) {
  if (value == null) return null
  const rounded = Math.round(value)
  let color
  if (neutral) color = 'var(--blue)'
  else if (higherBetter) color = rounded >= 75 ? 'var(--success)' : rounded >= 50 ? 'var(--gold)' : 'var(--danger)'
  else color = rounded <= 25 ? 'var(--success)' : rounded <= 50 ? 'var(--gold)' : 'var(--danger)'

  return (
    <div className="mb-2">
      <div className="mb-0.5 flex justify-between text-xs"><span className="text-muted">{label}</span><span className="font-medium text-label">{rounded}%</span></div>
      <div className="h-1 w-full rounded-full" style={{ background: 'rgba(255,255,255,0.08)' }}><div className="h-1 rounded-full" style={{ width: `${rounded}%`, background: color }} /></div>
    </div>
  )
}

const SORT_OPTIONS = [
  { value: 'name_asc', label: 'Name A-Z' },
  { value: 'rating_desc', label: 'Instructor Rating desc' },
  { value: 'course_rating_desc', label: 'Course Rating desc' },
  { value: 'courses_desc', label: 'Most Courses' },
  { value: 'respondents_desc', label: 'Most Respondents' },
]

function activeFilterCount({ concentration, minRating, minCourses }) {
  return (concentration !== 'All' ? 1 : 0) + (minRating !== 'any' ? 1 : 0) + (minCourses !== 'any' ? 1 : 0)
}

function FacultySidebar({
  meta, displayedProfs, allProfessors, selectedProf, query, setQuery, concentration, setConcentration,
  minRating, setMinRating, minCourses, setMinCourses, sortBy, setSortBy, resetFilters, handleSelectProf,
  mobile = false, onClose = null,
}) {
  const filters = activeFilterCount({ concentration, minRating, minCourses })

  return (
    <aside className="flex h-full flex-col overflow-hidden shrink-0" style={{ width: mobile ? '100%' : 292, background: 'linear-gradient(180deg, var(--panel-strong), var(--panel-soft))', borderRight: '1px solid var(--line)' }}>
      <div className="shrink-0 border-b px-4 pb-3 pt-4" style={{ borderColor: 'var(--line)' }}>
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <p className="kicker">Faculty Explorer</p>
            {filters > 0 && <span className="filter-badge">{filters} active</span>}
          </div>
          <div className="flex items-center gap-2">
            {filters > 0 && <button onClick={resetFilters} className="text-[10px] text-muted hover:text-label">Reset</button>}
            {mobile && onClose && <button onClick={onClose} className="rounded-full border px-2 py-1 text-[11px] text-muted hover:text-label" style={{ borderColor: 'var(--line)' }}>Close</button>}
          </div>
        </div>

        <input type="text" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by name..." className="mb-3 w-full" style={{ fontSize: 12 }} />

        <div className="grid gap-2">
          <div><p className="mb-1 text-[10px] uppercase tracking-wider text-muted">Sort</p><div className="select-wrap"><select value={sortBy} onChange={(event) => setSortBy(event.target.value)} style={{ fontSize: 11, padding: '3px 24px 3px 6px' }}>{SORT_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></div></div>
          <div><p className="mb-1 text-[10px] uppercase tracking-wider text-muted">Concentration</p><div className="select-wrap"><select value={concentration} onChange={(event) => setConcentration(event.target.value)} style={{ fontSize: 11, padding: '3px 24px 3px 6px' }}><option value="All">All</option>{meta.concentrations.map((item) => <option key={item} value={item}>{item}</option>)}</select></div></div>
          <div><p className="mb-1 text-[10px] uppercase tracking-wider text-muted">Min Instructor Rating</p><div className="select-wrap"><select value={minRating} onChange={(event) => setMinRating(event.target.value)} style={{ fontSize: 11, padding: '3px 24px 3px 6px' }}><option value="any">Any</option><option value="90">Top 10%</option><option value="75">Top 25%</option><option value="50">Top 50%</option></select></div></div>
          <div><p className="mb-1 text-[10px] uppercase tracking-wider text-muted">Min Courses Taught</p><div className="select-wrap"><select value={minCourses} onChange={(event) => setMinCourses(event.target.value)} style={{ fontSize: 11, padding: '3px 24px 3px 6px' }}><option value="any">Any</option><option value="3">3+</option><option value="5">5+</option><option value="10">10+</option><option value="20">20+</option></select></div></div>
        </div>

        <p className="mt-3 text-[10px] text-muted">{displayedProfs.length} of {allProfessors.length} instructors</p>
      </div>

      <div className="flex-1 overflow-y-auto">
        {displayedProfs.map((prof) => {
          const avg = prof.avgMetrics?.Instructor_Rating
          const selected = selectedProf === prof.professor
          return (
            <button
              key={prof.professor}
              onClick={() => { handleSelectProf(prof); if (mobile && onClose) onClose() }}
              className="w-full border-b px-4 py-3 text-left transition-colors"
              style={{ background: selected ? 'rgba(165, 28, 48, 0.12)' : undefined, borderColor: 'rgba(243, 233, 226, 0.06)', borderLeft: selected ? '3px solid var(--accent)' : '3px solid transparent' }}
            >
              <p className="text-xs font-medium leading-tight text-label">{prof.professor_display}</p>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <span className="text-[10px] text-muted">{prof.evalCourses} course{prof.evalCourses !== 1 ? 's' : ''}</span>
                {avg != null && <span className="rounded px-1 py-0.5 text-[10px] font-medium" style={{ background: avg >= 75 ? 'rgba(123,176,138,0.12)' : avg >= 50 ? 'rgba(212,168,106,0.12)' : 'rgba(216,112,112,0.12)', color: avg >= 75 ? 'var(--success)' : avg >= 50 ? 'var(--gold)' : 'var(--danger)' }}>{Math.round(avg)}% instr.</span>}
              </div>
            </button>
          )
        })}
        {displayedProfs.length === 0 && <p className="px-4 py-6 text-center text-xs text-muted">No instructors match the current filters.</p>}
      </div>
    </aside>
  )
}

export default function Faculty({ courses, meta, metricMode = 'score' }) {
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [selectedProf, setSelectedProf] = useState(searchParams.get('prof') || null)
  const [concentration, setConcentration] = useState('All')
  const [minRating, setMinRating] = useState('any')
  const [minCourses, setMinCourses] = useState('any')
  const [sortBy, setSortBy] = useState('name_asc')
  const [sidebarOpen, setSidebarOpen] = useState(false)

  useEffect(() => { const professor = searchParams.get('prof'); if (professor) setSelectedProf(professor) }, [searchParams])
  useEffect(() => { document.title = 'HKS Faculty Explorer' }, [])

  const allProfessors = useMemo(() => {
    const registry = new Map()
    for (const course of courses) {
      if (!course.professor || course.is_average) continue
      if (!registry.has(course.professor)) {
        registry.set(course.professor, {
          professor: course.professor,
          professor_display: course.professor_display || course.professor,
          faculty_title: course.faculty_title,
          faculty_category: course.faculty_category,
          courses: [],
          evalCourses: 0,
          totalRespondents: 0,
          concentrationSet: new Set(),
          sumMetrics: {},
          cntMetrics: {},
        })
      }
      const entry = registry.get(course.professor)
      entry.courses.push(course)
      if (course.concentration) entry.concentrationSet.add(course.concentration)
      if (course.has_eval && !course.is_average) {
        entry.evalCourses += 1
        entry.totalRespondents += course.n_respondents || 0
        for (const metric of meta.metrics) {
          const value = metricMode === 'score' ? course.metrics_score?.[metric.key] : course.metrics_pct?.[metric.key]
          if (value != null) {
            const weight = course.n_respondents || 1
            entry.sumMetrics[metric.key] = (entry.sumMetrics[metric.key] || 0) + value * weight
            entry.cntMetrics[metric.key] = (entry.cntMetrics[metric.key] || 0) + weight
          }
        }
      }
    }
    return [...registry.values()].filter((prof) => prof.evalCourses > 0).map((prof) => ({
      ...prof,
      concentrations: [...prof.concentrationSet].sort(),
      avgMetrics: Object.fromEntries(meta.metrics.map((metric) => [metric.key, prof.cntMetrics[metric.key] ? Math.round((prof.sumMetrics[metric.key] / prof.cntMetrics[metric.key]) * 10) / 10 : null])),
    }))
  }, [courses, meta.metrics, metricMode])

  const displayedProfs = useMemo(() => {
    const minRatingValue = minRating !== 'any' ? parseFloat(minRating) : null
    const minCoursesValue = minCourses !== 'any' ? parseInt(minCourses, 10) : null
    const list = allProfessors.filter((prof) => {
      if (query) {
        const normalized = query.toLowerCase()
        if (!(prof.professor_display || '').toLowerCase().includes(normalized) && !(prof.professor || '').toLowerCase().includes(normalized)) return false
      }
      if (concentration !== 'All' && !prof.concentrations.includes(concentration)) return false
      if (minRatingValue !== null && (prof.avgMetrics?.Instructor_Rating ?? -1) < minRatingValue) return false
      if (minCoursesValue !== null && prof.evalCourses < minCoursesValue) return false
      return true
    })
    switch (sortBy) {
      case 'rating_desc': list.sort((a, b) => (b.avgMetrics?.Instructor_Rating ?? -1) - (a.avgMetrics?.Instructor_Rating ?? -1)); break
      case 'course_rating_desc': list.sort((a, b) => (b.avgMetrics?.Course_Rating ?? -1) - (a.avgMetrics?.Course_Rating ?? -1)); break
      case 'courses_desc': list.sort((a, b) => b.evalCourses - a.evalCourses); break
      case 'respondents_desc': list.sort((a, b) => b.totalRespondents - a.totalRespondents); break
      default: list.sort((a, b) => (a.professor_display || '').localeCompare(b.professor_display || ''))
    }
    return list
  }, [allProfessors, concentration, minCourses, minRating, query, sortBy])

  const selectedData = useMemo(() => selectedProf ? allProfessors.find((prof) => prof.professor === selectedProf) || null : null, [allProfessors, selectedProf])
  const profCourses = useMemo(() => selectedData ? selectedData.courses.filter((course) => course.has_eval && !course.is_average).sort((a, b) => (b.year || 0) - (a.year || 0) || (a.term || '').localeCompare(b.term || '')) : [], [selectedData])

  const resetFilters = () => { setConcentration('All'); setMinRating('any'); setMinCourses('any'); setSortBy('name_asc'); setQuery('') }
  const handleSelectProf = (prof) => { setSelectedProf(prof.professor); setSearchParams({ prof: prof.professor }) }

  return (
    <div className="flex h-full min-h-0 overflow-hidden">
      {sidebarOpen && <button className="mobile-drawer-overlay md:hidden" onClick={() => setSidebarOpen(false)} aria-label="Close faculty list" />}
      <div className={`mobile-drawer md:hidden ${sidebarOpen ? 'open' : ''}`}>
        <FacultySidebar
          meta={meta}
          displayedProfs={displayedProfs}
          allProfessors={allProfessors}
          selectedProf={selectedProf}
          query={query}
          setQuery={setQuery}
          concentration={concentration}
          setConcentration={setConcentration}
          minRating={minRating}
          setMinRating={setMinRating}
          minCourses={minCourses}
          setMinCourses={setMinCourses}
          sortBy={sortBy}
          setSortBy={setSortBy}
          resetFilters={resetFilters}
          handleSelectProf={handleSelectProf}
          mobile
          onClose={() => setSidebarOpen(false)}
        />
      </div>
      <div className="hidden md:block">
        <FacultySidebar
          meta={meta}
          displayedProfs={displayedProfs}
          allProfessors={allProfessors}
          selectedProf={selectedProf}
          query={query}
          setQuery={setQuery}
          concentration={concentration}
          setConcentration={setConcentration}
          minRating={minRating}
          setMinRating={setMinRating}
          minCourses={minCourses}
          setMinCourses={setMinCourses}
          sortBy={sortBy}
          setSortBy={setSortBy}
          resetFilters={resetFilters}
          handleSelectProf={handleSelectProf}
        />
      </div>

      <main className="flex min-w-0 flex-1 flex-col overflow-y-auto px-4 py-4 md:px-8 md:py-6">
        <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
          <div><p className="kicker mb-2">Teaching lens</p><h2 className="serif-display text-3xl font-semibold md:text-[2.4rem]" style={{ color: 'var(--text)' }}>Faculty Explorer</h2><p className="mt-2 text-xs text-muted md:text-sm">Browse teaching history and weighted rating averages for HKS instructors.</p></div>
          <button onClick={() => setSidebarOpen(true)} className="rounded-full border px-3 py-2 text-xs font-medium text-white md:hidden" style={{ borderColor: 'var(--line)', background: 'rgba(255,255,255,0.04)' }}>Browse Faculty{activeFilterCount({ concentration, minRating, minCourses }) > 0 ? ` (${activeFilterCount({ concentration, minRating, minCourses })})` : ''}</button>
        </div>

        {!selectedData && (
          <div className="flex flex-1 flex-col items-center justify-center text-center" style={{ paddingBottom: 80 }}>
            <p className="mb-1 text-2xl" style={{ lineHeight: 1 }}>&#x1F393;</p>
            <p className="mb-1 mt-3 font-medium text-label">Select an instructor</p>
            <p className="mb-6 text-xs text-muted">
              {allProfessors.length} instructors with eval data - use the sidebar to search or filter
            </p>
            {allProfessors.length > 0 && (
              <div className="max-w-md">
                <p className="mb-2 text-[10px] uppercase tracking-wider text-muted">Top rated instructors</p>
                <div className="flex flex-wrap justify-center gap-2">
                  {[...allProfessors]
                    .filter((prof) => prof.avgMetrics?.Instructor_Rating != null)
                    .sort((a, b) => (b.avgMetrics.Instructor_Rating - a.avgMetrics.Instructor_Rating) || b.evalCourses - a.evalCourses)
                    .slice(0, 8)
                    .map((prof) => (
                      <button
                        key={prof.professor}
                        onClick={() => handleSelectProf(prof)}
                        className="rounded-full border px-3 py-1.5 text-xs text-label transition-colors hover:text-label"
                        style={{ borderColor: 'var(--line)', background: 'rgba(255,255,255,0.03)' }}
                      >
                        {prof.professor_display}
                        <span className="ml-1.5 font-medium" style={{ color: 'var(--success)' }}>{Math.round(prof.avgMetrics.Instructor_Rating)}%</span>
                      </button>
                    ))}
                </div>
              </div>
            )}
          </div>
        )}

        {selectedData && <>
          <div className="mb-6">
            <h2 className="serif-display mb-1 text-3xl font-semibold md:text-[2.25rem]" style={{ color: 'var(--text)' }}>{selectedData.professor_display}</h2>
            {selectedData.faculty_title && <p className="text-sm text-muted">{selectedData.faculty_title}</p>}
            {selectedData.faculty_category && <p className="text-xs text-muted">{selectedData.faculty_category}</p>}
            {selectedData.concentrations.length > 0 && <div className="mt-3 flex flex-wrap gap-2">{selectedData.concentrations.map((item) => <span key={item} className="rounded-full px-2.5 py-1 text-[10px] font-medium" style={{ background: 'var(--blue-soft)', color: 'var(--blue)' }}>{item}</span>)}</div>}
            <div className="mt-3 flex flex-wrap gap-4 text-xs text-muted"><span>{selectedData.evalCourses} course{selectedData.evalCourses !== 1 ? 's' : ''} with evals</span>{selectedData.totalRespondents > 0 && <span>{selectedData.totalRespondents} total respondents</span>}</div>
          </div>

          <div className="mb-6 grid gap-4 lg:grid-cols-2">
            <div className="surface-card rounded-[22px] p-4">
              <h4 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted">Average Ratings</h4>
              {meta.metrics.filter((metric) => !metric.bid_metric).map((metric) => <MetricBar key={metric.key} label={metric.label} value={selectedData.avgMetrics?.[metric.key]} higherBetter={metric.higher_is_better} neutral={metric.key === 'Workload' || metric.key === 'Rigor'} />)}
            </div>
            <div className="surface-card rounded-[22px] p-4">
              <h4 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted">Quick Stats</h4>
              {selectedData.avgMetrics?.Instructor_Rating != null && <div className="mb-3 rounded-2xl p-3" style={{ background: 'rgba(255,255,255,0.025)' }}><p className="text-[10px] uppercase tracking-wider text-muted">Instructor Rating</p><p className="text-xl font-bold" style={{ color: 'var(--accent-strong)' }}>{Math.round(selectedData.avgMetrics.Instructor_Rating)}%</p><p className="text-[10px] text-muted">global percentile average</p></div>}
              <div className="grid grid-cols-2 gap-2">{[{ key: 'Course_Rating', label: 'Course Rating', color: 'var(--success)' }, { key: 'Workload', label: 'Workload', color: 'var(--text-soft)' }, { key: 'Rigor', label: 'Rigor', color: 'var(--text-soft)' }, { key: 'Diverse Perspectives', label: 'Diverse Persp.', color: 'var(--text-soft)' }, { key: 'Feedback', label: 'Feedback', color: 'var(--text-soft)' }].map(({ key, label, color }) => selectedData.avgMetrics?.[key] != null && <div key={key} className="rounded-2xl p-2" style={{ background: 'rgba(255,255,255,0.025)' }}><p className="text-[10px] text-muted">{label}</p><p className="text-sm font-bold" style={{ color }}>{Math.round(selectedData.avgMetrics[key])}%</p></div>)}</div>
            </div>
          </div>

          <div className="surface-card rounded-[22px]">
            <div className="border-b px-4 py-3" style={{ borderColor: 'var(--line)' }}><h4 className="text-xs font-semibold uppercase tracking-wider text-muted">All Courses Taught ({profCourses.length})</h4></div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead><tr style={{ borderBottom: '1px solid rgba(243, 233, 226, 0.08)' }}>{['Year', 'Term', 'Course', 'Instructor %', 'Course %', 'Workload %', 'Rigor %', 'Diverse Persp.', 'N'].map((h) => <th key={h} className="whitespace-nowrap px-3 py-2 text-left font-medium text-muted">{h}</th>)}</tr></thead>
                <tbody>{profCourses.map((course, i) => <tr key={i} className="cursor-pointer transition-colors hover:bg-[rgba(255,255,255,0.02)]" style={{ borderBottom: '1px solid rgba(243, 233, 226, 0.05)' }} onClick={() => navigate(`/courses?id=${encodeURIComponent(course.id)}`)}><td className="px-3 py-2 text-label">{course.year}</td><td className="px-3 py-2 text-muted">{course.term}</td><td className="px-3 py-2"><span className="font-medium" style={{ color: 'var(--accent-strong)' }}>{course.course_code}</span><span className="ml-2 text-label">{course.course_name}</span></td><td className="px-3 py-2 font-medium" style={{ color: 'var(--accent-strong)' }}>{pct(course.metrics_pct?.Instructor_Rating)}</td><td className="px-3 py-2 text-label">{pct(course.metrics_pct?.Course_Rating)}</td><td className="px-3 py-2 text-label">{pct(course.metrics_pct?.Workload)}</td><td className="px-3 py-2 text-label">{pct(course.metrics_pct?.Rigor)}</td><td className="px-3 py-2 text-label">{pct(course.metrics_pct?.['Diverse Perspectives'])}</td><td className="px-3 py-2 text-muted">{course.n_respondents ?? '-'}</td></tr>)}</tbody>
              </table>
            </div>
          </div>

          <div className="app-footer mt-8">HKS Course Explorer by Michael Gritzbach VUS&apos;18, MPA&apos;26 - {new Date().getFullYear()}</div>
        </>}
      </main>
    </div>
  )
}
