import {
  DRM_ARTICLE_URL,
  DRM_GRADE_OPTIONS,
  DRM_PETITION_FORM_URL,
  DRM_WORKBOOK_URL,
  normalizeDrmCourseCode,
} from '../lib/drmPathway.js'

const CALENDAR_URL =
  'https://www.hks.harvard.edu/educational-programs/academic-calendars-policies/current-academic-calendar'
const AID_COUNSELOR_URL = 'https://hub.hks.harvard.edu/article/Contact-and-About-Us'

function MiniProgress({ value, required, color }) {
  const percent = required > 0 ? Math.min(100, Math.round((value / required) * 100)) : 100
  return (
    <div
      className="mt-2 h-2 overflow-hidden rounded-full"
      style={{ background: 'var(--track-bg)', border: '1px solid var(--line-strong)' }}
    >
      <div
        className="h-full rounded-full transition-all"
        style={{ width: `${percent}%`, background: color }}
      />
    </div>
  )
}

function RequirementMetric({ label, verified, projected, required, color }) {
  const complete = verified >= required
  return (
    <div
      className="rounded-[18px] p-3"
      style={{ background: 'var(--panel-strong)', border: '1px solid var(--line)' }}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold" style={{ color: 'var(--text-soft)' }}>
          {label}
        </span>
        <span
          className="text-xs font-semibold"
          style={{ color: complete ? 'var(--success)' : color }}
        >
          {verified} verified · {projected} projected / {required}
        </span>
      </div>
      <MiniProgress
        value={projected}
        required={required}
        color={complete ? 'var(--success)' : color}
      />
    </div>
  )
}

function AcademicYearSelect({ record, years, onUpdateCourse }) {
  return (
    <select
      aria-label={`DRM academic year for ${record.code}`}
      value={record.academicYear || ''}
      onChange={(event) => onUpdateCourse(record, { drmAcademicYear: event.target.value || null })}
      className="rounded-lg border px-2 py-1 text-[11px]"
      style={{
        background: 'var(--panel)',
        borderColor: 'var(--line-strong)',
        color: 'var(--text-soft)',
      }}
    >
      <option value="">Select academic year</option>
      {years.map((year) => (
        <option key={year} value={year}>
          {year}
        </option>
      ))}
    </select>
  )
}

function SectionSelect({ record, onUpdateCourse }) {
  if (!normalizeDrmCourseCode(record.code).startsWith('API203M')) return null
  return (
    <select
      aria-label={`DRM section for ${record.code}`}
      value={record.section || ''}
      onChange={(event) => onUpdateCourse(record, { drmSection: event.target.value || null })}
      className="rounded-lg border px-2 py-1 text-[11px]"
      style={{
        background: 'var(--panel)',
        borderColor: 'var(--line-strong)',
        color: 'var(--text-soft)',
      }}
    >
      <option value="">Select section</option>
      {['A', 'B', 'C', 'D', 'Z'].map((section) => (
        <option key={section} value={section}>
          Section {section}
        </option>
      ))}
    </select>
  )
}

function CreditEditor({ record, onUpdateCourse }) {
  if (record.credits != null) {
    return (
      <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
        {record.credits} cr
      </span>
    )
  }
  return (
    <label className="flex items-center gap-1 text-[11px]" style={{ color: 'var(--warning)' }}>
      Credits required
      <select
        aria-label={`Credits for ${record.code}`}
        value=""
        onChange={(event) => {
          const value = Number(event.target.value)
          onUpdateCourse(record, { credits: Number.isFinite(value) && value > 0 ? value : null })
        }}
        className="rounded-lg border px-2 py-1"
        style={{
          background: 'var(--panel)',
          borderColor: 'var(--warning)',
          color: 'var(--text)',
        }}
      >
        <option value="">Select</option>
        {[0.5, 1, 2, 3, 4, 8].map((credits) => (
          <option key={credits} value={credits}>
            {credits} cr
          </option>
        ))}
      </select>
    </label>
  )
}

