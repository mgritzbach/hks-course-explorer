import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { parseXlsx } from '../lib/xlsxParser.js'

const ADMIN_TOKEN_KEY = 'hks_admin_token'
const DEV_PASSWORD = 'hks2026admin'

const UPLOAD_CONFIG = [
  {
    key: 'bidding',
    label: 'Bidding Data',
    table: 'bidding',
    expectedColumns: ['course_code', 'bid_clearing_price', 'bid_capacity', 'bid_n_bids', 'academic_year', 'term'],
    hint: 'One row per course section with bidding data. Required: course_code, bid_clearing_price.',
  },
  {
    key: 'qguide',
    label: 'Q Guide Scores',
    table: 'qguide',
    expectedColumns: ['course_code', 'instructor_rating', 'course_rating', 'workload', 'year', 'term'],
    hint: 'One row per course-year-term. Required: course_code, instructor_rating, course_rating.',
  },
  {
    key: 'requirements_tags',
    label: 'Requirements Tags',
    table: 'requirements_tags',
    expectedColumns: ['course_code_base', 'is_core', 'is_stem'],
    hint: 'One row per course code base. Required: course_code_base.',
  },
  {
    key: 'stem_designations',
    label: 'STEM Designations',
    table: 'stem_designations',
    expectedColumns: ['course_code_base', 'is_stem', 'stem_group', 'stem_school'],
    hint: 'One row per course. Required: course_code_base, is_stem.',
  },
]

function getMissingColumns(parsedHeaders, expectedColumns) {
  const normalized = parsedHeaders.map((h) => String(h).trim().toLowerCase().replace(/[^a-z0-9_]/g, '_'))
  return expectedColumns.filter((col) => !normalized.some((h) => h === col || h.includes(col)))
}

function sanitizeRows(rows) {
  return rows.map((row) =>
    Object.fromEntries(
      Object.entries(row).map(([key, value]) => [key, value === '' ? null : value])
    )
  )
}

