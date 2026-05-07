import { createHash } from 'node:crypto'
import { join, resolve } from 'node:path'
import type { WorkspaceWorktreeOwner, WorkspaceWorktreeOwnerSource } from '../../types/worktree'

export const MANAGED_WORKTREE_LOCK_FILENAME = 'codexui-kanban-worktree.json'

export type ManagedWorktreeOwnerSource = WorkspaceWorktreeOwnerSource

export type ManagedWorktreeOwner = WorkspaceWorktreeOwner

export type ManagedWorktreeLock = {
  taskId: string
  owner: ManagedWorktreeOwner
  runId: string
  branchName: string
  baseRef: string
  worktreePath: string
  lockPath: string
  projectRoot: string
  pid: number
  createdAtIso: string
  heartbeatAtIso: string
  status: 'active' | 'removed'
}

export type LegacyManagedWorktreeLock = Omit<ManagedWorktreeLock, 'owner'> & {
  owner?: ManagedWorktreeOwner | null
}

export function normalizeManagedWorktreeOwner(lock: Pick<LegacyManagedWorktreeLock, 'taskId' | 'owner' | 'branchName'>): ManagedWorktreeOwner {
  if (isManagedWorktreeOwner(lock.owner)) return lock.owner
  if (lock.owner !== undefined && lock.owner !== null) throw new Error('Invalid managed worktree owner')
  if (!lock.branchName.startsWith('codexui/task/')) throw new Error('Missing managed worktree owner')
  return { source: 'kanban', id: lock.taskId }
}

export function normalizeManagedWorktreeLock(lock: LegacyManagedWorktreeLock): ManagedWorktreeLock {
  return {
    ...lock,
    owner: normalizeManagedWorktreeOwner(lock),
  }
}

export function resolveManagedWorktreeRoot(dataDir: string, projectRoot: string): string {
  return join(resolve(dataDir), 'worktrees', projectHash(projectRoot))
}

function isManagedWorktreeOwner(owner: unknown): owner is ManagedWorktreeOwner {
  return Boolean(
    owner
      && typeof owner === 'object'
      && 'source' in owner
      && isManagedWorktreeOwnerSource(owner.source)
      && 'id' in owner
      && typeof owner.id === 'string'
      && owner.id.length > 0,
  )
}

function isManagedWorktreeOwnerSource(source: unknown): source is ManagedWorktreeOwnerSource {
  return source === 'kanban' || source === 'automation' || source === 'action'
}

function projectHash(projectRoot: string): string {
  return createHash('sha256').update(resolve(projectRoot)).digest('hex').slice(0, 16)
}
