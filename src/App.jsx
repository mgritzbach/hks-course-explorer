import posthog from 'posthog-js'
import { useEffect, useRef, useState } from 'react'
import { NavLink, Route, Routes } from 'react-router-dom'
import ChatBot from './components/ChatBot.jsx'
import LandingSplash from './components/LandingSplash.jsx'
import Compare from './pages/Compare.jsx'
import Courses from './pages/Courses.jsx'
import Faculty from './pages/Faculty.jsx'
import Home from './pages/Home.jsx'
import Resources from './pages/Resources.jsx'
import { HKS_RESOURCES } from './resourceLinks.js'
import { useFavorites } from './useFavorites.js'
import { useNotes } from './useNotes.js'

function NavResourcesSection() {
  const [open, setOpen] = useState(false)
  return (
    <div style={{ borderTop: '1px solid var(--line)', marginTop: 8 }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
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
        className="transition-colors hover:bg-white/[0.03]"
      >
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--gold)' }}>
          🔗 HKS Resources
        </span>
        <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div style={{ padding: '0 8px 8px' }}>
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
                  className="transition-colors hover:bg-white/5"
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

// Tally form ID — create a form at tally.so, then paste the ID from the share URL here
const TALLY_FORM_ID = 'LZYAQv'

export default function App() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [theme, setTheme] = useState(() => {
    if (typeof window === 'undefined') return 'dark'
    return window.localStorage.getItem('hks-theme') || 'dark'
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
    document.documentElement.setAttribute('data-theme', theme)
    window.localStorage.setItem('hks-theme', theme)
  }, [theme])

  useEffect(() => {
    return () => {
      if (shareToastTimeoutRef.current) clearTimeout(shareToastTimeoutRef.current)
    }
  }, [])

  useEffect(() => {
    fetch('/courses.json', { cache: 'no-cache' })
      .then((response) => {
        if (!response.ok) throw new Error('Failed to load courses.json')
        return response.json()
      })
      .then((payload) => {
        setData(payload)
        setLoading(false)
      })
      .catch((err) => {
        setError(err.message)
        setLoading(false)
      })
  }, [])

  if (loading) {
    return (
      <div
        className="flex h-screen flex-col items-center justify-center gap-4"
        style={{ background: 'transparent' }}
      >
        <div className="spinner" />
        <p className="text-muted text-sm">Loading course data…</p>
      </div>
    )
  }

  if (error) {
    return (
      <div
        className="flex h-screen flex-col items-center justify-center gap-3 px-8 text-center"
        style={{ background: 'transparent' }}
      >
        <p className="text-lg font-semibold" style={{ color: 'var(--danger)' }}>Error: {error}</p>
        <p className="text-sm text-muted">
          Run <code style={{ color: 'var(--accent-strong)' }}>python scripts/build_data.py</code> first to generate the data file.
        </p>
      </div>
    )
  }

  const navItems = [
    { to: '/',           label: 'Home',      end: true },
    { to: '/courses',    label: 'Courses' },
    { to: '/faculty',    label: 'Faculty' },
    { to: '/compare',    label: 'Compare' },
    { to: '/resources',  label: 'Resources', mobileOnly: true },
  ]

  const desktopNavItem = ({ isActive }) =>
    `mx-2 rounded-2xl px-4 py-3 text-sm transition-colors ${
      isActive ? 'text-white' : 'text-label hover:text-white'
    }`

  const mobileNavItem = ({ isActive }) =>
    `flex min-w-0 flex-1 flex-col items-center justify-center rounded-xl px-2 py-2 text-[10px] font-medium transition-colors ${
      isActive ? 'text-white' : 'text-label'
    }`

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark'
    posthog.capture('theme_switched', { theme: next })
    setTheme(next)
  }
  const handleShareShortlist = async () => {
    try {
      // Always share the home page with the ?favs= param — never the current URL
      // (so sharing from /compare or /faculty still produces a working shortlist link)
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

  return (
    <div className="flex min-h-screen md:h-screen" style={{ background: 'transparent' }}>
      <LandingSplash />
      {data && <ChatBot courses={data.courses} favs={favs} />}
      {/* Desktop sidebar nav */}
      <nav
        className="hidden shrink-0 flex-col px-3 py-4 md:flex"
        style={{
          width: 178,
          background: 'var(--nav-shell)',
          borderRight: '1px solid var(--line)',
          backdropFilter: 'blur(18px)',
        }}
      >
        <div className="mb-4 rounded-[22px] border px-4 pb-4 pt-5" style={{ borderColor: 'var(--line)', background: 'linear-gradient(180deg, rgba(165, 28, 48, 0.16), rgba(255,255,255,0.02))' }}>
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

        {navItems.filter((item) => !item.mobileOnly).map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={desktopNavItem}
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
        {favs.count > 0 && (
          <div className="mt-auto">
            <button type="button" onClick={handleShareShortlist} className="theme-toggle mx-2">
              Share Shortlist
            </button>
          </div>
        )}
      </nav>

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {/* Mobile top header */}
        <header
          className="sticky top-0 z-30 border-b px-4 py-3 md:hidden"
          style={{
            background: 'var(--nav-shell)',
            borderColor: 'var(--line)',
            backdropFilter: 'blur(18px)',
          }}
        >
          <p className="kicker">Harvard-inspired</p>
          <div className="mt-1 flex items-center justify-between gap-3">
            <div>
              <p className="serif-display text-xl font-semibold" style={{ color: 'var(--text)' }}>HKS</p>
              <p className="text-sm" style={{ color: 'var(--text-soft)' }}>Course Explorer</p>
            </div>
            <div className="flex items-center gap-2">
              <button type="button" onClick={toggleTheme} className="theme-toggle">
                {theme === 'dark' ? 'Light' : 'Dark'}
              </button>
              <a
                href="/user-guide.html"
                target="_blank"
                rel="noopener noreferrer"
                className="theme-toggle"
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
                  className="theme-toggle"
                >
                  🐛
                </button>
              )}
            </div>
          </div>
        </header>

        {/* Page content */}
        <div className="min-h-0 flex-1 overflow-hidden pb-24 md:pb-0">
          <Routes>
            <Route path="/"        element={<Home    courses={data.courses} meta={data.meta} favs={favs} metricMode={metricMode} setMetricMode={setMetricMode} colorblindMode={colorblindMode} setColorblindMode={setColorblindMode} notes={notes} setNote={setNote} />} />
            <Route path="/courses" element={<Courses courses={data.courses} meta={data.meta} favs={favs} metricMode={metricMode} setMetricMode={setMetricMode} colorblindMode={colorblindMode} setColorblindMode={setColorblindMode} />} />
            <Route path="/faculty" element={<Faculty courses={data.courses} meta={data.meta} favs={favs} metricMode={metricMode} />} />
            <Route path="/compare" element={<Compare courses={data.courses} meta={data.meta} favs={favs} metricMode={metricMode} />} />
            <Route path="/resources" element={<Resources />} />
          </Routes>
        </div>

        {/* Mobile bottom nav */}
        <nav
          className="fixed inset-x-0 bottom-0 z-40 border-t px-3 pt-3 md:hidden"
          style={{
            background: 'var(--nav-shell)',
            borderColor: 'var(--line)',
            backdropFilter: 'blur(20px)',
            paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 0.75rem)',
          }}
        >
          {favs.count > 0 && (
            <div className="mx-auto mb-2 flex max-w-md justify-center">
              <button type="button" onClick={handleShareShortlist} className="theme-toggle" style={{ minHeight: 44 }}>
                Share Shortlist
              </button>
            </div>
          )}
          <div className="mx-auto flex max-w-md gap-1 rounded-[24px] border p-2 shadow-[0_-12px_28px_rgba(0,0,0,0.28)]" style={{ borderColor: 'var(--line)', background: 'var(--nav-shell-strong)' }}>
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={mobileNavItem}
                style={({ isActive }) => ({
                  background: isActive ? 'linear-gradient(180deg, rgba(165, 28, 48, 0.28), rgba(165, 28, 48, 0.12))' : 'transparent',
                  border: `1px solid ${isActive ? 'rgba(212, 168, 106, 0.18)' : 'transparent'}`,
                })}
              >
                {item.label}
              </NavLink>
            ))}
          </div>
        </nav>
      </div>
      {shareCopied && (
        <div
          className="fixed bottom-[160px] right-4 z-50 rounded-full px-3 py-2 text-xs font-medium md:bottom-20"
          style={{
            background: 'var(--panel-subtle)',
            border: '1px solid var(--line)',
            color: 'var(--text)',
          }}
        >
          Copied!
        </div>
      )}
    </div>
  )
}
