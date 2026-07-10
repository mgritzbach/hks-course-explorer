/**
 * Read a bounded Supabase collection without relying on the platform's
 * per-request row cap. Catalogue views must use a deterministic ordering
 * before calling this helper; otherwise records can move between pages.
 */
export const CATALOGUE_PAGE_SIZE = 1000
export const CATALOGUE_MAX_ROWS = 10000

export async function fetchCataloguePages(
  createQuery,
  { pageSize = CATALOGUE_PAGE_SIZE, maxRows = CATALOGUE_MAX_ROWS } = {},
) {
  if (!Number.isInteger(pageSize) || pageSize < 1) throw new Error('Invalid catalogue page size.')
  if (!Number.isInteger(maxRows) || maxRows < pageSize)
    throw new Error('Invalid catalogue row limit.')

  const allRows = []

  for (let from = 0; from < maxRows; from += pageSize) {
    const to = Math.min(from + pageSize - 1, maxRows - 1)
    const { data, error } = await createQuery().range(from, to)
    if (error) throw error

    const rows = Array.isArray(data) ? data : []
    allRows.push(...rows)
    if (rows.length < pageSize) return allRows
  }

  throw new Error(`Catalogue exceeds the safe ${maxRows} row limit.`)
}
