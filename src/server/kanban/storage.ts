import { randomUUID } from 'node:crypto'
import { copyFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { createEmptyStateFile, migrateKanbanStateFile, type KanbanStateFileV1 } from './migrations'
import { projectHash, resolveProjectStatePath } from './paths'

export class KanbanStorage {
  private readonly dataDir: string
  private readonly projectRoot: string
  private readonly statePath: string
  private mutationQueue: Promise<void> = Promise.resolve()

  constructor(options: { dataDir: string; projectRoot: string }) {
    this.dataDir = options.dataDir
    this.projectRoot = options.projectRoot
    this.statePath = resolveProjectStatePath(options.dataDir, options.projectRoot)
  }

  async load(): Promise<KanbanStateFileV1> {
    await mkdir(dirname(this.statePath), { recursive: true })
    let raw: string
    try {
      raw = await readFile(this.statePath, 'utf8')
    } catch (error) {
      if (isMissingFileError(error)) {
        const state = createEmptyStateFile(this.projectRoot, new Date().toISOString())
        await this.writeState(state)
        return state
      }
      throw error
    }
    try {
      return migrateKanbanStateFile(JSON.parse(raw), this.projectRoot)
    } catch (error) {
      const backupPath = await this.backupCorruptState()
      const detail = error instanceof Error ? `: ${error.message}` : ''
      throw new Error(`Kanban state file is corrupt; backup written to ${backupPath}${detail}`)
    }
  }

  async mutate(mutator: (state: KanbanStateFileV1) => void): Promise<KanbanStateFileV1> {
    let nextState: KanbanStateFileV1 | null = null
    const operation = this.mutationQueue.then(async () => {
      const state = await this.load()
      mutator(state)
      state.updatedAtIso = new Date().toISOString()
      await this.writeState(state)
      nextState = state
    })
    this.mutationQueue = operation.then(() => undefined, () => undefined)
    await operation
    if (!nextState) throw new Error('Kanban state mutation did not complete')
    return nextState
  }

  private async writeState(state: KanbanStateFileV1): Promise<void> {
    await mkdir(dirname(this.statePath), { recursive: true })
    const tmpPath = join(dirname(this.statePath), `.state-${randomUUID()}.tmp`)
    await writeFile(tmpPath, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
    await rename(tmpPath, this.statePath)
  }

  private async backupCorruptState(): Promise<string> {
    const backupDir = join(this.dataDir, 'backups')
    await mkdir(backupDir, { recursive: true })
    const safeTimestamp = new Date().toISOString().replace(/[:.]/gu, '-')
    const backupPath = join(backupDir, `${safeTimestamp}-${projectHash(this.projectRoot)}.json`)
    await copyFile(this.statePath, backupPath)
    return backupPath
  }
}

function isMissingFileError(error: unknown): boolean {
  return error !== null
    && typeof error === 'object'
    && 'code' in error
    && (error as { code?: string }).code === 'ENOENT'
}
