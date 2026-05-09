import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { promisify } from 'node:util'
import {
  MANAGED_WORKTREE_LOCK_FILENAME,
  normalizeManagedWorktreeLock,
  resolveManagedWorktreeRoot,
  type LegacyManagedWorktreeLock,
  type ManagedWorktreeLock,
  type ManagedWorktreeOwner,
} from './worktreeLocks'
import {
  applyManagedWorktreeLocalEnvironment,
  type ManagedWorktreeLocalEnvironmentSetupResult,
} from './localEnvironment'

const execFileAsync = promisify(execFile)

export type CreateManagedWorktreeInput = {
  owner: ManagedWorktreeOwner
  taskId: string
  runId: string
  name: string
  baseBranch?: string
  localEnvironmentConfigPath?: string | null
}

export type ManagedWorktree = {
  taskId: string
  owner: ManagedWorktreeOwner
  runId: string
  branchName: string
  baseRef: string
  worktreePath: string
  worktreeWorkspaceRoot: string
  lockPath: string
  localEnvironmentConfigPath: string | null
  localEnvironmentSetup: ManagedWorktreeLocalEnvironmentSetupResult | null
}

export type ManagedWorktreeServiceOptions = {
  dataDir: string
  projectRoot: string
  isOwnerRunActive?: (lock: ManagedWorktreeLock) => Promise<boolean> | boolean
}

export class ManagedWorktreeService {
  private readonly dataDir: string
  private readonly projectRoot: string
  private readonly isOwnerRunActive?: (lock: ManagedWorktreeLock) => Promise<boolean> | boolean

  constructor(options: ManagedWorktreeServiceOptions) {
    this.dataDir = resolve(options.dataDir)
    this.projectRoot = resolve(options.projectRoot)
    this.isOwnerRunActive = options.isOwnerRunActive
  }

  async createManagedWorktree(input: CreateManagedWorktreeInput): Promise<ManagedWorktree> {
    const gitRoot = await this.resolveGitRoot()
    const worktreeRoot = resolveManagedWorktreeRoot(this.dataDir, gitRoot)
    await mkdir(worktreeRoot, { recursive: true })
    const ownerLockPath = join(worktreeRoot, `${ownerLockSegment(input.owner)}.lock`)
    await acquireOwnerWorktreeLock(ownerLockPath, input.owner)
    try {
      return await this.createManagedWorktreeWithOwnerLock(input, gitRoot, worktreeRoot)
    } finally {
      await rm(ownerLockPath, { recursive: true, force: true }).catch(() => {})
    }
  }

