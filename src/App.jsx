import posthog from 'posthog-js'
import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { NavLink, Route, Routes, useLocation } from 'react-router-dom'

// Hidden routes — not linked from nav, accessible by direct URL only
const ScheduleBuilder = lazy(() => import('./pages/ScheduleBuilder.jsx'))
const Requirements    = lazy(() => import('./pages/Requirements.jsx'))
const Admin           = lazy(() => import('./pages/Admin.jsx'))
import ChatBot from './components/ChatBot.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import LandingSplash from './components/LandingSplash.jsx'
import SkeletonCard from './components/SkeletonCard.jsx'
import { supabase } from './lib/supabase.js'
import Compare from './pages/Compare.jsx'
import Courses from './pages/Courses.jsx'
import Faculty from './pages/Faculty.jsx'
import Home from './pages/Home.jsx'
import NotFound from './pages/NotFound.jsx'
import Resources from './pages/Resources.jsx'
import { HKS_RESOURCES } from './resourceLinks.js'
import { useFavorites } from './useFavorites.js'
import { useNotes } from './useNotes.js'

// Static metric definitions — never change
const METRICS = [
  { key: 'Instructor_Rating',    label: 'Instructor Rating',    higher_is_better: true },
  { key: 'Course_Rating',        label: 'Course Rating',        higher_is_better: true },
  { key: 'Workload',             label: 'Workload',             higher_is_better: false },
  { key: 'Assignments',          label: 'Assignment Value',     higher_is_better: true },
  { key: 'Availability',         label: 'Availability',         higher_is_better: true },
  { key: 'Discussions',          label: 'Class Discussions',    higher_is_better: true },
  { key: 'Diverse Perspectives', label: 'Diverse Perspectives', higher_is_better: true },
  { key: 'Feedback',             label: 'Feedback',             higher_is_better: true },
  { key: 'Discussion Diversity', label: 'Discussion Diversity', higher_is_better: true },
  { key: 'Rigor',                label: 'Rigor',                higher_is_better: true },
  { key: 'Readings',             label: 'Readings',             higher_is_better: false },
  { key: 'Insights',             label: 'Insights',             higher_is_better: true },
  { key: 'Bid_Price',            label: 'Bid Price',            higher_is_better: false, bid_metric: true },
  { key: 'Bid_N_Bids',          label: 'Number of Bids',       higher_is_better: false, bid_metric: true },
]

const STORAGE_VERSION = 'v2'

