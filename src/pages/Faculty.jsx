import { useState, useMemo, useEffect } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'

function pct(v) {
  return v != null ? `${Math.round(v)}%` : '—'
}

function MetricBar({ label, value, higherBetter = true }) {
  if (value == null) return null
  const v = Math.round(value)
  const color = higherBetter
    ? v >= 75 ? '#22c55e' : v >= 50 ? '#facc15' : '#ef4444'
    : v <= 25 ? '#22c55e' : v <= 50 ? '#facc15' : '#ef4444'
  return (
    <div className="mb-1.5">
      <div className="flex justify-between text-xs mb-0.5">
        <span className="text-muted">{label}</span>
        <span className="font-medium text-label">{v}%</span>
      </div>
      <div className="w-full rounded-full h-1" style={{ background: '#2a2a3e' }}>
        <div className="h-1 rounded-full" style={{ width: `${v}%`, background: color }} />
      </div>
    </div>
  )
}

const SORT_OPTIONS = [
  { value: 'name_asc',          label: 'Name A–Z' },
  { value: 'rating_desc',       label: 'Instructor Rating ↓' },
  { value: 'course_rating_desc',label: 'Course Rating ↓' },
  { value: 'courses_desc',      label: 'Most Courses ↓' },
  { value: 'respondents_desc',  label: 'Most Respondents ↓' },
]

