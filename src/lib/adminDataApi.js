// Browser client for server-enforced admin data endpoints. The signed session
// is supplied by React state and must never be persisted in local/session
// storage, URLs, or cookies.

const ADMIN_UPLOAD_ENDPOINT = '/api/admin-upload'
const ADMIN_HISTORY_ENDPOINT = '/api/admin-history'

export const ADMIN_UPLOAD_MAX_ROWS = 5_000

export class AdminDataApiError extends Error {
  constructor(message, status) {
    super(message)
    this.name = 'AdminDataApiError'
    this.status = status
  }
}

async function requestAdmin(endpoint, session, options, fetchImpl = fetch) {
  if (typeof session !== 'string' || session.length < 1 || session.length > 4096) {
    throw new AdminDataApiError('Admin session expired. Sign in again.', 401)
  }
  let response
  try {
    response = await fetchImpl(endpoint, {
      ...options,
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json',
        'X-Admin-Session': session,
        ...options.headers,
      },
    })
  } catch {
    throw new AdminDataApiError('Admin data service is unavailable. Please try again later.', 0)
  }

  let payload
  try {
    payload = await response.json()
  } catch {
    throw new AdminDataApiError('Admin data service returned an invalid response.', response.status)
  }
  if (!response.ok || payload?.ok !== true) {
    throw new AdminDataApiError(payload?.error || 'Admin data request failed.', response.status)
  }
  return payload
}

export async function uploadAdminRows(
  type,
  rows,
  session,
  { filename = null, fetchImpl = fetch } = {},
) {
  if (!Array.isArray(rows) || rows.length < 1 || rows.length > ADMIN_UPLOAD_MAX_ROWS) {
    throw new AdminDataApiError(`Upload must contain 1 to ${ADMIN_UPLOAD_MAX_ROWS} rows.`, 400)
  }
  const payload = await requestAdmin(
    ADMIN_UPLOAD_ENDPOINT,
    session,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, filename, rows }),
    },
    fetchImpl,
  )
  if (!Number.isInteger(payload.uploaded) || payload.uploaded !== rows.length) {
    throw new AdminDataApiError('Admin data service returned an invalid upload response.', 502)
  }
  return payload
}

export async function loadAdminUploadHistory(session, { fetchImpl = fetch } = {}) {
  const payload = await requestAdmin(ADMIN_HISTORY_ENDPOINT, session, { method: 'GET' }, fetchImpl)
  if (!Array.isArray(payload.uploads)) {
    throw new AdminDataApiError('Admin data service returned an invalid history response.', 502)
  }
  return payload.uploads
}
