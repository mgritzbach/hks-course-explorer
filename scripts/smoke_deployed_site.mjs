import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

const DEFAULT_DEPLOYED_SITE_URL = 'https://hks-course-explorer.pages.dev/'
export const FINGERPRINTED_ASSET_CACHE_CONTROL = 'public, max-age=0, must-revalidate'
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

export function assertDeployedEntrypoint(response, body, targetUrl) {
  if (!response.ok) {
    throw new Error(`Deployed site smoke check returned HTTP ${response.status}: ${targetUrl}`)
  }

  const contentType = response.headers.get('content-type') || ''
  if (!contentType.includes('text/html')) {
    throw new Error(`Deployed site smoke check returned ${contentType || 'no'} HTML: ${targetUrl}`)
  }

  if (!body.includes('<div id="root"></div>')) {
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
  const contentType = response.headers.get('content-type') || ''
  if (!contentType.includes(expectedContentType)) {
    throw new Error(
      `Deployed asset smoke check returned ${contentType || 'no content type'} instead of ${expectedContentType}: ${assetUrl}`,
    )
  }
  if (!hasSafePagesRevalidation(response.headers.get('cache-control'))) {
    throw new Error(`Deployed asset bypasses the reviewed Pages revalidation policy: ${assetUrl}`)
  }
}

export function hasSafePagesRevalidation(cacheControl) {
  if (typeof cacheControl !== 'string') return false
  const directives = new Set(
    cacheControl
      .split(',')
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  )
  return (
    directives.has('public') &&
    directives.has('max-age=0') &&
    directives.has('must-revalidate') &&
    !directives.has('immutable')
  )
}

export function collectBuildAssetPaths(manifest) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new Error('Built Vite manifest is not an object.')
  }
  const paths = new Set()
  for (const entry of Object.values(manifest)) {
    if (!entry || typeof entry !== 'object') continue
    for (const value of [entry.file, ...(entry.css || []), ...(entry.assets || [])]) {
      if (typeof value === 'string' && /\.(?:css|js)$/.test(value)) paths.add(`/${value}`)
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
      redirect: 'follow',
      signal: AbortSignal.timeout(30_000),
    })
    const body = await response.text()
    const expectedContentType = assetPath.endsWith('.css') ? 'text/css' : 'application/javascript'
    assertFingerprintAsset(response, assetUrl, expectedContentType)
    if (body !== expectedBody) {
      throw new Error(`Deployed asset differs from the exact built file: ${assetUrl}`)
    }
  }
}

export function assertDeployedSpaRoute(response, body, expectedAssetPath, targetUrl) {
  assertDeployedEntrypoint(response, body, targetUrl)
  assertSameFingerprintAsset(
    expectedAssetPath,
    extractFingerprintAssetPath(body, targetUrl),
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
  if (!(response.headers.get('content-type') || '').includes('application/json')) {
    throw new Error(`Similarity-coordinate smoke check returned non-JSON content: ${targetUrl}`)
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
  routes = DEPLOYED_SPA_ROUTE_PATHS,
} = {}) {
  if (!expectedAssetPath)
    throw new Error('Deployed route smoke check requires an expected build asset.')
  for (const route of routes) {
    const routeUrl = new URL(route, targetUrl).toString()
    const response = await fetchImpl(routeUrl, {
      redirect: 'follow',
      signal: AbortSignal.timeout(30_000),
    })
    const body = await response.text()
    assertDeployedSpaRoute(response, body, expectedAssetPath, routeUrl)
  }
}

export async function smokeDeployedSite({
  fetchImpl = fetch,
  readFileImpl = readFile,
  targetUrl = process.env.DEPLOY_SMOKE_URL || DEFAULT_DEPLOYED_SITE_URL,
  buildHtmlPath = process.env.DEPLOY_BUILD_HTML || 'dist/index.html',
  buildManifestPath = 'dist/.vite/manifest.json',
  expectedAssetPath,
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
  const expectedAsset =
    expectedAssetPath ||
    extractFingerprintAssetPath(await readFileImpl(buildHtmlPath, 'utf8'), buildHtmlPath)
  const expectedCoordinates = verifySimilarityCoordinates
    ? expectedSimilarityBody || (await readFileImpl(buildSimilarityPath, 'utf8'))
    : null
  let buildAssets = expectedBuildAssets
  if (verifyBuildAssets && !buildAssets) {
    const manifest = JSON.parse(await readFileImpl(buildManifestPath, 'utf8'))
    buildAssets = new Map()
    for (const assetPath of collectBuildAssetPaths(manifest)) {
      buildAssets.set(assetPath, await readFileImpl(`dist${assetPath}`, 'utf8'))
    }
  }
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
    throw new Error('Deployed site smoke check requires at least one asset verification attempt.')
  }

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const response = await fetchImpl(targetUrl, {
      redirect: 'follow',
      signal: AbortSignal.timeout(30_000),
    })
    const body = await response.text()
    assertDeployedEntrypoint(response, body, targetUrl)

    const deployedAsset = extractFingerprintAssetPath(body, targetUrl)
    if (expectedAsset !== deployedAsset) {
      if (attempt < maxAttempts) {
        await waitImpl(DEPLOYED_ASSET_RETRY_MS)
        continue
      }
      assertSameFingerprintAsset(expectedAsset, deployedAsset, targetUrl)
    }

    const assetUrl = new URL(deployedAsset, targetUrl).toString()
    const assetResponse = await fetchImpl(assetUrl, {
      redirect: 'follow',
      signal: AbortSignal.timeout(30_000),
    })
    if (
      !assetResponse.ok ||
      !hasSafePagesRevalidation(assetResponse.headers.get('cache-control')) ||
      !(assetResponse.headers.get('content-type') || '').includes('application/javascript')
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
          redirect: 'follow',
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

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await smokeDeployedSite({
      verifyBuildAssets: true,
      verifySpaRoutes: true,
      verifySimilarityCoordinates: true,
    })
    console.log(
      `Deployed site smoke check passed: ${process.env.DEPLOY_SMOKE_URL || DEFAULT_DEPLOYED_SITE_URL}`,
    )
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
