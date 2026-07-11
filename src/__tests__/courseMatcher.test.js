import { beforeEach, describe, expect, it, vi } from 'vitest'

const inQuery = vi.fn()

vi.mock('../lib/supabase.js', () => ({
  isSupabaseConfigured: true,
  supabase: {
    from: vi.fn(() => ({ select: vi.fn(() => ({ in: inQuery })) })),
  },
}))

const { matchBatch } = await import('../lib/courseMatcher.js')

describe('course matcher identity safety', () => {
  beforeEach(() => inQuery.mockReset())

  it('returns only exact course-code matches', async () => {
    inQuery.mockResolvedValue({ data: [{ course_code: 'DPI-802-M', id: 'historic' }], error: null })

    const [exact, suffixVariant] = await matchBatch([
      { courseCode: 'DPI-802-M' },
      { courseCode: 'DPI-802-M-D' },
    ])

    expect(inQuery).toHaveBeenCalledWith('course_code', ['DPI-802-M', 'DPI-802-M-D'])
    expect(exact.course).toMatchObject({ id: 'historic' })
    expect(suffixVariant.course).toBeNull()
  })

  it('propagates database failures instead of treating them as no match', async () => {
    inQuery.mockResolvedValue({ data: null, error: new Error('database unavailable') })
    await expect(matchBatch([{ courseCode: 'API-101' }])).rejects.toThrow('database unavailable')
  })
})
