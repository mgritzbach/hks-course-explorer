import { describe, expect, it } from 'vitest'

import { evaluateAuditReport } from './check_production_dependencies.mjs'

const auditReport = (advisory) => ({
  vulnerabilities: {
    'react-router': {
      name: 'react-router',
      via: [advisory],
    },
  },
})

describe('production dependency audit', () => {
  it('allows the React Router RSC-only advisory when RSC is not used', () => {
    const result = evaluateAuditReport(
      auditReport({
        severity: 'high',
        title: 'RSC Mode CSRF Bypass',
        url: 'https://github.com/advisories/GHSA-qwww-vcr4-c8h2',
      }),
      { rscInUse: false },
    )

    expect(result.blocked).toEqual([])
    expect(result.allowed).toEqual(['GHSA-qwww-vcr4-c8h2'])
  })

  it('blocks the RSC advisory as soon as RSC APIs are used', () => {
    const result = evaluateAuditReport(
      auditReport({
        severity: 'high',
        title: 'RSC Mode CSRF Bypass',
        url: 'https://github.com/advisories/GHSA-qwww-vcr4-c8h2',
      }),
      { rscInUse: true },
    )

    expect(result.blocked).toHaveLength(1)
  })

  it('continues to block every other moderate-or-higher advisory', () => {
    const result = evaluateAuditReport(
      auditReport({
        severity: 'moderate',
        title: 'Different production finding',
        url: 'https://github.com/advisories/GHSA-aaaa-bbbb-cccc',
      }),
      { rscInUse: false },
    )

    expect(result.blocked).toHaveLength(1)
    expect(result.allowed).toEqual([])
  })
})
