import { useEffect, useState } from 'react'
import { DAY_INDEX } from '../lib/scheduleCourseNormalization.js'

/**
 * Collects a cross-registration course that is absent from the HKS catalogue.
 * Persistence remains in ScheduleBuilder; this component owns only its temporary form state.
 */
export default function ManualCourseModal({ initial, onAdd, onClose }) {
  const [code, setCode] = useState(initial?.code || '')
  const [title, setTitle] = useState('')
  const [instructor, setInstructor] = useState('')
  const [credits, setCredits] = useState(4)
  const [days, setDays] = useState([])
  const [timeStart, setTimeStart] = useState('')
  const [timeEnd, setTimeEnd] = useState('')
  const [location, setLocation] = useState('')
  const [isStem, setIsStem] = useState(false)
  const [isCore, setIsCore] = useState(false)

  useEffect(() => {
    const handleEscape = (event) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleEscape)
    return () => window.removeEventListener('keydown', handleEscape)
  }, [onClose])

  const toggleDay = (day) => {
    setDays((current) =>
      current.includes(day)
        ? current.filter((value) => value !== day)
        : [...current, day].sort((a, b) => DAY_INDEX[a] - DAY_INDEX[b]),
    )
  }

  const handleSubmit = (event) => {
    event.preventDefault()
    const normalizedCode = code.trim().toUpperCase().replace(/\s+/g, '-')
    if (!normalizedCode) return
    onAdd({
      courseCode: normalizedCode,
      title: title.trim() || normalizedCode,
      instructors: instructor.trim() ? [instructor.trim()] : [],
      credits,
      sections: [],
      meeting_days: days.join('/'),
      time_start: timeStart || null,
      time_end: timeEnd || null,
      location: location.trim() || null,
      sessionDescription: '',
      enrichment: { is_stem: isStem, is_core: isCore, metrics_pct: null },
      _crossRegManual: true,
    })
  }

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center p-4"
      style={{ background: 'rgba(15, 23, 42, 0.62)' }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="manual-course-modal-title"
    >
      <div
        className="w-full max-w-2xl rounded-[28px] border p-6 shadow-2xl"
        style={{
          background: 'var(--panel)',
          borderColor: 'var(--line-strong)',
          color: 'var(--text)',
        }}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <p
              className="text-xs font-semibold uppercase tracking-[0.16em]"
              style={{ color: 'var(--text-muted)' }}
            >
              Manual course
            </p>
            <h2 id="manual-course-modal-title" className="mt-2 text-2xl font-semibold">
              Add a cross-registration course
            </h2>
            <p className="mt-2 text-sm leading-6" style={{ color: 'var(--text-muted)' }}>
              Fill in what you know now. You can still edit timing directly in the schedule later.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-10 w-10 items-center justify-center rounded-full border text-lg transition-transform hover:-translate-y-[1px]"
            style={{
              background: 'var(--panel-soft)',
              borderColor: 'var(--line-strong)',
              color: 'var(--text-muted)',
            }}
            aria-label="Close manual course form"
          >
            ×
          </button>
        </div>

        <form className="space-y-5" onSubmit={handleSubmit}>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Course code">
              <input
                aria-label="Course code"
                type="text"
                value={code}
                onChange={(event) => setCode(event.target.value.toUpperCase())}
                placeholder="MIT-15.783"
                className={inputClass}
                style={inputStyle}
              />
            </Field>
            <Field label="Title">
              <input
                aria-label="Title"
                type="text"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Machine Learning for Policy"
                className={inputClass}
                style={inputStyle}
              />
            </Field>
          </div>
          <div className="grid gap-4 md:grid-cols-[1.3fr,0.7fr]">
            <Field label="Instructor">
              <input
                aria-label="Instructor"
                type="text"
                value={instructor}
                onChange={(event) => setInstructor(event.target.value)}
                placeholder="Prof. Example"
                className={inputClass}
                style={inputStyle}
              />
            </Field>
            <div>
              <Label>Credits</Label>
              <div className="flex gap-2">
                {[2, 3, 4].map((value) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setCredits(value)}
                    className="flex-1 rounded-full border px-3 py-2 text-sm font-semibold transition-transform hover:-translate-y-[1px]"
                    style={{
                      background: credits === value ? 'var(--accent)' : 'var(--accent-soft)',
                      borderColor: credits === value ? 'var(--accent)' : 'var(--line-strong)',
                      color: credits === value ? '#fff' : 'var(--text)',
                    }}
                  >
                    {value} cr
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div>
            <Label>Meeting days</Label>
            <div className="flex flex-wrap gap-2">
              {['MON', 'TUE', 'WED', 'THU', 'FRI'].map((day) => (
                <button
                  key={day}
                  type="button"
                  onClick={() => toggleDay(day)}
                  className="rounded-full border px-3 py-2 text-xs font-semibold tracking-[0.08em] transition-transform hover:-translate-y-[1px]"
                  style={{
                    background: days.includes(day) ? 'var(--blue)' : 'var(--blue-soft)',
                    borderColor: days.includes(day) ? 'var(--blue)' : 'var(--line-strong)',
                    color: days.includes(day) ? '#fff' : 'var(--text)',
                  }}
                >
                  {day}
                </button>
              ))}
            </div>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            <Field label="Start time">
              <input
                aria-label="Start time"
                type="time"
                value={timeStart}
                onChange={(event) => setTimeStart(event.target.value)}
                className={inputClass}
                style={inputStyle}
              />
            </Field>
            <Field label="End time">
              <input
                aria-label="End time"
                type="time"
                value={timeEnd}
                onChange={(event) => setTimeEnd(event.target.value)}
                className={inputClass}
                style={inputStyle}
              />
            </Field>
            <Field label="Location">
              <input
                aria-label="Location"
                type="text"
                value={location}
                onChange={(event) => setLocation(event.target.value)}
                placeholder="Building / room"
                className={inputClass}
                style={inputStyle}
              />
            </Field>
          </div>
          <div>
            <Label>Tags</Label>
            <div className="flex flex-wrap gap-2">
              {[
                {
                  key: 'stem',
                  label: 'STEM',
                  active: isStem,
                  onClick: () => setIsStem((value) => !value),
                },
                {
                  key: 'core',
                  label: 'Core',
                  active: isCore,
                  onClick: () => setIsCore((value) => !value),
                },
              ].map((item) => (
                <button
                  key={item.key}
                  type="button"
                  onClick={item.onClick}
                  className="rounded-full border px-3 py-2 text-xs font-semibold transition-transform hover:-translate-y-[1px]"
                  style={{
                    background: item.active ? 'var(--accent)' : 'var(--panel-soft)',
                    borderColor: item.active ? 'var(--accent)' : 'var(--line-strong)',
                    color: item.active ? '#fff' : 'var(--text)',
                  }}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>
          <div
            className="flex items-center justify-between gap-3 border-t pt-5"
            style={{ borderColor: 'var(--line-strong)' }}
          >
            <p className="text-xs leading-5" style={{ color: 'var(--text-muted)' }}>
              This creates a manual shortlist entry marked as cross-registration.
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-full border px-4 py-2 text-sm font-semibold transition-transform hover:-translate-y-[1px]"
                style={{
                  background: 'var(--panel-soft)',
                  borderColor: 'var(--line-strong)',
                  color: 'var(--text)',
                }}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="rounded-full border px-4 py-2 text-sm font-semibold transition-transform hover:-translate-y-[1px]"
                style={{ background: 'var(--accent)', borderColor: 'var(--accent)', color: '#fff' }}
              >
                Add to schedule
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  )
}

function Label({ children }) {
  return (
    <span
      className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.12em]"
      style={{ color: 'var(--text-muted)' }}
    >
      {children}
    </span>
  )
}

function Field({ label, children }) {
  return (
    <label className="block">
      <Label>{label}</Label>
      {children}
    </label>
  )
}

const inputClass = 'w-full rounded-2xl border px-4 py-3 text-sm outline-none transition-colors'
const inputStyle = {
  background: 'var(--panel-soft)',
  borderColor: 'var(--line-strong)',
  color: 'var(--text)',
}
