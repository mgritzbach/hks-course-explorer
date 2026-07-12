import { execFile as execFileCallback } from 'node:child_process'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'

const execFile = promisify(execFileCallback)
const guard = path.resolve('scripts/check_bundle_budget.mjs')
const fixtures = []

afterEach(async () => {
  await Promise.all(
    fixtures.splice(0).map((fixture) => rm(fixture, { recursive: true, force: true })),
  )
})

async function createFixture(manifest, files = {}) {
  const dist = await mkdtemp(path.join(tmpdir(), 'hks-bundle-budget-'))
  fixtures.push(dist)
  await mkdir(path.join(dist, '.vite'), { recursive: true })
  await writeFile(path.join(dist, '.vite', 'manifest.json'), JSON.stringify(manifest))
  await Promise.all(
    Object.entries(files).map(async ([asset, content]) => {
      const target = path.join(dist, asset)
      await mkdir(path.dirname(target), { recursive: true })
      await writeFile(target, content)
    }),
  )
  return dist
}

async function runGuard(dist) {
  try {
    const result = await execFile(process.execPath, [guard, dist])
    return { code: 0, ...result }
  } catch (error) {
    return { code: error.code, stdout: error.stdout, stderr: error.stderr }
  }
}

function baseManifest({ home = {}, shell = {}, courses = {}, scheduleBuilder = {} } = {}) {
  return {
    'index.html': {
      file: 'assets/index.js',
      isEntry: true,
      imports: ['src/App.jsx'],
      css: ['assets/index.css'],
      dynamicImports: ['src/pages/Courses.jsx', 'src/pages/ScheduleBuilder.jsx'],
      ...shell,
    },
    'src/App.jsx': { file: 'assets/app.js', imports: ['src/shared.js'] },
    'src/shared.js': { file: 'assets/shared.js', css: ['assets/shared.css'] },
    'src/pages/Home.jsx': { file: 'assets/home.js', imports: ['src/shared.js'], ...home },
    'src/pages/Courses.jsx': {
      file: 'assets/courses.js',
      imports: ['src/shared.js'],
      isDynamicEntry: true,
      ...courses,
    },
    'src/pages/ScheduleBuilder.jsx': {
      file: 'assets/schedule-builder.js',
      imports: ['src/shared.js'],
      isDynamicEntry: true,
      ...scheduleBuilder,
    },
    'node_modules/plotly.js-dist-min/plotly.js': { file: 'assets/vendor-plotly.js' },
    'node_modules/@supabase/supabase-js/dist/main/index.js': { file: 'assets/vendor-supabase.js' },
    'node_modules/web-vitals/dist/web-vitals.js': {
      file: 'assets/web-vitals.js',
      isDynamicEntry: true,
    },
  }
}

const standardAssets = {
  'assets/index.js': 'index',
  'assets/app.js': 'app',
  'assets/shared.js': 'shared',
  'assets/home.js': 'home',
  'assets/courses.js': 'courses',
  'assets/schedule-builder.js': 'schedule-builder',
  'assets/index.css': 'body{}',
  'assets/shared.css': '.shared{}',
  'assets/vendor-plotly.js': 'plotly',
  'assets/vendor-supabase.js': 'supabase',
  'assets/web-vitals.js': 'web-vitals',
}

