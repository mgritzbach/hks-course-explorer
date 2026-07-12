import { describe, expect, it } from 'vitest'
import {
  assertDeployedEntrypoint,
  assertFingerprintAsset,
  assertDeployedSpaRoute,
  assertSameFingerprintAsset,
  assertSimilarityCoordinates,
  collectBuildAssetPaths,
  DEPLOYED_ASSET_MAX_ATTEMPTS,
  DEPLOYED_SPA_ROUTE_PATHS,
  extractFingerprintAssetPath,
  FINGERPRINTED_ASSET_CACHE_CONTROL,
  hasSafePagesRevalidation,
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

  it('collects every JavaScript and CSS file from the Vite manifest', () => {
    expect(
      collectBuildAssetPaths({
        entry: {
          file: 'assets/index-current123.js',
          css: ['assets/index-current123.css'],
          assets: ['assets/logo.svg'],
        },
        compare: { file: 'assets/Compare-current123.js' },
      }),
    ).toEqual([
      '/assets/Compare-current123.js',
      '/assets/index-current123.css',
      '/assets/index-current123.js',
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

  it('accepts equivalent safe Pages cache directives in any order', () => {
    expect(hasSafePagesRevalidation('must-revalidate, public, max-age=0, no-transform')).toBe(true)
    expect(hasSafePagesRevalidation('public, max-age=31556952, immutable')).toBe(false)
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

  it('extracts the fingerprinted Vite asset and requires safe Pages revalidation', () => {
    expect(
      extractFingerprintAssetPath(
        '<script type="module" src="/assets/index-abc12345.js"></script>',
        'https://example.test/',
      ),
    ).toBe('/assets/index-abc12345.js')
    expect(() =>
      assertFingerprintAsset(response(), 'https://example.test/assets/index-abc12345.js'),
    ).toThrow('instead of application/javascript')
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

  it('waits for the reviewed Pages cache policy after the exact asset is present', async () => {
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

  it('retries a transient missing entry asset before accepting the exact build', async () => {
    const entrypoint = response({
      body: '<script src="/assets/index-current123.js"></script><div id="root"></div>',
    })
    const responses = [
      entrypoint,
      response({ ok: false, status: 404, contentType: 'text/html; charset=utf-8' }),
      entrypoint,
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

  it('rejects an SPA fallback cached as a JavaScript chunk', async () => {
    const expectedAssets = new Map([
      ['/assets/index-current123.js', 'console.log("entry")'],
      ['/assets/Compare-current123.js', 'console.log("compare")'],
    ])
    const responses = [
      response({
        body: '<script src="/assets/index-current123.js"></script><div id="root"></div>',
      }),
      response({
        contentType: 'application/javascript',
        cacheControl: FINGERPRINTED_ASSET_CACHE_CONTROL,
      }),
      response({
        contentType: 'application/javascript',
        cacheControl: FINGERPRINTED_ASSET_CACHE_CONTROL,
        body: 'console.log("entry")',
      }),
      response({
        contentType: 'text/html; charset=utf-8',
        cacheControl: FINGERPRINTED_ASSET_CACHE_CONTROL,
        body: '<div id="root"></div>',
      }),
    ]

    await expect(
      smokeDeployedSite({
        expectedAssetPath: '/assets/index-current123.js',
        expectedBuildAssets: expectedAssets,
        fetchImpl: async () => responses.shift(),
        maxAttempts: 1,
        verifyBuildAssets: true,
      }),
    ).rejects.toThrow('instead of application/javascript')
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

  it('rejects empty or stale deployed similarity-coordinate data', async () => {
    const expectedCoordinates = JSON.stringify([{ id: 'a', sim_x: 1, sim_y: 2 }])
    expect(() =>
      assertSimilarityCoordinates(
        response({ contentType: 'application/json', body: '[]' }),
        '[]',
        expectedCoordinates,
        'https://example.test/sim_coords.json',
        1,
      ),
    ).toThrow('count differs')

    const responses = [
      response({
        body: '<script src="/assets/index-current123.js"></script><div id="root"></div>',
      }),
      response({
        contentType: 'application/javascript',
        cacheControl: FINGERPRINTED_ASSET_CACHE_CONTROL,
      }),
      response({ contentType: 'application/json', body: '[]' }),
    ]
    await expect(
      smokeDeployedSite({
        expectedAssetPath: '/assets/index-current123.js',
        expectedSimilarityBody: expectedCoordinates,
        minimumSimilarityRows: 1,
        verifySimilarityCoordinates: true,
        fetchImpl: async () => responses.shift(),
        maxAttempts: 1,
      }),
    ).rejects.toThrow('count differs')
  })

  it('accepts the exact nonempty similarity-coordinate artifact', async () => {
    const coordinates = JSON.stringify([{ id: 'a', sim_x: 1, sim_y: 2 }])
    const responses = [
      response({
        body: '<script src="/assets/index-current123.js"></script><div id="root"></div>',
      }),
      response({
        contentType: 'application/javascript',
        cacheControl: FINGERPRINTED_ASSET_CACHE_CONTROL,
      }),
      response({ contentType: 'application/json', body: coordinates }),
    ]
    await expect(
      smokeDeployedSite({
        expectedAssetPath: '/assets/index-current123.js',
        expectedSimilarityBody: coordinates,
        minimumSimilarityRows: 1,
        verifySimilarityCoordinates: true,
        fetchImpl: async () => responses.shift(),
        maxAttempts: 1,
      }),
    ).resolves.toBeUndefined()
  })

  it('waits for a direct route cache to serve the exact deployed build', async () => {
    const responses = [
      response({
        body: '<script src="/assets/index-current123.js"></script><div id="root"></div>',
      }),
      response({
        contentType: 'application/javascript',
        cacheControl: FINGERPRINTED_ASSET_CACHE_CONTROL,
      }),
      response({
        body: '<script src="/assets/index-stale12345.js"></script><div id="root"></div>',
      }),
      response({
        body: '<script src="/assets/index-current123.js"></script><div id="root"></div>',
      }),
      response({
        contentType: 'application/javascript',
        cacheControl: FINGERPRINTED_ASSET_CACHE_CONTROL,
      }),
      response({
        body: '<script src="/assets/index-current123.js"></script><div id="root"></div>',
      }),
    ]
    const waits = []

    await expect(
      smokeDeployedSite({
        expectedAssetPath: '/assets/index-current123.js',
        fetchImpl: async () => responses.shift(),
        spaRoutes: ['/courses'],
        verifySpaRoutes: true,
        waitImpl: async (milliseconds) => waits.push(milliseconds),
      }),
    ).resolves.toBeUndefined()
    expect(waits).toEqual([3_000])
  })
})
