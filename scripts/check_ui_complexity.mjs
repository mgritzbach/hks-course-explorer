#!/usr/bin/env node

/**
 * Complexity ratchet for the four largest UI roots. The values are measured
 * with ESLint's core `complexity` rule and intentionally allow reductions.
 * Update a baseline only with an architecture decision and regression evidence.
 */
import { ESLint } from 'eslint'
import path from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'

export const UI_COMPLEXITY_BASELINES = Object.freeze({
  'src/App.jsx': Object.freeze({ App: 24 }),
  'src/pages/ScheduleBuilder.jsx': Object.freeze({ ScheduleBuilder: 123 }),
  'src/pages/Courses.jsx': Object.freeze({ Courses: 100 }),
  'src/components/ScatterPlot.jsx': Object.freeze({ ScatterPlot: 69 }),
})

function parseComplexity(message) {
  const match = message.match(/(?:Async )?[Ff]unction '([^']+)' has a complexity of (\d+)/)
  return match ? { name: match[1], complexity: Number(match[2]) } : null
}

/**
 * Compare measured named-function complexity with the approved ratchet.
 * @param {Record<string, Record<string, number>>} observed Measured file/function complexity.
 * @param {Record<string, Record<string, number>>} baselines Approved maximum complexity.
 * @returns {{ file: string, name: string, complexity: number | null, limit: number }[]} Violations.
 */
export function evaluateUiComplexityBaselines(observed, baselines = UI_COMPLEXITY_BASELINES) {
  const violations = []
  for (const [file, functions] of Object.entries(baselines)) {
    for (const [name, limit] of Object.entries(functions)) {
      const complexity = observed[file]?.[name]
      if (complexity == null || complexity > limit)
        violations.push({ file, name, complexity: complexity ?? null, limit })
    }
  }
  return violations
}

/**
 * Measure protected UI functions using ESLint's deterministic complexity rule.
 * @param {string} root Repository root.
 * @returns {Promise<Record<string, Record<string, number>>>} Complexity by file and named function.
 */
export async function collectUiComplexity(root = process.cwd()) {
  const files = Object.keys(UI_COMPLEXITY_BASELINES)
  const eslint = new ESLint({
    cwd: root,
    overrideConfig: { rules: { complexity: ['error', 0] } },
  })
  const results = await eslint.lintFiles(files)
  const observed = {}
  for (const result of results) {
    const file = path.relative(root, result.filePath).replaceAll(path.sep, '/')
    observed[file] = {}
    for (const message of result.messages) {
      if (message.ruleId !== 'complexity') continue
      const parsed = parseComplexity(message.message)
      if (parsed) observed[file][parsed.name] = parsed.complexity
    }
  }
  return observed
}

export async function checkUiComplexity(root = process.cwd()) {
  const observed = await collectUiComplexity(root)
  return { observed, violations: evaluateUiComplexityBaselines(observed) }
}

async function main() {
  const root = path.resolve(process.argv[2] || '.')
  const { observed, violations } = await checkUiComplexity(root)

  console.log('UI cyclomatic-complexity ratchet')
  for (const [file, functions] of Object.entries(UI_COMPLEXITY_BASELINES)) {
    for (const [name, limit] of Object.entries(functions)) {
      console.log(`  ${file} :: ${name}: ${observed[file]?.[name] ?? 'missing'} / ${limit}`)
    }
  }
  if (violations.length) {
    throw new Error(
      `UI complexity growth requires an approved baseline update:\n${violations.map(({ file, name, complexity, limit }) => `- ${file} :: ${name}: ${complexity ?? 'missing'} exceeds ${limit}`).join('\n')}`,
    )
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`UI complexity check failed: ${error.message}`)
    process.exitCode = 1
  })
}
