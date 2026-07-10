// Contract for the Admin data endpoints. Only these existing, intentionally
// supported import targets can be addressed; clients can never choose a table
// name or arbitrary column set.

import { corsHeaders } from './cors.js'

export const ADMIN_REQUEST_LIMITS = Object.freeze({
  maxJsonBytes: 5 * 1024 * 1024,
  maxRows: 5_000,
  maxColumnsPerRow: 10,
  maxStringLength: 1_000,
})

export const ADMIN_UPLOAD_TARGETS = Object.freeze({
  bidding: Object.freeze({
    table: 'bidding',
    requiredColumns: Object.freeze(['course_code', 'bid_clearing_price']),
    allowedColumns: Object.freeze([
      'course_code',
      'bid_clearing_price',
      'bid_capacity',
      'bid_n_bids',
      'academic_year',
      'term',
    ]),
    numericColumns: Object.freeze(['bid_clearing_price']),
    integerColumns: Object.freeze(['bid_capacity', 'bid_n_bids']),
  }),
  qguide: Object.freeze({
    table: 'qguide',
    requiredColumns: Object.freeze(['course_code', 'instructor_rating', 'course_rating']),
    allowedColumns: Object.freeze([
      'course_code',
      'instructor_rating',
      'course_rating',
      'workload',
      'year',
      'term',
    ]),
    numericColumns: Object.freeze(['instructor_rating', 'course_rating', 'workload']),
    integerColumns: Object.freeze(['year']),
  }),
  requirements_tags: Object.freeze({
    table: 'requirements_tags',
    requiredColumns: Object.freeze(['course_code_base']),
    allowedColumns: Object.freeze(['course_code_base', 'is_core', 'is_stem']),
    booleanColumns: Object.freeze(['is_core', 'is_stem']),
  }),
  stem_designations: Object.freeze({
    table: 'stem_designations',
    requiredColumns: Object.freeze(['course_code_base', 'is_stem']),
    allowedColumns: Object.freeze(['course_code_base', 'is_stem', 'stem_group', 'stem_school']),
    booleanColumns: Object.freeze(['is_stem']),
  }),
})

// Keep this projection aligned with the pre-existing production `uploads`
// contract. The browser receives stable field names via `sanitizeHistory`.
export const UPLOAD_HISTORY_COLUMNS = 'id,upload_type,filename,row_count,status,uploaded_at'

export function jsonResponse(request, status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...corsHeaders(request),
    },
  })
}

export async function readBoundedJson(request, maxBytes = ADMIN_REQUEST_LIMITS.maxJsonBytes) {
  const contentLength = request.headers.get('Content-Length')
  if (contentLength && (!/^\d+$/.test(contentLength) || Number(contentLength) > maxBytes)) {
    return { ok: false, status: 413, error: 'Request body is too large.' }
  }

  if (!request.body) return { ok: false, status: 400, error: 'Invalid request body.' }

  const reader = request.body.getReader()
  const chunks = []
  let totalBytes = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      totalBytes += value.byteLength
      if (totalBytes > maxBytes) {
        // Stop the stream immediately so a missing or forged Content-Length
        // cannot make the Function materialize an unbounded request body.
        await reader.cancel('Request body exceeded maximum size').catch(() => {})
        return { ok: false, status: 413, error: 'Request body is too large.' }
      }
      chunks.push(value)
    }
  } catch {
    return { ok: false, status: 400, error: 'Invalid request body.' }
  } finally {
    reader.releaseLock()
  }

  const bytes = new Uint8Array(totalBytes)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  try {
    return { ok: true, value: JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) }
  } catch {
    return { ok: false, status: 400, error: 'Invalid JSON.' }
  }
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function isScalar(value) {
  return (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  )
}

function normalizedFilename(value) {
  if (value === undefined || value === null || value === '') return { ok: true, filename: null }
  if (typeof value !== 'string') return { ok: false }
  const filename = value.trim()
  if (!filename || filename.length > 255 || /[\r\n]/.test(filename)) return { ok: false }
  return { ok: true, filename }
}

function importKey(type, row) {
  if (type === 'bidding') return `${row.course_code}|${row.academic_year ?? ''}|${row.term ?? ''}`
  if (type === 'qguide') return `${row.course_code}|${row.year ?? ''}|${row.term ?? ''}`
  return row.course_code_base
}

