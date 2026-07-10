#!/usr/bin/env node

/**
 * Verifies the committed checksum for a vendored production dependency before
 * install/audit/build steps consume it. Keeping this check in Node makes it
 * portable between local Windows development and the Linux CI runner.
 */
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'
import process from 'node:process'

const archive = path.resolve('vendor/xlsx-0.20.3.tgz')
const checksumFile = path.resolve('vendor/xlsx-0.20.3.sha512')

async function main() {
  const [archiveBytes, checksumText] = await Promise.all([
    readFile(archive),
    readFile(checksumFile, 'utf8'),
  ])
  const expected = checksumText.trim().split(/\s+/)[0]?.toLowerCase()
  if (!/^[a-f0-9]{128}$/.test(expected || '')) {
    throw new Error(`${checksumFile} must start with one SHA-512 hexadecimal digest`)
  }
  const actual = createHash('sha512').update(archiveBytes).digest('hex')
  if (actual !== expected) {
    throw new Error(`checksum mismatch for ${archive}; expected ${expected}, got ${actual}`)
  }
  console.log(`Verified SHA-512 for ${path.basename(archive)}`)
}

main().catch((error) => {
  console.error(`Vendored dependency integrity check failed: ${error.message}`)
  process.exitCode = 1
})
