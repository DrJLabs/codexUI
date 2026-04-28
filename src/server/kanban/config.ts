import type { KanbanExecutionPolicy } from '../../types/kanban'

export type KanbanConfig = {
  dataDir: string
  policy: KanbanExecutionPolicy
}

export function resolveKanbanConfig(env: NodeJS.ProcessEnv = process.env): KanbanConfig {
  return {
    dataDir: env.CODEXUI_KANBAN_DATA_DIR?.trim() ?? '',
    policy: {
      enabled: true,
      executionEnabled: env.CODEXUI_KANBAN_EXECUTION_ENABLED === '1',
      requireLoopbackForExecution: true,
      disableExecutionWhenRemote: true,
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
