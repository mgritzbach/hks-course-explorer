// Server-only administrator session utilities. Admin sessions are bearer
// credentials deliberately kept out of cookies and browser storage: the UI
// holds them in React state only and sends them in a custom header.

import { signJWT, verifyJWT } from './jwt.js'

export const ADMIN_SESSION_HEADER = 'X-Admin-Session'
export const ADMIN_SESSION_TTL_SECONDS = 15 * 60
const ADMIN_SESSION_ISSUER = 'hks-course-explorer-admin'
const ADMIN_SESSION_SCOPE = 'admin:data'

function unixNow() {
  return Math.floor(Date.now() / 1000)
}

function sessionSecret(env) {
  const secret = env?.ADMIN_SESSION_SECRET
  // A distinct 32-character secret prevents an ADMIN_PASSWORD rotation from
  // unexpectedly invalidating a signing key and avoids reusing user input as
  // HMAC key material.
  return typeof secret === 'string' && secret.length >= 32 ? secret : null
}

export async function issueAdminSession(env, now = unixNow()) {
  const secret = sessionSecret(env)
  if (!secret) return null

  return signJWT(
    {
      iss: ADMIN_SESSION_ISSUER,
      scope: ADMIN_SESSION_SCOPE,
      iat: now,
      exp: now + ADMIN_SESSION_TTL_SECONDS,
    },
    secret,
  )
}

export async function requireAdminSession(request, env, now = unixNow()) {
  const secret = sessionSecret(env)
  const token = request.headers.get(ADMIN_SESSION_HEADER)
  if (!secret || !token || token.length > 4096) return null

  const payload = await verifyJWT(token, secret)
  if (!payload || payload.iss !== ADMIN_SESSION_ISSUER || payload.scope !== ADMIN_SESSION_SCOPE) {
    return null
  }

  // verifyJWT checks exp. These additional checks prevent tokens created with
  // a future iat or an accidentally oversized TTL from being accepted.
  if (!Number.isInteger(payload.iat) || !Number.isInteger(payload.exp)) return null
  if (payload.iat > now + 30 || payload.exp - payload.iat > ADMIN_SESSION_TTL_SECONDS) return null
  return payload
}

export async function passwordMatches(password, configuredPassword) {
  if (typeof password !== 'string' || typeof configuredPassword !== 'string') return false
  const encoder = new TextEncoder()
  const digest = async (value) => crypto.subtle.digest('SHA-256', encoder.encode(value))
  const [provided, configured] = await Promise.all([digest(password), digest(configuredPassword)])
  const providedBytes = new Uint8Array(provided)
  const configuredBytes = new Uint8Array(configured)
  let difference = 0
  for (let index = 0; index < configuredBytes.length; index += 1) {
    difference |= providedBytes[index] ^ configuredBytes[index]
  }
  return difference === 0
}
