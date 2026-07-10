import { describe, expect, it } from 'vitest'
import { assertDeployedEntrypoint, smokeDeployedSite } from './smoke_deployed_site.mjs'

function response({ ok = true, status = 200, contentType = 'text/html; charset=utf-8' } = {}) {
  return {
    ok,
    status,
    headers: { get: () => contentType },
    text: async () => '<!doctype html><div id="root"></div>',
  }
}

describe('deployed site smoke check', () => {
  it('accepts a reachable HTML application entrypoint', async () => {
    await expect(smokeDeployedSite({ fetchImpl: async () => response() })).resolves.toBeUndefined()
  })

  it('rejects a non-success response', () => {
    expect(() =>
      assertDeployedEntrypoint(response({ ok: false, status: 503 }), '', 'https://example.test'),
    ).toThrow('HTTP 503')
  })

  it('rejects an unexpected response body', () => {
    expect(() =>
      assertDeployedEntrypoint(response(), '<h1>Oops</h1>', 'https://example.test'),
    ).toThrow('no application root')
  })
})
