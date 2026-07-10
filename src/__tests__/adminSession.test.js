import { afterEach, describe, expect, it, vi } from 'vitest'
import { signJWT } from '../../functions/_shared/jwt.js'
import {
  ADMIN_SESSION_TTL_SECONDS,
  issueAdminSession,
  requireAdminSession,
} from '../../functions/_shared/adminSession.js'

const secret = 'a-long-random-admin-session-secret-value'
const env = { ADMIN_SESSION_SECRET: secret }
const requestFor = (session) =>
  new Request('https://app.example/api/admin-upload', {
    headers: { 'X-Admin-Session': session },
  })

afterEach(() => vi.useRealTimers())

describe('admin server sessions', () => {
  it('expires a session after its fixed 15-minute lifetime', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-09T00:00:00Z'))
    const session = await issueAdminSession(env)

    vi.setSystemTime(
      new Date((Date.parse('2026-07-09T00:00:00Z') / 1000 + ADMIN_SESSION_TTL_SECONDS + 1) * 1000),
    )
    await expect(requireAdminSession(requestFor(session), env)).resolves.toBeNull()
  })

  it('rejects a correctly signed session with a future issued-at claim', async () => {
    vi.useFakeTimers()
    const now = Math.floor(Date.parse('2026-07-09T00:00:00Z') / 1000)
    vi.setSystemTime(new Date(now * 1000))
    const session = await signJWT(
      {
        iss: 'hks-course-explorer-admin',
        scope: 'admin:data',
        iat: now + 31,
        exp: now + ADMIN_SESSION_TTL_SECONDS,
      },
      secret,
    )

    await expect(requireAdminSession(requestFor(session), env)).resolves.toBeNull()
  })

  it('invalidates outstanding sessions when the signing secret is rotated', async () => {
    const session = await issueAdminSession(env)

    await expect(
      requireAdminSession(requestFor(session), {
        ADMIN_SESSION_SECRET: 'a-different-long-random-admin-session-secret',
      }),
    ).resolves.toBeNull()
  })
})
