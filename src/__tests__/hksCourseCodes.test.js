import { describe, expect, it } from 'vitest'
import { isHksCourseCode } from '../lib/hksCourseCodes.js'

describe('HKS course-code ownership', () => {
  it('accepts every supported HKS prefix regardless of case', () => {
    for (const code of [
      'API-101',
      'bgp-200',
      'DEV-300',
      'DPI-400',
      'IGA-500',
      'MLD-600',
      'SUP-700',
      'MPAID-800',
      'HKS-900',
    ]) {
      expect(isHksCourseCode(code)).toBe(true)
    }
  })

  it('rejects external, blank, and malformed course prefixes', () => {
    expect(isHksCourseCode('HBS-101')).toBe(false)
    expect(isHksCourseCode('')).toBe(false)
    expect(isHksCourseCode(null)).toBe(false)
  })
})
