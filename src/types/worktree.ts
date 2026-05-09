export type WorkspaceWorktreeStatus = 'active' | 'removed' | 'missing' | 'dirty' | 'stale'

export type WorkspaceWorktreeOwnerSource = 'kanban' | 'automation' | 'action'

export type WorkspaceWorktreeOwner = {
  source: WorkspaceWorktreeOwnerSource
  id: string
}

export type WorkspaceWorktree = {
  taskId: string
  owner: WorkspaceWorktreeOwner
  runId: string
  branchName: string
  baseRef: string
  worktreePath: string
  lockPath: string
  projectRoot: string
  pid: number
  createdAtIso: string
  heartbeatAtIso: string
  lockStatus: 'active' | 'removed'
  status: WorkspaceWorktreeStatus
  dirty: boolean
  missing: boolean
  stale: boolean
  cleanupConfirmation: string
}
