import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

const DEFAULT_DEPLOYED_SITE_URL = 'https://hks-course-explorer.pages.dev/'
export const FINGERPRINTED_ASSET_CACHE_CONTROL = 'public, max-age=31556952, immutable'
const DEPLOYED_ASSET_MAX_ATTEMPTS = 10
const DEPLOYED_ASSET_RETRY_MS = 3_000

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

export function assertFingerprintAsset(response, assetUrl) {
  if (!response.ok) {
    throw new Error(`Deployed asset smoke check returned HTTP ${response.status}: ${assetUrl}`)
  }
  if (response.headers.get('cache-control') !== FINGERPRINTED_ASSET_CACHE_CONTROL) {
    throw new Error(`Deployed asset lacks immutable cache policy: ${assetUrl}`)
  }
}

export async function smokeDeployedSite({
  fetchImpl = fetch,
  readFileImpl = readFile,
  targetUrl = process.env.DEPLOY_SMOKE_URL || DEFAULT_DEPLOYED_SITE_URL,
  buildHtmlPath = process.env.DEPLOY_BUILD_HTML || 'dist/index.html',
  expectedAssetPath,
  maxAttempts = DEPLOYED_ASSET_MAX_ATTEMPTS,
  waitImpl = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
} = {}) {
  // Cloudflare can briefly serve the previous deployment after a successful
  // upload. Compare the deployed entry asset with this exact build so a
  // healthy older release cannot satisfy the smoke check.
  const expectedAsset =
    expectedAssetPath ||
    extractFingerprintAssetPath(await readFileImpl(buildHtmlPath, 'utf8'), buildHtmlPath)
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
    if (!assetResponse.ok) assertFingerprintAsset(assetResponse, assetUrl)
    if (assetResponse.headers.get('cache-control') !== FINGERPRINTED_ASSET_CACHE_CONTROL) {
      // The entry HTML and the Pages header rules can arrive at edge locations
      // a few seconds apart. Keep waiting only for this exact expected asset;
      // never accept a stale hash or an unsuccessful asset response.
      if (attempt < maxAttempts) {
        await waitImpl(DEPLOYED_ASSET_RETRY_MS)
        continue
      }
      assertFingerprintAsset(assetResponse, assetUrl)
    }
    return
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await smokeDeployedSite()
    console.log(
      `Deployed site smoke check passed: ${process.env.DEPLOY_SMOKE_URL || DEFAULT_DEPLOYED_SITE_URL}`,
    )
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
