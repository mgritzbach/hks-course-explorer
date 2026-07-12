import { describe, expect, it } from 'vitest'
import {
  buildAvailableCatalogueTerms,
  getEffectiveScheduleSession,
  getDefaultScheduleTerm,
  getLiveCatalogueTerm,
  getSessionOptions,
  normalizeSessionForSemester,
} from '../lib/scheduleCatalogueOptions.js'

describe('schedule catalogue term options', () => {
  it('builds an availability-backed term list with complete HKS counts', () => {
    expect(
      buildAvailableCatalogueTerms([
        { id: 'fall-a', term: '2026 Fall', is_hks: true },
        { id: 'fall-b', term: '2026 Fall', is_hks: true },
        { id: 'spring-a', term: '2027 Spring', is_hks: true },
        { id: 'other-school', term: '2026 Fall', is_hks: false },
        { id: 'invalid', term: 'unknown', is_hks: true },
      ]),
    ).toEqual([
      {
        term: '2026 Fall',
        year: '2026',
        semester: 'Fall',
        count: 2,
        label: 'Fall 2026',
      },
      {
        term: '2027 Spring',
        year: '2027',
        semester: 'Spring',
        count: 1,
        label: 'Spring 2027',
      },
    ])
  })

  it('defaults summer planning to the current Fall catalog', () => {
    expect(getDefaultScheduleTerm(new Date('2026-07-11T12:00:00Z'))).toEqual({
      year: '2026',
      semester: 'Fall',
    })
  })

  it('offers only sessions belonging to the selected semester', () => {
    expect(getSessionOptions('Fall')).toEqual(['Full Term', 'Fall 1', 'Fall 2'])
    expect(getSessionOptions('Spring')).toEqual(['Full Term', 'Spring 1', 'Spring 2', 'January'])
  })

  it('maps J-Term to the January session inside the Spring source term', () => {
    expect(getLiveCatalogueTerm('2027', 'January')).toBe('2027 Spring')
    expect(getEffectiveScheduleSession('January', 'all')).toBe('January')
  })

  it('clears an incompatible session when the semester changes', () => {
    expect(normalizeSessionForSemester('Spring 1', 'Fall')).toBe('all')
    expect(normalizeSessionForSemester('Fall 2', 'Fall')).toBe('Fall 2')
  })
})
