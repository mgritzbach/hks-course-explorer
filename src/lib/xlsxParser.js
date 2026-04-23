import * as XLSX from 'xlsx'

export async function parseXlsx(file) {
  const arrayBuffer = await file.arrayBuffer()
  const workbook = XLSX.read(arrayBuffer, { type: 'array' })
  const sheetName = workbook.SheetNames[0]
  const worksheet = workbook.Sheets[sheetName]
  const rows = XLSX.utils.sheet_to_json(worksheet, { defval: '' })
  const headers = rows.length > 0 ? Object.keys(rows[0]) : []

  return {
    workbook,
    sheetName,
    headers,
    rows,
  }
}

export function exportXlsx(rows = [], fileName = 'export.xlsx', sheetName = 'Sheet1') {
  const workbook = XLSX.utils.book_new()
  const worksheet = XLSX.utils.json_to_sheet(rows)
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName)
  XLSX.writeFile(workbook, fileName)
}