function coerceTypedCell(target, column, value) {
  if (value === null || value === '') return { ok: true, value: null }
  if (target.numericColumns?.includes(column) || target.integerColumns?.includes(column)) {
    const numeric =
      typeof value === 'number'
        ? value
        : typeof value === 'string' && value.trim()
          ? Number(value)
          : NaN
    if (
      !Number.isFinite(numeric) ||
      (target.integerColumns?.includes(column) && !Number.isInteger(numeric))
    )
      return { ok: false }
    return { ok: true, value: numeric }
  }
  if (target.booleanColumns?.includes(column)) {
    if (typeof value === 'boolean') return { ok: true, value }
    if (typeof value === 'number' && (value === 0 || value === 1))
      return { ok: true, value: Boolean(value) }
    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase()
      if (['true', 'yes', '1'].includes(normalized)) return { ok: true, value: true }
      if (['false', 'no', '0'].includes(normalized)) return { ok: true, value: false }
    }
    return { ok: false }
  }
  return { ok: true, value: value === '' ? null : value }
}

export function validateUploadPayload(value) {
  if (!isPlainObject(value) || typeof value.type !== 'string' || !Array.isArray(value.rows)) {
    return { ok: false, status: 400, error: 'Upload must contain a supported type and rows array.' }
  }
  const target = ADMIN_UPLOAD_TARGETS[value.type]
  if (!target) return { ok: false, status: 400, error: 'Unsupported upload target.' }
  const filename = normalizedFilename(value.filename)
  if (!filename.ok) return { ok: false, status: 400, error: 'Upload filename is invalid.' }
  if (value.rows.length < 1 || value.rows.length > ADMIN_REQUEST_LIMITS.maxRows) {
    return {
      ok: false,
      status: 400,
      error: `Upload must contain 1 to ${ADMIN_REQUEST_LIMITS.maxRows} rows.`,
    }
  }

  const allowedColumns = new Set(target.allowedColumns)
  const normalizedRows = []
  const naturalKeys = new Set()
  for (const row of value.rows) {
    if (!isPlainObject(row))
      return { ok: false, status: 400, error: 'Every upload row must be an object.' }
    const entries = Object.entries(row)
    if (entries.length === 0 || entries.length > ADMIN_REQUEST_LIMITS.maxColumnsPerRow) {
      return { ok: false, status: 400, error: 'An upload row has an invalid number of columns.' }
    }
    const normalized = {}
    for (const [column, cell] of entries) {
      if (
        !allowedColumns.has(column) ||
        !isScalar(cell) ||
        (typeof cell === 'number' && !Number.isFinite(cell))
      ) {
        return {
          ok: false,
          status: 400,
          error: 'Upload contains an unsupported column or cell value.',
        }
      }
      if (typeof cell === 'string' && cell.length > ADMIN_REQUEST_LIMITS.maxStringLength) {
        return { ok: false, status: 400, error: 'Upload contains a cell that is too long.' }
      }
      const typedCell = coerceTypedCell(target, column, cell)
      if (!typedCell.ok)
        return { ok: false, status: 400, error: `Upload contains an invalid ${column} value.` }
      normalized[column] = typedCell.value
    }
    if (
      !target.requiredColumns.every(
        (column) => Object.hasOwn(normalized, column) && normalized[column] !== null,
      )
    ) {
      return { ok: false, status: 400, error: 'An upload row is missing a required value.' }
    }
    const key = importKey(value.type, normalized)
    if (naturalKeys.has(key)) {
      return { ok: false, status: 400, error: 'Upload contains duplicate natural keys.' }
    }
    naturalKeys.add(key)
    normalizedRows.push(normalized)
  }

  return { ok: true, target, filename: filename.filename, rows: normalizedRows }
}

export function serviceRoleConfig(env) {
  const url = typeof env?.SUPABASE_URL === 'string' ? env.SUPABASE_URL.replace(/\/+$/, '') : ''
  const key = env?.SUPABASE_SERVICE_ROLE_KEY
  if (!/^https:\/\/.+/.test(url) || typeof key !== 'string' || key.length < 20) return null
  return { url, key }
}

export async function fetchSupabase(url, key, path, options = {}, fetchImpl = fetch) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10_000)
  try {
    return await fetchImpl(`${url}/rest/v1/${path}`, {
      ...options,
      signal: controller.signal,
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        ...options.headers,
      },
    })
  } finally {
    clearTimeout(timeout)
  }
}
