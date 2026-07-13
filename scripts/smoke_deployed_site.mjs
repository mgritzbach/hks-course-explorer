import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

const DEFAULT_DEPLOYED_SITE_URL = 'https://hks-course-explorer.pages.dev/'
export const FINGERPRINTED_ASSET_CACHE_CONTROL = 'public, max-age=0, must-revalidate'
export const MAX_FINGERPRINTED_ASSET_BROWSER_TTL_SECONDS = 14_400
const FINGERPRINTED_ASSET_PATH = /^\/assets\/[A-Za-z0-9_-]+-[A-Za-z0-9_-]{8,}\.(?:css|js)$/
// These direct SPA routes cover each primary visitor navigation destination.
// Verify them against the same build fingerprint as `/` so a healthy landing
// page cannot hide a broken redirect or stale route cache after deployment.
export const DEPLOYED_SPA_ROUTE_PATHS = Object.freeze([
  '/courses',
  '/faculty',
  '/compare',
  '/schedule-builder',
  '/requirements',
])
// Cloudflare's default Pages hostname can briefly retain a prior entrypoint
// after Wrangler reports success. Keep the check strict, but allow a bounded
// 57-second propagation window before declaring the verified deployment bad.
export const DEPLOYED_ASSET_MAX_ATTEMPTS = 20
const DEPLOYED_ASSET_RETRY_MS = 3_000
export const MIN_DEPLOYED_SIMILARITY_ROWS = 1_000

function responseBytes(body) {
  return Buffer.isBuffer(body) ? body : Buffer.from(body)
}

async function readResponseBytes(response) {
  if (typeof response.arrayBuffer === 'function') {
    return Buffer.from(await response.arrayBuffer())
  }
  return Buffer.from(await response.text())
}

function cacheDirectives(cacheControl) {
  if (typeof cacheControl !== 'string') return []
  return cacheControl
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)
}

function hasForbiddenCacheDirective(directives) {
  const forbidden = new Set([
    'immutable',
    'private',
    's-maxage',
    'stale-if-error',
    'stale-while-revalidate',
  ])
  return directives.some((value) => forbidden.has(value.split('=', 1)[0]))
}

function parsedMaxAge(directives) {
  const values = directives.filter((value) => value.startsWith('max-age='))
  if (values.length !== 1) return null
  const raw = values[0].slice('max-age='.length)
  if (!/^\d+$/.test(raw)) return null
  return Number(raw)
}

function responseMime(response) {
  return (response.headers.get('content-type') || '').split(';', 1)[0].trim().toLowerCase()
}

export function hasSafeEntrypointRevalidation(cacheControl) {
  const directives = cacheDirectives(cacheControl)
  return (
    directives.includes('public') &&
    directives.includes('must-revalidate') &&
    parsedMaxAge(directives) === 0 &&
    !hasForbiddenCacheDirective(directives)
  )
}

export function hasSafeFingerprintAssetCaching(cacheControl) {
  const directives = cacheDirectives(cacheControl)
  const maxAge = parsedMaxAge(directives)
  return (
    directives.includes('public') &&
    directives.includes('must-revalidate') &&
    maxAge !== null &&
    maxAge >= 0 &&
    maxAge <= MAX_FINGERPRINTED_ASSET_BROWSER_TTL_SECONDS &&
    !hasForbiddenCacheDirective(directives)
  )
}

export function assertDeployedEntrypoint(response, body, targetUrl, expectedBody = null) {
  if (!response.ok) {
    throw new Error(`Deployed site smoke check returned HTTP ${response.status}: ${targetUrl}`)
  }

  const contentType = responseMime(response)
  if (contentType !== 'text/html') {
    throw new Error(`Deployed site smoke check returned ${contentType || 'no'} HTML: ${targetUrl}`)
  }

  if (!hasSafeEntrypointRevalidation(response.headers.get('cache-control'))) {
    throw new Error(`Deployed HTML bypasses the reviewed revalidation policy: ${targetUrl}`)
  }

  const bodyBuffer = responseBytes(body)
  if (expectedBody !== null && !bodyBuffer.equals(responseBytes(expectedBody))) {
    throw new Error(`Deployed HTML differs from the exact built entrypoint: ${targetUrl}`)
  }

  const bodyText = bodyBuffer.toString('utf8')

  if (!bodyText.includes('<div id="root"></div>')) {
    throw new Error(`Deployed site smoke check found no application root: ${targetUrl}`)
  }
}

