import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import process from 'node:process'

const source = (process.env.VITE_CATALOGUE_DATA_URL || '').trim()
if (source) {
  const url = new URL(source)
  if (
    url.protocol !== 'https:' ||
    !url.hostname.endsWith('.pages.dev') ||
    url.username ||
    url.password ||
    url.port ||
    url.search ||
    url.hash ||
    !['', '/'].includes(url.pathname)
  ) {
    throw new Error('Snapshot mode requires an HTTPS Pages origin')
  }
  const root = 'public/catalogue-fallback'
  const manifest = JSON.parse(readFileSync(`${root}/manifest.json`, 'utf8'))
  if (
    manifest.schema !== 1 ||
    manifest.datasets?.history?.count < 5000 ||
    manifest.datasets?.terms?.count < 285
  ) {
    throw new Error('Snapshot mode requires a complete verified fallback')
  }
  for (const entry of Object.values(manifest.datasets)) {
    if (!/^snapshots\/[a-f0-9]{64}\.json$/.test(entry.path)) throw new Error('Unsafe snapshot path')
    const bytes = readFileSync(`${root}/${entry.path}`)
    if (
      bytes.length !== entry.bytes ||
      createHash('sha256').update(bytes).digest('hex') !== entry.sha256
    ) {
      throw new Error('Fallback snapshot checksum mismatch')
    }
  }
  console.log(`Verified bundled catalogue fallback ${manifest.version}`)
}
