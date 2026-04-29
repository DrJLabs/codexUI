import { execFile } from 'node:child_process'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { projectHash } from './paths'

const execFileAsync = promisify(execFile)
const LOCK_FILENAME = 'codexui-kanban-worktree.json'

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

export type ManagedWorktreeLock = ManagedWorktree & {
  projectRoot: string
  pid: number
  createdAtIso: string
  heartbeatAtIso: string
  status: 'active' | 'removed'
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
    const branchName = createTaskBranchName(input.taskId, input.taskTitle)
    if (branchName === 'main' || branchName === 'master') {
      throw new Error('Kanban worktrees cannot run directly on the default branch')
    }
    const baseRef = await this.resolveBaseRef(gitRoot, input.baseBranch)
    const repoName = basename(gitRoot)
    const worktreeParent = join(resolveManagedWorktreeRoot(this.dataDir, gitRoot), sanitizePathSegment(input.runId))
    const worktreePath = join(worktreeParent, repoName)
    const lockPath = join(worktreeParent, LOCK_FILENAME)

    await mkdir(worktreeParent, { recursive: true })
    await runCommand(gitRoot, ['worktree', 'add', '-b', branchName, worktreePath, baseRef])
    const now = new Date().toISOString()
    await writeFile(lockPath, `${JSON.stringify({
      taskId: input.taskId,
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
    if (locks.some((lock) => lock.status === 'active' && lock.taskId === taskId)) {
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
      const lockPath = join(root, entry, LOCK_FILENAME)
      try {
        locks.push(JSON.parse(await readFile(lockPath, 'utf8')) as ManagedWorktreeLock)
      } catch (error) {
        if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') continue
        throw error
      }
    }
    return locks
  }
}

export function resolveManagedWorktreeRoot(dataDir: string, projectRoot: string): string {
  return join(resolve(dataDir), 'worktrees', projectHash(projectRoot))
}

function createTaskBranchName(taskId: string, taskTitle: string): string {
  const taskSegment = sanitizePathSegment(taskId)
  const titleSegment = sanitizePathSegment(taskTitle) || 'task'
  return `codexui/task/${taskSegment}-${titleSegment}`
}

function sanitizePathSegment(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/gu, '-').replace(/^-+|-+$/gu, '').slice(0, 80)
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
