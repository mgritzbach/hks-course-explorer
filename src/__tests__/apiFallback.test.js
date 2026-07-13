import { describe, expect, it } from 'vitest'
import { onRequest } from '../../functions/api/[[path]].js'

describe('retired and unknown API routes', () => {
  it.each([
    ['POST', '/api/auth/request'],
    ['POST', '/api/auth/verify'],
    ['GET', '/api/auth/status'],
    ['POST', '/api/auth/logout'],
    ['GET', '/api/courses'],
    ['GET', '/api/unknown'],
  ])('returns a non-cacheable 404 for %s %s', async (method, pathname) => {
    const request = new Request(`https://hks-course-explorer.pages.dev${pathname}`, { method })
    const response = onRequest({ request })

    expect(response.status).toBe(404)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff')
    await expect(response.json()).resolves.toEqual({ error: 'Not found' })
  })
})
