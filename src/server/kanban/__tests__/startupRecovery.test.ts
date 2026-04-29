import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { KanbanExecutionPolicy, KanbanRun } from '../../../types/kanban'
import { recoverStaleKanbanRuns } from '../startupRecovery'
import { BUILTIN_KANBAN_RUN_PROFILES } from '../runProfiles'
import { KanbanStorage } from '../storage'
import { KanbanTaskService } from '../taskService'

const policy: KanbanExecutionPolicy = {
  enabled: true,
  executionMode: 'trusted_remote',
  executionEnabled: true,
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
}

async function createHarness() {
  const dataDir = await mkdtemp(join(tmpdir(), 'codexui-kanban-recovery-'))
  const projectRoot = join(dataDir, 'project')
  const storage = new KanbanStorage({ dataDir, projectRoot })
  const taskService = new KanbanTaskService({ storage, projectRoot, policy })
  return { storage, taskService, projectRoot, dataDir }
}

describe('recoverStaleKanbanRuns', () => {
  it('marks persisted queued and running runs as needing recovery without side effects', async () => {
    const { storage, taskService, projectRoot, dataDir } = await createHarness()
    const queuedTask = await taskService.createTask({ title: 'Queued before restart' })
    const runningTask = await taskService.createTask({ title: 'Running before restart' })
    const nowIso = new Date().toISOString()
    const queuedRun: KanbanRun = {
      id: 'run_queued',
      taskId: queuedTask.id,
      state: 'queued',
      projectRoot,
      worktreePath: '',
      branchName: '',
      threadId: '',
      turnId: '',
      logPath: join(dataDir, 'queued.log'),
      eventsPath: join(dataDir, 'queued.jsonl'),
      runProfileSnapshot: BUILTIN_KANBAN_RUN_PROFILES[1]!,
      errorMessage: '',
      createdAtIso: nowIso,
      updatedAtIso: nowIso,
    }
    const runningRun: KanbanRun = {
      ...queuedRun,
      id: 'run_running',
      taskId: runningTask.id,
      state: 'running',
      worktreePath: join(dataDir, 'worktree'),
      branchName: 'codexui/task/running',
      threadId: 'thread_running',
      turnId: 'turn_running',
    }
    await storage.mutate((state) => {
      state.runs[queuedRun.id] = queuedRun
      state.runs[runningRun.id] = runningRun
      state.tasks[queuedTask.id] = {
        ...state.tasks[queuedTask.id]!,
        currentRunId: queuedRun.id,
        runState: 'queued',
        status: 'running',
      }
      state.tasks[runningTask.id] = {
        ...state.tasks[runningTask.id]!,
        currentRunId: runningRun.id,
        runState: 'running',
        status: 'running',
        worktreePath: runningRun.worktreePath,
        branchName: runningRun.branchName,
      }
    })

    const result = await recoverStaleKanbanRuns(storage)

    const state = await storage.load()
    expect(result.recoveredRunIds).toEqual(['run_queued', 'run_running'])
    expect(state.runs.run_queued).toMatchObject({ state: 'needs_recovery', errorMessage: expect.stringContaining('server restarted') })
    expect(state.runs.run_running).toMatchObject({ state: 'needs_recovery', worktreePath: runningRun.worktreePath })
    expect(state.tasks[queuedTask.id]).toMatchObject({ runState: 'needs_recovery', errorMessage: expect.stringContaining('server restarted') })
    expect(state.tasks[runningTask.id]).toMatchObject({ runState: 'needs_recovery', worktreePath: runningRun.worktreePath })
  })
})
