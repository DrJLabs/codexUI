import { open, rename, rm } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { basename, dirname, join } from 'node:path'

export async function writeFileAtomic(path: string, contents: string): Promise<void> {
  const dir = dirname(path)
  const tempPath = join(dir, `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`)
  let published = false
  const handle = await open(tempPath, 'w', 0o600)
  try {
    await handle.writeFile(contents, 'utf8')
    await handle.sync()
  } finally {
    await handle.close()
  }
  try {
    await rename(tempPath, path)
    published = true
    await syncDirectoryBestEffort(dir)
  } finally {
    if (!published) await rm(tempPath, { force: true }).catch(() => {})
  }
}

async function syncDirectoryBestEffort(dir: string): Promise<void> {
  try {
    const handle = await open(dir, 'r')
    try {
      await handle.sync()
    } finally {
      await handle.close()
    }
  } catch {
    // Directory fsync is not supported on every platform/filesystem.
  }
}
