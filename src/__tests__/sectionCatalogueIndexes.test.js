import { describe, expect, it } from 'vitest'
import { buildSectionCatalogueIndexes, sectionCodeKey } from '../lib/sectionCatalogueIndexes.js'

describe('trusted section catalogue indexes', () => {
  it('normalises presentation only and preserves every course suffix', () => {
    expect(sectionCodeKey(' dpi 802 - m-d ')).toBe('DPI-802-M-D')
    expect(sectionCodeKey('DPI-802-M-D')).not.toBe(sectionCodeKey('DPI-802-M'))
  })

  it('does not make a section variant available through a stripped code', () => {
    const indexes = buildSectionCatalogueIndexes([
      {
        course_code_base: 'DPI-802-M',
        meetings: [{ day: 'MON', start: '09:00', end: '10:15' }],
        title: 'Exact offering',
      },
    ])

    expect(indexes.sectionTimesMap.get('DPI-802-M')).toHaveLength(1)
    expect(indexes.sectionTimesMap.get('DPI-802')).toBeUndefined()
    expect(indexes.sectionTimesMap.get('DPI-802-M-D')).toBeUndefined()
  })
})
