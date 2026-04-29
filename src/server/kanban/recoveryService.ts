import type { KanbanRunState } from '../../types/kanban'

export type KanbanRunRecoveryOptions = {
  canRestoreQueue?: boolean
  managedWorktreeExists?: boolean
  liveCodexTurnProven?: boolean
}

export type KanbanStartupRecoveryClassification =
  | 'terminal'
  | 'still_running'
  | 'crashed_cleanly'
  | 'crashed_with_changes'
  | 'orphaned_process'
  | 'awaiting_approval'
  | 'stuck'
  | 'restore_queue'

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

export function classifyStartupRecovery(
  state: KanbanRunState,
  options: {
    processAlive?: boolean
    worktreeDirty?: boolean
    liveCodexTurnProven?: boolean
  } = {},
): KanbanStartupRecoveryClassification {
  if (state === 'succeeded' || state === 'failed' || state === 'stalled' || state === 'cancelled' || state === 'idle') {
    return 'terminal'
  }
  if (state === 'queued') return 'restore_queue'
  if (state === 'waiting_for_approval') return 'awaiting_approval'
  if (state === 'running' && options.processAlive === false) return 'orphaned_process'
  if (options.worktreeDirty) return 'crashed_with_changes'
  if (state === 'running' && options.liveCodexTurnProven) return 'still_running'
  if (state === 'preparing_worktree' || state === 'starting_codex' || state === 'running_tests' || state === 'collecting_artifacts') {
    return 'crashed_cleanly'
  }
  return 'stuck'
}
