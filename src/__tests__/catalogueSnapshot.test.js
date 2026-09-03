// @vitest-environment node
import { createHash } from 'node:crypto'
import { Buffer } from 'node:buffer'
import { describe, expect, it, vi } from 'vitest'
import { createSnapshotLoader, validateManifest, verifySnapshot } from '../lib/catalogueSnapshot.js'

function fixture(rows = [{ id: 'one', metrics_raw: { Course_Rating: 4.5 } }]) {
  const bytes = Buffer.from(JSON.stringify(rows))
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  const entry = {
    path: `snapshots/${sha256}.json`,
    sha256,
    count: rows.length,
    bytes: bytes.length,
  }
  return {
    rows,
    bytes,
    entry,
    manifest: {
      schema: 1,
      version: 'a'.repeat(64),
      exportedAt: new Date().toISOString(),
      datasets: { history: entry, credits: entry, terms: entry },
    },
  }
}
function backend(data, options = {}) {
  const fetchImpl = vi.fn(async (url) => {
    if (options.offline?.(url)) throw new TypeError('Failed to fetch')
    return new Response(
      url.endsWith('manifest.json') ? JSON.stringify(data.manifest) : data.bytes,
      { headers: { 'Content-Type': 'application/json' } },
    )
  })
  return {
    fetchImpl,
    read: vi.fn(async () => null),
    write: vi.fn(async () => {}),
    onStatus: vi.fn(),
  }
}

describe('public snapshot transport', () => {
  it('coalesces requests, reuses unchanged data, and isolates caller mutations', async () => {
    const data = fixture(),
      io = backend(data)
    const load = createSnapshotLoader({ baseUrl: 'https://data.test', ...io })
    const [a, b] = await Promise.all([load('history'), load('history')])
    a[0].metrics_raw.Course_Rating = 0
    expect(b).toEqual(data.rows)
    expect(await load('history')).toEqual(data.rows)
    expect(io.fetchImpl).toHaveBeenCalledTimes(2)
    expect(io.onStatus).toHaveBeenLastCalledWith(expect.objectContaining({ fallback: false }))
  })

  it('checks the bytes and identities before accepting or persisting a response', async () => {
    const data = fixture()
    await expect(verifySnapshot(data.bytes, data.entry)).resolves.toEqual(data.rows)
    await expect(verifySnapshot(Buffer.from('[]'), data.entry)).rejects.toThrow('Incomplete')
    await expect(
      verifySnapshot(data.bytes, { ...data.entry, sha256: 'b'.repeat(64) }),
    ).rejects.toThrow('checksum')
    const duplicate = fixture([{ id: 'one' }, { id: 'one' }])
    await expect(verifySnapshot(duplicate.bytes, duplicate.entry)).rejects.toThrow('rows')
  })

  it('uses last verified data on outage without issuing a Supabase request', async () => {
    const data = fixture()
    let offline = false
    const io = backend(data, { offline: () => offline })
    let time = Date.now()
    const load = createSnapshotLoader({ baseUrl: 'https://data.test', now: () => time, ...io })
    await load('history')
    offline = true
    time += 3600000
    expect(await load('history')).toEqual(data.rows)
    expect(io.onStatus).toHaveBeenLastCalledWith(expect.objectContaining({ fallback: true }))
    expect(io.fetchImpl.mock.calls.every(([url]) => url.startsWith('https://data.test/'))).toBe(
      true,
    )
  })

  it('supports a first-time visitor during a data-host outage using the bundled copy', async () => {
    const data = fixture(),
      io = backend(data, { offline: (url) => url.startsWith('https:') })
    const load = createSnapshotLoader({ baseUrl: 'https://data.test', ...io })
    expect(await load('history')).toEqual(data.rows)
    expect(io.fetchImpl.mock.calls.some(([url]) => url.startsWith('/catalogue-fallback/'))).toBe(
      true,
    )
    expect(io.onStatus).toHaveBeenLastCalledWith(expect.objectContaining({ fallback: true }))
  })

  it('recovers across a publication between manifest and file requests', async () => {
    const old = fixture(),
      next = fixture([{ id: 'two' }])
    let manifests = 0
    const io = backend(next)
    io.fetchImpl = vi.fn(async (url) => {
      if (url.endsWith('manifest.json'))
        return Response.json(manifests++ === 0 ? old.manifest : next.manifest)
      if (url.endsWith(old.entry.path)) return new Response('not found', { status: 404 })
      return new Response(next.bytes, { headers: { 'Content-Type': 'application/json' } })
    })
    const load = createSnapshotLoader({ baseUrl: 'https://data.test', ...io })
    expect(await load('history')).toEqual(next.rows)
    expect(io.fetchImpl).toHaveBeenCalledTimes(4)
  })

  it('does not hide corrupt network data by persisting it', async () => {
    const data = fixture(),
      io = backend(data)
    io.fetchImpl = vi.fn(async (url) =>
      url.endsWith('manifest.json')
        ? Response.json(data.manifest)
        : Response.json([{ id: 'corrupt' }]),
    )
    const load = createSnapshotLoader({ baseUrl: 'https://data.test', ...io })
    await expect(load('history')).rejects.toThrow('Incomplete')
    expect(io.write).not.toHaveBeenCalled()
  })

  it('returns an empty absent term only from a valid complete manifest', async () => {
    const io = backend(fixture())
    const load = createSnapshotLoader({ baseUrl: 'https://data.test', ...io })
    expect(await load('live/2099 Fall')).toEqual([])
    expect(io.fetchImpl).toHaveBeenCalledTimes(1)
    await expect(load('../secret')).rejects.toThrow('Invalid')
  })

  it('rejects manifest redirects, missing required datasets, and unsafe lengths', () => {
    const data = fixture()
    expect(() => validateManifest({ ...data.manifest, datasets: {} })).toThrow('manifest')
    data.manifest.datasets.history = { ...data.entry, path: 'https://other.test/private' }
    expect(() => validateManifest(data.manifest)).toThrow('dataset')
    data.manifest.datasets.history = { ...data.entry, bytes: 30 * 1024 * 1024 }
    expect(() => validateManifest(data.manifest)).toThrow('dataset')
  })

  it('discloses stale snapshots', async () => {
    const data = fixture()
    data.manifest.exportedAt = '2020-01-01T00:00:00Z'
    const io = backend(data)
    await createSnapshotLoader({ baseUrl: 'https://data.test', ...io })('history')
    expect(io.onStatus).toHaveBeenLastCalledWith(expect.objectContaining({ stale: true }))
  })
})
