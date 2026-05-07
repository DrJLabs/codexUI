import type { CodexRunProfile } from './execution'

export type AutomationKind = 'heartbeat' | 'cron'

export type AutomationSource = 'native' | 'codexui'

export type AutomationStatus = 'active' | 'paused'

export type AutomationLegacyStatus = 'ACTIVE' | 'PAUSED'

export type AutomationRunMode = 'chat' | 'local' | 'worktree'

export type AutomationRunState =
  | 'queued'
  | 'starting'
  | 'running'
  | 'completed_with_findings'
  | 'completed_no_findings'
  | 'failed'

export type AutomationSchedule = {
  type: 'rrule'
  rrule: string
}

export type AutomationKanbanProjection =
  | { mode: 'off' }
  | { mode: 'definition_card'; taskId?: string }
  | { mode: 'run_card'; createFor: 'every_run' | 'findings_only' | 'failures_only' }
  | { mode: 'attach_existing_task'; taskId: string }

export type AutomationTarget = {
  targetThreadId: string | null
  projectRoot: string | null
}

export type AutomationExecution = {
  cwd: string | null
  cwds: string[]
  runMode: AutomationRunMode | null
  runProfileId: string | null
  model: string | null
  reasoningEffort: string | null
  localEnvironmentConfigPath: string | null
}

export type AutomationStorageInfo = {
  nativeDirName: string | null
  nativePath: string | null
  sidecarPath: string | null
}

export type AutomationDiagnostic = {
  automationId: string
  sourceDirName: string
  path: string
  severity: 'warning' | 'error'
  message: string
}

export type AutomationRun = {
  id: string
  automationId: string
  automationName: string
  trigger: 'manual' | 'schedule'
  runMode: AutomationRunMode
  state: AutomationRunState
  promptSnapshot: string
  scheduleSnapshot: AutomationSchedule
  dueAtIso: string | null
  nextDueAtIso: string | null
  runProfileId: string
  runProfileSnapshot: CodexRunProfile
  targetThreadId: string | null
  cwd: string | null
  worktreePath: string | null
  branchName: string | null
  threadId: string | null
  turnId: string | null
  resultSummary: string | null
  errorMessage: string | null
  findings: boolean | null
  inboxTitle: string
  inboxSummary: string
  readAtIso: string | null
  archivedAtIso: string | null
  kanbanTaskId: string | null
  reviewPacketId: string | null
  proposalIds: string[]
  runJsonPath: string
  eventsPath: string
  logPath: string
  createdAtIso: string
  startedAtIso: string | null
  completedAtIso: string | null
  updatedAtIso: string
}

export type AutomationDefinition = AutomationTarget & AutomationExecution & {
  id: string
  kind: AutomationKind
  source: AutomationSource
  nativeId: string | null
  name: string
  description: string | null
  prompt: string
  status: AutomationStatus
  legacyStatus: AutomationLegacyStatus
  schedule: AutomationSchedule
  autoArchiveNoFindings: boolean
  notifyOnFindings: boolean
  kanbanProjection: AutomationKanbanProjection
  notes: string
  storage: AutomationStorageInfo
  createdAtIso: string
  updatedAtIso: string
  lastRunAtIso: string | null
  nextRunAtIso: string | null
  recentRuns?: AutomationRun[]
  version: number
}

export type AutomationsState = {
  storageRoot: string
  featureFlags: {
    scheduler: boolean
    manualRun: boolean
    kanbanProjection: boolean
    artifactIndexing: boolean
  }
  sourceCounts: {
    native: number
    codexui: number
  }
  diagnostics: AutomationDiagnostic[]
  definitions: AutomationDefinition[]
  executionOptions: {
    defaultRunProfileId: string
    currentConfigProfileId: string | null
    runProfiles: CodexRunProfile[]
  }
}

export type AutomationTemplate = {
  id: string
  kind: AutomationKind
  name: string
  description: string
  schedule: AutomationSchedule
}
