import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { SECURITY_HEADERS } from '../../functions/_shared/cors.js'

describe('Cloudflare Pages security headers', () => {
  it('keeps static and Function response protections aligned', async () => {
    const staticHeaders = await readFile('public/_headers', 'utf8')

    for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
      expect(staticHeaders).toContain(`${name}: ${value}`)
    }
  })

  it('leaves cache ownership to Cloudflare Pages for every static response', async () => {
    const staticHeaders = await readFile('public/_headers', 'utf8')

    expect(staticHeaders).not.toContain('Cache-Control:')
    expect(staticHeaders).not.toContain('/assets/*')
  })
})
