import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { MODULE_LINE_LIMITS, checkArchitecture } from '../check_architecture.mjs'

const fixtures = []

afterEach(async () => {
  await Promise.all(
    fixtures.splice(0).map((fixture) => rm(fixture, { recursive: true, force: true })),
  )
})

async function createFixture(extraLines = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'hks-architecture-'))
  fixtures.push(root)
  await Promise.all(
    Object.entries(MODULE_LINE_LIMITS).map(async ([file, limit]) => {
      const target = path.join(root, file)
      await mkdir(path.dirname(target), { recursive: true })
      await writeFile(
        target,
        `${Array.from({ length: limit + (extraLines[file] || 0) }, () => 'code').join('\n')}\n`,
      )
    }),
  )
  return root
}

describe('check_architecture', () => {
  it('accepts modules at their approved size limits', async () => {
    const results = await checkArchitecture(await createFixture())
    expect(results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ file: 'src/App.jsx', lines: MODULE_LINE_LIMITS['src/App.jsx'] }),
      ]),
    )
  })

  it('reports a module that grows beyond its approved limit', async () => {
    const results = await checkArchitecture(await createFixture({ 'src/pages/Courses.jsx': 1 }))
    expect(results.find(({ file }) => file === 'src/pages/Courses.jsx')).toMatchObject({
      lines: MODULE_LINE_LIMITS['src/pages/Courses.jsx'] + 1,
      limit: MODULE_LINE_LIMITS['src/pages/Courses.jsx'],
    })
  })
})
