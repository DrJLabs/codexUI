import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { KanbanExecutionPolicy } from '../../../types/kanban'
import { KanbanStorage } from '../storage'
import { KanbanTaskService } from '../taskService'

const policy: KanbanExecutionPolicy = {
  enabled: true,
  executionEnabled: false,
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
  const dataDir = await mkdtemp(join(tmpdir(), 'codexui-kanban-task-service-test-'))
  const projectRoot = join(dataDir, 'project')
  const storage = new KanbanStorage({ dataDir, projectRoot })
  const service = new KanbanTaskService({ storage, projectRoot, policy })
  return { service }
}

describe('KanbanTaskService', () => {
  it('returns board config in state snapshots', async () => {
    const { service } = await createHarness()

    const state = await service.listState()

    expect(state.config).toMatchObject({
      defaults: { status: 'backlog', priority: 'normal' },
      proposalPolicy: 'confirm',
    })
  })

  it('populates parity metadata defaults for newly created tasks', async () => {
    const { service } = await createHarness()

    const firstTask = await service.createTask({ title: 'First task' })
    const secondTask = await service.createTask({ title: 'Second task' })

    expect(firstTask.priority).toBe('normal')
    expect(firstTask.createdBy).toBe('operator')
    expect(firstTask.sourceSessionKey).toBe('')
    expect(firstTask.assignee).toBe('codex:auto')
    expect(firstTask.columnOrder).toBe(0)
    expect(firstTask.result).toBe('')
    expect(firstTask.resultAtIso).toBe('')
    expect(firstTask.model).toBe('')
    expect(firstTask.thinking).toBe('medium')
    expect(firstTask.dueAtIso).toBe('')
    expect(firstTask.estimateMinutes).toBeNull()
    expect(firstTask.actualMinutes).toBeNull()
    expect(firstTask.feedback).toEqual([])
    expect(secondTask.columnOrder).toBe(1)
  })
})
