import { useCallback, useEffect, useMemo, useState } from 'react'
import { verifyAdminPassword } from '../lib/adminAuth.js'
import {
  ADMIN_UPLOAD_MAX_ROWS,
  AdminDataApiError,
  loadAdminUploadHistory,
  uploadAdminRows,
} from '../lib/adminDataApi.js'
import { parseXlsx } from '../lib/xlsxParser.js'

export const ADMIN_UPLOAD_CONFIG = [
  {
    key: 'bidding',
    label: 'Bidding Data',
    table: 'bidding',
    requiredColumns: ['course_code', 'bid_clearing_price'],
    expectedColumns: [
      'course_code',
      'bid_clearing_price',
      'bid_capacity',
      'bid_n_bids',
      'academic_year',
      'term',
    ],
    hint: 'One row per course section with bidding data. Required: course_code, bid_clearing_price.',
  },
  {
    key: 'qguide',
    label: 'Q Guide Scores',
    table: 'qguide',
    requiredColumns: ['course_code', 'instructor_rating', 'course_rating'],
    expectedColumns: [
      'course_code',
      'instructor_rating',
      'course_rating',
      'workload',
      'year',
      'term',
    ],
    hint: 'One row per course-year-term. Required: course_code, instructor_rating, course_rating.',
  },
  {
    key: 'requirements_tags',
    label: 'Requirements Tags',
    table: 'requirements_tags',
    requiredColumns: ['course_code_base'],
    expectedColumns: ['course_code_base', 'is_core', 'is_stem'],
    hint: 'One row per course code base. Required: course_code_base.',
  },
  {
    key: 'stem_designations',
    label: 'STEM Designations',
    table: 'stem_designations',
    requiredColumns: ['course_code_base', 'is_stem'],
    expectedColumns: ['course_code_base', 'is_stem', 'stem_group', 'stem_school'],
    hint: 'One row per course. Required: course_code_base, is_stem.',
  },
]

export function getMissingColumns(parsedHeaders, expectedColumns) {
  return expectedColumns.filter((column) => !parsedHeaders.includes(column))
}

export function getUploadReadiness(config, state) {
  const hasWorkbook = Boolean(state?.file && state.rows?.length > 0)
  const headers = Array.isArray(state?.headers) ? state.headers : []
  const missingColumns =
    hasWorkbook && config?.expectedColumns ? getMissingColumns(headers, config.expectedColumns) : []
  const missingRequiredColumns =
    hasWorkbook && config?.requiredColumns ? getMissingColumns(headers, config.requiredColumns) : []
  return {
    hasWorkbook,
    missingColumns,
    missingRequiredColumns,
    canUpload: hasWorkbook && missingRequiredColumns.length === 0,
  }
}

function sanitizeRows(rows) {
  return rows.map((row) =>
    Object.fromEntries(
      Object.entries(row).map(([key, value]) => [key, value === '' ? null : value]),
    ),
  )
}

