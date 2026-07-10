import { describe, expect, it } from 'vitest'
import { fetchCataloguePages } from '../lib/cataloguePagination.js'

function pagedQuery(rows, calls) {
  return () => ({
    range(from, to) {
      calls.push([from, to])
      return Promise.resolve({ data: rows.slice(from, to + 1), error: null })
    },
  })
}

describe('catalogue pagination', () => {
  it('retrieves every row across Supabase-sized pages', async () => {
    const rows = Array.from({ length: 1555 }, (_, index) => ({ id: index }))
    const calls = []

    await expect(fetchCataloguePages(pagedQuery(rows, calls))).resolves.toEqual(rows)
    expect(calls).toEqual([
      [0, 999],
      [1000, 1999],
    ])
  })

  it('fails closed instead of silently truncating an unexpectedly large catalogue', async () => {
    const rows = Array.from({ length: 2000 }, (_, index) => ({ id: index }))

    await expect(
      fetchCataloguePages(pagedQuery(rows, []), { pageSize: 1000, maxRows: 2000 }),
    ).rejects.toThrow('Catalogue exceeds the safe 2000 row limit.')
  })

  it('propagates database failures without returning a partial catalogue', async () => {
    const query = () => ({
      range: () => Promise.resolve({ data: null, error: new Error('Database unavailable') }),
    })

    await expect(fetchCataloguePages(query)).rejects.toThrow('Database unavailable')
  })
})
