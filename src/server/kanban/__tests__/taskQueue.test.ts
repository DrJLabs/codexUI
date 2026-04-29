import { describe, expect, it } from 'vitest'
import { classifyRecoveredRunState, classifyStartupRecovery } from '../recoveryService'
import { KanbanTaskQueue } from '../taskQueue'

describe('KanbanTaskQueue', () => {
  it('keeps one global active run and promotes the next eligible item on completion', () => {
    const queue = new KanbanTaskQueue()

    const first = queue.enqueue({ runId: 'run_1', taskId: 'task_1', repoRoot: '/repo/a' })
    const second = queue.enqueue({ runId: 'run_2', taskId: 'task_2', repoRoot: '/repo/b' })
    const promoted = queue.complete('run_1')

    expect(first.state).toBe('active')
    expect(second).toMatchObject({ state: 'queued', reason: 'global_limit' })
    expect(promoted).toEqual([{ runId: 'run_2', taskId: 'task_2', repoRoot: '/repo/b' }])
    expect(queue.getActiveRunIds()).toEqual(['run_2'])
  })

  it('enforces repo and task concurrency limits independently', () => {
    const repoQueue = new KanbanTaskQueue({ maxGlobalActiveRuns: 2, maxActiveRunsPerRepo: 1, maxActiveRunsPerTask: 1 })
    const taskQueue = new KanbanTaskQueue({ maxGlobalActiveRuns: 2, maxActiveRunsPerRepo: 2, maxActiveRunsPerTask: 1 })

    expect(repoQueue.enqueue({ runId: 'run_1', taskId: 'task_1', repoRoot: '/repo/a' }).state).toBe('active')
    expect(repoQueue.enqueue({ runId: 'run_2', taskId: 'task_2', repoRoot: '/repo/a' })).toMatchObject({
      state: 'queued',
      reason: 'repo_limit',
    })
    expect(taskQueue.enqueue({ runId: 'run_1', taskId: 'task_1', repoRoot: '/repo/a' }).state).toBe('active')
    expect(taskQueue.enqueue({ runId: 'run_2', taskId: 'task_1', repoRoot: '/repo/b' })).toMatchObject({
      state: 'queued',
      reason: 'task_limit',
    })
  })
})

describe('classifyRecoveredRunState', () => {
  it('maps startup active states to conservative recovery states', () => {
    expect(classifyRecoveredRunState('queued', { canRestoreQueue: true })).toBe('queued')
    expect(classifyRecoveredRunState('preparing_worktree', { managedWorktreeExists: false })).toBe('failed')
    expect(classifyRecoveredRunState('starting_codex')).toBe('needs_recovery')
    expect(classifyRecoveredRunState('running')).toBe('stalled')
    expect(classifyRecoveredRunState('waiting_for_approval')).toBe('needs_recovery')
    expect(classifyRecoveredRunState('running_tests')).toBe('needs_recovery')
    expect(classifyRecoveredRunState('collecting_artifacts')).toBe('needs_recovery')
    expect(classifyRecoveredRunState('stopping')).toBe('cancelled')
    expect(classifyRecoveredRunState('succeeded')).toBe('succeeded')
  })

  it('classifies startup recovery without deleting dirty worktrees', () => {
    expect(classifyStartupRecovery('running', { liveCodexTurnProven: true })).toBe('still_running')
    expect(classifyStartupRecovery('running', { processAlive: false })).toBe('orphaned_process')
    expect(classifyStartupRecovery('collecting_artifacts', { worktreeDirty: true })).toBe('crashed_with_changes')
    expect(classifyStartupRecovery('waiting_for_approval')).toBe('awaiting_approval')
    expect(classifyStartupRecovery('succeeded')).toBe('terminal')
  })
})
