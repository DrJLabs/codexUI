import type { KanbanExecutionPolicy } from '../../types/kanban'

export type KanbanConfig = {
  dataDir: string
  policy: KanbanExecutionPolicy
}

export function resolveKanbanConfig(env: NodeJS.ProcessEnv = process.env): KanbanConfig {
  const executionEnabled = env.CODEXUI_KANBAN_EXECUTION_ENABLED === '1'
  return {
    dataDir: env.CODEXUI_KANBAN_DATA_DIR?.trim() ?? '',
    policy: {
      enabled: true,
      executionMode: executionEnabled ? 'trusted_remote' : 'disabled',
      executionEnabled,
      requireTrustedAccessForExecution: true,
      allowTailscaleAccess: true,
      requireLoopbackForExecution: false,
      disableExecutionWhenRemote: false,
      sandboxMode: 'workspace-write',
      approvalPolicy: 'on-request',
      networkAccess: false,
      allowDangerFullAccess: false,
      allowApprovalNever: false,
      allowAcceptForSession: false,
      useThreadShellCommand: false,
      maxGlobalActiveRuns: 1,
      maxActiveRunsPerRepo: 1,
      maxActiveRunsPerTask: 1,
    },
  }
}
