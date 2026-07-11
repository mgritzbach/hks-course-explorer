#!/usr/bin/env node

/**
 * Enforces a startup budget for the app shell and the code needed to render
 * the '/' route. The Vite manifest is the source of truth for chunk imports;
 * dynamic imports beneath Home are deliberately excluded, so visualizations
 * such as Plotly remain lazy.
 *
 * These limits are a release guardrail, not a substitute for real-device
 * performance measurement. Update them only with a measured justification.
 */
import { readFile, stat } from 'node:fs/promises'
import { gzipSync } from 'node:zlib'
import path from 'node:path'
import process from 'node:process'

const DIST_DIR = path.resolve(process.argv[2] || 'dist')
const MANIFEST_FILE = path.join(DIST_DIR, '.vite', 'manifest.json')
const ROOT_ROUTE_SOURCE = 'src/pages/Home.jsx'
const BUDGET = {
  rootRouteRawBytes: 1_050_000,
  rootRouteGzipBytes: 310_000,
}
// These pages are intentionally lazy routes. Each budget includes the app
// shell and the route's static dependency graph, but excludes nested dynamic
// imports. They protect direct navigation without turning the root-route
// budget into a proxy for every page in the application.
const LAZY_ROUTES = [
  {
    route: '/courses',
    source: 'src/pages/Courses.jsx',
    rawBytes: 1_450_000,
    gzipBytes: 450_000,
  },
  {
    route: '/schedule-builder',
    source: 'src/pages/ScheduleBuilder.jsx',
    rawBytes: 1_150_000,
    gzipBytes: 360_000,
  },
]
const PLOTLY = /plotly/i
const SUPABASE = /supabase/i

function formatBytes(bytes) {
  return `${bytes.toLocaleString('en-US')} B (${(bytes / 1024).toFixed(1)} KiB)`
}

function findEntryKey(manifest, predicate, description) {
  const key = Object.keys(manifest).find(predicate)
  if (!key) throw new Error(`Vite manifest has no ${description} entry`)
  return key
}

function addChunkAssets(manifest, key, assets, visited) {
  if (visited.has(key)) return
  const chunk = manifest[key]
  if (!chunk) throw new Error(`Vite manifest references missing chunk "${key}"`)

  visited.add(key)
  if (chunk.file) assets.add(chunk.file)
  for (const css of chunk.css || []) assets.add(css)
  for (const importedKey of chunk.imports || []) {
    addChunkAssets(manifest, importedKey, assets, visited)
  }
}

async function measureAsset(asset) {
  const file = path.join(DIST_DIR, asset)
  const content = await readFile(file)
  return { asset, rawBytes: (await stat(file)).size, gzipBytes: gzipSync(content).length }
}

async function measureGraph(manifest, entryKeys) {
  const assets = new Set()
  const visited = new Set()
  for (const key of entryKeys) addChunkAssets(manifest, key, assets, visited)
  const measurements = await Promise.all([...assets].sort().map(measureAsset))
  const total = measurements.reduce(
    (sum, asset) => ({
      rawBytes: sum.rawBytes + asset.rawBytes,
      gzipBytes: sum.gzipBytes + asset.gzipBytes,
    }),
    { rawBytes: 0, gzipBytes: 0 },
  )
  return { assets, measurements, total }
}

