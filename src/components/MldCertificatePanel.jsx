import { useMemo, useState } from 'react'
import {
  MLD_CERTIFICATE_COURSE_LIST_UPDATED,
  MLD_CERTIFICATE_FOCUS_AREAS,
  MLD_CERTIFICATE_MAX_NON_HKS_CREDITS,
  MLD_CERTIFICATE_SOURCES,
  computeMldCertificateProgress,
} from '../lib/mldCertificate.js'

const COLLAPSED_STORAGE_KEY = 'hks_mld_certificate_collapsed'

function loadCollapsed() {
  if (typeof window === 'undefined') return false
  return window.localStorage.getItem(COLLAPSED_STORAGE_KEY) === 'true'
}

function CoursePills({ label, tone, courses }) {
  if (courses.length === 0) return null
  return (
    <div>
      <p
        className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em]"
        style={{ color: tone }}
      >
        {label}
      </p>
      <div className="flex flex-wrap gap-2">
        {courses.map((item) => (
          <span
            key={`${label}-${item.code}`}
            className="rounded-full px-3 py-1 text-xs font-semibold"
            style={{
              background: 'var(--panel-strong)',
              border: '1px solid var(--line)',
              color: 'var(--text-soft)',
            }}
            title={item.areas.join(' · ')}
          >
            {item.displayCode} · {item.credits} cr
          </span>
        ))}
      </div>
    </div>
  )
}

export default function MldCertificatePanel({ scheduledCourses, completedCourses, programId }) {
  const [collapsed, setCollapsed] = useState(loadCollapsed)
  const progress = useMemo(
    () => computeMldCertificateProgress(scheduledCourses, completedCourses, programId),
    [scheduledCourses, completedCourses, programId],
  )

  const toggleCollapsed = () => {
    setCollapsed((current) => {
      const next = !current
      window.localStorage.setItem(COLLAPSED_STORAGE_KEY, String(next))
      return next
    })
  }

  return (
    <section
      className="rounded-[28px] p-6"
      style={{ background: 'var(--panel)', border: '1px solid var(--line)' }}
      aria-labelledby="mld-certificate-title"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="kicker">Optional certificate</p>
          <h2
            id="mld-certificate-title"
            className="mt-1 text-2xl font-semibold"
            style={{ color: 'var(--text)' }}
          >
            MLD Certificate
          </h2>
          <p className="mt-1 text-sm" style={{ color: 'var(--text-muted)' }}>
            Management, Leadership, and Decision Sciences
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span
            className="rounded-full px-3 py-1 text-xs font-semibold"
            style={{ background: 'var(--accent-soft)', color: 'var(--text)' }}
          >
            {progress.totalCredits} / {progress.requiredCredits} cr planned
          </span>
          <button
            type="button"
            onClick={toggleCollapsed}
            aria-expanded={!collapsed}
            aria-controls="mld-certificate-details"
            className="rounded-full border px-3 py-1 text-xs font-semibold"
            style={{
              background: 'transparent',
              borderColor: 'var(--line-strong)',
              color: 'var(--text-muted)',
            }}
          >
            {collapsed ? 'Expand' : 'Minimize'}
          </button>
        </div>
      </div>

      {!collapsed && (
        <div id="mld-certificate-details" className="mt-5">
          <p className="text-sm leading-6" style={{ color: 'var(--text-muted)' }}>
            Complete at least 12 credits of approved MLD electives with a grade of B+ or better in
            each course. Required MLD courses do not count. Up to{' '}
            {MLD_CERTIFICATE_MAX_NON_HKS_CREDITS} credits may be approved non-HKS coursework.
          </p>

          <div
            className="mt-4 h-3 overflow-hidden rounded-full"
            role="progressbar"
            aria-label={`MLD Certificate: ${progress.totalCredits} of ${progress.requiredCredits} eligible credits planned`}
            aria-valuemin={0}
            aria-valuemax={progress.requiredCredits}
            aria-valuenow={Math.min(progress.totalCredits, progress.requiredCredits)}
            style={{ background: 'var(--track-bg)', border: '1px solid var(--line-strong)' }}
          >
            <div
              className="h-full rounded-full transition-all"
              style={{ width: `${progress.percent}%`, background: 'var(--accent)' }}
            />
          </div>

          <div className="mt-5 grid gap-4 md:grid-cols-2">
            <div
              className="rounded-2xl p-4"
              style={{ background: 'var(--panel-soft)', border: '1px solid var(--line)' }}
            >
              <p className="text-sm font-semibold" style={{ color: 'var(--text)' }}>
                Official requirements
              </p>
              <ul
                className="mt-3 space-y-2 text-xs leading-5"
                style={{ color: 'var(--text-muted)' }}
              >
                <li>
                  • Be enrolled in and complete an HKS master’s degree; only coursework credited to
                  that HKS degree may count.
                </li>
                <li>• Activate candidacy by November 1 of your graduation year.</li>
                <li>
                  • Complete 12 approved elective credits; every course requires B+ or better.
                </li>
                <li>• Submit the final application and training statement by May 1.</li>
                <li>
                  • Non-HKS courses require HKS credit eligibility and advance MLD approval; no more
                  than 4 credits may count.
                </li>
              </ul>
            </div>
            <div
              className="rounded-2xl p-4"
              style={{ background: 'var(--panel-soft)', border: '1px solid var(--line)' }}
            >
              <p className="text-sm font-semibold" style={{ color: 'var(--text)' }}>
                Four curricular areas
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {MLD_CERTIFICATE_FOCUS_AREAS.map((area) => (
                  <span
                    key={area}
                    className="rounded-full px-2.5 py-1 text-[11px]"
                    style={{
                      background: 'var(--panel-strong)',
                      border: '1px solid var(--line)',
                      color: 'var(--text-soft)',
                    }}
                  >
                    {area}
                  </span>
                ))}
              </div>
            </div>
          </div>

          {(progress.completed.length > 0 || progress.planned.length > 0) && (
            <div className="mt-5 space-y-4">
              <CoursePills
                label={`${progress.completedCredits} credits completed`}
                tone="var(--success)"
                courses={progress.completed}
              />
              <CoursePills
                label={`${progress.plannedCredits} credits planned`}
                tone="var(--blue)"
                courses={progress.planned}
              />
            </div>
          )}

          {progress.missingCreditCodes.length > 0 && (
            <p className="mt-4 text-xs" style={{ color: 'var(--gold)' }}>
              Credit values are still loading for: {progress.missingCreditCodes.join(', ')}.
            </p>
          )}

          <p className="mt-4 text-xs leading-5" style={{ color: 'var(--text-muted)' }}>
            This tracker automatically recognizes courses on the official HKS elective list (updated{' '}
            {MLD_CERTIFICATE_COURSE_LIST_UPDATED}). Grade eligibility, candidacy, applications, and
            individually approved non-HKS courses must still be verified with HKS.
          </p>

          <div
            className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 border-t pt-3 text-[11px]"
            style={{ borderColor: 'var(--line)', color: 'var(--text-muted)' }}
          >
            <span className="font-semibold uppercase tracking-[0.1em]">Sources</span>
            {MLD_CERTIFICATE_SOURCES.map((source) => (
              <a
                key={source.url}
                href={source.url}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: 'var(--accent)' }}
              >
                {source.label} ↗
              </a>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}