function PreviewTable({ rows }) {
  const headers = rows.length > 0 ? Object.keys(rows[0]) : []

  if (!headers.length) {
    return <p className="text-sm" style={{ color: 'var(--text-muted)' }}>No rows parsed yet.</p>
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-xs">
        <thead>
          <tr style={{ borderBottom: '1px solid var(--line)' }}>
            {headers.map((header) => (
              <th key={header} className="px-3 py-2 font-semibold" style={{ color: 'var(--text-soft)' }}>
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, 5).map((row, index) => (
            <tr key={index} style={{ borderBottom: '1px solid var(--line)' }}>
              {headers.map((header) => (
                <td key={`${index}-${header}`} className="px-3 py-2 align-top" style={{ color: 'var(--text-muted)' }}>
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
  const isReady = Boolean(state.file && state.rows.length > 0)
  const missingColumns = isReady && config.expectedColumns
    ? getMissingColumns(state.headers, config.expectedColumns)
    : []

  return (
    <section className="rounded-[24px] p-5" style={{ background: 'var(--panel)', border: '1px solid var(--line)' }}>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.12em]" style={{ color: 'var(--gold)' }}>
            Upload Target
          </p>
          <h2 className="mt-2 text-xl font-semibold" style={{ color: 'var(--text)' }}>
            {config.label}
          </h2>
          <p className="mt-2 text-sm leading-6" style={{ color: 'var(--text-muted)' }}>
            {config.hint || `Rows will be inserted into the `}<span style={{ color: 'var(--text-soft)' }}>{config.table}</span>{config.hint ? '' : ' table.'}
          </p>
          {config.expectedColumns && (
            <p className="mt-2 text-xs" style={{ color: 'var(--text-muted)' }}>
              Expected columns: <span style={{ color: 'var(--text-soft)' }}>{config.expectedColumns.join(', ')}</span>
            </p>
          )}
        </div>

        <button
          type="button"
          disabled={!isReady || state.uploading}
          onClick={() => onUpload(config.key)}
          className="rounded-full px-4 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60"
          style={{ background: 'var(--gold-soft)', border: '1px solid var(--line)', color: 'var(--text)' }}
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
        {state.message && !state.error && <span style={{ color: 'var(--success)' }}>{state.message}</span>}
      </div>
      {missingColumns.length > 0 && (
        <div className="mt-3 rounded-[16px] border px-4 py-3 text-xs" style={{ background: 'var(--panel-soft)', borderColor: 'var(--warning)', color: 'var(--warning)' }}>
          ⚠ Missing expected columns: <strong>{missingColumns.join(', ')}</strong>. Upload may fail or produce incomplete data.
        </div>
      )}

      <div className="mt-4 rounded-[20px] p-4" style={{ background: 'var(--panel-strong)', border: '1px solid var(--line)' }}>
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
            <th className="px-3 py-2 font-semibold" style={{ color: 'var(--text-soft)' }}>Type</th>
            <th className="px-3 py-2 font-semibold" style={{ color: 'var(--text-soft)' }}>Filename</th>
            <th className="px-3 py-2 font-semibold" style={{ color: 'var(--text-soft)' }}>Rows</th>
            <th className="px-3 py-2 font-semibold" style={{ color: 'var(--text-soft)' }}>Status</th>
            <th className="px-3 py-2 font-semibold" style={{ color: 'var(--text-soft)' }}>Uploaded</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id ?? `${row.filename}-${row.created_at}`} style={{ borderBottom: '1px solid var(--line)' }}>
              <td className="px-3 py-2" style={{ color: 'var(--text)' }}>{row.type || '—'}</td>
              <td className="px-3 py-2" style={{ color: 'var(--text-muted)' }}>{row.filename || '—'}</td>
              <td className="px-3 py-2" style={{ color: 'var(--text-muted)' }}>{row.row_count ?? row.rows ?? '—'}</td>
              <td className="px-3 py-2" style={{ color: 'var(--text-muted)' }}>{row.status || '—'}</td>
              <td className="px-3 py-2" style={{ color: 'var(--text-muted)' }}>{row.created_at ? new Date(row.created_at).toLocaleString() : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function Admin() {
  const [password, setPassword] = useState('')
  const [authError, setAuthError] = useState(false)
  const [isAuthed, setIsAuthed] = useState(() => {
    if (typeof window === 'undefined') return false
    return window.sessionStorage.getItem(ADMIN_TOKEN_KEY) === DEV_PASSWORD
  })
  const [uploads, setUploads] = useState(() =>
    Object.fromEntries(
      UPLOAD_CONFIG.map((config) => [
        config.key,
        { file: null, rows: [], headers: [], error: '', message: '', uploading: false },
      ])
    )
  )
  const [recentUploads, setRecentUploads] = useState([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyError, setHistoryError] = useState('')

  const sections = useMemo(() => UPLOAD_CONFIG, [])

  const loadRecentUploads = useCallback(async () => {
    setHistoryLoading(true)
    setHistoryError('')
    try {
      const { data, error } = await supabase
        .from('uploads')
        .select('id,type,filename,row_count,status,created_at')
        .order('created_at', { ascending: false })
        .limit(10)
      if (error) throw error
      setRecentUploads(Array.isArray(data) ? data : [])
    } catch (error) {
      setRecentUploads([])
      setHistoryError(error.message || 'Could not load upload history.')
    } finally {
      setHistoryLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!isAuthed) return
    void loadRecentUploads()
  }, [isAuthed, loadRecentUploads])

  const handleAuth = (event) => {
    event.preventDefault()
    if (password !== DEV_PASSWORD) {
      setAuthError(true)
      return
    }
    setAuthError(false)
    window.sessionStorage.setItem(ADMIN_TOKEN_KEY, DEV_PASSWORD)
    setIsAuthed(true)
  }

  const handleSelectFile = async (key, file) => {
    try {
      const parsed = await parseXlsx(file)
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
    const config = UPLOAD_CONFIG.find((item) => item.key === key)
    const state = uploads[key]
    if (!config || !state || state.rows.length === 0) return

    setUploads((current) => ({
      ...current,
      [key]: { ...current[key], uploading: true, error: '', message: '' },
    }))

    try {
      const payload = sanitizeRows(state.rows)
      const { error } = await supabase.from(config.table).insert(payload)
      if (error) throw error

      setUploads((current) => ({
        ...current,
        [key]: {
          ...current[key],
          uploading: false,
          message: `Uploaded ${payload.length} rows to ${config.table}`,
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
    }
  }

  if (!isAuthed) {
    return (
      <div className="h-full overflow-y-auto px-6 py-10 md:px-10">
        <div className="mx-auto max-w-lg rounded-[28px] p-6" style={{ background: 'var(--panel)', border: '1px solid var(--line)' }}>
          <p className="kicker">Restricted</p>
          <h1 className="serif-display mt-2 text-4xl font-semibold" style={{ color: 'var(--text)' }}>
            Admin
          </h1>
          <p className="mt-3 text-sm leading-6" style={{ color: 'var(--text-muted)' }}>
            Enter the admin password to access the hidden upload tools.
          </p>

          <form className="mt-6" onSubmit={handleAuth}>
            <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.12em]" style={{ color: 'var(--text-muted)' }}>
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(event) => { setPassword(event.target.value); setAuthError(false) }}
              placeholder="Enter admin password"
              style={{ borderColor: authError ? 'var(--danger)' : undefined }}
            />
            {authError && (
              <p className="mt-2 text-sm font-semibold" style={{ color: 'var(--danger)' }}>
                Incorrect password. Try again.
              </p>
            )}
            <button
              type="submit"
              className="mt-4 rounded-full px-4 py-2 text-sm font-semibold transition-transform hover:-translate-y-[1px]"
              style={{ background: 'var(--gold-soft)', border: '1px solid var(--line)', color: 'var(--text)' }}
            >
              Unlock admin
            </button>
          </form>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto px-6 py-8 md:px-10">
      <div className="mx-auto flex max-w-6xl flex-col gap-6">
        <div className="rounded-[28px] p-6" style={{ background: 'var(--panel)', border: '1px solid var(--line)' }}>
          <p className="kicker">Hidden Feature</p>
          <h1 className="serif-display mt-2 text-4xl font-semibold" style={{ color: 'var(--text)' }}>
            Admin Uploads
          </h1>
          <p className="mt-3 max-w-3xl text-sm leading-6" style={{ color: 'var(--text-muted)' }}>
            Use these import panels to stage Excel uploads before pushing rows into Supabase.
          </p>
        </div>

        <section className="rounded-[24px] p-5" style={{ background: 'var(--panel)', border: '1px solid var(--line)' }}>
          <p className="text-xs font-semibold uppercase tracking-[0.12em]" style={{ color: 'var(--gold)' }}>
            Recent Uploads
          </p>
          <h2 className="mt-2 text-xl font-semibold" style={{ color: 'var(--text)' }}>
            Upload History
          </h2>
          <div className="mt-4 rounded-[20px] p-4" style={{ background: 'var(--panel-strong)', border: '1px solid var(--line)' }}>
            {historyLoading ? (
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Loading upload history...</p>
            ) : recentUploads.length > 0 ? (
              <UploadHistoryTable rows={recentUploads} />
            ) : (
              <p className="text-sm" style={{ color: historyError ? 'var(--danger)' : 'var(--text-muted)' }}>
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
