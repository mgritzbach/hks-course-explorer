import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  CACHE_POLICY_HEADERS,
  MAX_PAGES_HEADER_RULES,
  parsePagesHeaders,
  validateBuiltPagesHeaders,
  validatePagesHeaders,
} from './validate_pages_headers.mjs'

const SAFE_HEADERS = `
/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
`

describe('final Cloudflare Pages header contract', () => {
  it('validates the authored header contract before the post-build dist gate', async () => {
    const rules = validatePagesHeaders(await readFile('public/_headers', 'utf8'))
    expect(rules).toHaveLength(1)
    expect(rules[0].pattern).toBe('/*')
    expect(rules[0].headers.map(({ name }) => name)).toContain('x-content-type-options')
  })

  const builtArtifactTest = existsSync('dist/_headers') ? it : it.skip
  builtArtifactTest('parses and validates the exact final dist/_headers artifact', async () => {
    const rules = await validateBuiltPagesHeaders()
    expect(rules).toHaveLength(1)
    expect(rules[0].pattern).toBe('/*')
  })

  it('parses comments, detached headers, and ordinary header values deterministically', () => {
    expect(parsePagesHeaders(`# comment\n/*\n  X-Test: value\n/assets/*\n  ! Link\n`)).toEqual([
      {
        pattern: '/*',
        line: 2,
        headers: [{ name: 'x-test', detached: false, line: 3 }],
      },
      {
        pattern: '/assets/*',
        line: 4,
        headers: [{ name: 'link', detached: true, line: 5 }],
      },
    ])
  })

  it.each([...CACHE_POLICY_HEADERS])(
    'rejects authored and detached %s policies, including overlapping rules',
    (headerName) => {
      expect(() =>
        validatePagesHeaders(
          `${SAFE_HEADERS}\n/assets/*\n  ${headerName}: public, max-age=31556952, stale-if-error=86400\n`,
        ),
      ).toThrow(`must not author ${headerName}`)
      expect(() => validatePagesHeaders(`${SAFE_HEADERS}\n/assets/*\n  ! ${headerName}\n`)).toThrow(
        `must not author ${headerName}`,
      )
    },
  )

  it('rejects duplicate patterns and a rule count above the free Pages ceiling', () => {
    expect(() => validatePagesHeaders(`${SAFE_HEADERS}\n/*\n  X-Test: duplicate\n`)).toThrow(
      'repeats rule pattern',
    )
    const tooManyRules = Array.from(
      { length: MAX_PAGES_HEADER_RULES + 1 },
      (_, index) => `/path-${index}\n  X-Test: value`,
    ).join('\n')
    expect(() => validatePagesHeaders(tooManyRules)).toThrow('allows at most 100')
  })

  it('rejects malformed or empty header artifacts', () => {
    expect(() => validatePagesHeaders('')).toThrow('contains no rules')
    expect(() => validatePagesHeaders('  X-Test: before-rule')).toThrow('before a rule')
  })
})
