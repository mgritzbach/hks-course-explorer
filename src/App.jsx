import { useState, useEffect } from 'react'
import { Routes, Route, NavLink, useNavigate } from 'react-router-dom'
import Home from './pages/Home.jsx'
import Courses from './pages/Courses.jsx'
import Faculty from './pages/Faculty.jsx'

export default function App() {
  const [data, setData]       = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)

  useEffect(() => {
    fetch('/courses.json')
      .then(r => { if (!r.ok) throw new Error('Failed to load courses.json'); return r.json() })
      .then(d => { setData(d); setLoading(false) })
      .catch(e => { setError(e.message); setLoading(false) })
  }, [])

  if (loading) return (
    <div
      className="flex flex-col items-center justify-center h-screen gap-4"
      style={{ background: '#0f0f17' }}
    >
      <div className="spinner" />
      <p className="text-muted text-sm">Loading course data…</p>
    </div>
  )

  if (error) return (
    <div
      className="flex flex-col items-center justify-center h-screen gap-3 text-center px-8"
      style={{ background: '#0f0f17' }}
    >
      <p className="text-4xl">⚠️</p>
      <p className="text-red-400 font-semibold">Error: {error}</p>
      <p className="text-muted text-sm">
        Run <code className="text-accent">python scripts/build_data.py</code> first to generate the data file.
      </p>
    </div>
  )

  const navItem = ({ isActive }) =>
    `px-4 py-2 text-sm cursor-pointer transition-colors ${
      isActive ? 'bg-[#2a2a3e] text-white' : 'text-label hover:bg-[#1e1e2e]'
    }`

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: '#0f0f17' }}>
      {/* ── Left nav ── */}
      <nav
        className="flex flex-col shrink-0 py-3"
        style={{ width: 160, background: '#151521', borderRight: '1px solid #2a2a3e' }}
      >
        <div className="px-4 pb-3 mb-2 border-b border-[#1e1e2e]">
          <p className="text-xs font-bold" style={{ color: '#38bdf8' }}>HKS</p>
          <p className="text-xs text-muted">Course Explorer</p>
        </div>

        <NavLink to="/"        end       className={navItem}>🏠 Home</NavLink>
        <NavLink to="/courses"           className={navItem}>🔎 Courses</NavLink>
        <NavLink to="/faculty"           className={navItem}>👩‍🏫 Faculty</NavLink>
      </nav>

      {/* ── Page content ── */}
      <div className="flex-1 overflow-hidden flex flex-col">
        <Routes>
          <Route path="/"        element={<Home    courses={data.courses} meta={data.meta} />} />
          <Route path="/courses" element={<Courses courses={data.courses} meta={data.meta} />} />
          <Route path="/faculty" element={<Faculty courses={data.courses} meta={data.meta} />} />
        </Routes>
      </div>
    </div>
  )
}
