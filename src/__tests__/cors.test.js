import { describe, expect, it } from 'vitest'
import { corsHeaders, handleOptions } from '../../functions/_shared/cors.js'

function request(origin, url = 'https://hks-course-explorer.pages.dev/api/example') {
  return new Request(url, { headers: origin ? { Origin: origin } : {} })
}

describe('Pages Function CORS policy', () => {
  it('permits the deployed request origin', () => {
    const headers = corsHeaders(request('https://hks-course-explorer.pages.dev'))

    expect(headers['Access-Control-Allow-Origin']).toBe('https://hks-course-explorer.pages.dev')
    expect(headers['Access-Control-Allow-Credentials']).toBe('true')
    expect(headers.Vary).toBe('Origin')
  })

  it('permits supported local development origins', () => {
    const headers = corsHeaders(request('http://localhost:4173'))

    expect(headers['Access-Control-Allow-Origin']).toBe('http://localhost:4173')
    expect(headers['Access-Control-Allow-Headers']).toContain('X-Admin-Session')
  })

  it('does not grant an unknown cross-origin caller permission', async () => {
    const headers = corsHeaders(request('https://untrusted.example'))

    expect(headers['Access-Control-Allow-Origin']).toBeUndefined()
    expect(headers['Access-Control-Allow-Credentials']).toBeUndefined()
    expect(headers.Vary).toBe('Origin')

    const preflight = handleOptions(request('https://untrusted.example'))
    expect(preflight.status).toBe(204)
    expect(preflight.headers.get('Access-Control-Allow-Origin')).toBeNull()
    expect(preflight.headers.get('Vary')).toBe('Origin')
  })

  it('does not add unnecessary CORS permission headers without Origin', () => {
    const headers = corsHeaders(request(''))

    expect(headers).toMatchObject({
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'X-Frame-Options': 'SAMEORIGIN',
      Vary: 'Origin',
    })
  })
})
