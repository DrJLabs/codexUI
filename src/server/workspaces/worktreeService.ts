import { execFile } from 'node:child_process'
import { access, readFile, readdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import type { WorkspaceWorktree, WorkspaceWorktreeStatus } from '../../types/worktree'
import type { ManagedWorktreeLock } from '../kanban/worktreeManager'
import { projectHash } from '../kanban/paths'

const execFileAsync = promisify(execFile)
const LOCK_FILENAME = 'codexui-kanban-worktree.json'

export class WorkspaceWorktreeService {
  private readonly dataDir: string
  private readonly projectRoot: string

  constructor(options: { dataDir: string; projectRoot: string }) {
    this.dataDir = resolve(options.dataDir)
    this.projectRoot = resolve(options.projectRoot)
  }

  async listWorktrees(): Promise<WorkspaceWorktree[]> {
    const locks = await this.readLocks()
    const worktrees = await Promise.all(locks.map(async (lock) => await this.describeLock(lock)))
    return worktrees.sort((left, right) => left.createdAtIso.localeCompare(right.createdAtIso) || left.runId.localeCompare(right.runId))
  }

  async cleanupWorktree(input: { runId: string; confirmation: string; activeRunIds?: string[] }): Promise<WorkspaceWorktree> {
    if (input.confirmation !== `remove ${input.runId}`) {
      throw new Error(`Cleanup confirmation must equal: remove ${input.runId}`)
    }
    if (input.activeRunIds?.includes(input.runId)) {
      throw new Error(`Cannot clean up active Kanban run ${input.runId}`)
    }
    const lock = await this.readLockForRun(input.runId)
    const description = await this.describeLock(lock)
    if (description.dirty) throw new Error('Refusing to remove dirty managed worktree')
    if (!description.missing && description.lockStatus === 'active') {
      await runGit(lock.projectRoot, ['worktree', 'remove', lock.worktreePath])
    }
    const removedLock: ManagedWorktreeLock = { ...lock, status: 'removed' }
    await writeFile(lock.lockPath, `${JSON.stringify(removedLock, null, 2)}\n`, 'utf8')
    return await this.describeLock(removedLock)
  }

  private async readLockForRun(runId: string): Promise<ManagedWorktreeLock> {
    const locks = await this.readLocks()
    const lock = locks.find((entry) => entry.runId === runId)
    if (!lock) throw new Error(`Managed worktree not found for run ${runId}`)
    return lock
  }

  private async readLocks(): Promise<ManagedWorktreeLock[]> {
    const root = resolveManagedWorktreeRoot(this.dataDir, await this.resolveGitRoot())
    let entries: string[] = []
    try {
      entries = await readdir(root)
    } catch (error) {
      if (isMissingFileError(error)) return []
      throw error
    }
    const locks: ManagedWorktreeLock[] = []
    for (const entry of entries) {
      const lockPath = join(root, entry, LOCK_FILENAME)
      try {
        locks.push(JSON.parse(await readFile(lockPath, 'utf8')) as ManagedWorktreeLock)
      } catch (error) {
        if (isMissingFileError(error)) continue
        throw error
      }
    }
    return locks
  }

  private async resolveGitRoot(): Promise<string> {
    return resolve((await runGit(this.projectRoot, ['rev-parse', '--show-toplevel'])).trim())
  }

  private async describeLock(lock: ManagedWorktreeLock): Promise<WorkspaceWorktree> {
    const missing = !(await pathExists(lock.worktreePath))
    const dirty = missing ? false : (await runGit(lock.worktreePath, ['status', '--porcelain'])).trim().length > 0
    const stale = lock.status === 'active' && !isProcessAlive(lock.pid)
    const status = resolveStatus(lock.status, { missing, dirty, stale })
    return {
      taskId: lock.taskId,
      runId: lock.runId,
      branchName: lock.branchName,
      baseRef: lock.baseRef,
      worktreePath: lock.worktreePath,
      lockPath: lock.lockPath,
      projectRoot: lock.projectRoot,
      pid: lock.pid,
      createdAtIso: lock.createdAtIso,
      heartbeatAtIso: lock.heartbeatAtIso,
      lockStatus: lock.status,
      status,
      dirty,
      missing,
      stale,
      cleanupConfirmation: `remove ${lock.runId}`,
    }
  }
}

function resolveStatus(lockStatus: ManagedWorktreeLock['status'], checks: { missing: boolean; dirty: boolean; stale: boolean }): WorkspaceWorktreeStatus {
  if (lockStatus === 'removed') return 'removed'
  if (checks.missing) return 'missing'
  if (checks.dirty) return 'dirty'
  if (checks.stale) return 'stale'
  return 'active'
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

function isProcessAlive(pid: number): boolean {
  if (!Number.isFinite(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function isMissingFileError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
}

async function runGit(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd })
  return stdout
}

function resolveManagedWorktreeRoot(dataDir: string, projectRoot: string): string {
  return join(resolve(dataDir), 'worktrees', projectHash(projectRoot))
}
