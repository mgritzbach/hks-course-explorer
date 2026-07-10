import * as XLSX from 'xlsx'
import { describe, expect, it, vi } from 'vitest'
import { parseXlsx, XLSX_UPLOAD_LIMITS, XlsxUploadError } from '../lib/xlsxParser.js'

function workbookFile(name, rows, bookType = 'xlsx') {
  const workbook = XLSX.utils.book_new()
  const worksheet = XLSX.utils.aoa_to_sheet(rows)
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Import')
  const arrayBuffer = XLSX.write(workbook, { type: 'array', bookType })

  return {
    name,
    size: arrayBuffer.byteLength,
    arrayBuffer: async () => arrayBuffer,
  }
}

function workbookFileWithRange(name, range) {
  const workbook = XLSX.utils.book_new()
  const worksheet = XLSX.utils.aoa_to_sheet([['course_code']])
  worksheet['!ref'] = range
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Import')
  const arrayBuffer = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' })

  return {
    name,
    size: arrayBuffer.byteLength,
    arrayBuffer: async () => arrayBuffer,
  }
}

describe('parseXlsx', () => {
  it('returns the first worksheet with valid rows and headers', async () => {
    const parsed = await parseXlsx(
      workbookFile('courses.XLSX', [
        ['course_code', 'term'],
        ['API-101', 'Fall'],
      ]),
    )

    expect(parsed.sheetName).toBe('Import')
    expect(parsed.headers).toEqual(['course_code', 'term'])
    expect(parsed.rows).toEqual([{ course_code: 'API-101', term: 'Fall' }])
  })

  it('normalizes human workbook headers into the API contract', async () => {
    const parsed = await parseXlsx(
      workbookFile('courses.xlsx', [
        ['Course Code', 'Bid Clearing Price'],
        ['API-101', 10],
      ]),
    )

    expect(parsed.headers).toEqual(['course_code', 'bid_clearing_price'])
    expect(parsed.rows).toEqual([{ course_code: 'API-101', bid_clearing_price: 10 }])
  })

  it('preserves the supported legacy .xls import path', async () => {
    const parsed = await parseXlsx(
      workbookFile(
        'courses.xls',
        [
          ['Course Code', 'Term'],
          ['API-101', 'Fall'],
        ],
        'biff8',
      ),
    )

    expect(parsed.rows).toEqual([{ course_code: 'API-101', term: 'Fall' }])
  })

  it('rejects ambiguous headers after normalization', async () => {
    await expect(
      parseXlsx(
        workbookFile('courses.xlsx', [
          ['Course Code', 'course_code'],
          ['API-101', 'API-101'],
        ]),
      ),
    ).rejects.toMatchObject({ code: 'DUPLICATE_NORMALIZED_HEADER' })
  })

  it('rejects a blank workbook heading instead of accepting SheetJS placeholder keys', async () => {
    await expect(
      parseXlsx(
        workbookFile('courses.xlsx', [
          ['', 'course_code'],
          ['ignored', 'API-101'],
        ]),
      ),
    ).rejects.toMatchObject({ code: 'INVALID_HEADERS' })
  })

  it('rejects unsupported extensions before reading the file', async () => {
    const arrayBuffer = vi.fn()

    await expect(parseXlsx({ name: 'courses.csv', size: 10, arrayBuffer })).rejects.toMatchObject({
      name: 'XlsxUploadError',
      code: 'UNSUPPORTED_FILE_TYPE',
      message: 'Only .xlsx and .xls workbooks can be uploaded.',
    })
    expect(arrayBuffer).not.toHaveBeenCalled()
  })

  it('rejects files over the fixed upload limit before parsing', async () => {
    const arrayBuffer = vi.fn()

    await expect(
      parseXlsx({
        name: 'courses.xlsx',
        size: XLSX_UPLOAD_LIMITS.maxBytes + 1,
        arrayBuffer,
      }),
    ).rejects.toMatchObject({ code: 'FILE_TOO_LARGE' })
    expect(arrayBuffer).not.toHaveBeenCalled()
  })

  it('rejects malformed workbook contents with a safe error', async () => {
    await expect(
      parseXlsx({
        name: 'courses.xlsx',
        size: 4,
        arrayBuffer: async () => new Uint8Array([1, 2, 3, 4]).buffer,
      }),
    ).rejects.toEqual(
      expect.objectContaining({
        name: 'XlsxUploadError',
        code: 'INVALID_WORKBOOK',
        message: 'The selected file does not match its Excel file type.',
      }),
    )
  })

  it('rejects a worksheet range above the data-row limit before materializing rows', async () => {
    const file = workbookFileWithRange('courses.xlsx', `A1:A${XLSX_UPLOAD_LIMITS.maxDataRows + 2}`)

    await expect(parseXlsx(file)).rejects.toMatchObject({
      name: 'XlsxUploadError',
      code: 'TOO_MANY_ROWS',
      message: 'The workbook has too many rows. Upload at most 10,000 data rows.',
    })
  })

  it('rejects a worksheet range above the column limit before materializing rows', async () => {
    const lastColumn = XLSX.utils.encode_col(XLSX_UPLOAD_LIMITS.maxColumns)
    const file = workbookFileWithRange('courses.xlsx', `A1:${lastColumn}2`)

    await expect(parseXlsx(file)).rejects.toMatchObject({
      name: 'XlsxUploadError',
      code: 'TOO_MANY_COLUMNS',
      message: 'The workbook has too many columns. Upload at most 100 columns.',
    })
  })

  it('exports a dedicated error type for caller-safe upload feedback', () => {
    expect(new XlsxUploadError('safe message', 'SAFE_CODE')).toBeInstanceOf(Error)
  })
})