function PreviewTable({ rows }) {
  const headers = rows.length > 0 ? Object.keys(rows[0]) : []

  if (!headers.length) {
    return (
      <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
        No rows parsed yet.
      </p>
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-xs">
        <thead>
          <tr style={{ borderBottom: '1px solid var(--line)' }}>
            {headers.map((header) => (
              <th
                key={header}
                scope="col"
                className="px-3 py-2 font-semibold"
                style={{ color: 'var(--text-soft)' }}
              >
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, 5).map((row, index) => (
            <tr key={index} style={{ borderBottom: '1px solid var(--line)' }}>
              {headers.map((header) => (
                <td
                  key={`${index}-${header}`}
                  className="px-3 py-2 align-top"
                  style={{ color: 'var(--text-muted)' }}
                >
                  {String(row[header] ?? '')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function UploadSection({ config, state, onSelectFile, onUpload }) {
  const { missingColumns, missingRequiredColumns, canUpload } = getUploadReadiness(config, state)

  return (
    <section
      className="rounded-[24px] p-5"
      style={{ background: 'var(--panel)', border: '1px solid var(--line)' }}
    >
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p
            className="text-xs font-semibold uppercase tracking-[0.12em]"
            style={{ color: 'var(--gold)' }}
          >
            Upload Target
          </p>
          <h2 className="mt-2 text-xl font-semibold" style={{ color: 'var(--text)' }}>
            {config.label}
          </h2>
          <p className="mt-2 text-sm leading-6" style={{ color: 'var(--text-muted)' }}>
            {config.hint || `Rows will be inserted into the `}
            <span style={{ color: 'var(--text-soft)' }}>{config.table}</span>
            {config.hint ? '' : ' table.'}
          </p>
          {config.expectedColumns && (
            <p className="mt-2 text-xs" style={{ color: 'var(--text-muted)' }}>
              Expected columns:{' '}
              <span style={{ color: 'var(--text-soft)' }}>{config.expectedColumns.join(', ')}</span>
            </p>
          )}
        </div>

        <button
          type="button"
          disabled={!canUpload || state.uploading}
          onClick={() => onUpload(config.key)}
          className="rounded-full px-4 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60"
          style={{
            background: 'var(--gold-soft)',
            border: '1px solid var(--line)',
            color: 'var(--text)',
          }}
        >
          {state.uploading ? 'Uploading...' : 'Confirm upload'}
        </button>
      </div>

      <label
        className="mt-5 block rounded-[20px] p-5 text-center"
        style={{ background: 'var(--panel-strong)', border: '1px dashed var(--line)' }}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault()
          const file = event.dataTransfer.files?.[0]
          if (file) {
            onSelectFile(config.key, file)
          }
        }}
      >
        <input
          type="file"
          accept=".xlsx,.xls"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (file) {
              onSelectFile(config.key, file)
            }
          }}
        />
        <p className="text-sm font-semibold" style={{ color: 'var(--text)' }}>
          Drag and drop an Excel file here
        </p>
        <p className="mt-2 text-xs" style={{ color: 'var(--text-muted)' }}>
          or click to choose a file
        </p>
      </label>

      <div className="mt-4 flex flex-wrap gap-4 text-xs">
        <span style={{ color: 'var(--text-soft)' }}>
          File: <span style={{ color: 'var(--text-muted)' }}>{state.file?.name || 'none'}</span>
        </span>
        <span style={{ color: 'var(--text-soft)' }}>
          Rows: <span style={{ color: 'var(--text-muted)' }}>{state.rows.length}</span>
        </span>
        {state.error && <span style={{ color: 'var(--danger)' }}>{state.error}</span>}
        {state.message && !state.error && (
          <span style={{ color: 'var(--success)' }}>{state.message}</span>
        )}
      </div>
      {missingRequiredColumns.length > 0 && (
        <div
          className="mt-3 rounded-[16px] border px-4 py-3 text-xs"
          style={{
            background: 'var(--panel-soft)',
            borderColor: 'var(--danger)',
            color: 'var(--danger)',
          }}
        >
          Required columns missing: <strong>{missingRequiredColumns.join(', ')}</strong>. Upload is
          disabled.
        </div>
      )}
      {missingColumns.length > 0 && missingRequiredColumns.length === 0 && (
        <div
          className="mt-3 rounded-[16px] border px-4 py-3 text-xs"
          style={{
            background: 'var(--panel-soft)',
            borderColor: 'var(--warning)',
            color: 'var(--warning)',
          }}
        >
          ⚠ Missing expected columns: <strong>{missingColumns.join(', ')}</strong>. Upload may fail
          or produce incomplete data.
        </div>
      )}

      <div
        className="mt-4 rounded-[20px] p-4"
        style={{ background: 'var(--panel-strong)', border: '1px solid var(--line)' }}
      >
        <PreviewTable rows={state.rows} />
      </div>
    </section>
  )
}

function UploadHistoryTable({ rows }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr style={{ borderBottom: '1px solid var(--line)' }}>
            <th
              scope="col"
              className="px-3 py-2 font-semibold"
              style={{ color: 'var(--text-soft)' }}
            >
              Type
            </th>
            <th
              scope="col"
              className="px-3 py-2 font-semibold"
              style={{ color: 'var(--text-soft)' }}
            >
              Filename
            </th>
            <th
              scope="col"
              className="px-3 py-2 font-semibold"
              style={{ color: 'var(--text-soft)' }}
            >
              Rows
            </th>
            <th
              scope="col"
              className="px-3 py-2 font-semibold"
              style={{ color: 'var(--text-soft)' }}
            >
              Status
            </th>
            <th
              scope="col"
              className="px-3 py-2 font-semibold"
              style={{ color: 'var(--text-soft)' }}
            >
              Uploaded
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.id ?? `${row.filename}-${row.created_at}`}
              style={{ borderBottom: '1px solid var(--line)' }}
            >
              <td className="px-3 py-2" style={{ color: 'var(--text)' }}>
                {row.type || '—'}
              </td>
              <td className="px-3 py-2" style={{ color: 'var(--text-muted)' }}>
                {row.filename || '—'}
              </td>
              <td className="px-3 py-2" style={{ color: 'var(--text-muted)' }}>
                {row.row_count ?? row.rows ?? '—'}
              </td>
              <td className="px-3 py-2" style={{ color: 'var(--text-muted)' }}>
                {row.status || '—'}
              </td>
              <td className="px-3 py-2" style={{ color: 'var(--text-muted)' }}>
                {row.created_at ? new Date(row.created_at).toLocaleString() : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function Admin() {
  const [password, setPassword] = useState('')
  const [authError, setAuthError] = useState('')
  const [authenticating, setAuthenticating] = useState(false)
  // The signed server session is intentionally in-memory. Browser storage is
  // user-controlled; a reload requires a fresh, server-validated sign-in.
  const [adminSession, setAdminSession] = useState(null)
  const [uploads, setUploads] = useState(() =>
    Object.fromEntries(
      ADMIN_UPLOAD_CONFIG.map((config) => [
        config.key,
        { file: null, rows: [], headers: [], error: '', message: '', uploading: false },
      ]),
    ),
  )
  const [recentUploads, setRecentUploads] = useState([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyError, setHistoryError] = useState('')

  const sections = useMemo(() => ADMIN_UPLOAD_CONFIG, [])
  const isAuthed = typeof adminSession === 'string'

  const loadRecentUploads = useCallback(async () => {
    if (!adminSession) return
    setHistoryLoading(true)
    setHistoryError('')
    try {
      setRecentUploads(await loadAdminUploadHistory(adminSession))
    } catch (error) {
      setRecentUploads([])
      setHistoryError(error.message || 'Could not load upload history.')
      if (error instanceof AdminDataApiError && error.status === 401) setAdminSession(null)
    } finally {
      setHistoryLoading(false)
    }
  }, [adminSession])

  useEffect(() => {
    if (!isAuthed) return
    void loadRecentUploads()
  }, [isAuthed, loadRecentUploads])

  const handleAuth = async (event) => {
    event.preventDefault()
    setAuthenticating(true)
    setAuthError('')
    try {
      const session = await verifyAdminPassword(password)
      setAdminSession(session)
      setPassword('')
    } catch (error) {
      setAuthError(error.message || 'Admin verification failed. Please try again later.')
    } finally {
      setAuthenticating(false)
    }
  }

  const handleSelectFile = async (key, file) => {
    try {
      const parsed = await parseXlsx(file)
      if (parsed.rows.length > ADMIN_UPLOAD_MAX_ROWS) {
        throw new Error(
          `This import has ${parsed.rows.length} rows. Admin uploads are limited to ${ADMIN_UPLOAD_MAX_ROWS} rows.`,
        )
      }
      setUploads((current) => ({
        ...current,
        [key]: {
          ...current[key],
          file,
          rows: parsed.rows,
          headers: parsed.headers,
          error: '',
          message: `Parsed ${parsed.rows.length} rows from ${parsed.sheetName}`,
          uploading: false,
        },
      }))
    } catch (error) {
      setUploads((current) => ({
        ...current,
        [key]: {
          ...current[key],
          file: null,
          rows: [],
          headers: [],
          error: error.message || 'Could not parse workbook',
          message: '',
          uploading: false,
        },
      }))
    }
  }

  const handleUpload = async (key) => {
    const config = ADMIN_UPLOAD_CONFIG.find((item) => item.key === key)
    const state = uploads[key]
    if (!config || !state || state.rows.length === 0) return
    const readiness = getUploadReadiness(config, state)
    if (!readiness.canUpload) {
      setUploads((current) => ({
        ...current,
        [key]: {
          ...current[key],
          error: `Required columns missing: ${readiness.missingRequiredColumns.join(', ')}`,
          message: '',
        },
      }))
      return
    }

    setUploads((current) => ({
      ...current,
      [key]: { ...current[key], uploading: true, error: '', message: '' },
    }))

    try {
      const payload = sanitizeRows(state.rows)
      await uploadAdminRows(config.key, payload, adminSession, {
        filename: state.file?.name ?? null,
      })

      setUploads((current) => ({
        ...current,
        [key]: {
          ...current[key],
          uploading: false,
          message: `Staged ${payload.length} rows in ${config.table}. Publishing requires the documented review and catalogue rebuild.`,
        },
      }))
      void loadRecentUploads()
    } catch (error) {
      setUploads((current) => ({
        ...current,
        [key]: {
          ...current[key],
          uploading: false,
          error: error.message || 'Upload failed',
        },
      }))
      if (error instanceof AdminDataApiError && error.status === 401) setAdminSession(null)
    }
  }

  if (!isAuthed) {
    return (
      <div className="h-full overflow-y-auto px-6 py-10 md:px-10">
        <div
          className="mx-auto max-w-lg rounded-[28px] p-6"
          style={{ background: 'var(--panel)', border: '1px solid var(--line)' }}
        >
          <p className="kicker">Restricted</p>
          <h1
            className="serif-display mt-2 text-4xl font-semibold"
            style={{ color: 'var(--text)' }}
          >
            Admin
          </h1>
          <p className="mt-3 text-sm leading-6" style={{ color: 'var(--text-muted)' }}>
            Enter the admin password to access the hidden upload tools.
          </p>

          <form className="mt-6" onSubmit={handleAuth}>
            <label
              className="mb-2 block text-xs font-semibold uppercase tracking-[0.12em]"
              style={{ color: 'var(--text-muted)' }}
            >
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(event) => {
                setPassword(event.target.value)
                setAuthError('')
              }}
              placeholder="Enter admin password"
              style={{ borderColor: authError ? 'var(--danger)' : undefined }}
            />
            {authError && (
              <p className="mt-2 text-sm font-semibold" style={{ color: 'var(--danger)' }}>
                {authError}
              </p>
            )}
            <button
              type="submit"
              disabled={authenticating}
              className="mt-4 rounded-full px-4 py-2 text-sm font-semibold transition-transform hover:-translate-y-[1px]"
              style={{
                background: 'var(--gold-soft)',
                border: '1px solid var(--line)',
                color: 'var(--text)',
              }}
            >
              {authenticating ? 'Verifying...' : 'Unlock admin'}
            </button>
          </form>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto px-6 py-8 md:px-10">
      <div className="mx-auto flex max-w-6xl flex-col gap-6">
        <div
          className="rounded-[28px] p-6"
          style={{ background: 'var(--panel)', border: '1px solid var(--line)' }}
        >
          <p className="kicker">Hidden Feature</p>
          <h1
            className="serif-display mt-2 text-4xl font-semibold"
            style={{ color: 'var(--text)' }}
          >
            Admin Uploads
          </h1>
          <p className="mt-3 max-w-3xl text-sm leading-6" style={{ color: 'var(--text-muted)' }}>
            Stage reviewed Excel source rows here. Uploading records source data and its audit
            trail; it does not publish changes to course cards automatically.
          </p>
        </div>

        <section
          className="rounded-[24px] p-5"
          style={{ background: 'var(--panel)', border: '1px solid var(--line)' }}
        >
          <p
            className="text-xs font-semibold uppercase tracking-[0.12em]"
            style={{ color: 'var(--gold)' }}
          >
            Recent Uploads
          </p>
          <h2 className="mt-2 text-xl font-semibold" style={{ color: 'var(--text)' }}>
            Upload History
          </h2>
          <div
            className="mt-4 rounded-[20px] p-4"
            style={{ background: 'var(--panel-strong)', border: '1px solid var(--line)' }}
          >
            {historyLoading ? (
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                Loading upload history...
              </p>
            ) : recentUploads.length > 0 ? (
              <UploadHistoryTable rows={recentUploads} />
            ) : (
              <p
                className="text-sm"
                style={{ color: historyError ? 'var(--danger)' : 'var(--text-muted)' }}
              >
                {historyError || 'No uploads yet'}
              </p>
            )}
          </div>
        </section>

        <div className="grid gap-5">
          {sections.map((config) => (
            <UploadSection
              key={config.key}
              config={config}
              state={uploads[config.key]}
              onSelectFile={handleSelectFile}
              onUpload={handleUpload}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
