import { describe, expect, it } from 'vitest'
import { currentAcademicSeasonLabel } from '../lib/homeSummary.js'

describe('homepage summary', () => {
  it('labels July as the summer cycle instead of relying on stale eval terms', () => {
    expect(currentAcademicSeasonLabel(new Date('2026-07-14T12:00:00Z'))).toBe('Summer 2026')
  })

  it('falls back safely when a date cannot be parsed', () => {
    expect(currentAcademicSeasonLabel('not-a-date')).toBe('Current cycle')
  })
})
