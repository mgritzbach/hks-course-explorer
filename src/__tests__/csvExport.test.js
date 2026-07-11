import { describe, expect, it } from 'vitest'
import { csvCell } from '../lib/csvExport.js'

describe('csvCell', () => {
  it('keeps ordinary course data compatible with the established comma/newline format', () => {
    expect(csvCell('Course, title\nwith detail')).toBe('Course; title with detail')
  })

  it('neutralizes formula-leading imported values before spreadsheet export', () => {
    expect(csvCell('=HYPERLINK("https://example.test")')).toBe(
      '\'=HYPERLINK("https://example.test")',
    )
    expect(csvCell('  @SUM(A1:A2)')).toBe("'  @SUM(A1:A2)")
  })
})
