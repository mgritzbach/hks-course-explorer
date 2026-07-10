import { pathToFileURL } from 'node:url'

const DEFAULT_DEPLOYED_SITE_URL = 'https://hks-course-explorer.pages.dev/'

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

export async function smokeDeployedSite({
  fetchImpl = fetch,
  targetUrl = process.env.DEPLOY_SMOKE_URL || DEFAULT_DEPLOYED_SITE_URL,
} = {}) {
  const response = await fetchImpl(targetUrl, {
    redirect: 'follow',
    signal: AbortSignal.timeout(30_000),
  })
  const body = await response.text()
  assertDeployedEntrypoint(response, body, targetUrl)
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