export default function Faculty({ courses, meta }) {
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()

  const [query,        setQuery]        = useState('')
  const [selectedProf, setSelectedProf] = useState(searchParams.get('prof') || null)

  // Filter + sort state
  const [concentration, setConcentration] = useState('All')
  const [minRating,     setMinRating]     = useState('any')   // 'any' | '50' | '75' | '90'
  const [minCourses,    setMinCourses]    = useState('any')   // 'any' | '3' | '5' | '10'
  const [sortBy,        setSortBy]        = useState('name_asc')

  useEffect(() => {
    const prof = searchParams.get('prof')
    if (prof) setSelectedProf(prof)
  }, [searchParams])

  useEffect(() => {
    document.title = 'HKS Faculty Explorer'
  }, [])

  // ── Build professor registry ────────────────────────────────────────────────
  const allProfessors = useMemo(() => {
    const map = new Map()
    for (const c of courses) {
      if (!c.professor || c.is_average) continue
      const key = c.professor
      if (!map.has(key)) {
        map.set(key, {
          professor:         key,
          professor_display: c.professor_display || key,
          faculty_title:     c.faculty_title,
          faculty_category:  c.faculty_category,
          gender:            c.gender,
          courses:           [],
          evalCourses:       0,
          totalRespondents:  0,
          concentrationSet:  new Set(),
          sumMetrics:        {},
          cntMetrics:        {},
        })
      }
      const entry = map.get(key)
      entry.courses.push(c)
      if (c.concentration) entry.concentrationSet.add(c.concentration)
      if (c.has_eval && !c.is_average) {
        entry.evalCourses++
        entry.totalRespondents += c.n_respondents || 0
        for (const m of meta.metrics) {
          const v = c.metrics_pct?.[m.key]
          if (v != null) {
            const w = c.n_respondents || 1
            entry.sumMetrics[m.key] = (entry.sumMetrics[m.key] || 0) + v * w
            entry.cntMetrics[m.key] = (entry.cntMetrics[m.key] || 0) + w
          }
        }
      }
    }

    return [...map.values()]
      .filter(p => p.evalCourses > 0)
      .map(p => ({
        ...p,
        concentrations: [...p.concentrationSet].sort(),
        avgMetrics: Object.fromEntries(
          meta.metrics.map(m => [
            m.key,
            p.cntMetrics[m.key]
              ? Math.round(p.sumMetrics[m.key] / p.cntMetrics[m.key] * 10) / 10
              : null,
          ])
        ),
      }))
  }, [courses, meta.metrics])

  // ── Filter + sort ───────────────────────────────────────────────────────────
  const displayedProfs = useMemo(() => {
    const minRatingN  = minRating  !== 'any' ? parseFloat(minRating)  : null
    const minCoursesN = minCourses !== 'any' ? parseInt(minCourses)   : null

    let list = allProfessors.filter(p => {
      if (query) {
        const q = query.toLowerCase()
        if (!(p.professor_display || '').toLowerCase().includes(q) &&
            !(p.professor || '').toLowerCase().includes(q)) return false
      }
      if (concentration !== 'All' && !p.concentrations.includes(concentration)) return false
      if (minRatingN  !== null && (p.avgMetrics?.Instructor_Rating ?? -1) < minRatingN)  return false
      if (minCoursesN !== null && p.evalCourses < minCoursesN) return false
      return true
    })

    switch (sortBy) {
      case 'rating_desc':
        list.sort((a, b) => {
          const av = a.avgMetrics?.Instructor_Rating ?? -1
          const bv = b.avgMetrics?.Instructor_Rating ?? -1
          return bv - av
        })
        break
      case 'course_rating_desc':
        list.sort((a, b) => {
          const av = a.avgMetrics?.Course_Rating ?? -1
          const bv = b.avgMetrics?.Course_Rating ?? -1
          return bv - av
        })
        break
      case 'courses_desc':
        list.sort((a, b) => b.evalCourses - a.evalCourses)
        break
      case 'respondents_desc':
        list.sort((a, b) => b.totalRespondents - a.totalRespondents)
        break
      default: // name_asc
        list.sort((a, b) => (a.professor_display || '').localeCompare(b.professor_display || ''))
    }

    return list
  }, [allProfessors, query, concentration, minRating, minCourses, sortBy])

  // ── Selected professor ──────────────────────────────────────────────────────
  const selectedData = useMemo(() =>
    selectedProf ? allProfessors.find(p => p.professor === selectedProf) || null : null,
    [allProfessors, selectedProf]
  )

  const profCourses = useMemo(() => {
    if (!selectedData) return []
    return selectedData.courses
      .filter(c => c.has_eval && !c.is_average)
      .sort((a, b) => (b.year || 0) - (a.year || 0) || (a.term || '').localeCompare(b.term || ''))
  }, [selectedData])

  const handleSelectProf = (p) => {
    setSelectedProf(p.professor)
    setSearchParams({ prof: p.professor })
  }

  const resetFilters = () => {
    setConcentration('All')
    setMinRating('any')
    setMinCourses('any')
    setSortBy('name_asc')
    setQuery('')
  }

  const activeFilters = (concentration !== 'All' ? 1 : 0)
    + (minRating !== 'any' ? 1 : 0)
    + (minCourses !== 'any' ? 1 : 0)

  return (
    <div className="flex h-full overflow-hidden">

      {/* ── Left panel: list + filters ── */}
      <aside
        className="flex flex-col overflow-hidden shrink-0"
        style={{ width: 280, background: '#151521', borderRight: '1px solid #2a2a3e' }}
      >
        {/* Header + search */}
        <div className="px-4 pt-4 pb-2 shrink-0 border-b border-[#2a2a3e]">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-semibold" style={{ color: '#38bdf8' }}>👩‍🏫 Faculty Explorer</p>
            {activeFilters > 0 && (
              <button
                onClick={resetFilters}
                className="text-[10px] text-muted hover:text-label transition-colors"
              >
                🔄 Reset ({activeFilters})
              </button>
            )}
          </div>
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search by name…"
            className="w-full mb-2"
            style={{ fontSize: 12 }}
          />

          {/* Sort */}
          <div className="mb-2">
            <p className="text-[10px] text-muted mb-1 uppercase tracking-wider">Sort</p>
            <div className="select-wrap">
              <select
                value={sortBy}
                onChange={e => setSortBy(e.target.value)}
                style={{ fontSize: 11, padding: '3px 24px 3px 6px' }}
              >
                {SORT_OPTIONS.map(o => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Concentration filter */}
          <div className="mb-2">
            <p className="text-[10px] text-muted mb-1 uppercase tracking-wider">Concentration</p>
            <div className="select-wrap">
              <select
                value={concentration}
                onChange={e => setConcentration(e.target.value)}
                style={{ fontSize: 11, padding: '3px 24px 3px 6px' }}
              >
                <option value="All">All</option>
                {meta.concentrations.map(c => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Min instructor rating */}
          <div className="mb-2">
            <p className="text-[10px] text-muted mb-1 uppercase tracking-wider">Min Instructor Rating</p>
            <div className="select-wrap">
              <select
                value={minRating}
                onChange={e => setMinRating(e.target.value)}
                style={{ fontSize: 11, padding: '3px 24px 3px 6px' }}
              >
                <option value="any">Any</option>
                <option value="90">Top 10% (≥90%)</option>
                <option value="75">Top 25% (≥75%)</option>
                <option value="50">Top 50% (≥50%)</option>
              </select>
            </div>
          </div>

          {/* Min courses */}
          <div className="mb-3">
            <p className="text-[10px] text-muted mb-1 uppercase tracking-wider">Min Courses Taught</p>
            <div className="select-wrap">
              <select
                value={minCourses}
                onChange={e => setMinCourses(e.target.value)}
                style={{ fontSize: 11, padding: '3px 24px 3px 6px' }}
              >
                <option value="any">Any</option>
                <option value="3">≥ 3 courses</option>
                <option value="5">≥ 5 courses</option>
                <option value="10">≥ 10 courses</option>
                <option value="20">≥ 20 courses</option>
              </select>
            </div>
          </div>

          <p className="text-[10px] text-muted">
            {displayedProfs.length} of {allProfessors.length} instructor{allProfessors.length !== 1 ? 's' : ''}
          </p>
        </div>

        {/* Professor list */}
        <div className="flex-1 overflow-y-auto">
          {displayedProfs.map(p => {
            const avgInstr = p.avgMetrics?.Instructor_Rating
            const isSelected = selectedProf === p.professor
            return (
              <button
                key={p.professor}
                onClick={() => handleSelectProf(p)}
                className="w-full text-left px-4 py-2.5 transition-colors border-b border-[#1e1e2e] hover:bg-[#1e1e2e]"
                style={{
                  background: isSelected ? '#2a2a3e' : undefined,
                  borderLeft: isSelected ? '3px solid #38bdf8' : '3px solid transparent',
                }}
              >
                <p className="text-xs font-medium text-label leading-tight">{p.professor_display}</p>
                <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                  <span className="text-[10px] text-muted">
                    {p.evalCourses} course{p.evalCourses !== 1 ? 's' : ''}
                  </span>
                  {avgInstr != null && (
                    <span
                      className="text-[10px] font-medium px-1 rounded"
                      style={{
                        background: avgInstr >= 75 ? '#14532d' : avgInstr >= 50 ? '#422006' : '#450a0a',
                        color:      avgInstr >= 75 ? '#4ade80' : avgInstr >= 50 ? '#fb923c' : '#f87171',
                      }}
                    >
                      {Math.round(avgInstr)}% instr.
                    </span>
                  )}
                  {p.concentrations.length > 0 && (
                    <span className="text-[10px] text-muted">{p.concentrations.join(', ')}</span>
                  )}
                </div>
              </button>
            )
          })}
          {displayedProfs.length === 0 && (
            <p className="px-4 py-6 text-xs text-muted text-center">No instructors match the current filters.</p>
          )}
        </div>
      </aside>

      {/* ── Right panel: detail ── */}
      <main className="flex-1 overflow-y-auto px-8 py-6">

        {!selectedData && (
          <div className="flex flex-col items-center justify-center h-full text-center" style={{ paddingBottom: 80 }}>
            <p className="text-4xl mb-4">👩‍🏫</p>
            <p className="text-label font-medium mb-2">Select an instructor</p>
            <p className="text-xs text-muted">
              Browse {allProfessors.length} instructors on the left, or click any instructor name anywhere in the app.
            </p>
          </div>
        )}

        {selectedData && (
          <>
            {/* Header */}
            <div className="mb-6">
              <h2 className="text-2xl font-bold text-white mb-1">{selectedData.professor_display}</h2>
              {selectedData.faculty_title && (
                <p className="text-sm text-muted">{selectedData.faculty_title}</p>
              )}
              {selectedData.faculty_category && (
                <p className="text-xs text-muted">{selectedData.faculty_category}</p>
              )}
              {selectedData.concentrations.length > 0 && (
                <div className="flex gap-1 mt-2 flex-wrap">
                  {selectedData.concentrations.map(c => (
                    <span
                      key={c}
                      className="text-[10px] font-medium px-1.5 py-0.5 rounded"
                      style={{ background: '#1e2a4a', color: '#93c5fd' }}
                    >
                      {c}
                    </span>
                  ))}
                </div>
              )}
              <div className="flex gap-4 mt-3 text-xs text-muted flex-wrap">
                <span>📚 {selectedData.evalCourses} course{selectedData.evalCourses !== 1 ? 's' : ''} with evals</span>
                {selectedData.totalRespondents > 0 && (
                  <span>👥 {selectedData.totalRespondents} total respondents</span>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 mb-6">
              {/* Avg metrics panel */}
              <div className="rounded-lg p-4" style={{ background: '#1a1a28', border: '1px solid #2a2a3e' }}>
                <h4 className="text-xs font-semibold text-muted uppercase tracking-wider mb-3">
                  Average Ratings (weighted by respondents)
                </h4>
                {meta.metrics.filter(m => !m.bid_metric).map(m => (
                  <MetricBar
                    key={m.key}
                    label={m.label}
                    value={selectedData.avgMetrics?.[m.key]}
                    higherBetter={m.higher_is_better}
                  />
                ))}
              </div>

              {/* Quick stats */}
              <div className="rounded-lg p-4" style={{ background: '#1a1a28', border: '1px solid #2a2a3e' }}>
                <h4 className="text-xs font-semibold text-muted uppercase tracking-wider mb-3">Quick Stats</h4>
                {(() => {
                  const s = selectedData.avgMetrics
                  return (
                    <div className="space-y-3">
                      {s?.Instructor_Rating != null && (
                        <div className="p-3 rounded" style={{ background: '#13131f' }}>
                          <p className="text-[10px] text-muted uppercase tracking-wider">Instructor Rating</p>
                          <p className="text-xl font-bold" style={{ color: '#38bdf8' }}>{Math.round(s.Instructor_Rating)}%</p>
                          <p className="text-[10px] text-muted">global percentile avg</p>
                        </div>
                      )}
                      <div className="grid grid-cols-2 gap-2">
                        {[
                          { key: 'Course_Rating',        label: 'Course Rating',     color: '#86efac' },
                          { key: 'Workload',             label: 'Workload',          color: '#c0c0d8' },
                          { key: 'Rigor',                label: 'Rigor',             color: '#c0c0d8' },
                          { key: 'Diverse Perspectives', label: 'Diverse Persp.',    color: '#c0c0d8' },
                          { key: 'Feedback',             label: 'Feedback',          color: '#c0c0d8' },
                        ].map(({ key, label, color }) => s?.[key] != null && (
                          <div key={key} className="p-2 rounded" style={{ background: '#13131f' }}>
                            <p className="text-[10px] text-muted">{label}</p>
                            <p className="text-sm font-bold" style={{ color }}>{Math.round(s[key])}%</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )
                })()}
              </div>
            </div>

            {/* Course history table */}
            <div className="rounded-lg" style={{ background: '#1a1a28', border: '1px solid #2a2a3e' }}>
              <div className="px-4 py-3 border-b border-[#2a2a3e]">
                <h4 className="text-xs font-semibold text-muted uppercase tracking-wider">
                  All Courses Taught ({profCourses.length})
                </h4>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr style={{ borderBottom: '1px solid #2a2a3e' }}>
                      {['Year', 'Term', 'Course', 'Instructor %', 'Course %', 'Workload %', 'Rigor %', 'Diverse Persp.', 'N'].map(h => (
                        <th key={h} className="text-left py-2 px-3 text-muted font-medium whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {profCourses.map((c, i) => (
                      <tr
                        key={i}
                        className="hover:bg-[#1e1e2e] cursor-pointer transition-colors"
                        style={{ borderBottom: '1px solid #1a1a28' }}
                        onClick={() => navigate(`/courses?id=${encodeURIComponent(c.id)}`)}
                      >
                        <td className="py-1.5 px-3 text-label">{c.year}</td>
                        <td className="py-1.5 px-3 text-muted">{c.term}</td>
                        <td className="py-1.5 px-3">
                          <span className="font-medium" style={{ color: '#38bdf8' }}>{c.course_code}</span>
                          <span className="text-label ml-2">{c.course_name}</span>
                        </td>
                        <td className="py-1.5 px-3 font-medium" style={{ color: '#38bdf8' }}>
                          {pct(c.metrics_pct?.Instructor_Rating)}
                        </td>
                        <td className="py-1.5 px-3 text-label">{pct(c.metrics_pct?.Course_Rating)}</td>
                        <td className="py-1.5 px-3 text-label">{pct(c.metrics_pct?.Workload)}</td>
                        <td className="py-1.5 px-3 text-label">{pct(c.metrics_pct?.Rigor)}</td>
                        <td className="py-1.5 px-3 text-label">{pct(c.metrics_pct?.['Diverse Perspectives'])}</td>
                        <td className="py-1.5 px-3 text-muted">{c.n_respondents ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="app-footer mt-8">
              Data from HKS QReports · {new Date().getFullYear()}
            </div>
          </>
        )}
      </main>
    </div>
  )
}
