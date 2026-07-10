#!/usr/bin/env node

/**
 * Prevents further growth of the legacy modules that are scheduled for
 * incremental extraction. This is intentionally a ratchet: a maintainer may
 * improve behaviour, but a larger module requires an approved baseline update
 * accompanied by an architecture decision and regression evidence.
 */
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'

export const MODULE_LINE_LIMITS = {
  'src/App.jsx': 1123,
  'src/pages/ScheduleBuilder.jsx': 3577,
  'src/pages/Courses.jsx': 1993,
  'src/components/ScatterPlot.jsx': 1121,
}

function countNonEmptyLines(source) {
  return source.split(/\r?\n/).filter(Boolean).length
}

export async function checkArchitecture(root = process.cwd()) {
  const results = await Promise.all(
    Object.entries(MODULE_LINE_LIMITS).map(async ([file, limit]) => {
      const lines = countNonEmptyLines(await readFile(path.join(root, file), 'utf8'))
      return { file, limit, lines }
    }),
  )
  return results
}

async function main() {
  const root = path.resolve(process.argv[2] || '.')
  const results = await checkArchitecture(root)
  const violations = results.filter(({ lines, limit }) => lines > limit)

  console.log('Architecture size ratchet')
  for (const { file, lines, limit } of results) {
    console.log(`  ${file}: ${lines} non-empty lines / ${limit}`)
  }
  if (violations.length) {
    throw new Error(
      `legacy module growth requires an approved baseline update:\n${violations.map(({ file, lines, limit }) => `- ${file}: ${lines} exceeds ${limit}`).join('\n')}`,
    )
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`Architecture check failed: ${error.message}`)
    process.exitCode = 1
  })
}
