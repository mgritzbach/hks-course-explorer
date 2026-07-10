import { describe, expect, it } from 'vitest'
import {
  assertCourseMetaContract,
  assertCourseMetricDefinitions,
  buildCourseMeta,
} from '../lib/courseMeta.js'
import {
  DAY_INDEX,
  assertScheduleNormalizationContract,
} from '../lib/scheduleCourseNormalization.js'
import { VISITOR_NAV_ITEMS, assertVisitorNavigationContract } from '../lib/visitorNavigation.js'
import schoolConfig, { assertSchoolConfig } from '../school.config.js'

describe('runtime contracts', () => {
  it('accepts the production pure-module and configuration contracts', () => {
    expect(assertCourseMetricDefinitions()).toBe(true)
    expect(assertCourseMetaContract(buildCourseMeta([]))).toBe(true)
    expect(assertScheduleNormalizationContract()).toBe(true)
    expect(assertVisitorNavigationContract()).toBe(true)
    expect(assertSchoolConfig()).toBe(true)
  })

  it('rejects malformed course metadata fixtures deterministically', () => {
    expect(() =>
      assertCourseMetricDefinitions([
        { key: 'A', label: 'A', higher_is_better: true },
        { key: 'A', label: 'Again', higher_is_better: false },
      ]),
    ).toThrow('Course metadata contract: metric key "A" must be unique')
    expect(() =>
      assertCourseMetaContract({
        metrics: [],
        concentrations: [],
        years: [],
        terms: [],
        default_terms: [],
        default_year: '2025',
        year_medians_instructor: {},
      }),
    ).toThrow('Course metadata contract: default_year must be a finite number')
  })

  it('rejects malformed schedule-order fixtures deterministically', () => {
    expect(() => assertScheduleNormalizationContract({ ...DAY_INDEX, SUN: 5 })).toThrow(
      'Schedule normalization contract: DAY_INDEX.SUN must equal 6',
    )
  })

  it('rejects duplicate or incomplete visitor navigation fixtures deterministically', () => {
    expect(() =>
      assertVisitorNavigationContract([
        VISITOR_NAV_ITEMS[0],
        { ...VISITOR_NAV_ITEMS[0], label: 'Duplicate home' },
      ]),
    ).toThrow('Visitor navigation contract: route "/" must be unique')
    expect(() =>
      assertVisitorNavigationContract([
        {
          to: '/only',
          label: 'Only',
          mobileLabel: 'Only',
          icon: '•',
          desktop: true,
          mobile: 'hidden',
        },
      ]),
    ).toThrow(
      'Visitor navigation contract: route "/only" must use mobile placement primary or more',
    )
  })

  it('rejects unsafe school configuration fixtures deterministically', () => {
    expect(() => assertSchoolConfig({ ...schoolConfig, appTitle: '' })).toThrow(
      'School configuration contract: appTitle must be a non-empty string',
    )
    expect(() =>
      assertSchoolConfig({ ...schoolConfig, creatorUrl: 'http://example.test' }),
    ).toThrow('School configuration contract: creatorUrl must use HTTPS')
  })
})