export function extractFingerprintAssetPath(body, targetUrl) {
  const match = body.match(
    /<script\b[^>]*\bsrc=["']([^"']*\/assets\/[A-Za-z0-9_-]+-[A-Za-z0-9_-]{8,}\.js)["']/i,
  )
  if (!match)
    throw new Error(
      `Deployed site smoke check found no fingerprinted JavaScript asset: ${targetUrl}`,
    )
  return match[1]
}

export function assertSameFingerprintAsset(expectedAssetPath, deployedAssetPath, targetUrl) {
  if (expectedAssetPath !== deployedAssetPath) {
    throw new Error(
      `Deployed entry asset does not match this build: expected ${expectedAssetPath}, received ${deployedAssetPath}: ${targetUrl}`,
    )
  }
}

export function assertFingerprintAsset(
  response,
  assetUrl,
  expectedContentType = 'application/javascript',
) {
  if (!response.ok) {
    throw new Error(`Deployed asset smoke check returned HTTP ${response.status}: ${assetUrl}`)
  }
  const contentType = responseMime(response)
  const expectedTypes =
    expectedContentType === 'application/javascript'
      ? ['application/javascript', 'text/javascript']
      : [expectedContentType]
  if (!expectedTypes.includes(contentType)) {
    throw new Error(
      `Deployed asset smoke check returned ${contentType || 'no content type'} instead of ${expectedContentType}: ${assetUrl}`,
    )
  }
  if (!FINGERPRINTED_ASSET_PATH.test(new URL(assetUrl).pathname)) {
    throw new Error(`Deployed cache-eligible asset is not a fingerprinted CSS/JS path: ${assetUrl}`)
  }
  if (!hasSafeFingerprintAssetCaching(response.headers.get('cache-control'))) {
    throw new Error(`Deployed asset bypasses the reviewed fingerprint cache policy: ${assetUrl}`)
  }
}

export function hasSafePagesRevalidation(cacheControl) {
  return hasSafeEntrypointRevalidation(cacheControl)
}

export function collectBuildAssetPaths(manifest) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new Error('Built Vite manifest is not an object.')
  }
  const paths = new Set()
  for (const entry of Object.values(manifest)) {
    if (!entry || typeof entry !== 'object') continue
    for (const value of [entry.file, ...(entry.css || []), ...(entry.assets || [])]) {
      if (typeof value !== 'string' || !/\.(?:css|js)$/.test(value)) continue
      const path = `/${value}`
      if (!FINGERPRINTED_ASSET_PATH.test(path)) {
        throw new Error(`Built manifest contains a non-fingerprinted CSS/JS asset: ${path}`)
      }
      paths.add(path)
    }
  }
  if (!paths.size) throw new Error('Built Vite manifest contains no JavaScript or CSS assets.')
  return [...paths].sort()
}

export async function smokeDeployedBuildAssets({
  fetchImpl = fetch,
  targetUrl,
  expectedAssets,
} = {}) {
  if (!(expectedAssets instanceof Map) || !expectedAssets.size) {
    throw new Error('Deployed asset smoke check requires the exact built asset bodies.')
  }
  for (const [assetPath, expectedBody] of expectedAssets) {
    const assetUrl = new URL(assetPath, targetUrl).toString()
    const response = await fetchImpl(assetUrl, {
      redirect: 'error',
      signal: AbortSignal.timeout(30_000),
    })
    const body = await readResponseBytes(response)
    const expectedContentType = assetPath.endsWith('.css') ? 'text/css' : 'application/javascript'
    assertFingerprintAsset(response, assetUrl, expectedContentType)
    if (!body.equals(responseBytes(expectedBody))) {
      throw new Error(`Deployed asset differs from the exact built file: ${assetUrl}`)
    }
  }
}

export function assertDeployedSpaRoute(response, body, expectedAssetPath, targetUrl, expectedHtml) {
  assertDeployedEntrypoint(response, body, targetUrl, expectedHtml)
  assertSameFingerprintAsset(
    expectedAssetPath,
    extractFingerprintAssetPath(responseBytes(body).toString('utf8'), targetUrl),
    targetUrl,
  )
}

