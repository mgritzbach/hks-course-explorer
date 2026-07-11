import { describe, expect, it } from 'vitest'
import {
  assertDeployedEntrypoint,
  assertFingerprintAsset,
  assertDeployedSpaRoute,
  assertSameFingerprintAsset,
  DEPLOYED_ASSET_MAX_ATTEMPTS,
  DEPLOYED_SPA_ROUTE_PATHS,
  extractFingerprintAssetPath,
  FINGERPRINTED_ASSET_CACHE_CONTROL,
  smokeDeployedSite,
  smokeDeployedSpaRoutes,
} from './smoke_deployed_site.mjs'

function response({
  ok = true,
  status = 200,
  contentType = 'text/html; charset=utf-8',
  cacheControl = null,
  body = '<!doctype html><script src="/assets/index-abc12345.js"></script><div id="root"></div>',
} = {}) {
  return {
    ok,
    status,
    headers: {
      get: (name) => {
        if (name === 'content-type') return contentType
        if (name === 'cache-control') return cacheControl
        return null
      },
    },
    text: async () => body,
  }
}

describe('deployed site smoke check', () => {
  it('keeps a bounded propagation window for the exact deployed fingerprint', () => {
    expect(DEPLOYED_ASSET_MAX_ATTEMPTS).toBe(20)
  })

  it('covers each primary direct SPA navigation route', () => {
    expect(DEPLOYED_SPA_ROUTE_PATHS).toEqual([
      '/courses',
      '/faculty',
      '/compare',
      '/schedule-builder',
      '/requirements',
    ])
  })

  it('accepts a reachable HTML application entrypoint', async () => {
    const responses = [
      response(),
      response({
        contentType: 'application/javascript',
        cacheControl: FINGERPRINTED_ASSET_CACHE_CONTROL,
      }),
    ]
    await expect(
      smokeDeployedSite({
        expectedAssetPath: '/assets/index-abc12345.js',
        fetchImpl: async () => responses.shift(),
      }),
    ).resolves.toBeUndefined()
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

  it('extracts the fingerprinted Vite asset and requires its immutable cache policy', () => {
    expect(
      extractFingerprintAssetPath(
        '<script type="module" src="/assets/index-abc12345.js"></script>',
        'https://example.test/',
      ),
    ).toBe('/assets/index-abc12345.js')
    expect(() =>
      assertFingerprintAsset(response(), 'https://example.test/assets/index-abc12345.js'),
    ).toThrow('lacks immutable cache policy')
  })

  it('rejects an unhashed or stale deployed entry asset', async () => {
    expect(() =>
      extractFingerprintAssetPath(
        '<script type="module" src="/assets/index.js"></script>',
        'https://example.test/',
      ),
    ).toThrow('no fingerprinted JavaScript asset')
    expect(() =>
      assertSameFingerprintAsset(
        '/assets/index-current123.js',
        '/assets/index-previous12.js',
        'https://example.test/',
      ),
    ).toThrow('does not match this build')

    const responses = [
      response({
        body: '<script src="/assets/index-previous12.js"></script><div id="root"></div>',
      }),
      response({
        contentType: 'application/javascript',
        cacheControl: FINGERPRINTED_ASSET_CACHE_CONTROL,
      }),
    ]
    await expect(
      smokeDeployedSite({
        expectedAssetPath: '/assets/index-current123.js',
        fetchImpl: async () => responses.shift(),
        maxAttempts: 1,
      }),
    ).rejects.toThrow('does not match this build')
  })

  it('waits for the exact build asset during short deployment propagation', async () => {
    const responses = [
      response({
        body: '<script src="/assets/index-previous12.js"></script><div id="root"></div>',
      }),
      response({
        body: '<script src="/assets/index-current123.js"></script><div id="root"></div>',
      }),
      response({
        contentType: 'application/javascript',
        cacheControl: FINGERPRINTED_ASSET_CACHE_CONTROL,
      }),
    ]
    const waits = []

    await expect(
      smokeDeployedSite({
        expectedAssetPath: '/assets/index-current123.js',
        fetchImpl: async () => responses.shift(),
        waitImpl: async (milliseconds) => waits.push(milliseconds),
      }),
    ).resolves.toBeUndefined()
    expect(waits).toEqual([3_000])
  })

  it('waits for the immutable header after the exact asset is present', async () => {
    const responses = [
      response({
        body: '<script src="/assets/index-current123.js"></script><div id="root"></div>',
      }),
      response({ contentType: 'application/javascript' }),
      response({
        body: '<script src="/assets/index-current123.js"></script><div id="root"></div>',
      }),
      response({
        contentType: 'application/javascript',
        cacheControl: FINGERPRINTED_ASSET_CACHE_CONTROL,
      }),
    ]
    const waits = []

    await expect(
      smokeDeployedSite({
        expectedAssetPath: '/assets/index-current123.js',
        fetchImpl: async () => responses.shift(),
        waitImpl: async (milliseconds) => waits.push(milliseconds),
      }),
    ).resolves.toBeUndefined()
    expect(waits).toEqual([3_000])
  })

  it('rejects a primary route that does not serve the exact deployed SPA build', async () => {
    await expect(
      smokeDeployedSpaRoutes({
        expectedAssetPath: '/assets/index-current123.js',
        routes: ['/courses'],
        fetchImpl: async () =>
          response({
            body: '<script src="/assets/index-stale12345.js"></script><div id="root"></div>',
          }),
      }),
    ).rejects.toThrow('does not match this build')
  })

  it('accepts a primary route serving the exact deployed SPA build', () => {
    expect(() =>
      assertDeployedSpaRoute(
        response({
          body: '<script src="/assets/index-current123.js"></script><div id="root"></div>',
        }),
        '<script src="/assets/index-current123.js"></script><div id="root"></div>',
        '/assets/index-current123.js',
        'https://example.test/schedule-builder',
      ),
    ).not.toThrow()
  })
})
