export const FULL_ACCESS_CODEX_RUN_PROFILE_ID = 'full-access-operator'

export type CodexRunProfileReasoningEffort = 'low' | 'medium' | 'high' | 'xhigh' | ''

export type CodexRunProfileSandboxMode = 'read-only' | 'workspace-write' | 'danger-full-access'

export type CodexRunProfileApprovalPolicy = 'untrusted' | 'on-request' | 'never'

export type ExecutionSource = 'kanban' | 'automation' | 'action'

export type ExecutionOwnerType = 'kanban-task' | 'automation' | 'action'

export type ExecutionOwner = {
  source: ExecutionSource
  type: ExecutionOwnerType
  id: string
}

export type CodexRunProfile = {
  id: string
  name: string
  description: string
  model: string
  reasoningEffort: CodexRunProfileReasoningEffort
  sandboxMode: CodexRunProfileSandboxMode
  approvalPolicy: CodexRunProfileApprovalPolicy
  networkAccess: boolean
  writableRoots: string[]
  createdAtIso: string
  updatedAtIso: string
}

export type CodexTurnStartRunSettings = {
  model?: string
  effort?: CodexRunProfileReasoningEffort
  approvalPolicy: CodexRunProfileApprovalPolicy
  sandboxPolicy:
    | { type: 'readOnly'; access: { type: 'fullAccess' }; networkAccess: boolean }
    | {
      type: 'workspaceWrite'
      writableRoots: string[]
      readOnlyAccess: { type: 'fullAccess' }
      networkAccess: boolean
      excludeTmpdirEnvVar: boolean
      excludeSlashTmp: boolean
    }
    | { type: 'dangerFullAccess' }
}