export function assertSimilarityCoordinates(
  response,
  body,
  expectedBody,
  targetUrl,
  minimumRows = MIN_DEPLOYED_SIMILARITY_ROWS,
) {
  if (!response.ok) {
    throw new Error(
      `Similarity-coordinate smoke check returned HTTP ${response.status}: ${targetUrl}`,
    )
  }
  if (responseMime(response) !== 'application/json') {
    throw new Error(`Similarity-coordinate smoke check returned non-JSON content: ${targetUrl}`)
  }
  if (!hasSafeEntrypointRevalidation(response.headers.get('cache-control'))) {
    throw new Error(
      `Mutable similarity data bypasses the reviewed revalidation policy: ${targetUrl}`,
    )
  }
  let actual
  let expected
  try {
    actual = JSON.parse(body)
    expected = JSON.parse(expectedBody)
  } catch {
    throw new Error(`Similarity-coordinate smoke check received malformed JSON: ${targetUrl}`)
  }
  if (!Array.isArray(expected) || expected.length < minimumRows) {
    throw new Error(`Built similarity-coordinate artifact has fewer than ${minimumRows} rows`)
  }
  if (!Array.isArray(actual) || actual.length !== expected.length) {
    throw new Error(
      `Deployed similarity-coordinate count differs from this build: expected ${expected.length}, received ${Array.isArray(actual) ? actual.length : 'non-array'}: ${targetUrl}`,
    )
  }
  if (body !== expectedBody) {
    throw new Error(`Deployed similarity-coordinate artifact differs from this build: ${targetUrl}`)
  }
}

export async function smokeDeployedSpaRoutes({
  fetchImpl = fetch,
  targetUrl = process.env.DEPLOY_SMOKE_URL || DEFAULT_DEPLOYED_SITE_URL,
  expectedAssetPath,
  expectedHtml,
  routes = DEPLOYED_SPA_ROUTE_PATHS,
} = {}) {
  if (!expectedAssetPath)
    throw new Error('Deployed route smoke check requires an expected build asset.')
  for (const route of routes) {
    const routeUrl = new URL(route, targetUrl).toString()
    const response = await fetchImpl(routeUrl, {
      redirect: 'error',
      signal: AbortSignal.timeout(30_000),
    })
    const body = await readResponseBytes(response)
    assertDeployedSpaRoute(response, body, expectedAssetPath, routeUrl, expectedHtml)
  }
}

export async function preflightCurrentProduction({
  fetchImpl = fetch,
  targetUrl = process.env.DEPLOY_SMOKE_URL || DEFAULT_DEPLOYED_SITE_URL,
  minimumSimilarityRows = MIN_DEPLOYED_SIMILARITY_ROWS,
} = {}) {
  const rootResponse = await fetchImpl(targetUrl, {
    redirect: 'error',
    signal: AbortSignal.timeout(30_000),
  })
  const rootBody = await readResponseBytes(rootResponse)
  assertDeployedEntrypoint(rootResponse, rootBody, targetUrl)

  const assetPath = extractFingerprintAssetPath(rootBody.toString('utf8'), targetUrl)
  const assetUrl = new URL(assetPath, targetUrl).toString()
  const assetResponse = await fetchImpl(assetUrl, {
    redirect: 'error',
    signal: AbortSignal.timeout(30_000),
  })
  const assetBody = await readResponseBytes(assetResponse)
  assertFingerprintAsset(assetResponse, assetUrl)
  if (!assetBody.length) {
    throw new Error(`Current production entry asset is empty: ${assetUrl}`)
  }

  const similarityUrl = new URL('/sim_coords.json', targetUrl).toString()
  const similarityResponse = await fetchImpl(similarityUrl, {
    redirect: 'error',
    signal: AbortSignal.timeout(30_000),
  })
  const similarityBody = await similarityResponse.text()
  assertSimilarityCoordinates(
    similarityResponse,
    similarityBody,
    similarityBody,
    similarityUrl,
    minimumSimilarityRows,
  )

  return assetPath
}

