import type { CodexRunProfile } from './execution'
import type { KanbanExecutionMode } from './kanban'

export type LocalActionKind = 'build' | 'test' | 'dev'

export type LocalActionCommand = {
  id: string
  kind: LocalActionKind
  label: string
  command: string
  scriptCommand?: string
  cwd: string
  runProfile: CodexRunProfile
  executionMode: KanbanExecutionMode
  createdAtIso: string
}

export type LocalActionPolicy = {
  executionMode: KanbanExecutionMode
  executionEnabled: boolean
  trustedForExecution: boolean
  allowDangerFullAccess: boolean
  allowApprovalNever: boolean
}

export type LocalActionEvidence = {
  id: string
  actionId: string
  command: string
  cwd: string
  exitCode: number | null
  startedAtIso: string
  completedAtIso: string
  output: string
}
