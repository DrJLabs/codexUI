import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { writeFileAtomic } from '../fileWrites'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function createTempDir() {
  const dir = await mkdtemp(join(tmpdir(), 'codexui-atomic-write-'))
  tempDirs.push(dir)
  return dir
}

describe('writeFileAtomic', () => {
  it('publishes the complete file and removes the sibling temp file', async () => {
    const dir = await createTempDir()
    const target = join(dir, 'automation.toml')

    await writeFileAtomic(target, 'name = "Nightly"\n')

    await expect(readFile(target, 'utf8')).resolves.toBe('name = "Nightly"\n')
    const leftovers = (await readdir(dir)).filter((entry) => entry.includes(`${basename(target)}.`) && entry.endsWith('.tmp'))
    expect(leftovers).toEqual([])
  })
})
