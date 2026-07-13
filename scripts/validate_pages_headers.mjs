import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

export const MAX_PAGES_HEADER_RULES = 100
export const CACHE_POLICY_HEADERS = new Set([
  'cache-control',
  'cdn-cache-control',
  'cloudflare-cdn-cache-control',
])

export function parsePagesHeaders(source) {
  if (typeof source !== 'string') throw new Error('Pages _headers must be text.')

  const rules = []
  let current = null
  for (const [index, rawLine] of source.split(/\r?\n/).entries()) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue

    if (!/^\s/.test(rawLine)) {
      current = { pattern: line, headers: [], line: index + 1 }
      rules.push(current)
      continue
    }

    if (!current) {
      throw new Error(`Pages _headers defines a header before a rule on line ${index + 1}.`)
    }
    const detached = line.startsWith('! ')
    const separator = line.indexOf(':')
    const name = (detached ? line.slice(2) : separator >= 0 ? line.slice(0, separator) : line)
      .trim()
      .toLowerCase()
    if (!name) throw new Error(`Pages _headers has an empty header name on line ${index + 1}.`)
    current.headers.push({ name, detached, line: index + 1 })
  }

  return rules
}

export function validatePagesHeaders(source) {
  const rules = parsePagesHeaders(source)
  if (!rules.length) throw new Error('Final dist/_headers contains no rules.')
  if (rules.length > MAX_PAGES_HEADER_RULES) {
    throw new Error(
      `Final dist/_headers has ${rules.length} rules; Cloudflare Pages allows at most ${MAX_PAGES_HEADER_RULES}.`,
    )
  }

  const seenPatterns = new Set()
  for (const rule of rules) {
    if (seenPatterns.has(rule.pattern)) {
      throw new Error(`Final dist/_headers repeats rule pattern ${rule.pattern}.`)
    }
    seenPatterns.add(rule.pattern)
    for (const header of rule.headers) {
      if (CACHE_POLICY_HEADERS.has(header.name)) {
        throw new Error(
          `Final dist/_headers must not author ${header.name} (${rule.pattern}, line ${header.line}); effective cache policy is verified from deployed responses.`,
        )
      }
    }
  }

  return rules
}

export async function validateBuiltPagesHeaders(path = 'dist/_headers') {
  return validatePagesHeaders(await readFile(path, 'utf8'))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const rules = await validateBuiltPagesHeaders()
    console.log(`Final Pages headers validated: ${rules.length}/${MAX_PAGES_HEADER_RULES} rules`)
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
