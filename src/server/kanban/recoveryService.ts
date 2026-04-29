import type { KanbanRunState } from '../../types/kanban'

export type KanbanRunRecoveryOptions = {
  canRestoreQueue?: boolean
  managedWorktreeExists?: boolean
  liveCodexTurnProven?: boolean
}

export function classifyRecoveredRunState(
  state: KanbanRunState,
  options: KanbanRunRecoveryOptions = {},
): KanbanRunState {
  switch (state) {
    case 'queued':
      return options.canRestoreQueue ? 'queued' : 'needs_recovery'
    case 'preparing_worktree':
      return options.managedWorktreeExists === false ? 'failed' : 'needs_recovery'
    case 'starting_codex':
    case 'waiting_for_approval':
    case 'running_tests':
    case 'collecting_artifacts':
      return 'needs_recovery'
    case 'running':
      return options.liveCodexTurnProven ? 'running' : 'stalled'
    case 'stopping':
      return 'cancelled'
    case 'idle':
    case 'succeeded':
    case 'failed':
    case 'stalled':
    case 'cancelled':
    case 'needs_recovery':
      return state
  }
}
