import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { NavLink, Route, Routes, useLocation } from 'react-router-dom'
import config from './school.config.js'

// Hidden routes — not linked from nav, accessible by direct URL only
const ScheduleBuilder = lazy(() => import('./pages/ScheduleBuilder.jsx'))
const Admin = lazy(() => import('./pages/Admin.jsx'))
import ChatBot from './components/ChatBot.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import SkeletonCard from './components/SkeletonCard.jsx'
import SupportProjectPrompt from './components/SupportProjectPrompt.jsx'
import WelcomeHome from './components/WelcomeHome.jsx'
import { useWelcomeEntry } from './components/WelcomeEntryProvider.jsx'
import { COURSES_CACHE_KEY, STORAGE_VERSION, TALLY_FORM_ID } from './lib/appConstants.js'
import { buildCourseMeta } from './lib/courseMeta.js'
import { csvCell } from './lib/csvExport.js'
import { fetchAllCoursesWithCache } from './lib/courseDataCache.js'
import { capture } from './lib/analytics.js'
import { buildCatalogueReadyProperties } from './lib/performanceTelemetry.js'
import {
  DESKTOP_NAV_ITEMS,
  MOBILE_MORE_NAV_ITEMS,
  MOBILE_PRIMARY_NAV_ITEMS,
} from './lib/visitorNavigation.js'
import NotFound from './pages/NotFound.jsx'
import { HKS_RESOURCES } from './resourceLinks.js'
import { useFavorites } from './useFavorites.js'
import { useNotes } from './useNotes.js'
const Compare = lazy(() => import('./pages/Compare.jsx'))
const Courses = lazy(() => import('./pages/Courses.jsx'))
const Faculty = lazy(() => import('./pages/Faculty.jsx'))
const Resources = lazy(() => import('./pages/Resources.jsx'))

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
        onMouseEnter={(e) => {
          e.currentTarget.style.background = 'var(--panel-subtle)'
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'none'
        }}
      >
        <span
          style={{
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            color: 'var(--gold)',
          }}
        >
          🔗 {config.schoolCode} Resources
        </span>
        <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div id="hks-resources-list" style={{ padding: '0 8px 8px' }}>
          {HKS_RESOURCES.map((section) => (
            <div key={section.group} style={{ marginBottom: 10 }}>
              <p
                style={{
                  fontSize: 9,
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  letterSpacing: '0.07em',
                  color: 'var(--text-muted)',
                  paddingLeft: 6,
                  marginBottom: 2,
                }}
              >
                {section.group}
              </p>
              {section.links.map((link) => (
                <a
                  key={link.url}
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={link.auth ? `Requires ${link.auth}` : link.desc}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '5px 8px',
                    borderRadius: 8,
                    textDecoration: 'none',
                    gap: 4,
                  }}
                  className="transition-colors"
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'var(--panel-subtle)'
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = ''
                  }}
                >
                  <span
                    style={{
                      fontSize: 11,
                      color: 'var(--text-soft)',
                      minWidth: 0,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {link.label}
                  </span>
                  <span
                    style={{
                      fontSize: 9,
                      color: 'var(--text-muted)',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 2,
                      flexShrink: 0,
                    }}
                  >
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

export default function App() {
  const location = useLocation()
  const { isWelcomeDecisionPending } = useWelcomeEntry()
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
    if (typeof window === 'undefined') return true
    const stored = window.localStorage.getItem('hks-theme')
    return stored === null ? true : stored === 'hub'
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
  const [mobileMoreOpen, setMobileMoreOpen] = useState(false)
  const mobileMoreButtonRef = useRef(null)
  const previousPathRef = useRef(location.pathname)

  // A mobile disclosure belongs to the current screen. Close it after every
  // route transition and move keyboard/screen-reader focus to the destination
  // content after client-side navigation. A direct page load deliberately
  // keeps the skip link as the first keyboard target.
  useEffect(() => {
    setMobileMoreOpen(false)
    if (previousPathRef.current === location.pathname || isWelcomeDecisionPending) return undefined
    previousPathRef.current = location.pathname
    const frame = window.requestAnimationFrame(() => {
      // A global catalogue load can temporarily replace the application with
      // a busy main landmark. Do not move focus to a node that will unmount;
      // WelcomeEntryProvider completes first-visit focus once stable content
      // (or the persistent error state) is available.
      document.querySelector('#main-content:not([aria-busy="true"])')?.focus()
    })
    return () => window.cancelAnimationFrame(frame)
  }, [isWelcomeDecisionPending, location.pathname])
  const favs = useFavorites()
  const { notes, setNote } = useNotes()
  const shareToastTimeoutRef = useRef(null)

  const setMetricMode = (mode) => {
    window.localStorage.setItem('hks-metric-mode', mode)
    capture('metric_mode_changed', { mode })
    setMetricModeState(mode)
  }
  const setColorblindMode = (val) => {
    window.localStorage.setItem('hks-colorblind', String(val))
    if (val) capture('colorblind_mode_enabled')
    setColorblindModeState(val)
  }

  useEffect(() => {
    const storedVersion = window.localStorage.getItem('hks_storage_version')
    if (storedVersion === STORAGE_VERSION) return

    // Back up existing plans before wiping so user can recover
    const backup = {}
    ;['Plan A', 'Plan B', 'Plan C', 'Plan D'].forEach((name) => {
      const key = `hks_plan_${name}`
      const v = window.localStorage.getItem(key)
      if (v) backup[name] = v
    })
    if (Object.keys(backup).length > 0) {
      try {
        window.localStorage.setItem(
          'hks_plan_backup_pre_v2',
          JSON.stringify({
            savedAt: new Date().toISOString(),
            plans: backup,
          }),
        )
      } catch {
        // Ignore backup save errors
      }
    }

    window.localStorage.removeItem('hks_plan_A')
    window.localStorage.removeItem('hks_plan_B')
    window.localStorage.removeItem('hks_plan_C')
    window.localStorage.removeItem('hks_plan_D')
    window.localStorage.removeItem('hks_completed_courses')
    window.localStorage.removeItem(COURSES_CACHE_KEY)
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
    if (isWelcomeDecisionPending) return
    fetch('/sim_coords.json')
      .then((r) => r.json())
      .then((coords) => {
        const map = new Map()
        for (const entry of coords) {
          map.set(entry.id, {
            sim_x: entry.sim_x,
            sim_y: entry.sim_y,
            course_code: entry.course_code,
            course_name: entry.course_name,
            professor_display: entry.professor_display,
            concentration: entry.concentration,
          })
        }
        setSimIndex(map)
      })
      .catch(() => {})
  }, [isWelcomeDecisionPending])

  useEffect(() => {
    // A first-visit landing page must be a real decision boundary. Loading
    // the full historical catalogue and graph while it covers the app wastes
    // bandwidth and CPU before a visitor has chosen to enter.
    if (isWelcomeDecisionPending) return
    const startedAt = performance.now()
    let cacheStatus = 'miss'
    const route = window.location.pathname
    setLoading(true)
    setError(null)
    setLoadCount(0)
    fetchAllCoursesWithCache(
      (n) => setLoadCount(n),
      (status) => {
        cacheStatus = status
      },
    )
      .then((courses) => {
        courses.forEach((c) => {
          if (c.metrics_raw) {
            c.metrics_score = Object.fromEntries(
              Object.entries(c.metrics_raw).map(([k, v]) => [
                k,
                v != null ? Math.round((v / 5) * 100 * 10) / 10 : null,
              ]),
            )
          }
        })
        setData({ courses, meta: buildCourseMeta(courses) })
        setLoading(false)
        capture(
          'catalogue_ready',
          buildCatalogueReadyProperties({
            startedAt,
            endedAt: performance.now(),
            rowCount: courses.length,
            cacheStatus,
            route,
            success: true,
          }),
        )
      })
      .catch((err) => {
        setError(err.message)
        setLoading(false)
        capture(
          'catalogue_ready',
          buildCatalogueReadyProperties({
            startedAt,
            endedAt: performance.now(),
            rowCount: 0,
            cacheStatus,
            route,
            success: false,
            error: err,
          }),
        )
      })
  }, [isWelcomeDecisionPending, retryKey])

  if (loading) {
    return (
      <div className="flex min-h-screen" style={{ background: 'transparent' }}>
        <aside
          className="hidden shrink-0 md:flex md:w-[178px] md:flex-col md:gap-4 md:px-3 md:py-4"
          style={{ background: 'var(--nav-shell)', borderRight: '1px solid var(--line)' }}
        >
          <div
            className="rounded-[22px] border px-4 pb-4 pt-5"
            style={{ borderColor: 'var(--line)', background: 'var(--panel-subtle)' }}
          >
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

        <main
          id="main-content"
          tabIndex={-1}
          aria-busy="true"
          aria-live="polite"
          className="flex min-w-0 flex-1 flex-col px-4 py-6 md:px-6"
        >
          <div className="mb-5">
            <div className="skeleton-shimmer mb-3 h-4" style={{ width: 140 }} />
            <div className="skeleton-shimmer mb-3 h-10 max-w-[420px]" />
            <div className="skeleton-shimmer h-4 max-w-[560px]" />
          </div>

          <div className="mb-4 flex items-center gap-3">
            <div className="spinner" />
            <div>
              <p className="text-sm font-medium" style={{ color: 'var(--text)' }}>
                Loading {config.appTitle}
              </p>
              <p className="mt-1 text-xs" style={{ color: 'var(--text-muted)' }}>
                {loadCount > 0
                  ? `${loadCount.toLocaleString()} courses loaded…`
                  : 'Connecting to database…'}
              </p>
            </div>
          </div>

          <div className="grid gap-4">
            {Array.from({ length: 5 }, (_, index) => (
              <SkeletonCard key={index} />
            ))}
          </div>
        </main>
      </div>
    )
  }

  if (error) {
    return (
      <main
        id="main-content"
        tabIndex={-1}
        className="flex h-screen flex-col items-center justify-center gap-4 px-8 text-center"
        style={{ background: 'transparent' }}
      >
        <p className="text-4xl" style={{ opacity: 0.3 }}>
          ⚠
        </p>
        <p className="text-lg font-semibold" style={{ color: 'var(--danger)' }}>
          Failed to load course data
        </p>
        <p className="max-w-sm text-sm text-muted">
          {error}. Check your network connection and try again.
        </p>
        <button
          onClick={() => setRetryKey((k) => k + 1)}
          className="rounded-full px-5 py-2.5 text-sm font-semibold"
          style={{
            background: 'var(--accent-soft)',
            color: 'var(--text)',
            border: '1px solid var(--line)',
          }}
        >
          ↺ Retry
        </button>
      </main>
    )
  }

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark'
    capture('theme_switched', { theme: next })
    setTheme(next)
    if (hubTheme) setHubTheme(false) // switching dark/light exits hub mode
  }

  const toggleHubTheme = () => {
    capture('hub_theme_toggled', { hub: !hubTheme })
    setHubTheme((v) => !v)
  }

  const handleShareShortlist = async () => {
    try {
      const favsParam = [...(favs?.favorites || [])].join(',')
      const shareUrl = favsParam
        ? `${window.location.origin}/?favs=${encodeURIComponent(favsParam)}`
        : window.location.origin + '/'
      await navigator.clipboard.writeText(shareUrl)
      capture('shortlist_shared', { course_count: favs?.count || 0 })
      setShareCopied(true)
      if (shareToastTimeoutRef.current) clearTimeout(shareToastTimeoutRef.current)
      shareToastTimeoutRef.current = setTimeout(() => setShareCopied(false), 1800)
    } catch {
      // Ignore clipboard errors
    }
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
    const headers = [
      'Code',
      'Title',
      'Instructor',
      'Year',
      'Term',
      'Concentration',
      'Core',
      'STEM',
      'Instructor %',
      'Course %',
      'Workload %',
      'N Respondents',
      'Last Bid Price',
      'Note',
    ]
    const rows = deduped.map((c) => {
      const note = notes[c.course_code_base] || ''
      return [
        c.course_code || '',
        c.course_name || '',
        c.professor_display || c.professor || '',
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
        note,
      ]
        .map(csvCell)
        .join(',')
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
    capture('shortlist_exported_csv', { course_count: deduped.length })
  }

  // ─── Shared page routes ────────────────────────────────────────────────────
  const pageRoutes = (
    <ErrorBoundary>
      <Suspense
        fallback={
          <div
            style={{ padding: 40, color: 'var(--text-muted)', textAlign: 'center', fontSize: 14 }}
          >
            Loading…
          </div>
        }
      >
        <Routes>
          <Route
            path="/"
            element={
              <WelcomeHome
                courses={data.courses}
                meta={data.meta}
                favs={favs}
                metricMode={metricMode}
                setMetricMode={setMetricMode}
                colorblindMode={colorblindMode}
                setColorblindMode={setColorblindMode}
                notes={notes}
                setNote={setNote}
                isLight={theme === 'light'}
              />
            }
          />
          <Route
            path="/courses"
            element={
              <Courses
                courses={data.courses}
                meta={data.meta}
                favs={favs}
                metricMode={metricMode}
                setMetricMode={setMetricMode}
                simIndex={simIndex}
                notes={notes}
                setNote={setNote}
              />
            }
          />
          <Route
            path="/faculty"
            element={
              <Faculty
                courses={data.courses}
                meta={data.meta}
                favs={favs}
                metricMode={metricMode}
                setMetricMode={setMetricMode}
              />
            }
          />
          <Route
            path="/compare"
            element={
              <Compare
                courses={data.courses}
                meta={data.meta}
                favs={favs}
                metricMode={metricMode}
                setMetricMode={setMetricMode}
              />
            }
          />
          <Route path="/resources" element={<Resources />} />
          <Route
            path="/schedule-builder"
            element={<ScheduleBuilder courses={data?.courses || []} meta={data?.meta} />}
          />
          <Route
            path="/requirements"
            element={<ScheduleBuilder myDegreeMode courses={data?.courses || []} />}
          />
          <Route path="/admin" element={<Admin />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
    </ErrorBoundary>
  )

  // ─── Shared mobile bottom nav ──────────────────────────────────────────────
  const mobileBottomNav = (
    <nav
      aria-label="Mobile navigation"
      onKeyDown={(event) => {
        if (event.key === 'Escape' && mobileMoreOpen) {
          event.preventDefault()
          setMobileMoreOpen(false)
          mobileMoreButtonRef.current?.focus()
        }
      }}
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
          <button
            type="button"
            onClick={handleShareShortlist}
            className="theme-toggle"
            style={{ minHeight: 44 }}
          >
            {shareCopied ? '✓ Copied!' : `🔗 Share (${favs.count})`}
          </button>
          <button
            type="button"
            onClick={handleExportShortlist}
            className="theme-toggle"
            style={{ minHeight: 44 }}
          >
            ⬇ CSV
          </button>
          <button
            type="button"
            onClick={() => favs.clearAll()}
            className="theme-toggle"
            style={{ minHeight: 44 }}
          >
            ✕ Clear
          </button>
        </div>
      )}
      <div
        className="mx-auto flex max-w-md gap-1 rounded-[24px] border p-1.5 shadow-[0_-12px_28px_rgba(0,0,0,0.28)]"
        style={{ borderColor: 'var(--line)', background: 'var(--nav-shell-strong)' }}
      >
        {MOBILE_PRIMARY_NAV_ITEMS.map((item) => (
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
              background: isActive
                ? 'linear-gradient(180deg, rgba(165, 28, 48, 0.28), rgba(165, 28, 48, 0.12))'
                : 'transparent',
              border: `1px solid ${isActive ? 'rgba(212, 168, 106, 0.18)' : 'transparent'}`,
            })}
          >
            <span className="text-base leading-none" aria-hidden="true">
              {item.icon}
            </span>
            <span className="text-[9px] font-semibold leading-tight tracking-[0.02em]">
              {item.mobileLabel || item.label}
            </span>
          </NavLink>
        ))}
        <button
          ref={mobileMoreButtonRef}
          type="button"
          aria-expanded={mobileMoreOpen}
          aria-controls="mobile-more-navigation"
          onClick={() => setMobileMoreOpen((open) => !open)}
          className="flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-[18px] px-1 py-2.5 text-label transition-colors"
          style={{ minHeight: 52 }}
        >
          <span className="text-base leading-none" aria-hidden="true">
            •••
          </span>
          <span className="text-[9px] font-semibold leading-tight tracking-[0.02em]">More</span>
        </button>
      </div>
      {mobileMoreOpen && (
        <div
          id="mobile-more-navigation"
          className="mx-auto mt-2 grid max-w-md grid-cols-3 gap-1 rounded-2xl border p-1.5 shadow-[0_-12px_28px_rgba(0,0,0,0.28)]"
          style={{ borderColor: 'var(--line)', background: 'var(--nav-shell-strong)' }}
        >
          {MOBILE_MORE_NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              aria-label={item.label}
              onClick={() => setMobileMoreOpen(false)}
              className={({ isActive }) =>
                `flex min-w-0 flex-col items-center justify-center gap-0.5 rounded-xl px-1 py-2 text-center text-[10px] font-semibold transition-colors ${isActive ? 'text-white' : 'text-label'}`
              }
              style={({ isActive }) => ({
                minHeight: 48,
                background: isActive
                  ? 'linear-gradient(180deg, rgba(165, 28, 48, 0.28), rgba(165, 28, 48, 0.12))'
                  : 'transparent',
                border: `1px solid ${isActive ? 'rgba(212, 168, 106, 0.18)' : 'transparent'}`,
              })}
            >
              <span className="text-base leading-none" aria-hidden="true">
                {item.icon}
              </span>
              <span>{item.mobileLabel || item.label}</span>
            </NavLink>
          ))}
        </div>
      )}
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
          <div
            style={{
              width: 28,
              height: 28,
              background: 'var(--accent)',
              borderRadius: 6,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <span
              style={{ color: '#fff', fontSize: 13, fontWeight: 800, fontFamily: 'Georgia, serif' }}
            >
              H
            </span>
          </div>
          <div>
            <p
              className="text-sm font-bold leading-none"
              style={{ color: 'var(--text)', fontFamily: 'Georgia, serif' }}
            >
              {config.appTitle}
            </p>
            <p className="mt-0.5 text-[10px] leading-none" style={{ color: 'var(--text-muted)' }}>
              Independent student tool
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={toggleTheme}
            className="theme-toggle"
            style={{ padding: '5px 10px', fontSize: 10, minHeight: 32 }}
          >
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
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-white focus:px-4 focus:py-2 focus:text-black"
        >
          Skip to main content
        </a>
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
          <div
            className="flex shrink-0 items-center gap-0 border-r"
            style={{ height: '100%', borderColor: 'var(--line)', minWidth: 180 }}
          >
            <a
              href="/"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '0 20px',
                height: '100%',
                textDecoration: 'none',
              }}
            >
              {/* Shield icon */}
              <div
                style={{
                  width: 32,
                  height: 32,
                  background: 'var(--accent)',
                  borderRadius: 4,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                <span
                  style={{
                    color: '#fff',
                    fontSize: 14,
                    fontWeight: 800,
                    fontFamily: 'Georgia, serif',
                    letterSpacing: '-0.02em',
                  }}
                >
                  H
                </span>
              </div>
              <div>
                <p
                  style={{
                    fontSize: 15,
                    fontWeight: 700,
                    fontFamily: 'Georgia, serif',
                    color: 'var(--accent)',
                    letterSpacing: '-0.01em',
                    lineHeight: 1.1,
                  }}
                >
                  HKS
                </p>
                <p
                  style={{
                    fontSize: 9,
                    fontWeight: 600,
                    letterSpacing: '0.07em',
                    textTransform: 'uppercase',
                    color: 'var(--text-muted)',
                    lineHeight: 1,
                  }}
                >
                  Course Explorer
                </p>
              </div>
            </a>
          </div>

          {/* Nav links — horizontal, hub style */}
          <nav aria-label="Main navigation" className="flex h-full items-stretch">
            {DESKTOP_NAV_ITEMS.map((item) => (
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
                  style={{
                    background: 'var(--accent-soft)',
                    borderColor: 'var(--accent)',
                    color: 'var(--accent)',
                  }}
                >
                  {shareCopied ? '✓ Copied!' : `🔗 Share (${favs.count})`}
                </button>
                <button type="button" onClick={handleExportShortlist} className="hub-action-btn">
                  ⬇ CSV
                </button>
                <button type="button" onClick={() => favs.clearAll()} className="hub-action-btn">
                  ✕ Clear
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
        <main
          id="main-content"
          tabIndex={-1}
          className="min-h-0 flex-1 overflow-hidden pb-24 md:pb-0"
        >
          {pageRoutes}
        </main>

        <SupportProjectPrompt mobileNavExpanded={favs.count > 0} />
        {mobileBottomNav}
      </div>
    )
  }

  // ══════════════════════════════════════════════════════════════════════════
  // CLASSIC MODE — left sidebar navigation
  // ══════════════════════════════════════════════════════════════════════════
  return (
    <div className="flex min-h-screen md:h-screen" style={{ background: 'transparent' }}>
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-white focus:px-4 focus:py-2 focus:text-black"
      >
        Skip to main content
      </a>
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
        <div
          className="mb-4 rounded-[22px] border px-4 pb-4 pt-5"
          style={{
            borderColor: 'var(--line)',
            background: 'linear-gradient(180deg, rgba(165, 28, 48, 0.14), var(--panel-subtle))',
          }}
        >
          <p className="kicker">Harvard-inspired</p>
          <p className="serif-display mt-2 text-2xl font-semibold" style={{ color: 'var(--text)' }}>
            {config.schoolCode}
          </p>
          <p className="text-xs" style={{ color: 'var(--text-soft)' }}>
            {config.appTitle.replace(`${config.schoolCode} `, '')}
          </p>
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
        {DESKTOP_NAV_ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              `mx-2 rounded-2xl px-4 py-3 text-sm transition-colors ${isActive ? 'text-white' : 'text-label hover:text-white'}`
            }
            style={({ isActive }) => ({
              background: isActive
                ? 'linear-gradient(180deg, rgba(165, 28, 48, 0.22), rgba(165, 28, 48, 0.09))'
                : 'transparent',
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
              <button
                type="button"
                onClick={handleShareShortlist}
                className="theme-toggle"
                style={{ width: '100%' }}
              >
                {shareCopied ? '✓ Copied!' : `🔗 Share Shortlist (${favs.count})`}
              </button>
              <button
                type="button"
                onClick={handleExportShortlist}
                className="theme-toggle"
                style={{ width: '100%' }}
              >
                ⬇ Export CSV
              </button>
              <button
                type="button"
                onClick={() => favs.clearAll()}
                className="theme-toggle"
                style={{ width: '100%' }}
              >
                ✕ Clear Shortlist
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

        <main
          id="main-content"
          tabIndex={-1}
          className="min-h-0 flex-1 overflow-hidden pb-24 md:pb-0"
        >
          {pageRoutes}
        </main>

        <SupportProjectPrompt mobileNavExpanded={favs.count > 0} />
        {mobileBottomNav}
      </div>
    </div>
  )
}
