import * as XLSX from 'xlsx'

// These limits protect the browser and the Supabase insert path from accidental
// or hostile bulk imports. They are deliberately independent of the file
// chooser, because drag-and-drop can bypass the HTML accept attribute.
export const XLSX_UPLOAD_LIMITS = Object.freeze({
  maxBytes: 10 * 1024 * 1024,
  maxDataRows: 10_000,
  maxColumns: 100,
})

const SUPPORTED_EXTENSIONS = new Set(['.xlsx', '.xls'])

export class XlsxUploadError extends Error {
  constructor(message, code) {
    super(message)
    this.name = 'XlsxUploadError'
    this.code = code
  }
}

function uploadError(message, code) {
  return new XlsxUploadError(message, code)
}

function getExtension(name) {
  const dotIndex = name.lastIndexOf('.')
  return dotIndex >= 0 ? name.slice(dotIndex).toLowerCase() : ''
}

function validateFile(file) {
  if (!file || typeof file.name !== 'string' || typeof file.arrayBuffer !== 'function') {
    throw uploadError('Choose an Excel workbook to upload.', 'INVALID_FILE')
  }

  if (!SUPPORTED_EXTENSIONS.has(getExtension(file.name))) {
    throw uploadError('Only .xlsx and .xls workbooks can be uploaded.', 'UNSUPPORTED_FILE_TYPE')
  }

  if (!Number.isFinite(file.size) || file.size <= 0) {
    throw uploadError('The selected workbook is empty or unavailable.', 'INVALID_FILE_SIZE')
  }

  if (file.size > XLSX_UPLOAD_LIMITS.maxBytes) {
    throw uploadError('The workbook exceeds the 10 MB upload limit.', 'FILE_TOO_LARGE')
  }
}

function hasBytes(bytes, expected) {
  return expected.every((value, index) => bytes[index] === value)
}

function validateWorkbookSignature(arrayBuffer, extension) {
  if (!(arrayBuffer instanceof ArrayBuffer)) {
    throw uploadError(
      'Could not read the selected workbook. Choose another file and try again.',
      'FILE_READ_FAILED',
    )
  }

  const bytes = new Uint8Array(arrayBuffer, 0, Math.min(arrayBuffer.byteLength, 8))
  const isZip = hasBytes(bytes, [0x50, 0x4b, 0x03, 0x04])
  const isCompoundFile = hasBytes(bytes, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])
  const isExpectedFormat = extension === '.xlsx' ? isZip : isCompoundFile

  if (!isExpectedFormat) {
    throw uploadError('The selected file does not match its Excel file type.', 'INVALID_WORKBOOK')
  }
}

function getWorksheetDimensions(worksheet) {
  if (!worksheet || typeof worksheet['!ref'] !== 'string') {
    throw uploadError('The workbook does not contain a readable worksheet.', 'INVALID_WORKBOOK')
  }

  try {
    const range = XLSX.utils.decode_range(worksheet['!ref'])
    return {
      columns: range.e.c - range.s.c + 1,
      // sheet_to_json treats the first row of the selected range as headers.
      dataRows: Math.max(0, range.e.r - range.s.r),
    }
  } catch {
    throw uploadError('The workbook does not contain a readable worksheet.', 'INVALID_WORKBOOK')
  }
}

function validateWorksheetDimensions(dimensions) {
  if (dimensions.columns > XLSX_UPLOAD_LIMITS.maxColumns) {
    throw uploadError(
      'The workbook has too many columns. Upload at most 100 columns.',
      'TOO_MANY_COLUMNS',
    )
  }

  if (dimensions.dataRows > XLSX_UPLOAD_LIMITS.maxDataRows) {
    throw uploadError(
      'The workbook has too many rows. Upload at most 10,000 data rows.',
      'TOO_MANY_ROWS',
    )
  }
}

export function normalizeWorksheetColumn(name) {
  const source = String(name)
  // SheetJS labels a blank header `__EMPTY`; treat it as invalid rather than
  // accepting an accidental `empty` column that the server would later reject.
  if (/^__empty(?:_\d+)?$/i.test(source)) return ''
  return source
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

function normalizeWorksheetRows(rows) {
  return rows.map((row) => {
    const normalized = {}
    for (const [header, value] of Object.entries(row)) {
      const column = normalizeWorksheetColumn(header)
      if (!column)
        throw uploadError('The workbook has an invalid column header.', 'INVALID_HEADERS')
      if (Object.hasOwn(normalized, column))
        throw uploadError(
          'The workbook has duplicate column headers after normalization.',
          'DUPLICATE_NORMALIZED_HEADER',
        )
      normalized[column] = value
    }
    return normalized
  })
}

export async function parseXlsx(file) {
  validateFile(file)
  const extension = getExtension(file.name)

  let arrayBuffer
  try {
    arrayBuffer = await file.arrayBuffer()
  } catch {
    throw uploadError(
      'Could not read the selected workbook. Choose another file and try again.',
      'FILE_READ_FAILED',
    )
  }

  validateWorkbookSignature(arrayBuffer, extension)

  let workbook
  try {
    workbook = XLSX.read(arrayBuffer, { type: 'array' })
  } catch {
    throw uploadError('The selected file is not a readable Excel workbook.', 'INVALID_WORKBOOK')
  }

  const sheetName = workbook.SheetNames?.[0]
  const worksheet = sheetName ? workbook.Sheets?.[sheetName] : null
  const dimensions = getWorksheetDimensions(worksheet)
  validateWorksheetDimensions(dimensions)

  let rows
  try {
    rows = XLSX.utils.sheet_to_json(worksheet, { defval: '' })
  } catch {
    throw uploadError('The workbook could not be safely converted into rows.', 'INVALID_WORKBOOK')
  }

  const normalizedRows = normalizeWorksheetRows(rows)
  const headers = normalizedRows.length > 0 ? Object.keys(normalizedRows[0]) : []
  if (
    rows.length > XLSX_UPLOAD_LIMITS.maxDataRows ||
    headers.length > XLSX_UPLOAD_LIMITS.maxColumns
  ) {
    throw uploadError(
      'The workbook exceeds the supported row or column limit.',
      'WORKSHEET_LIMIT_EXCEEDED',
    )
  }

  return {
    workbook,
    sheetName,
    headers,
    rows: normalizedRows,
  }
}

export function exportXlsx(rows = [], fileName = 'export.xlsx', sheetName = 'Sheet1') {
  const workbook = XLSX.utils.book_new()
  const worksheet = XLSX.utils.json_to_sheet(rows)
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName)
  XLSX.writeFile(workbook, fileName)
}
