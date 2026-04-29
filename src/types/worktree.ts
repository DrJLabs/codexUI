export type WorkspaceWorktreeStatus = 'active' | 'removed' | 'missing' | 'dirty' | 'stale'

export type WorkspaceWorktree = {
  taskId: string
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