export async function smokeDeployedSite({
  fetchImpl = fetch,
  readFileImpl = readFile,
  targetUrl = process.env.DEPLOY_SMOKE_URL || DEFAULT_DEPLOYED_SITE_URL,
  buildHtmlPath = process.env.DEPLOY_BUILD_HTML || 'dist/index.html',
  buildManifestPath = 'dist/.vite/manifest.json',
  expectedAssetPath,
  expectedBuildHtml,
  expectedBuildAssets,
  maxAttempts = DEPLOYED_ASSET_MAX_ATTEMPTS,
  spaRoutes = DEPLOYED_SPA_ROUTE_PATHS,
  verifyBuildAssets = false,
  verifySpaRoutes = false,
  verifySimilarityCoordinates = false,
  buildSimilarityPath = 'dist/sim_coords.json',
  expectedSimilarityBody,
  minimumSimilarityRows = MIN_DEPLOYED_SIMILARITY_ROWS,
  waitImpl = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
} = {}) {
  // Cloudflare can briefly serve the previous deployment after a successful
  // upload. Compare the deployed entry asset with this exact build so a
  // healthy older release cannot satisfy the smoke check.
  const buildHtml = responseBytes(expectedBuildHtml ?? (await readFileImpl(buildHtmlPath)))
  const expectedAsset =
    expectedAssetPath || extractFingerprintAssetPath(buildHtml.toString('utf8'), buildHtmlPath)
  const expectedCoordinates = verifySimilarityCoordinates
    ? expectedSimilarityBody || (await readFileImpl(buildSimilarityPath, 'utf8'))
    : null
  let buildAssets = expectedBuildAssets
  if (verifyBuildAssets && !buildAssets) {
    const manifest = JSON.parse(await readFileImpl(buildManifestPath, 'utf8'))
    buildAssets = new Map()
    for (const assetPath of collectBuildAssetPaths(manifest)) {
      buildAssets.set(assetPath, await readFileImpl(`dist${assetPath}`))
    }
  }
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
    throw new Error('Deployed site smoke check requires at least one asset verification attempt.')
  }

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const response = await fetchImpl(targetUrl, {
      redirect: 'error',
      signal: AbortSignal.timeout(30_000),
    })
    const body = await readResponseBytes(response)
    try {
      assertDeployedEntrypoint(response, body, targetUrl, buildHtml)
    } catch (error) {
      if (attempt < maxAttempts) {
        await waitImpl(DEPLOYED_ASSET_RETRY_MS)
        continue
      }
      throw error
    }

    const deployedAsset = extractFingerprintAssetPath(body.toString('utf8'), targetUrl)
    if (expectedAsset !== deployedAsset) {
      if (attempt < maxAttempts) {
        await waitImpl(DEPLOYED_ASSET_RETRY_MS)
        continue
      }
      assertSameFingerprintAsset(expectedAsset, deployedAsset, targetUrl)
    }

    const assetUrl = new URL(deployedAsset, targetUrl).toString()
    const assetResponse = await fetchImpl(assetUrl, {
      redirect: 'error',
      signal: AbortSignal.timeout(30_000),
    })
    if (
      !assetResponse.ok ||
      !hasSafeFingerprintAssetCaching(assetResponse.headers.get('cache-control')) ||
      !['application/javascript', 'text/javascript'].includes(responseMime(assetResponse))
    ) {
      // The entry HTML and the asset inventory can arrive at edge locations a
      // few seconds apart. Keep waiting only for this exact expected asset;
      // never accept HTML from the SPA fallback as JavaScript.
      if (attempt < maxAttempts) {
        await waitImpl(DEPLOYED_ASSET_RETRY_MS)
        continue
      }
      assertFingerprintAsset(assetResponse, assetUrl)
    }
    if (verifyBuildAssets) {
      try {
        await smokeDeployedBuildAssets({ fetchImpl, targetUrl, expectedAssets: buildAssets })
      } catch (error) {
        if (attempt < maxAttempts) {
          await waitImpl(DEPLOYED_ASSET_RETRY_MS)
          continue
        }
        throw error
      }
    }
    if (verifySpaRoutes) {
      try {
        await smokeDeployedSpaRoutes({
          fetchImpl,
          targetUrl,
          expectedAssetPath: expectedAsset,
          expectedHtml: buildHtml,
          routes: spaRoutes,
        })
      } catch (error) {
        // Route caches can lag the root entrypoint for a few seconds. Keep the
        // route check in the same bounded propagation window rather than
        // failing an otherwise healthy deployment on a transient stale route.
        if (attempt < maxAttempts) {
          await waitImpl(DEPLOYED_ASSET_RETRY_MS)
          continue
        }
        throw error
      }
    }
    if (verifySimilarityCoordinates) {
      try {
        const similarityUrl = new URL('/sim_coords.json', targetUrl).toString()
        const similarityResponse = await fetchImpl(similarityUrl, {
          redirect: 'error',
          signal: AbortSignal.timeout(30_000),
        })
        const similarityBody = await similarityResponse.text()
        assertSimilarityCoordinates(
          similarityResponse,
          similarityBody,
          expectedCoordinates,
          similarityUrl,
          minimumSimilarityRows,
        )
      } catch (error) {
        if (attempt < maxAttempts) {
          await waitImpl(DEPLOYED_ASSET_RETRY_MS)
          continue
        }
        throw error
      }
    }
    return
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const preflightOnly = process.env.DEPLOY_PREFLIGHT_ONLY === 'true'
    if (preflightOnly) {
      await preflightCurrentProduction()
    } else {
      await smokeDeployedSite({
        verifyBuildAssets: true,
        verifySpaRoutes: true,
        verifySimilarityCoordinates: true,
      })
    }
    const label = preflightOnly
      ? 'Current custom-domain preflight passed'
      : 'Deployed site smoke check passed'
    console.log(`${label}: ${process.env.DEPLOY_SMOKE_URL || DEFAULT_DEPLOYED_SITE_URL}`)
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
