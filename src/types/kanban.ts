export const KANBAN_STATUSES = [
  { id: 'backlog', title: 'Backlog' },
  { id: 'ready', title: 'Ready' },
  { id: 'running', title: 'Running' },
  { id: 'review', title: 'Review' },
  { id: 'rework', title: 'Rework' },
  { id: 'done', title: 'Done' },
  { id: 'cancelled', title: 'Cancelled' },
] as const

export type KanbanStatus = typeof KANBAN_STATUSES[number]['id']

export type KanbanRunState =
  | 'idle'
  | 'queued'
  | 'preparing_worktree'
  | 'starting_codex'
  | 'running'
  | 'waiting_for_approval'
  | 'running_tests'
  | 'collecting_artifacts'
  | 'stopping'
  | 'succeeded'
  | 'failed'
  | 'stalled'
  | 'cancelled'
  | 'needs_recovery'

export type KanbanTaskLabel = {
  id: string
  name: string
  color: string
}

export type KanbanAcceptanceCriterion = {
  id: string
  text: string
  checked: boolean
  createdAtIso: string
  updatedAtIso: string
}

export type KanbanTask = {
  id: string
  boardId: string
  title: string
  description: string
  status: KanbanStatus
  runState: KanbanRunState
  labels: KanbanTaskLabel[]
  acceptanceCriteria: KanbanAcceptanceCriterion[]
  projectRoot: string
  cwd: string
  baseBranch: string
  branchName: string
  worktreeId: string
  worktreePath: string
  codexThreadId: string
  currentRunId: string
  runIds: string[]
  reviewPacketId: string
  proposalIds: string[]
  blockedReason: string
  errorMessage: string
  archived: boolean
  createdAtIso: string
  updatedAtIso: string
  version: number
}

export type KanbanRun = {
  id: string
  taskId: string
  state: KanbanRunState
  projectRoot: string
  worktreePath: string
  branchName: string
  threadId: string
  turnId: string
  logPath: string
  eventsPath: string
  errorMessage: string
  createdAtIso: string
  updatedAtIso: string
}

export type KanbanBoard = {
  id: string
  title: string
  projectRoot: string
  createdAtIso: string
  updatedAtIso: string
}

export type KanbanExecutionPolicy = {
  enabled: boolean
  executionEnabled: boolean
  requireLoopbackForExecution: boolean
  disableExecutionWhenRemote: boolean
  sandboxMode: 'workspace-write'
  approvalPolicy: 'on-request'
  networkAccess: false
  allowDangerFullAccess: false
  allowApprovalNever: false
  allowAcceptForSession: false
  useThreadShellCommand: false
  maxGlobalActiveRuns: 1
  maxActiveRunsPerRepo: 1
  maxActiveRunsPerTask: 1
}

export type KanbanStateSnapshot = {
  schemaVersion: 1
  board: KanbanBoard
  tasks: KanbanTask[]
  policy: KanbanExecutionPolicy
  generatedAtIso: string
}

export type StartKanbanRunResponse = {
  run: KanbanRun
  task: KanbanTask
}

export type InterruptKanbanRunResponse = {
  run: KanbanRun
  task: KanbanTask | null
}

export type CreateKanbanTaskInput = {
  title: string
  description?: string
  labels?: KanbanTaskLabel[]
  acceptanceCriteria?: Array<{ text: string; checked?: boolean }>
}

export type UpdateKanbanTaskInput = Partial<Pick<KanbanTask, 'title' | 'description' | 'labels' | 'blockedReason'>>

export type SetKanbanTaskStatusInput = {
  status: KanbanStatus
  reason?: string
}

export type ReplaceKanbanAcceptanceCriteriaInput = {
  criteria: Array<{ id?: string; text: string; checked?: boolean }>
}

export type KanbanApiResponse<T> = {
  data: T
}

export type KanbanApiError = {
  error: string
}
