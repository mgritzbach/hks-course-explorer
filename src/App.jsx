import { useEffect, useState } from 'react'
import { NavLink, Route, Routes } from 'react-router-dom'
import Home from './pages/Home.jsx'
import Courses from './pages/Courses.jsx'
import Faculty from './pages/Faculty.jsx'
import { useFavorites } from './useFavorites.js'

export default function App() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const favs = useFavorites()

  useEffect(() => {
    fetch('/courses.json')
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
        style={{ background: '#0f0f17' }}
      >
        <div className="spinner" />
        <p className="text-muted text-sm">Loading course data...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div
        className="flex h-screen flex-col items-center justify-center gap-3 px-8 text-center"
        style={{ background: '#0f0f17' }}
      >
        <p className="text-red-400 text-lg font-semibold">Error: {error}</p>
        <p className="text-muted text-sm">
          Run <code className="text-accent">python scripts/build_data.py</code> first to generate the data file.
        </p>
      </div>
    )
  }

  const navItems = [
    { to: '/', label: 'Home', end: true },
    { to: '/courses', label: 'Courses' },
    { to: '/faculty', label: 'Faculty' },
  ]

  const desktopNavItem = ({ isActive }) =>
    `px-4 py-2 text-sm transition-colors ${isActive ? 'bg-[#2a2a3e] text-white' : 'text-label hover:bg-[#1e1e2e]'}`

  const mobileNavItem = ({ isActive }) =>
    `flex min-w-0 flex-1 flex-col items-center justify-center rounded-xl px-3 py-2 text-[11px] font-medium transition-colors ${
      isActive ? 'bg-[#1f3145] text-white' : 'text-[#98a3c1]'
    }`

  return (
    <div className="flex min-h-screen md:h-screen" style={{ background: '#0f0f17' }}>
      <nav
        className="hidden shrink-0 flex-col py-3 md:flex"
        style={{ width: 160, background: '#151521', borderRight: '1px solid #2a2a3e' }}
      >
        <div className="mb-2 border-b border-[#1e1e2e] px-4 pb-3">
          <p className="text-xs font-bold" style={{ color: '#38bdf8' }}>HKS</p>
          <p className="text-xs text-muted">Course Explorer</p>
        </div>

        {navItems.map((item) => (
          <NavLink key={item.to} to={item.to} end={item.end} className={desktopNavItem}>
            {item.label}
          </NavLink>
        ))}
      </nav>

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <header
          className="sticky top-0 z-30 border-b border-[#1e1e2e] px-4 py-3 md:hidden"
          style={{ background: 'rgba(15, 15, 23, 0.96)', backdropFilter: 'blur(14px)' }}
        >
          <p className="text-[11px] font-bold uppercase tracking-[0.24em]" style={{ color: '#38bdf8' }}>
            HKS
          </p>
          <p className="text-sm text-white">Course Explorer</p>
        </header>

        <div className="min-h-0 flex-1 overflow-hidden pb-24 md:pb-0">
          <Routes>
            <Route path="/" element={<Home courses={data.courses} meta={data.meta} favs={favs} />} />
            <Route path="/courses" element={<Courses courses={data.courses} meta={data.meta} favs={favs} />} />
            <Route path="/faculty" element={<Faculty courses={data.courses} meta={data.meta} favs={favs} />} />
          </Routes>
        </div>

        <nav
          className="fixed inset-x-0 bottom-0 z-40 border-t border-[#223046] px-3 pt-3 md:hidden"
          style={{
            background: 'rgba(15, 15, 23, 0.98)',
            backdropFilter: 'blur(16px)',
            paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 0.75rem)',
          }}
        >
          <div className="mx-auto flex max-w-md gap-2 rounded-2xl border border-[#223046] bg-[#121825]/90 p-2 shadow-[0_-8px_24px_rgba(0,0,0,0.28)]">
            {navItems.map((item) => (
              <NavLink key={item.to} to={item.to} end={item.end} className={mobileNavItem}>
                {item.label}
              </NavLink>
            ))}
          </div>
        </nav>
      </div>
    </div>
  )
}
