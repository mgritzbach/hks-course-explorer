import { readFileSync, readdirSync, statSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ALLOWED_RSC_ADVISORY = 'GHSA-qwww-vcr4-c8h2'
const BLOCKED_SEVERITIES = new Set(['moderate', 'high', 'critical'])
const RSC_MARKERS = [
  /\bRSC\b/,
  /\bRSCHydratedRouter\b/,
  /\bRSCStaticRouter\b/,
  /\bunstable_createCallServer\b/,
  /\bcreateFromFetch\b/,
  /\bcreateFromReadableStream\b/,
]

function walkSourceFiles(root) {
  const files = []
  for (const entry of readdirSync(root)) {
    const path = join(root, entry)
    const stats = statSync(path)
    if (stats.isDirectory()) {
      files.push(...walkSourceFiles(path))
    } else if (/\.[cm]?[jt]sx?$/.test(entry)) {
      files.push(path)
    }
  }
  return files
}

export function usesReactServerComponents(sourceFiles) {
  return sourceFiles.some((path) => {
    const source = readFileSync(path, 'utf8')
    return (
      /from\s+['"]react-router(?:\/dom\/server)?['"]/.test(source) ||
      RSC_MARKERS.some((marker) => marker.test(source))
    )
  })
}

export function evaluateAuditReport(report, { rscInUse }) {
  const blocked = []
  const allowed = []

  for (const vulnerability of Object.values(report?.vulnerabilities ?? {})) {
    for (const advisory of vulnerability.via ?? []) {
      if (typeof advisory !== 'object' || !BLOCKED_SEVERITIES.has(advisory.severity)) {
        continue
      }

      const advisoryId = String(advisory.url ?? '')
        .split('/')
        .pop()
      if (advisoryId === ALLOWED_RSC_ADVISORY && !rscInUse) {
        allowed.push(advisoryId)
      } else {
        blocked.push({
          package: vulnerability.name,
          severity: advisory.severity,
          title: advisory.title,
          url: advisory.url,
        })
      }
    }
  }

  return { allowed: [...new Set(allowed)], blocked }
}

function main() {
  const reportPath = process.argv[2]
  let report
  try {
    report = JSON.parse(readFileSync(reportPath || 0, 'utf8').replace(/^\uFEFF/, ''))
  } catch {
    console.error('npm audit did not return valid JSON')
    process.exit(1)
  }

  if (report.error || !report.vulnerabilities) {
    console.error(report.error?.summary || 'npm audit returned an incomplete report')
    process.exit(1)
  }

  const sourceFiles = walkSourceFiles(join(process.cwd(), 'src'))
  const result = evaluateAuditReport(report, {
    rscInUse: usesReactServerComponents(sourceFiles),
  })

  if (result.blocked.length > 0) {
    for (const finding of result.blocked) {
      console.error(`${finding.severity}: ${finding.package}: ${finding.title} (${finding.url})`)
    }
    process.exit(1)
  }

  if (result.allowed.includes(ALLOWED_RSC_ADVISORY)) {
    console.warn(
      `Allowed ${ALLOWED_RSC_ADVISORY}: the advisory affects only unstable React Server Component APIs, and this client-only BrowserRouter app does not import them.`,
    )
  }

  console.log('No applicable moderate-or-higher production dependency findings.')
}

if (fileURLToPath(import.meta.url) === resolve(process.argv[1] ?? '')) {
  main()
}
