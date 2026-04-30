import type { CodexRunProfile } from './execution'

export type AutomationKind = 'heartbeat'

export type AutomationSource = 'native' | 'codexui'

export type AutomationStatus = 'active' | 'paused'

export type AutomationLegacyStatus = 'ACTIVE' | 'PAUSED'

export type AutomationRunMode = 'chat' | 'local' | 'worktree'

export type AutomationRunState =
  | 'queued'
  | 'starting'
  | 'running'
  | 'completed_no_findings'
  | 'failed'

export type AutomationSchedule = {
  type: 'rrule'
  rrule: string
}

export type AutomationTarget = {
  targetThreadId: string | null
  projectRoot: string | null
}

export type AutomationExecution = {
  cwd: string | null
  runMode: AutomationRunMode | null
  runProfileId: string | null
  model: string | null
  reasoningEffort: string | null
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
  trigger: 'manual'
  runMode: AutomationRunMode
  state: AutomationRunState
  promptSnapshot: string
  scheduleSnapshot: AutomationSchedule
  runProfileId: string
  runProfileSnapshot: CodexRunProfile
  targetThreadId: string | null
  cwd: string | null
  worktreePath: string | null
  threadId: string | null
  turnId: string | null
  resultSummary: string | null
  errorMessage: string | null
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
  kanbanProjection: { mode: 'off' }
  notes: string
  storage: AutomationStorageInfo
  createdAtIso: string
  updatedAtIso: string
  lastRunAtIso: string | null
  nextRunAtIso: null
  recentRuns?: AutomationRun[]
  version: number
}

export type AutomationsState = {
  storageRoot: string
  featureFlags: {
    scheduler: false
    manualRun: boolean
    kanbanProjection: false
    artifactIndexing: false
  }
  sourceCounts: {
    native: number
    codexui: number
  }
  diagnostics: AutomationDiagnostic[]
  definitions: AutomationDefinition[]
}

export type AutomationTemplate = {
  id: string
  kind: AutomationKind
  name: string
  description: string
  schedule: AutomationSchedule
}
