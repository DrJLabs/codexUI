import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import type { WorkspaceWorktree } from '../../types/worktree'
import {
  MANAGED_WORKTREE_LOCK_FILENAME,
  normalizeManagedWorktreeLock,
  resolveManagedWorktreeRoot,
  type LegacyManagedWorktreeLock,
  type ManagedWorktreeLock,
} from '../workspaces/worktreeLocks'
import { WorkspaceWorktreeService } from '../workspaces/worktreeService'

const execFileAsync = promisify(execFile)

export { resolveManagedWorktreeRoot } from '../workspaces/worktreeLocks'
export type { ManagedWorktreeLock } from '../workspaces/worktreeLocks'

export type CreateManagedWorktreeInput = {
  taskId: string
  taskTitle: string
  runId: string
  baseBranch?: string
}

export type ManagedWorktree = {
  taskId: string
  runId: string
  branchName: string
  baseRef: string
  worktreePath: string
  lockPath: string
}

export class KanbanWorktreeManager {
  private readonly dataDir: string
  private readonly projectRoot: string

  constructor(options: { dataDir: string; projectRoot: string }) {
    this.dataDir = resolve(options.dataDir)
    this.projectRoot = resolve(options.projectRoot)
  }

  async createManagedWorktree(input: CreateManagedWorktreeInput): Promise<ManagedWorktree> {
    const gitRoot = await this.resolveGitRoot()
    await this.assertNoActiveWorktreeForTask(input.taskId)
    const branchName = createTaskBranchName(input.taskId, input.taskTitle, input.runId)
    if (branchName === 'main' || branchName === 'master') {
      throw new Error('Kanban worktrees cannot run directly on the default branch')
    }
    const baseRef = await this.resolveBaseRef(gitRoot, input.baseBranch)
    const repoName = basename(gitRoot)
    const worktreeParent = join(resolveManagedWorktreeRoot(this.dataDir, gitRoot), sanitizePathSegment(input.runId))
    const worktreePath = join(worktreeParent, repoName)
    const lockPath = join(worktreeParent, MANAGED_WORKTREE_LOCK_FILENAME)

    await mkdir(worktreeParent, { recursive: true })
    let worktreeCreated = false
    await runCommand(gitRoot, ['worktree', 'add', '-b', branchName, worktreePath, baseRef])
    worktreeCreated = true
    const now = new Date().toISOString()
    try {
      await writeFile(lockPath, `${JSON.stringify({
        taskId: input.taskId,
        owner: { source: 'kanban', id: input.taskId },
        runId: input.runId,
        branchName,
        baseRef,
        worktreePath,
        lockPath,
        projectRoot: gitRoot,
        pid: process.pid,
        createdAtIso: now,
        heartbeatAtIso: now,
        status: 'active',
      } satisfies ManagedWorktreeLock, null, 2)}\n`, 'utf8')
    } catch (error) {
      if (worktreeCreated) {
        await cleanupWorktreeAndBranch(gitRoot, worktreePath, branchName)
      }
      throw error
    }

    return { taskId: input.taskId, runId: input.runId, branchName, baseRef, worktreePath, lockPath }
  }

  async removeManagedWorktree(input: { runId: string }): Promise<void> {
    const lock = await this.readLockForRun(input.runId)
    const status = await runCommand(lock.worktreePath, ['status', '--porcelain'])
    if (status.trim().length > 0) {
      throw new Error('Refusing to remove dirty Kanban worktree')
    }
    await runCommand(lock.projectRoot, ['worktree', 'remove', lock.worktreePath])
    await writeFile(lock.lockPath, `${JSON.stringify({ ...lock, status: 'removed' } satisfies ManagedWorktreeLock, null, 2)}\n`, 'utf8')
  }

  async cleanupManagedWorktree(input: { runId: string; confirmation: string; activeRunIds?: string[] }): Promise<void> {
    if (input.confirmation !== `remove ${input.runId}`) {
      throw new Error(`Cleanup confirmation must equal: remove ${input.runId}`)
    }
    if (input.activeRunIds?.includes(input.runId)) {
      throw new Error(`Cannot clean up active Kanban run ${input.runId}`)
    }
    await this.removeManagedWorktree({ runId: input.runId })
  }

  async listManagedWorktrees(): Promise<WorkspaceWorktree[]> {
    return await new WorkspaceWorktreeService({ dataDir: this.dataDir, projectRoot: this.projectRoot }).listWorktrees()
  }