function GradeSelect({ record, onUpdateCourse }) {
  if (record.source !== 'completed') {
    return (
      <span className="text-[11px]" style={{ color: 'var(--blue)' }}>
        Planned
      </span>
    )
  }
  return (
    <select
      aria-label={`Grade for ${record.code}`}
      value={String(record.course?.grade || '').toUpperCase()}
      onChange={(event) => onUpdateCourse(record, { grade: event.target.value })}
      className="rounded-lg border px-2 py-1 text-[11px]"
      style={{
        background: 'var(--panel)',
        borderColor:
          record.gradeStatus === 'passing'
            ? 'var(--success)'
            : record.gradeStatus === 'below-minimum'
              ? 'var(--danger)'
              : 'var(--warning)',
        color: 'var(--text-soft)',
      }}
    >
      {DRM_GRADE_OPTIONS.map((grade) => (
        <option key={grade || 'missing'} value={grade}>
          {grade || 'Grade required'}
        </option>
      ))}
    </select>
  )
}

function AllocationSelect({ record, onAssignmentChange }) {
  return (
    <label className="flex flex-col gap-1 text-[10px]" style={{ color: 'var(--text-muted)' }}>
      {record.overlap
        ? `Counting choice · ${record.overlap.label} allowance ${record.overlap.cap} cr`
        : 'Counting choice · no official degree-overlap allowance'}
      <select
        aria-label={`DRM counting choice for ${record.code}`}
        value={record.requestedAllocation}
        onChange={(event) => onAssignmentChange(record.key, event.target.value)}
        className="rounded-lg border px-2 py-1 text-[11px]"
        style={{
          background: 'var(--panel)',
          borderColor: record.decisionRequired ? 'var(--warning)' : 'var(--line-strong)',
          color: 'var(--text-soft)',
        }}
      >
        <option value="auto">
          {record.overlap ? 'Double-count only when allowance permits' : 'Count toward DRM only'}
        </option>
        {record.overlap && <option value="drm">Count toward DRM only</option>}
        <option value="degree">Count toward degree requirements only</option>
      </select>
    </label>
  )
}