async function main() {
  const manifest = JSON.parse(await readFile(MANIFEST_FILE, 'utf8'))
  const shellEntry = findEntryKey(
    manifest,
    (key, chunk) => key === 'index.html' || chunk.isEntry === true,
    'HTML shell',
  )
  const homeEntry = findEntryKey(
    manifest,
    (key) => key === ROOT_ROUTE_SOURCE || key.endsWith(`/${ROOT_ROUTE_SOURCE}`),
    `root-route (${ROOT_ROUTE_SOURCE})`,
  )
  // Include the app shell and Home, but no dynamic imports that Home may make.
  const { assets, measurements, total } = await measureGraph(manifest, [shellEntry, homeEntry])
  const allPlotlyChunks = Object.entries(manifest)
    .filter(([key, chunk]) => PLOTLY.test(key) || PLOTLY.test(chunk.file || ''))
    .map(([, chunk]) => chunk.file)
    .filter(Boolean)
  const initialPlotlyChunks = allPlotlyChunks.filter((asset) => assets.has(asset))
  const allSupabaseChunks = Object.entries(manifest)
    .filter(([key, chunk]) => SUPABASE.test(key) || SUPABASE.test(chunk.file || ''))
    .map(([, chunk]) => chunk.file)
    .filter(Boolean)
  const initialSupabaseChunks = allSupabaseChunks.filter((asset) => assets.has(asset))
  const violations = []

  if (!allPlotlyChunks.length)
    violations.push('Vite manifest contains no Plotly chunk to verify as lazy')
  if (total.rawBytes > BUDGET.rootRouteRawBytes) {
    violations.push(
      `root-route raw size ${formatBytes(total.rawBytes)} exceeds ${formatBytes(BUDGET.rootRouteRawBytes)}`,
    )
  }
  if (total.gzipBytes > BUDGET.rootRouteGzipBytes) {
    violations.push(
      `root-route gzip size ${formatBytes(total.gzipBytes)} exceeds ${formatBytes(BUDGET.rootRouteGzipBytes)}`,
    )
  }
  if (initialPlotlyChunks.length) {
    violations.push(
      `Plotly must be lazy-loaded, but is in the root-route graph: ${initialPlotlyChunks.join(', ')}`,
    )
  }
  if (initialSupabaseChunks.length) {
    violations.push(
      `Supabase must load after the initial Home graph: ${initialSupabaseChunks.join(', ')}`,
    )
  }

  const lazyRouteReports = await Promise.all(
    LAZY_ROUTES.map(async (route) => {
      const entry = findEntryKey(
        manifest,
        (key) => key === route.source || key.endsWith(`/${route.source}`),
        `lazy-route (${route.source})`,
      )
      const chunk = manifest[entry]
      const graph = await measureGraph(manifest, [shellEntry, entry])
      const routeViolations = []

      if (!chunk.isDynamicEntry)
        routeViolations.push(`${route.route} must remain a Vite dynamic entry`)
      if (!(manifest[shellEntry].dynamicImports || []).includes(entry)) {
        routeViolations.push(`${route.route} must remain dynamically imported by the app shell`)
      }
      if (graph.total.rawBytes > route.rawBytes) {
        routeViolations.push(
          `${route.route} raw size ${formatBytes(graph.total.rawBytes)} exceeds ${formatBytes(route.rawBytes)}`,
        )
      }
      if (graph.total.gzipBytes > route.gzipBytes) {
        routeViolations.push(
          `${route.route} gzip size ${formatBytes(graph.total.gzipBytes)} exceeds ${formatBytes(route.gzipBytes)}`,
        )
      }
      return { ...route, entry, ...graph, violations: routeViolations }
    }),
  )
  for (const report of lazyRouteReports) violations.push(...report.violations)

  console.log("Root-route ('/') bundle budget")
  console.log(`  Shell manifest entry: ${shellEntry}`)
  console.log(`  Home manifest entry: ${homeEntry}`)
  for (const asset of measurements) {
    console.log(
      `  ${asset.asset}: raw ${formatBytes(asset.rawBytes)}, gzip ${formatBytes(asset.gzipBytes)}`,
    )
  }
  console.log(
    `  Total: raw ${formatBytes(total.rawBytes)} / ${formatBytes(BUDGET.rootRouteRawBytes)}, gzip ${formatBytes(total.gzipBytes)} / ${formatBytes(BUDGET.rootRouteGzipBytes)}`,
  )
  console.log(
    `  Plotly: ${initialPlotlyChunks.length ? 'FAILED' : `lazy (${allPlotlyChunks.join(', ')})`}`,
  )
  console.log(
    `  Supabase: ${initialSupabaseChunks.length ? 'FAILED' : `deferred (${allSupabaseChunks.join(', ')})`}`,
  )
  for (const report of lazyRouteReports) {
    console.log(`Lazy-route ('${report.route}') bundle budget`)
    console.log(
      `  Manifest entry: ${report.entry} (${manifest[report.entry].isDynamicEntry ? 'lazy' : 'NOT lazy'})`,
    )
    console.log(
      `  Total: raw ${formatBytes(report.total.rawBytes)} / ${formatBytes(report.rawBytes)}, gzip ${formatBytes(report.total.gzipBytes)} / ${formatBytes(report.gzipBytes)}`,
    )
  }

  if (violations.length) {
    console.error(`\nBundle budget check failed:\n- ${violations.join('\n- ')}`)
    process.exitCode = 1
  }
}

main().catch((error) => {
  console.error(`Bundle budget check could not inspect ${MANIFEST_FILE}: ${error.message}`)
  process.exitCode = 1
})