describe('check_bundle_budget', () => {
  it('fails when the manifest is missing or malformed', async () => {
    const missing = await mkdtemp(path.join(tmpdir(), 'hks-bundle-budget-missing-'))
    fixtures.push(missing)
    const malformed = await mkdtemp(path.join(tmpdir(), 'hks-bundle-budget-malformed-'))
    fixtures.push(malformed)
    await mkdir(path.join(malformed, '.vite'), { recursive: true })
    await writeFile(path.join(malformed, '.vite', 'manifest.json'), '{')

    const missingResult = await runGuard(missing)
    const malformedResult = await runGuard(malformed)
    expect(missingResult.code).not.toBe(0)
    expect(missingResult.stderr).toContain('Bundle budget check could not inspect')
    expect(malformedResult.code).not.toBe(0)
    expect(malformedResult.stderr).toContain('Bundle budget check could not inspect')
  })

  it('includes Home plus all recursive static imports and CSS assets', async () => {
    const dist = await createFixture(baseManifest(), standardAssets)
    const result = await runGuard(dist)

    expect(result.code).toBe(0)
    expect(result.stdout).toContain('assets/app.js')
    expect(result.stdout).toContain('assets/home.js')
    expect(result.stdout).toContain('assets/shared.js')
    expect(result.stdout).toContain('assets/index.css')
    expect(result.stdout).toContain('assets/shared.css')
    expect(result.stdout).toContain('Plotly: lazy')
    expect(result.stdout).toContain('Web Vitals: lazy')
    expect(result.stdout).toContain("Lazy-route ('/courses') bundle budget")
    expect(result.stdout).toContain("Lazy-route ('/schedule-builder') bundle budget")
  })

  it('fails an over-budget root-route graph', async () => {
    const manifest = baseManifest({ shell: { imports: ['src/large.js'] } })
    manifest['src/large.js'] = { file: 'assets/large.js' }
    const dist = await createFixture(manifest, {
      ...standardAssets,
      'assets/large.js': 'x'.repeat(1_050_001),
    })
    const result = await runGuard(dist)

    expect(result.code).not.toBe(0)
    expect(result.stderr).toContain('root-route raw size')
  })

  it('fails when Plotly is a static Home dependency', async () => {
    const dist = await createFixture(
      baseManifest({ home: { imports: ['node_modules/plotly.js-dist-min/plotly.js'] } }),
      standardAssets,
    )
    const result = await runGuard(dist)

    expect(result.code).not.toBe(0)
    expect(result.stderr).toContain('Plotly must be lazy-loaded')
  })

  it('allows Plotly only in Home dynamicImports', async () => {
    const dist = await createFixture(
      baseManifest({ home: { dynamicImports: ['node_modules/plotly.js-dist-min/plotly.js'] } }),
      standardAssets,
    )
    const result = await runGuard(dist)

    expect(result.code).toBe(0)
    expect(result.stdout).toContain('Plotly: lazy')
  })

  it('fails when Supabase is a static Home dependency', async () => {
    const dist = await createFixture(
      baseManifest({
        home: { imports: ['node_modules/@supabase/supabase-js/dist/main/index.js'] },
      }),
      standardAssets,
    )
    const result = await runGuard(dist)

    expect(result.code).not.toBe(0)
    expect(result.stderr).toContain('Supabase must load after the initial Home graph')
  })

  it('fails when Web Vitals telemetry becomes a static Home dependency', async () => {
    const dist = await createFixture(
      baseManifest({ home: { imports: ['node_modules/web-vitals/dist/web-vitals.js'] } }),
      standardAssets,
    )
    const result = await runGuard(dist)

    expect(result.code).not.toBe(0)
    expect(result.stderr).toContain('Web Vitals telemetry must be lazy-loaded')
  })

  it('fails when a direct-navigation lazy route exceeds its budget', async () => {
    const manifest = baseManifest()
    const dist = await createFixture(manifest, {
      ...standardAssets,
      'assets/courses.js': 'x'.repeat(1_450_001),
    })
    const result = await runGuard(dist)

    expect(result.code).not.toBe(0)
    expect(result.stderr).toContain('/courses raw size')
  })

  it('fails when a protected route stops being lazy-loaded by the shell', async () => {
    const manifest = baseManifest({
      shell: { dynamicImports: ['src/pages/ScheduleBuilder.jsx'] },
      courses: { isDynamicEntry: false },
    })
    const dist = await createFixture(manifest, standardAssets)
    const result = await runGuard(dist)

    expect(result.code).not.toBe(0)
    expect(result.stderr).toContain('/courses must remain a Vite dynamic entry')
    expect(result.stderr).toContain('/courses must remain dynamically imported by the app shell')
  })
})
