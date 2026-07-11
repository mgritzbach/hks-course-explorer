import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const source = readFileSync(
  resolve(globalThis.process.cwd(), 'src/pages/ScheduleBuilder.jsx'),
  'utf8',
)

describe('Schedule Builder identity contract', () => {
  it('uses verified history evidence instead of suffix-stripped rating fallbacks', () => {
    expect(source).toContain('findVerifiedHistoricalRating')
    expect(source).not.toContain('getBaseCourseId')
    expect(source).not.toContain('histRatingsMap.get(')
  })

  it('does not borrow meeting times from a related course-code variant', () => {
    expect(source).not.toContain("sectionTimesMap.get(code.replace(/-[A-Z]$/, ''))")
    expect(source).not.toContain("sectionTimesMap.get(eCode.replace(/-[A-Z]$/, ''))")
  })
})
