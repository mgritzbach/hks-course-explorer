import { beforeEach, describe, expect, it, vi } from 'vitest'
import { COURSES_CACHE_KEY } from '../lib/appConstants.js'
import { fetchAllCourses } from '../lib/courseDataLoader.js'
import { fetchAllCoursesWithCache } from '../lib/courseDataCache.js'

vi.mock('../lib/courseDataLoader.js', () => ({ fetchAllCourses: vi.fn() }))
vi.mock('../lib/supabase.js', () => ({ isSupabaseConfigured: true, supabase: { source: 'test' } }))

describe('historical catalogue cache', () => {
  beforeEach(() => {
    sessionStorage.clear()
    vi.mocked(fetchAllCourses).mockReset()
  })

  it('returns a complete fresh cache entry without loading the database client path', async () => {
    const courses = Array.from({ length: 1001 }, (_, id) => ({ id }))
    sessionStorage.setItem(COURSES_CACHE_KEY, JSON.stringify({ ts: Date.now(), data: courses }))
    const onProgress = vi.fn()
    const onCacheStatus = vi.fn()

    await expect(fetchAllCoursesWithCache(onProgress, onCacheStatus)).resolves.toEqual(courses)
    expect(onCacheStatus).toHaveBeenCalledWith('hit')
    expect(onProgress).toHaveBeenCalledWith(1001)
    expect(fetchAllCourses).not.toHaveBeenCalled()
  })

  it('falls back to a complete database read and stores the result after a cache miss', async () => {
    const courses = [{ id: 'one' }, { id: 'two' }]
    vi.mocked(fetchAllCourses).mockResolvedValue(courses)
    const onCacheStatus = vi.fn()

    await expect(fetchAllCoursesWithCache(undefined, onCacheStatus)).resolves.toEqual(courses)
    expect(onCacheStatus).toHaveBeenCalledWith('miss')
    expect(fetchAllCourses).toHaveBeenCalledWith({ source: 'test' }, undefined)
    expect(JSON.parse(sessionStorage.getItem(COURSES_CACHE_KEY)).data).toEqual(courses)
  })

  it('treats malformed storage as a miss instead of failing catalogue load', async () => {
    sessionStorage.setItem(COURSES_CACHE_KEY, '{not-json')
    vi.mocked(fetchAllCourses).mockResolvedValue([{ id: 'safe' }])

    await expect(fetchAllCoursesWithCache()).resolves.toEqual([{ id: 'safe' }])
  })
})
