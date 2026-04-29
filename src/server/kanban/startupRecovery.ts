import type { KanbanRun, KanbanRunState } from '../../types/kanban'
import type { KanbanStateFileV1 } from './migrations'
import { KanbanStorage } from './storage'

const RECOVERABLE_RUN_STATES: KanbanRunState[] = [
  'queued',
  'preparing_worktree',
  'starting_codex',
  'running',
  'waiting_for_approval',
  'running_tests',
  'collecting_artifacts',
  'stopping',
]

const RECOVERY_MESSAGE = 'Kanban run needs recovery because the server restarted and the in-memory execution queue was lost.'

export type KanbanStartupRecoveryResult = {
  recoveredRunIds: string[]
}

export async function recoverStaleKanbanRuns(storage: KanbanStorage): Promise<KanbanStartupRecoveryResult> {
  const recoveredRunIds: string[] = []
  await storage.mutate((state: KanbanStateFileV1) => {
    const nowIso = new Date().toISOString()
    for (const run of Object.values(state.runs)) {
      if (!isKanbanRun(run) || !RECOVERABLE_RUN_STATES.includes(run.state)) continue
      recoveredRunIds.push(run.id)
      state.runs[run.id] = {
        ...run,
        state: 'needs_recovery',
        errorMessage: RECOVERY_MESSAGE,
        updatedAtIso: nowIso,
      }
      const task = state.tasks[run.taskId]
      if (!task || task.currentRunId !== run.id) continue
      state.tasks[task.id] = {
        ...task,
        runState: 'needs_recovery',
        worktreePath: run.worktreePath || task.worktreePath,
        branchName: run.branchName || task.branchName,
        errorMessage: RECOVERY_MESSAGE,
        updatedAtIso: nowIso,
        version: task.version + 1,
      }
    }
  })
  return { recoveredRunIds }
}

function isKanbanRun(value: unknown): value is KanbanRun {
  return value !== null
    && typeof value === 'object'
    && typeof (value as { id?: unknown }).id === 'string'
    && typeof (value as { taskId?: unknown }).taskId === 'string'
    && typeof (value as { state?: unknown }).state === 'string'
}
