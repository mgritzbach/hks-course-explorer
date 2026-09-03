import { readSnapshot, writeSnapshot } from './snapshotStorage.js'

export const CATALOGUE_DATA_URL = (import.meta.env.VITE_CATALOGUE_DATA_URL || '').replace(
  /\/+$/,
  '',
)
export const usesCatalogueSnapshots = Boolean(CATALOGUE_DATA_URL)
const MANIFEST_TTL = 5 * 60 * 1000
const STALE_AFTER = 48 * 60 * 60 * 1000
const DATASET_NAME =
  /^(history|credits|terms|live\/\d{4} (Spring|Summer|Fall|January)|sections\/\d{4}(Spring|Summer|Fall|January))$/

export function validateManifest(manifest) {
  if (
    manifest?.schema !== 1 ||
    !Number.isFinite(Date.parse(manifest.exportedAt)) ||
    !/^[a-f0-9]{64}$/.test(manifest.version || '') ||
    !manifest.datasets ||
    !['history', 'credits', 'terms'].every((key) => manifest.datasets[key])
  )
    throw new Error('Invalid catalogue manifest')
  for (const [name, entry] of Object.entries(manifest.datasets)) {
    if (
      !DATASET_NAME.test(name) ||
      !/^[a-f0-9]{64}$/.test(entry?.sha256 || '') ||
      entry.path !== `snapshots/${entry.sha256}.json` ||
      !Number.isInteger(entry.count) ||
      entry.count < 0 ||
      entry.count > 20000 ||
      !Number.isInteger(entry.bytes) ||
      entry.bytes < 2 ||
      entry.bytes > 24 * 1024 * 1024
    )
      throw new Error('Invalid catalogue dataset')
  }
  return manifest
}

export async function verifySnapshot(bytes, entry) {
  if (bytes.byteLength !== entry.bytes) throw new Error('Incomplete catalogue file')
  const hash = await crypto.subtle.digest('SHA-256', bytes)
  const hex = Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join(
    '',
  )
  if (hex !== entry.sha256) throw new Error('Catalogue checksum mismatch')
  const rows = JSON.parse(new TextDecoder().decode(bytes))
  if (
    !Array.isArray(rows) ||
    rows.length !== entry.count ||
    rows.some((row) => !row || typeof row.id !== 'string') ||
    new Set(rows.map((row) => row.id)).size !== rows.length
  )
    throw new Error('Invalid catalogue rows')
  return rows
}

export function createSnapshotLoader({
  baseUrl,
  fallbackUrl = '/catalogue-fallback',
  fetchImpl = (...args) => fetch(...args),
  read = readSnapshot,
  write = writeSnapshot,
  now = Date.now,
  onStatus = () => {},
}) {
  const manifests = new Map()
  const memory = new Map()
  const pending = new Map()

  async function request(url, json = false) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), json ? 3500 : 8000)
    try {
      const response = await fetchImpl(url, {
        signal: controller.signal,
        credentials: 'omit',
        ...(json ? { cache: 'no-cache' } : {}),
      })
      if (
        !response.ok ||
        !(response.headers.get('content-type') || '').includes('application/json')
      ) {
        const error = new Error('Catalogue file unavailable')
        error.retryManifest = !json && response.status === 404
        throw error
      }
      return json ? await response.json() : await response.arrayBuffer()
    } finally {
      clearTimeout(timer)
    }
  }

  function manifestAt(base, refresh = false) {
    const old = manifests.get(base)
    if (!refresh && old && now() - old.ts < MANIFEST_TTL) return old.promise
    const promise = request(`${base}/manifest.json`, true).then(validateManifest)
    // Cache failures briefly too: a broken source cannot cause a request storm.
    manifests.set(base, { ts: now(), promise })
    return promise
  }

  function report(dataset, record, fallback) {
    onStatus({
      dataset,
      exportedAt: record.exportedAt,
      fallback,
      stale: now() - Date.parse(record.exportedAt) > STALE_AFTER,
    })
  }

  async function fromSource(base, dataset, refresh = false) {
    const manifest = await manifestAt(base, refresh)
    const entry = manifest.datasets[dataset]
    if (!entry) {
      if (!dataset.startsWith('live/') && !dataset.startsWith('sections/')) {
        throw new Error('Required catalogue dataset missing')
      }
      return { rows: [], exportedAt: manifest.exportedAt }
    }
    const previous = memory.get(dataset)
    if (previous?.sha256 === entry.sha256) {
      return { ...previous, exportedAt: manifest.exportedAt }
    }
    const bytes = await request(`${base}/${entry.path}`)
    return {
      rows: await verifySnapshot(bytes, entry),
      sha256: entry.sha256,
      exportedAt: manifest.exportedAt,
    }
  }

  async function load(dataset) {
    let record
    try {
      try {
        record = await fromSource(baseUrl, dataset)
      } catch (error) {
        if (!error.retryManifest) throw error
        // A publication may replace the manifest between two reads. Retry once
        // using its new manifest; this never falls through to Supabase.
        record = await fromSource(baseUrl, dataset, true)
      }
      memory.set(dataset, record)
      void write(`${baseUrl}|${dataset}`, record)
      report(dataset, record, false)
      return structuredClone(record.rows)
    } catch {
      record = memory.get(dataset) || (await read(`${baseUrl}|${dataset}`))
      if (
        !record ||
        !Array.isArray(record.rows) ||
        !Number.isFinite(Date.parse(record.exportedAt))
      ) {
        record = await fromSource(fallbackUrl, dataset)
      }
      memory.set(dataset, record)
      report(dataset, record, true)
      return structuredClone(record.rows)
    }
  }

  return (dataset) => {
    if (!DATASET_NAME.test(dataset))
      return Promise.reject(new Error('Invalid catalogue dataset name'))
    if (!pending.has(dataset)) {
      const task = load(dataset).finally(() => pending.delete(dataset))
      pending.set(dataset, task)
    }
    // Callers sometimes enrich historical rows. Never mutate a shared cache.
    return pending.get(dataset).then((rows) => structuredClone(rows))
  }
}

const status = new Map()
export function snapshotStatus() {
  return [...status.values()]
}
export const loadSnapshotRows = createSnapshotLoader({
  baseUrl: CATALOGUE_DATA_URL,
  onStatus: (value) => {
    status.set(value.dataset, value)
    if (typeof window !== 'undefined') window.dispatchEvent(new Event('catalogue-snapshot-status'))
  },
})