  private async createManagedWorktreeWithOwnerLock(
    input: CreateManagedWorktreeInput,
    gitRoot: string,
    worktreeRoot: string,
  ): Promise<ManagedWorktree> {
    await this.assertNoActiveWorktreeForOwner(input.owner)
    const branchName = createAutomationBranchName(input.owner.id, input.runId, input.name)
    if (branchName === 'main' || branchName === 'master') {
      throw new Error('Managed worktrees cannot run directly on the default branch')
    }
    const baseRef = await this.resolveBaseRef(gitRoot, input.baseBranch)
    const repoName = basename(gitRoot)
    const worktreeParent = join(worktreeRoot, sanitizePathSegment(input.runId))
    const worktreePath = join(worktreeParent, repoName)
    const worktreeWorkspaceRoot = resolveWorktreeWorkspaceRoot(gitRoot, this.projectRoot, worktreePath)
    const lockPath = join(worktreeParent, MANAGED_WORKTREE_LOCK_FILENAME)

    await mkdir(worktreeParent, { recursive: true })
    let worktreeCreated = false
    await runGit(gitRoot, ['worktree', 'add', '-b', branchName, worktreePath, baseRef])
    worktreeCreated = true
    const now = new Date().toISOString()
    let localEnvironment: Awaited<ReturnType<typeof applyManagedWorktreeLocalEnvironment>> | null = null
    try {
      await mkdir(worktreeWorkspaceRoot, { recursive: true })
      localEnvironment = await applyManagedWorktreeLocalEnvironment({
        sourceWorkspaceRoot: this.projectRoot,
        sourceGitRoot: gitRoot,
        worktreeGitRoot: worktreePath,
        worktreeWorkspaceRoot,
        localEnvironmentConfigPath: input.localEnvironmentConfigPath,
      })
      await writeFile(lockPath, `${JSON.stringify({
        taskId: input.taskId,
        owner: input.owner,
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

    return {
      taskId: input.taskId,
      owner: input.owner,
      runId: input.runId,
      branchName,
      baseRef,
      worktreePath,
      worktreeWorkspaceRoot,
      lockPath,
      localEnvironmentConfigPath: localEnvironment?.localEnvironmentConfigPath ?? null,
      localEnvironmentSetup: localEnvironment?.setupResult ?? null,
    }
  }

  private async resolveGitRoot(): Promise<string> {
    try {
      return resolve((await runGit(this.projectRoot, ['rev-parse', '--show-toplevel'])).trim())
    } catch (error) {
      if (isNotGitRepositoryError(error)) {
        throw new ManagedWorktreeUnavailableError('Managed worktree source is not a Git repository')
      }
      throw error
    }
  }

  private async resolveBaseRef(gitRoot: string, configuredBaseBranch?: string): Promise<string> {
    const candidates = [
      configuredBaseBranch?.trim(),
      await readGitRef(gitRoot, ['branch', '--show-current']),
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
    throw new Error('Unable to resolve a managed worktree base branch')
  }

  private async assertNoActiveWorktreeForOwner(owner: ManagedWorktreeOwner): Promise<void> {
    const locks = await this.readLocks()
    for (const lock of locks) {
      if (lock.status !== 'active') continue
      if (lock.owner.source !== owner.source || lock.owner.id !== owner.id) continue
      const ownerRunActive = this.isOwnerRunActive ? await this.isOwnerRunActive(lock) : true
      if (ownerRunActive) {
        throw new Error(`Active managed worktree already exists for ${owner.source} ${owner.id}`)
      }
    }
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
      const lockPath = join(root, entry, MANAGED_WORKTREE_LOCK_FILENAME)
      try {
        locks.push(normalizeManagedWorktreeLock(JSON.parse(await readFile(lockPath, 'utf8')) as LegacyManagedWorktreeLock))
      } catch (error) {
        if (isMissingFileError(error)) continue
        if (error instanceof SyntaxError) {
          console.warn(`Skipping malformed managed worktree lock at ${lockPath}:`, error)
          continue
        }
        if (isInvalidManagedWorktreeOwnerError(error)) continue
        throw error
      }
    }
    return locks
  }
}

export class ManagedWorktreeUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ManagedWorktreeUnavailableError'
  }
}

function isInvalidManagedWorktreeOwnerError(error: unknown): boolean {
  return error instanceof Error && (
    error.message === 'Invalid managed worktree owner' ||
    error.message === 'Missing managed worktree owner'
  )
}

function createAutomationBranchName(automationId: string, runId: string, name: string): string {
  return `codexui/automation/${[
    sanitizePathSegment(automationId),
    sanitizePathSegment(runId, { preserveUnderscore: true }),
    sanitizePathSegment(name) || 'automation',
  ].filter(Boolean).join('-')}`
}

function sanitizePathSegment(value: string, options: { preserveUnderscore?: boolean } = {}): string {
  const allowedPattern = options.preserveUnderscore ? /[^a-z0-9_]+/gu : /[^a-z0-9]+/gu
  const normalized = value.trim().toLowerCase().replace(allowedPattern, '-').replace(/^-+|-+$/gu, '')
  if (normalized.length <= 80) return normalized
  const hash = createHash('sha256').update(normalized).digest('hex').slice(0, 8)
  return `${normalized.slice(0, 71)}-${hash}`
}

function ownerLockSegment(owner: ManagedWorktreeOwner): string {
  return `owner-${owner.source}-${createHash('sha256').update(`${owner.source}:${owner.id}`).digest('hex').slice(0, 16)}`
}

function resolveWorktreeWorkspaceRoot(gitRoot: string, projectRoot: string, worktreePath: string): string {
  const relativeWorkspace = relative(gitRoot, projectRoot)
  if (!relativeWorkspace || relativeWorkspace === '.') return worktreePath
  if (relativeWorkspace === '..' || relativeWorkspace.startsWith(`..${sep}`) || isAbsolute(relativeWorkspace)) {
    return worktreePath
  }
  return join(worktreePath, relativeWorkspace)
}

async function acquireOwnerWorktreeLock(lockPath: string, owner: ManagedWorktreeOwner): Promise<void> {
  try {
    await mkdir(lockPath)
  } catch (error) {
    if (isFileExistsError(error)) {
      throw new Error(`Managed worktree creation is already in progress for ${owner.source} ${owner.id}`)
    }
    throw error
  }
}

async function gitRefExists(cwd: string, ref: string): Promise<boolean> {
  try {
    await runGit(cwd, ['show-ref', '--verify', '--quiet', ref])
    return true
  } catch {
    return false
  }
}

async function gitRevExists(cwd: string, rev: string): Promise<boolean> {
  try {
    await runGit(cwd, ['rev-parse', '--verify', `${rev}^{commit}`])
    return true
  } catch {
    return false
  }
}

async function readGitRef(cwd: string, args: string[]): Promise<string | null> {
  try {
    const value = (await runGit(cwd, args)).trim()
    return value || null
  } catch {
    return null
  }
}

async function runGit(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd })
  return stdout
}

async function cleanupWorktreeAndBranch(gitRoot: string, worktreePath: string, branchName: string): Promise<void> {
  await runGit(gitRoot, ['worktree', 'remove', '--force', worktreePath]).catch(() => {})
  await rm(worktreePath, { recursive: true, force: true }).catch(() => {})
  await runGit(gitRoot, ['branch', '-D', branchName]).catch(() => {})
}

function isMissingFileError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
}

function isFileExistsError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST')
}

function isNotGitRepositoryError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const stderr = (error as Error & { stderr?: unknown }).stderr
  const text = typeof stderr === 'string' ? stderr : error.message
  return text.toLowerCase().includes('not a git repository')
}
