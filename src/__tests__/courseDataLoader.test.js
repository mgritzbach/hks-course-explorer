import { describe, expect, it, vi } from 'vitest'
import { fetchAllCourses, MAX_COURSE_ROWS } from '../lib/courseDataLoader.js'

function createClient(rows, { count = rows.length, errorAt = null } = {}) {
  const ranges = []
  return {
    ranges,
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        range: vi.fn((from, to) => {
          ranges.push([from, to])
          if (from === errorAt)
            return Promise.resolve({ data: null, count, error: new Error('failed') })
          return Promise.resolve({ data: rows.slice(from, to + 1), count, error: null })
        }),
      })),
    })),
  }
}

describe('course data loader', () => {
  it('fetches only the counted catalogue pages while retaining parallel-safe ranges', async () => {
    const rows = Array.from({ length: 1_800 }, (_, id) => ({ id }))
    const client = createClient(rows)
    const onProgress = vi.fn()

    await expect(fetchAllCourses(client, onProgress)).resolves.toEqual(rows)
    expect(client.ranges).toEqual([
      [0, 999],
      [1000, 1999],
    ])
    expect(onProgress).toHaveBeenCalledWith(1_800)
  })

  it('falls back to bounded sequential paging when the server omits a count', async () => {
    const rows = Array.from({ length: 1_200 }, (_, id) => ({ id }))
    const client = createClient(rows, { count: null })

    await expect(fetchAllCourses(client)).resolves.toEqual(rows)
    expect(client.ranges).toEqual([
      [0, 999],
      [1000, 1999],
    ])
  })

  it('fails closed for a count above the catalogue safety ceiling', async () => {
    const client = createClient([], { count: MAX_COURSE_ROWS + 1 })

    await expect(fetchAllCourses(client)).rejects.toThrow('Catalogue exceeds the safe')
    expect(client.ranges).toEqual([[0, 999]])
  })

  it('propagates a page failure instead of showing a partial catalogue', async () => {
    const rows = Array.from({ length: 1_200 }, (_, id) => ({ id }))
    const client = createClient(rows, { errorAt: 1000 })

    await expect(fetchAllCourses(client)).rejects.toThrow('failed')
  })
})