  private async resolveGitRoot(): Promise<string> {
    return resolve((await runCommand(this.projectRoot, ['rev-parse', '--show-toplevel'])).trim())
  }

  private async resolveBaseRef(gitRoot: string, configuredBaseBranch?: string): Promise<string> {
    const candidates = [
      configuredBaseBranch?.trim(),
      await readGitRef(gitRoot, ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD']),
      'main',
      'master',
    ].filter((candidate): candidate is string => Boolean(candidate))

    for (const candidate of candidates) {
      if (candidate === 'main' || candidate === 'master') {
        if (await gitRefExists(gitRoot, `refs/heads/${candidate}`)) return candidate
        continue
      }
      if (await gitRevExists(gitRoot, candidate)) return candidate
    }
    throw new Error('Unable to resolve a Kanban worktree base branch')
  }

  private async assertNoActiveWorktreeForTask(taskId: string): Promise<void> {
    const locks = await this.readLocks()
    if (locks.some((lock) => lock.status === 'active' && lock.owner.source === 'kanban' && lock.owner.id === taskId)) {
      throw new Error(`Active Kanban worktree already exists for task ${taskId}`)
    }
  }

  private async readLockForRun(runId: string): Promise<ManagedWorktreeLock> {
    const locks = await this.readLocks()
    const lock = locks.find((entry) => entry.runId === runId)
    if (!lock) throw new Error(`Managed Kanban worktree not found for run ${runId}`)
    return lock
  }

  private async readLocks(): Promise<ManagedWorktreeLock[]> {
    const root = resolveManagedWorktreeRoot(this.dataDir, await this.resolveGitRoot())
    let entries: string[] = []
    try {
      entries = await readdir(root)
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return []
      throw error
    }
    const locks: ManagedWorktreeLock[] = []
    for (const entry of entries) {
      const lockPath = join(root, entry, MANAGED_WORKTREE_LOCK_FILENAME)
      try {
        locks.push(normalizeManagedWorktreeLock(JSON.parse(await readFile(lockPath, 'utf8')) as LegacyManagedWorktreeLock))
      } catch (error) {
        if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') continue
        if (error instanceof SyntaxError || isInvalidManagedWorktreeOwnerError(error)) continue
        throw error
      }
    }
    return locks
  }
}

function isInvalidManagedWorktreeOwnerError(error: unknown): boolean {
  return error instanceof Error && (
    error.message === 'Invalid managed worktree owner' ||
    error.message === 'Missing managed worktree owner'
  )
}

function createTaskBranchName(taskId: string, taskTitle: string, runId?: string): string {
  const taskSegment = sanitizePathSegment(taskId)
  const runSegment = runId ? sanitizePathSegment(runId) : ''
  const titleSegment = sanitizePathSegment(taskTitle) || 'task'
  return `codexui/task/${[taskSegment, runSegment, titleSegment].filter(Boolean).join('-')}`
}

function sanitizePathSegment(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9]+/gu, '-').replace(/^-+|-+$/gu, '')
  if (normalized.length <= 80) return normalized
  const hash = createHash('sha256').update(normalized).digest('hex').slice(0, 8)
  return `${normalized.slice(0, 71)}-${hash}`
}

async function gitRefExists(cwd: string, ref: string): Promise<boolean> {
  try {
    await runCommand(cwd, ['show-ref', '--verify', '--quiet', ref])
    return true
  } catch {
    return false
  }
}

async function gitRevExists(cwd: string, rev: string): Promise<boolean> {
  try {
    await runCommand(cwd, ['rev-parse', '--verify', `${rev}^{commit}`])
    return true
  } catch {
    return false
  }
}

async function readGitRef(cwd: string, args: string[]): Promise<string | null> {
  try {
    const value = (await runCommand(cwd, args)).trim()
    return value || null
  } catch {
    return null
  }
}

async function runCommand(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd })
  return stdout
}

async function cleanupWorktreeAndBranch(gitRoot: string, worktreePath: string, branchName: string): Promise<void> {
  await runCommand(gitRoot, ['worktree', 'remove', '--force', worktreePath]).catch(() => {})
  await rm(worktreePath, { recursive: true, force: true }).catch(() => {})
  await runCommand(gitRoot, ['branch', '-D', branchName]).catch(() => {})
}
