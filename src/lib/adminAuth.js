const ADMIN_VERIFY_ENDPOINT = '/api/admin-verify'

/**
 * Verifies an admin password with the Pages Function. The browser never
 * compares a password locally, so no admin credential is shipped in the app
 * bundle. The returned short-lived server session must remain in memory only.
 */
export async function verifyAdminPassword(password, { fetchImpl = fetch } = {}) {
  if (typeof password !== 'string' || password.length === 0) {
    throw new Error('Enter the admin password.')
  }

  let response
  try {
    response = await fetchImpl(ADMIN_VERIFY_ENDPOINT, {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ password }),
    })
  } catch {
    throw new Error('Admin verification is unavailable. Please try again later.')
  }

  let payload
  try {
    payload = await response.json()
  } catch {
    throw new Error('Admin verification returned an invalid response.')
  }

  if (response.status === 503) {
    throw new Error('Admin login is not configured. Contact an operator.')
  }

  if (response.status === 401) {
    throw new Error('Incorrect password. Try again.')
  }

  if (
    !response.ok ||
    payload?.ok !== true ||
    typeof payload?.session !== 'string' ||
    payload.session.length < 1 ||
    payload.session.length > 4096 ||
    Object.keys(payload).some((key) => key !== 'ok' && key !== 'session')
  ) {
    throw new Error('Admin verification returned an invalid response.')
  }
  return payload.session
}
