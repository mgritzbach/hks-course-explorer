import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  fetchFromHarvard,
  mapWithConcurrency,
  normalise,
  onRequestGet,
} from '../../functions/api/harvard-courses.js'

const url = 'https://example.test/search?q=api'

afterEach(() => vi.unstubAllGlobals())

describe('Harvard catalogue Worker contract', () => {
  it('normalises the list-shaped Harvard response contract', () => {
    const result = normalise([
      {
        courseID: '123',
        catalogSubject: 'API',
        classCatalogNumber: '101',
        courseTitle: 'Policy Analysis',
        publishedInstructors: [{ instructorName: 'Professor Example' }],
      },
    ])

    expect(result).toEqual({
      results: [
        expect.objectContaining({
          harvardId: '123',
          courseCode: 'API-101',
          title: 'Policy Analysis',
          instructors: ['Professor Example'],
        }),
      ],
      total: 1,
    })
  })

  it('retries a transient response and returns the successful attempt', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 503 })
      .mockResolvedValueOnce({ ok: true, status: 200 })
    const sleepImpl = vi.fn().mockResolvedValue(undefined)

    const result = await fetchFromHarvard(url, 'test-key', { fetchImpl, sleepImpl })

    expect(result).toMatchObject({ ok: true, status: 200, attempts: 2 })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(sleepImpl).toHaveBeenCalledTimes(1)
  })

  it('does not retry a non-transient response', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 401 })
    const sleepImpl = vi.fn().mockResolvedValue(undefined)

    const result = await fetchFromHarvard(url, 'test-key', { fetchImpl, sleepImpl })

    expect(result).toMatchObject({ ok: false, status: 401, attempts: 1 })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(sleepImpl).not.toHaveBeenCalled()
  })

  it('returns an explicit failed result after transient network errors', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('network unavailable'))
    const sleepImpl = vi.fn().mockResolvedValue(undefined)

    const result = await fetchFromHarvard(url, 'test-key', { fetchImpl, sleepImpl })

    expect(result).toMatchObject({ ok: false, status: 0, attempts: 3 })
    expect(fetchImpl).toHaveBeenCalledTimes(3)
    expect(sleepImpl).toHaveBeenCalledTimes(2)
  })

  it('stops retries at the remaining request deadline instead of extending it', async () => {
    let now = 0
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 503 })
    const sleepImpl = vi.fn(async (delay) => {
      now += delay
    })

    const result = await fetchFromHarvard(url, 'test-key', {
      fetchImpl,
      sleepImpl,
      deadlineAt: 50,
      now: () => now,
    })

    expect(result).toMatchObject({ ok: false, status: 503, attempts: 1 })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(sleepImpl).toHaveBeenCalledWith(50)
  })

  it('bounds Non-HKS fan-out concurrency while preserving school order', async () => {
    let active = 0
    let peak = 0
    const mapped = await mapWithConcurrency(['A', 'B', 'C', 'D', 'E'], 2, async (school) => {
      active += 1
      peak = Math.max(peak, active)
      await new Promise((resolve) => setTimeout(resolve, 5))
      active -= 1
      return school.toLowerCase()
    })

    expect(peak).toBe(2)
    expect(mapped).toEqual(['a', 'b', 'c', 'd', 'e'])
  })

  it('does not start queued fan-out work after the shared deadline', async () => {
    let now = 0
    const started = []
    const mapped = await mapWithConcurrency(
      ['A', 'B', 'C'],
      1,
      async (school) => {
        started.push(school)
        now = 10
        return school.toLowerCase()
      },
      {
        deadlineAt: 10,
        now: () => now,
        deadlineResult: (school) => `timed-out-${school}`,
      },
    )

    expect(started).toEqual(['A'])
    expect(mapped).toEqual(['a', 'timed-out-B', 'timed-out-C'])
  })

  it('serves a valid fresh cache result as a cache hit without stale metadata', async () => {
    const fresh = { results: [{ harvardId: 'fresh', courseCode: 'HKS-101' }], total: 1 }
    const cache = {
      match: vi.fn(async (key) =>
        key.url.includes('__hks_cache_variant') ? undefined : new Response(JSON.stringify(fresh)),
      ),
      put: vi.fn(),
      delete: vi.fn(),
    }
    const fetchImpl = vi.fn()
    vi.stubGlobal('caches', { default: cache })
    vi.stubGlobal('fetch', fetchImpl)

    const response = await onRequestGet({
      request: new Request('https://worker.test/api/harvard-courses?q=policy&school=HKS'),
      env: { HARVARD_API_KEY: 'test-key' },
    })

    expect(response.headers.get('CF-Cache-Status')).toBe('HIT')
    expect(response.headers.get('X-Harvard-Stale-Result')).toBeNull()
    await expect(response.json()).resolves.toEqual(fresh)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('continues with the upstream response when cache reads fail', async () => {
    const cache = {
      match: vi.fn().mockRejectedValue(new Error('cache unavailable')),
      put: vi.fn(),
      delete: vi.fn(),
    }
    const upstream = [
      {
        courseID: 'network-good',
        catalogSubject: 'HKS',
        classCatalogNumber: '101',
        courseTitle: 'Network course',
      },
    ]
    vi.stubGlobal('caches', { default: cache })
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify(upstream), { status: 200 })),
    )

    const response = await onRequestGet({
      request: new Request('https://worker.test/api/harvard-courses?q=policy&school=HKS'),
      env: { HARVARD_API_KEY: 'test-key' },
    })

    expect(response.status).toBe(200)
    expect(response.headers.get('CF-Cache-Status')).toBe('MISS')
    await expect(response.json()).resolves.toMatchObject({
      results: [expect.objectContaining({ harvardId: 'network-good' })],
    })
  })

  it('only returns an explicitly labelled stale result after a fresh single-school failure', async () => {
    const stale = { results: [{ harvardId: 'last-good', courseCode: 'HKS-999' }], total: 1 }
    const cache = {
      match: vi.fn(async (key) =>
        key.url.includes('__hks_cache_variant') ? new Response(JSON.stringify(stale)) : undefined,
      ),
      put: vi.fn(),
      delete: vi.fn(),
    }
    vi.stubGlobal('caches', { default: cache })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401 }))

    const response = await onRequestGet({
      request: new Request('https://worker.test/api/harvard-courses?q=policy&school=HKS'),
      env: { HARVARD_API_KEY: 'test-key' },
    })

    expect(response.status).toBe(200)
    expect(response.headers.get('CF-Cache-Status')).toBe('STALE')
    expect(response.headers.get('X-Harvard-Stale-Result')).toBe('true')
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    await expect(response.json()).resolves.toEqual({ ...stale, stale: true })
  })

  it('labels mixed stale and failed Non-HKS results as partial rather than fresh', async () => {
    const staleRaw = [
      {
        courseID: 'last-good',
        catalogSubject: 'FAS',
        classCatalogNumber: '101',
        courseTitle: 'Cached course',
      },
    ]
    const cache = {
      match: vi.fn(async (key) =>
        key.url.includes('__hks_cache_variant') && key.url.includes('catalogSchool=FAS')
          ? new Response(JSON.stringify(staleRaw))
          : undefined,
      ),
      put: vi.fn(),
      delete: vi.fn(),
    }
    vi.stubGlobal('caches', { default: cache })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401 }))

    const response = await onRequestGet({
      request: new Request('https://worker.test/api/harvard-courses?q=policy&school=Non-HKS'),
      env: { HARVARD_API_KEY: 'test-key' },
    })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(response.headers.get('CF-Cache-Status')).toBe('STALE')
    expect(response.headers.get('X-Harvard-Partial-Result')).toBe('true')
    expect(response.headers.get('X-Harvard-Stale-Result')).toBe('true')
    expect(body).toMatchObject({
      partial: true,
      stale: true,
      results: [expect.objectContaining({ harvardId: 'last-good' })],
    })
  })
})
