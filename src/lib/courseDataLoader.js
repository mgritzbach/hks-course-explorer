/** Efficiently load the historical catalogue without speculative empty pages. */
export const COURSE_PAGE_SIZE = 1000
export const MAX_COURSE_ROWS = 10_000

async function fetchPage(client, from, to, includeCount) {
  const options = includeCount ? { count: 'exact' } : undefined
  return client.from('courses').select('*', options).range(from, to)
}

/**
 * Fetch every historical course row. The first request carries the exact
 * count, allowing all remaining required pages to load in parallel. If a
 * count is unavailable, retain the bounded sequential fallback rather than
 * risking a truncated catalogue.
 */
export async function fetchAllCourses(client, onProgress) {
  const firstResult = await fetchPage(client, 0, COURSE_PAGE_SIZE - 1, true)
  if (firstResult.error) throw firstResult.error

  const firstRows = Array.isArray(firstResult.data) ? firstResult.data : []
  const totalRows = Number.isInteger(firstResult.count) ? firstResult.count : null
  if (totalRows != null && totalRows > MAX_COURSE_ROWS) {
    throw new Error(`Catalogue exceeds the safe ${MAX_COURSE_ROWS} row limit.`)
  }

  const remainingPages =
    totalRows == null ? null : Math.max(0, Math.ceil(totalRows / COURSE_PAGE_SIZE) - 1)
  const allRows = [...firstRows]

  if (remainingPages != null) {
    const results = await Promise.all(
      Array.from({ length: remainingPages }, (_, index) => {
        const from = (index + 1) * COURSE_PAGE_SIZE
        return fetchPage(client, from, from + COURSE_PAGE_SIZE - 1, false)
      }),
    )
    for (const { data, error } of results) {
      if (error) throw error
      if (Array.isArray(data)) allRows.push(...data)
    }
  } else {
    for (let from = COURSE_PAGE_SIZE; from < MAX_COURSE_ROWS; from += COURSE_PAGE_SIZE) {
      const { data, error } = await fetchPage(client, from, from + COURSE_PAGE_SIZE - 1, false)
      if (error) throw error
      const rows = Array.isArray(data) ? data : []
      allRows.push(...rows)
      if (rows.length < COURSE_PAGE_SIZE) break
    }
  }

  if (allRows.length > MAX_COURSE_ROWS) {
    throw new Error(`Catalogue exceeds the safe ${MAX_COURSE_ROWS} row limit.`)
  }
  if (totalRows != null && allRows.length !== totalRows) {
    throw new Error(
      `Catalogue pagination returned ${allRows.length} of ${totalRows} expected rows.`,
    )
  }

  onProgress?.(allRows.length)
  return allRows
}
