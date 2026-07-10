import { describe, expect, it, vi } from 'vitest'
import { HarvardCourseSearchError, searchHarvardCourses } from '../lib/harvardApi'

describe('searchHarvardCourses', () => {
  it('returns successful proxy results unchanged', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ results: [{ courseCode: 'API-101' }] }), { status: 200 }),
      )

    await expect(searchHarvardCourses('API-101', { school: 'HKS' }, fetchImpl)).resolves.toEqual({
      results: [{ courseCode: 'API-101' }],
    })
    expect(fetchImpl).toHaveBeenCalledWith('/api/harvard-courses?q=API-101&school=HKS')
  })

  it('preserves an honest proxy failure for the UI', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: 'Harvard catalogue is temporarily unavailable',
          code: 'HARVARD_API_UNAVAILABLE',
        }),
        { status: 502 },
      ),
    )

    await expect(searchHarvardCourses('policy', {}, fetchImpl)).rejects.toMatchObject({
      name: 'HarvardCourseSearchError',
      status: 502,
      code: 'HARVARD_API_UNAVAILABLE',
    })
  })

  it('exports a distinguishable error type for callers', () => {
    expect(new HarvardCourseSearchError('unavailable', { status: 503 })).toBeInstanceOf(Error)
  })
})