function CourseRow({ record, years, onUpdateCourse, onAssignmentChange }) {
  const allocationLabels = {
    drm: 'DRM credit',
    overlap: 'Allowed double-count',
    'drm-only': 'DRM only',
    'degree-only': 'Degree only',
  }
  return (
    <div
      className="rounded-[18px] p-3"
      style={{ background: 'var(--panel-strong)', border: '1px solid var(--line)' }}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold" style={{ color: 'var(--text)' }}>
              {record.code}
            </span>
            <span
              className="rounded-full px-2 py-0.5 text-[10px] font-semibold"
              style={{
                background:
                  record.group === 'A'
                    ? 'color-mix(in srgb, var(--blue) 14%, transparent)'
                    : 'color-mix(in srgb, var(--accent) 14%, transparent)',
                color: record.group === 'A' ? 'var(--blue)' : 'var(--accent)',
              }}
            >
              Group {record.group}
            </span>
            <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
              {allocationLabels[record.allocation]}
            </span>
          </div>
          {record.officialEntry?.raw && (
            <p className="mt-1 text-[10px]" style={{ color: 'var(--text-muted)' }}>
              Official listing: {record.officialEntry.raw}
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <CreditEditor record={record} onUpdateCourse={onUpdateCourse} />
          <GradeSelect record={record} onUpdateCourse={onUpdateCourse} />
          <AcademicYearSelect record={record} years={years} onUpdateCourse={onUpdateCourse} />
          <SectionSelect record={record} onUpdateCourse={onUpdateCourse} />
        </div>
      </div>
      <div className="mt-2">
        <AllocationSelect record={record} onAssignmentChange={onAssignmentChange} />
      </div>
      {record.decisionRequired && (
        <p className="mt-2 text-[11px] leading-4" style={{ color: 'var(--warning)' }}>
          The official overlap allowance is exhausted. The safe default is degree-only; choose DRM
          only if this course should stop satisfying that restricted degree requirement.
        </p>
      )}
      {record.gradeStatus === 'below-minimum' && (
        <p className="mt-2 text-[11px]" style={{ color: 'var(--danger)' }}>
          This course does not count toward DRM because the recorded grade is below B-.
        </p>
      )}
    </div>
  )
}

function ReviewCourseRow({ record, years, onUpdateCourse }) {
  const messages = {
    denied: 'The current official guidance explicitly lists this course as denied.',
    'not-listed': 'Not found in the official list for this academic year.',
    'year-required': 'Select the academic year in which you took or plan to take this course.',
    'unsupported-year': 'The official workbook does not include this academic year.',
    'section-required': 'The official group depends on the API-203M section.',
    'section-not-listed':
      'That section is not listed as qualifying for the selected academic year.',
  }
  return (
    <div
      className="rounded-[16px] p-3"
      style={{
        background: 'color-mix(in srgb, var(--warning) 6%, var(--panel-strong))',
        border: '1px solid color-mix(in srgb, var(--warning) 35%, var(--line))',
      }}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <span className="text-sm font-semibold" style={{ color: 'var(--text)' }}>
            {record.code}
          </span>
          <p className="mt-1 text-[11px]" style={{ color: 'var(--warning)' }}>
            {messages[record.status] || 'Needs review against the official list.'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <AcademicYearSelect record={record} years={years} onUpdateCourse={onUpdateCourse} />
          <SectionSelect record={record} onUpdateCourse={onUpdateCourse} />
        </div>
      </div>
    </div>
  )
}

export default function DrmPathwayPanel({
  progress,
  degreeProgress,
  collapsed,
  onToggle,
  onAssignmentChange,
  onUpdateCourse,
  preferredPacArea,
  onPreferredPacAreaChange,
}) {
  const degreeProjectedComplete =
    Boolean(degreeProgress) &&
    degreeProgress.overallPercent >= 100 &&
    degreeProgress.categories.every((category) => category.isComplete)

  if (!progress?.eligibleProgram) {
    return (
      <section
        className="rounded-[24px] p-5"
        style={{ background: 'var(--panel)', border: '1px solid var(--line)' }}
      >
        <p
          className="text-xs font-semibold uppercase tracking-[0.12em]"
          style={{ color: 'var(--blue)' }}
        >
          Official STEM status
        </p>
        <h2 className="mt-2 text-xl font-semibold" style={{ color: 'var(--text)' }}>
          MPA/ID is already STEM-designated
        </h2>
        <p className="mt-2 text-sm leading-6" style={{ color: 'var(--text-muted)' }}>
          The optional Data and Research Methods pathway applies only to MPP, MPA, and MC/MPA
          students.
        </p>
        <a
          className="mt-3 inline-flex text-sm font-semibold"
          style={{ color: 'var(--accent)' }}
          href={DRM_ARTICLE_URL}
          target="_blank"
          rel="noreferrer"
        >
          Official HKS guidance ↗
        </a>
      </section>
    )
  }

  return (
    <section
      data-tour="req-stem"
      className="rounded-[26px] p-5 md:p-6"
      style={{
        background: progress.courseRequirementsVerified
          ? 'linear-gradient(160deg, var(--success-soft), var(--panel))'
          : 'var(--panel)',
        border: `1px solid ${
          progress.courseRequirementsVerified ? 'var(--success)' : 'var(--line)'
        }`,
      }}
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p
            className="text-xs font-semibold uppercase tracking-[0.12em]"
            style={{ color: 'var(--accent)' }}
          >
            Official HKS guidance · article updated July 14, 2026
          </p>
          <h2 className="mt-2 text-2xl font-semibold" style={{ color: 'var(--text)' }}>
            Data &amp; Research Methods Pathway
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-6" style={{ color: 'var(--text-muted)' }}>
            At least 16 qualifying credits, including at least 4 Group A and 4 Group B credits.
            Every completed qualifying course must have a grade of B- or better.
          </p>
        </div>
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={!collapsed}
          className="rounded-full border px-3 py-1.5 text-xs font-semibold"
          style={{
            background: 'var(--panel-strong)',
            borderColor: 'var(--line-strong)',
            color: 'var(--text-soft)',
          }}
        >
          {collapsed ? 'Show details' : 'Minimize'}
        </button>
      </div>

      <div className="mt-4 flex flex-wrap gap-2 text-xs">
        <span
          className="rounded-full px-3 py-1 font-semibold"
          style={{
            background: progress.courseRequirementsVerified
              ? 'var(--success-soft)'
              : 'var(--accent-soft)',
            color: progress.courseRequirementsVerified ? 'var(--success)' : 'var(--text)',
          }}
        >
          {progress.verifiedCredits} verified · {progress.projectedCredits} projected / 16 cr
        </span>
        <span
          className="rounded-full px-3 py-1"
          style={{ background: 'var(--panel-strong)', color: 'var(--text-muted)' }}
        >
          Official workbook snapshot: June 25, 2026
        </span>
      </div>

      {!collapsed && (
        <>
          <div className="mt-5 grid gap-3 md:grid-cols-3">
            <RequirementMetric
              label="Total qualifying credits"
              verified={progress.verifiedCredits}
              projected={progress.projectedCredits}
              required={16}
              color="var(--accent)"
            />
            <RequirementMetric
              label="Group A · quantitative analysis"
              verified={progress.verifiedGroupA}
              projected={progress.projectedGroupA}
              required={4}
              color="var(--blue)"
            />
            <RequirementMetric
              label="Group B · research methods"
              verified={progress.verifiedGroupB}
              projected={progress.projectedGroupB}
              required={4}
              color="var(--accent)"
            />
          </div>

          <div
            className="mt-4 rounded-[18px] p-4 text-sm leading-6"
            style={{
              background: degreeProjectedComplete
                ? 'color-mix(in srgb, var(--success) 7%, var(--panel-strong))'
                : 'var(--panel-strong)',
              border: '1px solid var(--line)',
              color: 'var(--text-muted)',
            }}
          >
            <strong style={{ color: 'var(--text)' }}>Degree requirement gate:</strong>{' '}
            {degreeProjectedComplete
              ? 'Your current plan projects all tracked program requirements as complete.'
              : 'The official pathway also requires you to enroll in and fulfill every requirement of your MPP, MPA, or MC/MPA degree.'}{' '}
            This planner does not replace Registrar certification.
          </div>

          {progress.programId?.startsWith('MPP') && (
            <div
              className="mt-4 rounded-[18px] p-4"
              style={{ background: 'var(--panel-strong)', border: '1px solid var(--line)' }}
            >
              <p className="text-sm font-semibold" style={{ color: 'var(--text)' }}>
                Declared MPP Policy Area of Concentration (PAC)
              </p>
              <p className="mt-1 text-xs leading-5" style={{ color: 'var(--text-muted)' }}>
                The official DRM guidance permits up to 4 qualifying declared-PAC elective credits
                to count toward both requirements. Select the PAC you have declared; leave this
                blank if you have not declared one.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {['BGP', 'DPI', 'IGA', 'DEV', 'SUP'].map((area) => {
                  const active = preferredPacArea === area
                  return (
                    <button
                      key={area}
                      type="button"
                      aria-pressed={active}
                      onClick={() => onPreferredPacAreaChange(area)}
                      className="rounded-full border px-3 py-1.5 text-xs font-semibold"
                      style={{
                        background: active ? 'var(--accent)' : 'var(--panel)',
                        borderColor: active ? 'var(--accent)' : 'var(--line-strong)',
                        color: active ? 'white' : 'var(--text-soft)',
                      }}
                    >
                      {area}
                    </button>
                  )
                })}
                {preferredPacArea && (
                  <button
                    type="button"
                    onClick={() => onPreferredPacAreaChange(preferredPacArea)}
                    className="rounded-full border px-3 py-1.5 text-xs font-semibold"
                    style={{
                      background: 'transparent',
                      borderColor: 'var(--line-strong)',
                      color: 'var(--text-muted)',
                    }}
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>
          )}

          <div
            className="mt-4 rounded-[18px] p-4 text-sm leading-6"
            style={{
              background: 'color-mix(in srgb, var(--gold) 7%, var(--panel-strong))',
              border: '1px solid color-mix(in srgb, var(--gold) 35%, var(--line))',
              color: 'var(--text-muted)',
            }}
          >
            <strong style={{ color: 'var(--text)' }}>2027 graduates:</strong> declarations are due
            August 15, 2026. If you will not fulfill the pathway, notify the Registrar by the{' '}
            <a
              href={CALENDAR_URL}
              target="_blank"
              rel="noreferrer"
              style={{ color: 'var(--accent)' }}
            >
              Spring drop-without-notation deadline
            </a>
            . Declaring may affect federal student-loan eligibility; students borrowing federal
            loans should contact their{' '}
            <a
              href={AID_COUNSELOR_URL}
              target="_blank"
              rel="noreferrer"
              style={{ color: 'var(--accent)' }}
            >
              Admissions and Aid counselor
            </a>
            .
          </div>

          <div className="mt-5">
            <h3 className="text-sm font-semibold" style={{ color: 'var(--text)' }}>
              Qualifying courses in this plan
            </h3>
            <p className="mt-1 text-xs leading-5" style={{ color: 'var(--text-muted)' }}>
              MPP: up to 4 qualifying core credits and 4 qualifying declared-PAC credits may
              double-count. MPA and MC/MPA: up to 4 qualifying distribution credits may
              double-count. Cross-registered courses on the official list count toward the pathway
              credit allowance.
            </p>
            <div className="mt-3 space-y-2">
              {progress.courses.length ? (
                progress.courses.map((record) => (
                  <CourseRow
                    key={record.key}
                    record={record}
                    years={progress.availableAcademicYears}
                    onUpdateCourse={onUpdateCourse}
                    onAssignmentChange={onAssignmentChange}
                  />
                ))
              ) : (
                <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                  No courses in this plan match the official year-specific DRM workbook yet.
                </p>
              )}
            </div>
          </div>

          {progress.reviewCourses.length > 0 && (
            <div className="mt-5">
              <h3 className="text-sm font-semibold" style={{ color: 'var(--warning)' }}>
                Courses requiring official-list review
              </h3>
              <div className="mt-3 space-y-2">
                {progress.reviewCourses.map((record) => (
                  <ReviewCourseRow
                    key={`review-${record.key}`}
                    record={record}
                    years={progress.availableAcademicYears}
                    onUpdateCourse={onUpdateCourse}
                  />
                ))}
              </div>
            </div>
          )}

          <div
            className="mt-5 rounded-[18px] p-4"
            style={{ background: 'var(--panel-strong)', border: '1px solid var(--line)' }}
          >
            <p
              className="text-xs font-semibold uppercase tracking-[0.12em]"
              style={{ color: 'var(--text-soft)' }}
            >
              Official sources
            </p>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-2 text-sm">
              <a
                href={DRM_ARTICLE_URL}
                target="_blank"
                rel="noreferrer"
                style={{ color: 'var(--accent)' }}
              >
                Pathway requirements ↗
              </a>
              <a
                href={DRM_WORKBOOK_URL}
                target="_blank"
                rel="noreferrer"
                style={{ color: 'var(--accent)' }}
              >
                Year-specific qualifying courses ↗
              </a>
              <a
                href={DRM_PETITION_FORM_URL}
                target="_blank"
                rel="noreferrer"
                style={{ color: 'var(--accent)' }}
              >
                Petition form ↗
              </a>
            </div>
            <p className="mt-3 text-xs leading-5" style={{ color: 'var(--text-muted)' }}>
              HKS may add courses during the academic year as petitions are reviewed. Students may
              not petition to move a course from its assigned group, and HKS advises graduating
              students not to rely on an unapproved course during their graduating term.
            </p>
          </div>
        </>
      )}
    </section>
  )
}