function median(values) {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

async function fetchAllCourses(onProgress) {
  /*
   * Nullable schedule fields added 2026-04-26:
   * - meeting_days: text[] of short day codes such as ['Mon', 'Wed']
   * - meeting_time: start time in 24h HH:MM format
   * - meeting_time_end: end time in 24h HH:MM format
   */
  const PAGE = 1000
  let all = [], from = 0, done = false
  while (!done) {
    const { data, error } = await supabase
      .from('courses')
      .select('*')
      .range(from, from + PAGE - 1)
    if (error) throw error
    all = all.concat(data)
    done = data.length < PAGE
    from += PAGE
    if (onProgress) onProgress(all.length)
  }
  return all
}

function buildMeta(courses) {
  const concentrations = [...new Set(courses.map(c => c.concentration).filter(Boolean))].sort()
  const years = [...new Set(courses.map(c => c.year).filter(Boolean))].sort((a, b) => a - b)

  const allRatings = courses
    .filter(c => c.metrics_raw?.Instructor_Rating != null && !c.is_average)
    .map(c => c.metrics_raw.Instructor_Rating)
  const overall_median_instructor = median(allRatings)

  const byYear = {}
  courses.filter(c => c.year && c.metrics_raw?.Instructor_Rating != null && !c.is_average).forEach(c => {
    if (!byYear[c.year]) byYear[c.year] = []
    byYear[c.year].push(c.metrics_raw.Instructor_Rating)
  })
  const year_medians_instructor = Object.fromEntries(
    Object.entries(byYear).map(([yr, vals]) => [yr, median(vals)])
  )

  const evalYears = [...new Set(courses.filter(c => c.has_eval && !c.is_average && c.year).map(c => c.year))]
  const default_year = evalYears.length ? Math.max(...evalYears) : 2025

  return {
    concentrations,
    years,
    terms: ['Fall', 'Spring', 'January'],
    default_year,
    default_terms: ['Fall', 'Spring'],
    metrics: METRICS,
    overall_median_instructor,
    year_medians_instructor,
    academic_areas: [],
  }
}

function NavResourcesSection() {
  const [open, setOpen] = useState(false)
  return (
    <div style={{ borderTop: '1px solid var(--line)', marginTop: 8 }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="hks-resources-list"
        style={{
          display: 'flex',
          width: '100%',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '10px 16px',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
        }}
        className="transition-colors"
        onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--panel-subtle)' }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'none' }}
      >
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--gold)' }}>
          🔗 HKS Resources
        </span>
        <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div id="hks-resources-list" style={{ padding: '0 8px 8px' }}>
          {HKS_RESOURCES.map((section) => (
            <div key={section.group} style={{ marginBottom: 10 }}>
              <p style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--text-muted)', paddingLeft: 6, marginBottom: 2 }}>
                {section.group}
              </p>
              {section.links.map((link) => (
                <a
                  key={link.url}
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={link.auth ? `Requires ${link.auth}` : link.desc}
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '5px 8px', borderRadius: 8, textDecoration: 'none', gap: 4 }}
                  className="transition-colors"
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--panel-subtle)' }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = '' }}
                >
                  <span style={{ fontSize: 11, color: 'var(--text-soft)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{link.label}</span>
                  <span style={{ fontSize: 9, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0 }}>
                    {link.auth && <span>🔒</span>}
                    <span style={{ opacity: 0.45 }}>↗</span>
                  </span>
                </a>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

const TALLY_FORM_ID = 'LZYAQv'

export default function App() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [loadCount, setLoadCount] = useState(0)
  const [error, setError] = useState(null)
  const [retryKey, setRetryKey] = useState(0)
  const [simIndex, setSimIndex] = useState(null)
  const [theme, setTheme] = useState(() => {
    if (typeof window === 'undefined') return 'dark'
    const stored = window.localStorage.getItem('hks-theme')
    if (stored) return stored === 'hub' ? 'dark' : stored
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  })
  const [hubTheme, setHubTheme] = useState(() => {
    if (typeof window === 'undefined') return false
    return window.localStorage.getItem('hks-theme') === 'hub'
  })
  const [metricMode, setMetricModeState] = useState(() => {
    if (typeof window === 'undefined') return 'score'
    return window.localStorage.getItem('hks-metric-mode') || 'percentile'
  })
  const [colorblindMode, setColorblindModeState] = useState(() => {
    if (typeof window === 'undefined') return false
    return window.localStorage.getItem('hks-colorblind') === 'true'
  })
  const [shareCopied, setShareCopied] = useState(false)
  const favs = useFavorites()
  const { notes, setNote } = useNotes()
  const shareToastTimeoutRef = useRef(null)

  const setMetricMode = (mode) => {
    window.localStorage.setItem('hks-metric-mode', mode)
    posthog.capture('metric_mode_changed', { mode })
    setMetricModeState(mode)
  }
  const setColorblindMode = (val) => {
    window.localStorage.setItem('hks-colorblind', String(val))
    if (val) posthog.capture('colorblind_mode_enabled')
    setColorblindModeState(val)
  }

  useEffect(() => {
    const storedVersion = window.localStorage.getItem('hks_storage_version')
    if (storedVersion === STORAGE_VERSION) return

    window.localStorage.removeItem('hks_plan_A')
    window.localStorage.removeItem('hks_plan_B')
    window.localStorage.removeItem('hks_plan_C')
    window.localStorage.removeItem('hks_plan_D')
    window.localStorage.removeItem('hks_completed_courses')
    window.localStorage.setItem('hks_storage_version', STORAGE_VERSION)
  }, [])

  // Single source of truth for data-theme on <html>
  useEffect(() => {
    if (hubTheme) {
      document.documentElement.setAttribute('data-theme', 'hub')
      window.localStorage.setItem('hks-theme', 'hub')
    } else {
      document.documentElement.setAttribute('data-theme', theme)
      window.localStorage.setItem('hks-theme', theme)
    }
  }, [hubTheme, theme])

  useEffect(() => {
    return () => {
      if (shareToastTimeoutRef.current) clearTimeout(shareToastTimeoutRef.current)
    }
  }, [])

  useEffect(() => {
    fetch('/sim_coords.json')
      .then((r) => r.json())
      .then((coords) => {
        const map = new Map()
        for (const entry of coords) {
          map.set(entry.id, { sim_x: entry.sim_x, sim_y: entry.sim_y, course_code: entry.course_code, course_name: entry.course_name, professor_display: entry.professor_display, concentration: entry.concentration })
        }
        setSimIndex(map)
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    setLoading(true)
    setError(null)
    setLoadCount(0)
    fetchAllCourses((n) => setLoadCount(n))
      .then((courses) => {
        courses.forEach(c => {
          if (c.metrics_raw) {
            c.metrics_score = Object.fromEntries(
              Object.entries(c.metrics_raw).map(([k, v]) => [k, v != null ? Math.round(v / 5 * 100 * 10) / 10 : null])
            )
          }
        })
        setData({ courses, meta: buildMeta(courses) })
        setLoading(false)
      })
      .catch((err) => {
        setError(err.message)
        setLoading(false)
      })
  }, [retryKey])

  if (loading) {
    return (
      <div className="flex min-h-screen" style={{ background: 'transparent' }}>
        <aside
          className="hidden shrink-0 md:flex md:w-[178px] md:flex-col md:gap-4 md:px-3 md:py-4"
          style={{ background: 'var(--nav-shell)', borderRight: '1px solid var(--line)' }}
        >
          <div className="rounded-[22px] border px-4 pb-4 pt-5" style={{ borderColor: 'var(--line)', background: 'var(--panel-subtle)' }}>
            <div className="skeleton-shimmer mb-3 h-4" style={{ width: '60%' }} />
            <div className="skeleton-shimmer mb-2 h-8" style={{ width: '45%' }} />
            <div className="skeleton-shimmer h-3" style={{ width: '75%' }} />
          </div>
          {[0, 1, 2].map((index) => (
            <div
              key={index}
              className="skeleton-shimmer hidden rounded-[18px] md:block"
              style={{ height: 88 }}
            />
          ))}
        </aside>

        <div className="flex min-w-0 flex-1 flex-col px-4 py-6 md:px-6">
          <div className="mb-5">
            <div className="skeleton-shimmer mb-3 h-4" style={{ width: 140 }} />
            <div className="skeleton-shimmer mb-3 h-10 max-w-[420px]" />
            <div className="skeleton-shimmer h-4 max-w-[560px]" />
          </div>

          <div className="mb-4 flex items-center gap-3">
            <div className="spinner" />
            <div>
              <p className="text-sm font-medium" style={{ color: 'var(--text)' }}>Loading HKS Course Explorer</p>
              <p className="mt-1 text-xs" style={{ color: 'var(--text-muted)' }}>
                {loadCount > 0 ? `${loadCount.toLocaleString()} courses loaded…` : 'Connecting to database…'}
              </p>
            </div>
          </div>

          <div className="grid gap-4">
            {Array.from({ length: 5 }, (_, index) => (
              <SkeletonCard key={index} />
            ))}
          </div>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div
        className="flex h-screen flex-col items-center justify-center gap-4 px-8 text-center"
        style={{ background: 'transparent' }}
      >
        <p className="text-4xl" style={{ opacity: 0.3 }}>⚠</p>
        <p className="text-lg font-semibold" style={{ color: 'var(--danger)' }}>Failed to load course data</p>
        <p className="max-w-sm text-sm text-muted">
          {error}. Check your network connection and try again.
        </p>
        <button
          onClick={() => setRetryKey((k) => k + 1)}
          className="rounded-full px-5 py-2.5 text-sm font-semibold"
          style={{ background: 'var(--accent-soft)', color: 'var(--text)', border: '1px solid var(--line)' }}
        >
          ↺ Retry
        </button>
      </div>
    )
  }

  // All nav destinations — some filtered per context
  // label = used on desktop sidebar; mobileLabel = short label for mobile bottom nav
  const allNavItems = [
    { to: '/',                 label: 'Home',             mobileLabel: 'Home',      icon: '⌂',  end: true },
    { to: '/courses',          label: 'Courses',          mobileLabel: 'Courses',   icon: '📖' },
    { to: '/faculty',          label: 'Faculty',          mobileLabel: 'Faculty',   icon: '👤' },
    { to: '/compare',          label: 'Compare',          mobileLabel: 'Compare',   icon: '⚖' },
    { to: '/schedule-builder', label: 'Schedule Builder', mobileLabel: 'Schedule',  icon: '🗓',  desktopOnly: true },
    { to: '/requirements',     label: 'Requirements',     mobileLabel: 'Req.',      icon: '✅',  desktopOnly: true },
    { to: '/resources',        label: 'Resources',        mobileLabel: 'Resources', icon: '🔗',  mobileOnly: true },
  ]

  // Mobile bottom nav uses all non-desktopOnly items
  const mobileNavItems = allNavItems.filter(item => !item.desktopOnly)

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark'
    posthog.capture('theme_switched', { theme: next })
    setTheme(next)
    if (hubTheme) setHubTheme(false) // switching dark/light exits hub mode
  }

  const toggleHubTheme = () => {
    posthog.capture('hub_theme_toggled', { hub: !hubTheme })
    setHubTheme(v => !v)
  }

  const handleShareShortlist = async () => {
    try {
      const favsParam = [...(favs?.favorites || [])].join(',')
      const shareUrl = favsParam
        ? `${window.location.origin}/?favs=${encodeURIComponent(favsParam)}`
        : window.location.origin + '/'
      await navigator.clipboard.writeText(shareUrl)
      posthog.capture('shortlist_shared', { course_count: favs?.count || 0 })
      setShareCopied(true)
      if (shareToastTimeoutRef.current) clearTimeout(shareToastTimeoutRef.current)
      shareToastTimeoutRef.current = setTimeout(() => setShareCopied(false), 1800)
    } catch {}
  }

  const handleExportShortlist = () => {
    if (!data?.courses || !favs?.count) return
    const starred = data.courses.filter((c) => !c.is_average && favs.isFavorite(c.course_code_base))
    const seen = new Set()
    const deduped = starred.filter((c) => {
      const code = c.course_code_base || c.course_code
      if (seen.has(code)) return false
      seen.add(code)
      return true
    })
    const headers = ['Code', 'Title', 'Instructor', 'Year', 'Term', 'Concentration', 'Core', 'STEM', 'Instructor %', 'Course %', 'Workload %', 'N Respondents', 'Last Bid Price', 'Note']
    const rows = deduped.map((c) => {
      const note = notes[c.course_code_base] || ''
      return [
        c.course_code || '',
        (c.course_name || '').replace(/,/g, ';'),
        (c.professor_display || c.professor || '').replace(/,/g, ';'),
        c.year || '',
        c.term || '',
        c.concentration || '',
        c.is_core ? 'Yes' : 'No',
        c.is_stem ? (c.stem_group ? `STEM ${c.stem_group}` : 'Yes') : 'No',
        c.metrics_pct?.Instructor_Rating != null ? Math.round(c.metrics_pct.Instructor_Rating) : '',
        c.metrics_pct?.Course_Rating != null ? Math.round(c.metrics_pct.Course_Rating) : '',
        c.metrics_pct?.Workload != null ? Math.round(c.metrics_pct.Workload) : '',
        c.n_respondents ?? '',
        c.last_bid_price ?? '',
        note.replace(/,/g, ';').replace(/\n/g, ' '),
      ].join(',')
    })
    const csv = [headers.join(','), ...rows].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `hks-shortlist-${new Date().toISOString().slice(0, 10)}.csv`
    a.style.display = 'none'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    setTimeout(() => URL.revokeObjectURL(url), 100)
    posthog.capture('shortlist_exported_csv', { course_count: deduped.length })
  }

  // ─── Shared page routes ────────────────────────────────────────────────────
  const pageRoutes = (
    <ErrorBoundary>
      <Suspense fallback={<div style={{ padding: 40, color: 'var(--text-muted)', textAlign: 'center', fontSize: 14 }}>Loading…</div>}>
        <Routes>
          <Route path="/"        element={<Home    courses={data.courses} meta={data.meta} favs={favs} metricMode={metricMode} setMetricMode={setMetricMode} colorblindMode={colorblindMode} setColorblindMode={setColorblindMode} notes={notes} setNote={setNote} isLight={theme === 'light'} />} />
          <Route path="/courses" element={<Courses courses={data.courses} meta={data.meta} favs={favs} metricMode={metricMode} setMetricMode={setMetricMode} simIndex={simIndex} notes={notes} setNote={setNote} />} />
          <Route path="/faculty" element={<Faculty courses={data.courses} meta={data.meta} favs={favs} metricMode={metricMode} setMetricMode={setMetricMode} />} />
          <Route path="/compare" element={<Compare courses={data.courses} meta={data.meta} favs={favs} metricMode={metricMode} setMetricMode={setMetricMode} />} />
          <Route path="/resources" element={<Resources />} />
          <Route path="/schedule-builder" element={<ScheduleBuilder courses={data?.courses || []} meta={data?.meta} />} />
          <Route path="/requirements"     element={<Requirements courses={data?.courses || []} />} />
          <Route path="/admin"            element={<Admin />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
    </ErrorBoundary>
  )

  // ─── Shared mobile bottom nav ──────────────────────────────────────────────
  const mobileBottomNav = (
    <nav
      aria-label="Mobile navigation"
      className="fixed inset-x-0 bottom-0 z-40 border-t px-3 pt-3 md:hidden"
      style={{
        background: 'var(--nav-shell)',
        borderColor: 'var(--line)',
        backdropFilter: 'blur(20px)',
        paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 0.75rem)',
      }}
    >
      {favs.count > 0 && (
        <div className="mx-auto mb-2 flex max-w-md justify-center gap-2">
          <button type="button" onClick={handleShareShortlist} className="theme-toggle" style={{ minHeight: 44 }}>
            {shareCopied ? '✓ Copied!' : `🔗 Share (${favs.count})`}
          </button>
          <button type="button" onClick={handleExportShortlist} className="theme-toggle" style={{ minHeight: 44 }}>
            ⬇ CSV
          </button>
        </div>
      )}
      <div className="mx-auto flex max-w-md gap-1 rounded-[24px] border p-1.5 shadow-[0_-12px_28px_rgba(0,0,0,0.28)]" style={{ borderColor: 'var(--line)', background: 'var(--nav-shell-strong)' }}>
        {mobileNavItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            aria-label={item.label}
            className={({ isActive }) =>
              `flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-[18px] px-1 py-2.5 transition-colors ${isActive ? 'text-white' : 'text-label'}`
            }
            style={({ isActive }) => ({
              minHeight: 52,
              background: isActive ? 'linear-gradient(180deg, rgba(165, 28, 48, 0.28), rgba(165, 28, 48, 0.12))' : 'transparent',
              border: `1px solid ${isActive ? 'rgba(212, 168, 106, 0.18)' : 'transparent'}`,
            })}
          >
            <span className="text-base leading-none" aria-hidden="true">{item.icon}</span>
            <span className="text-[9px] font-semibold leading-tight tracking-[0.02em]">{item.mobileLabel || item.label}</span>
          </NavLink>
        ))}
      </div>
    </nav>
  )

  // ─── Shared mobile top header ──────────────────────────────────────────────
  const mobileTopHeader = (
    <header
      className="sticky top-0 z-30 border-b md:hidden"
      style={{
        background: 'var(--nav-shell)',
        borderColor: 'var(--line)',
        backdropFilter: 'blur(18px)',
        paddingTop: 'calc(env(safe-area-inset-top, 0px) + 10px)',
        paddingBottom: 10,
        paddingLeft: 16,
        paddingRight: 16,
      }}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div style={{ width: 28, height: 28, background: 'var(--accent)', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <span style={{ color: '#fff', fontSize: 13, fontWeight: 800, fontFamily: 'Georgia, serif' }}>H</span>
          </div>
          <div>
            <p className="text-sm font-bold leading-none" style={{ color: 'var(--text)', fontFamily: 'Georgia, serif' }}>HKS Course Explorer</p>
            <p className="mt-0.5 text-[10px] leading-none" style={{ color: 'var(--text-muted)' }}>Independent student tool</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <button type="button" onClick={toggleTheme} className="theme-toggle" style={{ padding: '5px 10px', fontSize: 10, minHeight: 32 }}>
            {theme === 'dark' ? '☀ Light' : '● Dark'}
          </button>
          <a
            href="/user-guide.html"
            target="_blank"
            rel="noopener noreferrer"
            className="theme-toggle"
            aria-label="Open user guide"
            style={{ textDecoration: 'none', padding: '5px 10px', fontSize: 10, minHeight: 32 }}
          >
            <span aria-hidden="true">ⓘ</span>
          </a>
          {TALLY_FORM_ID !== 'YOUR_FORM_ID' && (
            <button
              type="button"
              data-tally-open={TALLY_FORM_ID}
              data-tally-width="400"
              data-tally-overlay="1"
              data-tally-emoji-text="🐛"
              data-tally-emoji-animation="wave"
              className="theme-toggle"
              aria-label="Open feedback form"
              style={{ padding: '5px 10px', fontSize: 10, minHeight: 32 }}
            >
              <span aria-hidden="true">🐛</span>
            </button>
          )}
        </div>
      </div>
    </header>
  )

  // ══════════════════════════════════════════════════════════════════════════
  // HUB MODE — top navigation bar, no left sidebar
  // ══════════════════════════════════════════════════════════════════════════
  if (hubTheme) {
    return (
      <div className="flex h-screen flex-col" style={{ background: 'var(--bg)' }}>
        <LandingSplash />
        {data && <ChatBot courses={data.courses} favs={favs} isLight={true} />}

        {/* Hub desktop top nav bar */}
        <header
          className="hidden md:flex shrink-0 items-center gap-0 border-b"
          style={{
            height: 60,
            background: 'var(--nav-shell)',
            borderColor: 'var(--line)',
            boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
          }}
        >
          {/* Logo */}
          <div className="flex shrink-0 items-center gap-0 border-r" style={{ height: '100%', borderColor: 'var(--line)', minWidth: 180 }}>
            <a href="/" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '0 20px', height: '100%', textDecoration: 'none' }}>
              {/* Shield icon */}
              <div style={{ width: 32, height: 32, background: 'var(--accent)', borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <span style={{ color: '#fff', fontSize: 14, fontWeight: 800, fontFamily: 'Georgia, serif', letterSpacing: '-0.02em' }}>H</span>
              </div>
              <div>
                <p style={{ fontSize: 15, fontWeight: 700, fontFamily: 'Georgia, serif', color: 'var(--accent)', letterSpacing: '-0.01em', lineHeight: 1.1 }}>HKS</p>
                <p style={{ fontSize: 9, fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--text-muted)', lineHeight: 1 }}>Course Explorer</p>
              </div>
            </a>
          </div>

          {/* Nav links — horizontal, hub style */}
          <nav
            aria-label="Main navigation"
            className="flex h-full items-stretch"
          >
            {allNavItems.filter(item => !item.mobileOnly).map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) => `hub-nav-link${isActive ? ' hub-active' : ''}`}
              >
                {item.label}
              </NavLink>
            ))}
          </nav>

          {/* Actions — right side */}
          <div className="ml-auto flex items-center gap-1.5 px-4">
            {favs.count > 0 && (
              <>
                <button
                  type="button"
                  onClick={handleShareShortlist}
                  className="hub-action-btn"
                  style={{ background: 'var(--accent-soft)', borderColor: 'var(--accent)', color: 'var(--accent)' }}
                >
                  {shareCopied ? '✓ Copied!' : `🔗 Share (${favs.count})`}
                </button>
                <button
                  type="button"
                  onClick={handleExportShortlist}
                  className="hub-action-btn"
                >
                  ⬇ CSV
                </button>
                <div className="hub-action-divider" />
              </>
            )}
            <a
              href="/user-guide.html"
              target="_blank"
              rel="noopener noreferrer"
              className="hub-action-btn"
              style={{ textDecoration: 'none' }}
            >
              ⓘ Guide
            </a>
            {TALLY_FORM_ID !== 'YOUR_FORM_ID' && (
              <button
                type="button"
                data-tally-open={TALLY_FORM_ID}
                data-tally-width="400"
                data-tally-overlay="1"
                data-tally-emoji-text="🐛"
                data-tally-emoji-animation="wave"
                className="hub-action-btn"
              >
                Feedback
              </button>
            )}
            <div className="hub-action-divider" />
            <button
              type="button"
              onClick={toggleHubTheme}
              className="hub-action-btn hub-action-primary"
            >
              ← Classic View
            </button>
          </div>
        </header>

        {/* Mobile header (hub mode on mobile looks the same) */}
        {mobileTopHeader}

        {/* Page content — full width, no left bar */}
        <main className="min-h-0 flex-1 overflow-hidden pb-24 md:pb-0">
          {pageRoutes}
        </main>

        {mobileBottomNav}
      </div>
    )
  }

  // ══════════════════════════════════════════════════════════════════════════
  // CLASSIC MODE — left sidebar navigation
  // ══════════════════════════════════════════════════════════════════════════
  return (
    <div className="flex min-h-screen md:h-screen" style={{ background: 'transparent' }}>
      <LandingSplash />
      {data && <ChatBot courses={data.courses} favs={favs} isLight={theme === 'light'} />}

      {/* Desktop sidebar nav */}
      <nav
        aria-label="Main navigation"
        className="hidden shrink-0 flex-col px-3 py-4 md:flex"
        style={{
          width: 178,
          background: 'var(--nav-shell)',
          borderRight: '1px solid var(--line)',
          backdropFilter: 'blur(18px)',
        }}
      >
        {/* Brand block */}
        <div className="mb-4 rounded-[22px] border px-4 pb-4 pt-5" style={{ borderColor: 'var(--line)', background: 'linear-gradient(180deg, rgba(165, 28, 48, 0.14), var(--panel-subtle))' }}>
          <p className="kicker">Harvard-inspired</p>
          <p className="serif-display mt-2 text-2xl font-semibold" style={{ color: 'var(--text)' }}>HKS</p>
          <p className="text-xs" style={{ color: 'var(--text-soft)' }}>Course Explorer</p>
          <p className="mt-3 text-[11px] leading-5" style={{ color: 'var(--text-muted)' }}>
            Crafted independently for Harvard Kennedy School students.
          </p>
          <button type="button" onClick={toggleTheme} className="theme-toggle mt-4">
            {theme === 'dark' ? 'Light Mode' : 'Dark Mode'}
          </button>
          <a
            href="/user-guide.html"
            target="_blank"
            rel="noopener noreferrer"
            className="theme-toggle mt-2 block text-center"
            style={{ textDecoration: 'none' }}
          >
            ⓘ User Guide
          </a>
          {TALLY_FORM_ID !== 'YOUR_FORM_ID' && (
            <button
              type="button"
              data-tally-open={TALLY_FORM_ID}
              data-tally-width="400"
              data-tally-overlay="1"
              data-tally-emoji-text="🐛"
              data-tally-emoji-animation="wave"
              className="theme-toggle mt-2 w-full"
            >
              🐛 Feedback
            </button>
          )}
        </div>

        {/* Primary nav links */}
        {allNavItems.filter((item) => !item.mobileOnly).map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              `mx-2 rounded-2xl px-4 py-3 text-sm transition-colors ${isActive ? 'text-white' : 'text-label hover:text-white'}`
            }
            style={({ isActive }) => ({
              background: isActive ? 'linear-gradient(180deg, rgba(165, 28, 48, 0.22), rgba(165, 28, 48, 0.09))' : 'transparent',
              border: `1px solid ${isActive ? 'rgba(212, 168, 106, 0.26)' : 'transparent'}`,
              boxShadow: isActive ? '0 14px 30px rgba(165, 28, 48, 0.16)' : 'none',
            })}
          >
            {item.label}
          </NavLink>
        ))}

        <NavResourcesSection />

        {/* Bottom section: shortlist actions + hub toggle */}
        <div className="mt-auto flex flex-col gap-1 px-1 pb-1">
          {favs.count > 0 && (
            <>
              <button type="button" onClick={handleShareShortlist} className="theme-toggle" style={{ width: '100%' }}>
                {shareCopied ? '✓ Copied!' : `🔗 Share Shortlist (${favs.count})`}
              </button>
              <button type="button" onClick={handleExportShortlist} className="theme-toggle" style={{ width: '100%' }}>
                ⬇ Export CSV
              </button>
            </>
          )}
          <button
            type="button"
            onClick={toggleHubTheme}
            className="theme-toggle"
            style={{ width: '100%', opacity: 0.7 }}
          >
            🏛 HUB Style
          </button>
        </div>
      </nav>

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {mobileTopHeader}

        <main className="min-h-0 flex-1 overflow-hidden pb-24 md:pb-0">
          {pageRoutes}
        </main>

        {mobileBottomNav}
      </div>
    </div>
  )
}
