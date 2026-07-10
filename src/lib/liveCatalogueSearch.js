function searchText(value) {
  return typeof value === 'string' ? value.trim().toLocaleLowerCase() : ''
}

function matchesSchool(row, school) {
  if (school === 'All') return true
  if (school === 'HKS') return Boolean(row.is_hks)
  if (school === 'Non-HKS') return !row.is_hks
  if (school === 'HBS') return row.school === 'HBSD' || row.school === 'HBSM'
  return row.school === school
}

/** Search only the daily-synced current-offering catalogue. */
export function findLiveCatalogueRows(rows, { query = '', year, semester, school = 'HKS' } = {}) {
  const expectedTerm = year && semester ? `${year} ${semester}` : null
  const needle = searchText(query)

  return (Array.isArray(rows) ? rows : []).filter((row) => {
    if (!row || typeof row !== 'object') return false
    if (expectedTerm && row.term !== expectedTerm) return false
    if (!matchesSchool(row, school)) return false
    if (!needle) return true

    const content = [
      row.course_code,
      row.course_code_base,
      row.title,
      ...(Array.isArray(row.instructors) ? row.instructors : []),
    ]
      .filter((value) => typeof value === 'string')
      .join(' ')
      .toLocaleLowerCase()
    return content.includes(needle)
  })
}
