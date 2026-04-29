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

export type KanbanPriority = 'critical' | 'high' | 'normal' | 'low'

export type KanbanActor = 'operator' | 'codex:auto' | `codex:thread:${string}`

export type KanbanThinkingLevel = 'off' | 'low' | 'medium' | 'high'

export type KanbanDueDateIso = '' | `${number}${number}${number}${number}-${number}${number}-${number}${number}`

export type KanbanTaskFeedback = {
  id: string
  atIso: string
  by: KanbanActor
  note: string
}

export type KanbanBoardColumn = {
  key: KanbanStatus
  title: string
  visible: boolean
  wipLimit: number | null
}

export type KanbanBoardConfig = {
  columns: KanbanBoardColumn[]
  defaults: {
    status: KanbanStatus
    priority: KanbanPriority
  }
  reviewRequired: boolean
  allowDoneDragBypass: boolean
  quickViewLimit: number
  proposalPolicy: 'confirm' | 'auto'
  defaultModel: string
  defaultThinking: KanbanThinkingLevel
}

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
  priority: KanbanPriority
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
  createdBy: KanbanActor
  sourceSessionKey: string
  assignee: KanbanActor
  columnOrder: number
  currentRunId: string
  runIds: string[]
  reviewPacketId: string
  proposalIds: string[]
  result: string
  resultAtIso: string
  model: string
  thinking: KanbanThinkingLevel
  dueAtIso: KanbanDueDateIso
  estimateMinutes: number | null
  actualMinutes: number | null
  feedback: KanbanTaskFeedback[]
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
  requireTrustedAccessForExecution: boolean
  allowTailscaleAccess: boolean
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
  config: KanbanBoardConfig
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

export type KanbanReviewPacket = {
  id: string
  taskId: string
  runId: string
  packetHash: string
  generatedAtIso: string
  baseCommit: string
  headCommit: string
  rawDiffPatch: string
  summary: {
    fileCount: number
    addedLineCount: number
    removedLineCount: number
  }
  testResults: Array<{ id: string; command: string; exitCode: number | null }>
  unresolvedProposalIds: string[]
}

export type CreateKanbanTaskInput = {
  title: string
  description?: string
  labels?: KanbanTaskLabel[]
  acceptanceCriteria?: Array<{ text: string; checked?: boolean }>
} & Partial<Pick<KanbanTask,
  | 'priority'
  | 'assignee'
  | 'model'
  | 'thinking'
  | 'dueAtIso'
  | 'estimateMinutes'
  | 'actualMinutes'
  | 'blockedReason'
>>

export type KanbanMetadataPatch = Partial<Pick<KanbanTask,
  | 'priority'
  | 'assignee'
  | 'model'
  | 'thinking'
  | 'dueAtIso'
  | 'estimateMinutes'
  | 'actualMinutes'
>>

export type UpdateKanbanTaskInput =
  Partial<Pick<KanbanTask, 'title' | 'description' | 'labels' | 'blockedReason'>>
  & KanbanMetadataPatch

export type KanbanProposalStatus = 'pending' | 'approved' | 'rejected'

export type KanbanCreateProposalPayload = CreateKanbanTaskInput

export type KanbanUpdateProposalPayload = {
  taskId: string
  patch: UpdateKanbanTaskInput
}

export type KanbanProposalPayload = KanbanCreateProposalPayload | KanbanUpdateProposalPayload

export type KanbanProposal =
  | {
    id: string
    type: 'create'
    payload: KanbanCreateProposalPayload
    sourceRunId: string
    sourceThreadId: string
    proposedBy: KanbanActor
    status: KanbanProposalStatus
    version: number
    createdAtIso: string
    updatedAtIso: string
    resolvedAtIso: string
    resolvedBy: KanbanActor | ''
    reason: string
    resultTaskId: string
  }
  | {
    id: string
    type: 'update'
    payload: KanbanUpdateProposalPayload
    sourceRunId: string
    sourceThreadId: string
    proposedBy: KanbanActor
    status: KanbanProposalStatus
    version: number
    createdAtIso: string
    updatedAtIso: string
    resolvedAtIso: string
    resolvedBy: KanbanActor | ''
    reason: string
    resultTaskId: string
  }

export type CreateKanbanProposalInput = Pick<KanbanProposal,
  'type' | 'payload' | 'sourceRunId' | 'sourceThreadId' | 'proposedBy'
>

export type ResolveKanbanProposalInput = {
  resolvedBy?: KanbanActor
  reason?: string
}

export type KanbanProposalListQuery = {
  status?: KanbanProposalStatus
}

export type KanbanVersionedInput = {
  version: number
}

export type VersionedUpdateKanbanTaskInput = UpdateKanbanTaskInput & KanbanVersionedInput

export type SetKanbanTaskStatusInput = {
  status: KanbanStatus
  reason?: string
}

export type VersionedSetKanbanTaskStatusInput = SetKanbanTaskStatusInput & KanbanVersionedInput

export type DeleteKanbanTaskInput = KanbanVersionedInput

export type ReorderKanbanTaskInput = KanbanVersionedInput & {
  status: KanbanStatus
  beforeTaskId?: string
  afterTaskId?: string
}

export type KanbanTaskListQuery = {
  q?: string
  priority?: KanbanPriority[]
  assignee?: KanbanActor
  label?: string
  limit: number
  offset: number
}

export type ListKanbanTasksParams = Partial<KanbanTaskListQuery>

export type KanbanTaskListResult = {
  items: KanbanTask[]
  total: number
  limit: number
  offset: number
  hasMore: boolean
}

export type UpdateKanbanBoardConfigInput = Partial<Omit<KanbanBoardConfig, 'columns' | 'defaults'>> & {
  columns?: KanbanBoardColumn[]
  defaults?: Partial<KanbanBoardConfig['defaults']>
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
