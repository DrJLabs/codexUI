import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { FULL_ACCESS_KANBAN_RUN_PROFILE_ID, type KanbanExecutionPolicy } from '../../../types/kanban'
import { KanbanStorage } from '../storage'
import { KanbanTaskService } from '../taskService'

const policy: KanbanExecutionPolicy = {
  enabled: true,
  executionMode: 'disabled',
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
      executionMode: 'disabled',
      defaultRunProfileId: 'workspace-coding',
    })
    expect(state.config.runProfiles.map((profile) => profile.id)).toEqual([
      'read-only-planning',
      'workspace-coding',
      'workspace-coding-network',
      FULL_ACCESS_KANBAN_RUN_PROFILE_ID,
    ])
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

  it('places new tasks after active tasks only', async () => {
    const { service } = await createHarness()
    const archivedTask = await service.createTask({ title: 'Archived first task' })
    await service.archiveTask(archivedTask.id, { version: archivedTask.version })

    const newTask = await service.createTask({ title: 'New active task' })

    expect(newTask.columnOrder).toBe(0)
  })

  it('rejects stale updates with a version conflict code', async () => {
    const { service } = await createHarness()
    const task = await service.createTask({ title: 'Original task' })
    await service.updateTask(task.id, { version: task.version, title: 'Fresh title' })

    await expect(service.updateTask(task.id, { version: task.version, title: 'Stale title' }))
      .rejects
      .toMatchObject({ code: 'version_conflict' })
  })

  it('rejects forced unversioned public updates at runtime', async () => {
    const { service } = await createHarness()
    const task = await service.createTask({ title: 'Original task' })

    await expect(service.updateTask(task.id, { title: 'Missing version' } as never))
      .rejects
      .toThrow('version is required')
  })

  it('rejects forced unversioned public status updates at runtime', async () => {
    const { service } = await createHarness()
    const task = await service.createTask({ title: 'Original task' })

    await expect(service.setTaskStatus(task.id, { status: 'ready' } as never))
      .rejects
      .toThrow('version is required')
  })

  it('rejects forced unversioned public archive and delete calls at runtime', async () => {
    const { service } = await createHarness()
    const archiveTask = await service.createTask({ title: 'Archive task' })
    const deleteTask = await service.createTask({ title: 'Delete task' })

    await expect(service.archiveTask(archiveTask.id, undefined as never))
      .rejects
      .toThrow('version is required')
    await expect(service.deleteTask(deleteTask.id, undefined as never))
      .rejects
      .toThrow('version is required')
  })

  it('rejects stale acceptance criteria replacement with a version conflict code', async () => {
    const { service } = await createHarness()
    const task = await service.createTask({
      title: 'Criteria task',
      acceptanceCriteria: [{ text: 'Original criterion' }],
    })
    await service.replaceAcceptanceCriteria(task.id, {
      version: task.version,
      criteria: [{ text: 'Fresh criterion', checked: false }],
    })

    await expect(service.replaceAcceptanceCriteria(task.id, {
      version: task.version,
      criteria: [{ text: 'Stale criterion', checked: true }],
    }))
      .rejects
      .toMatchObject({ code: 'version_conflict' })
  })

  it('rejects forced unversioned public acceptance criteria replacement at runtime', async () => {
    const { service } = await createHarness()
    const task = await service.createTask({ title: 'Criteria task' })

    await expect(service.replaceAcceptanceCriteria(task.id, { criteria: [] } as never))
      .rejects
      .toThrow('version is required')
  })

  it('lists matching tasks with total and hasMore metadata', async () => {
    const { service } = await createHarness()
    await service.createTask({ title: 'Deploy production bundle' })
    await service.createTask({ title: 'Refine settings panel' })

    const result = await service.listTasks({ q: 'deploy', limit: 20, offset: 0 })

    expect(result.items).toHaveLength(1)
    expect(result.items[0]?.title).toBe('Deploy production bundle')
    expect(result.total).toBe(1)
    expect(result.limit).toBe(20)
    expect(result.offset).toBe(0)
    expect(result.hasMore).toBe(false)
  })

  it('enforces createTaskIfNoActiveLabel labels on newly created tasks', async () => {
    const { service } = await createHarness()

    const task = await service.createTaskIfNoActiveLabel('automation:daily-check', {
      title: 'Automation failure',
      labels: [],
    })
    const duplicate = await service.createTaskIfNoActiveLabel('automation:daily-check', {
      title: 'Duplicate automation failure',
      labels: [],
    })

    expect(task.labels).toEqual([
      expect.objectContaining({ name: 'automation:daily-check' }),
    ])
    expect(duplicate.id).toBe(task.id)
  })

  it('filters listed tasks by metadata and label', async () => {
    const { service } = await createHarness()
    const highTask = await service.createTask({
      title: 'High priority deploy',
      labels: [{ id: 'label_ops', name: 'Ops', color: '#2563eb' }],
    })
    const lowTask = await service.createTask({
      title: 'Low priority copy',
      labels: [{ id: 'label_docs', name: 'Docs', color: '#16a34a' }],
    })
    await service.updateTask(highTask.id, {
      version: highTask.version,
      priority: 'high',
      assignee: 'codex:auto',
      model: 'gpt-5.4',
      thinking: 'high',
      dueAtIso: '2026-05-02',
      estimateMinutes: 45,
      actualMinutes: null,
    })
    await service.updateTask(lowTask.id, {
      version: lowTask.version,
      priority: 'low',
      assignee: 'operator',
    })

    const result = await service.listTasks({
      priority: ['high'],
      assignee: 'codex:auto',
      label: 'Ops',
      limit: 20,
      offset: 0,
    })

    expect(result.items.map((task) => task.id)).toEqual([highTask.id])
    expect(result.total).toBe(1)
  })

  it('updates allowed metadata fields through the versioned update path', async () => {
    const { service } = await createHarness()
    const task = await service.createTask({ title: 'Metadata task' })

    const updated = await service.updateTask(task.id, {
      version: task.version,
      priority: 'critical',
      assignee: 'codex:thread:019e-meta',
      model: 'gpt-5.4-codex',
      thinking: 'low',
      dueAtIso: '2026-05-03',
      estimateMinutes: 30,
      actualMinutes: 25,
    })

    expect(updated).toMatchObject({
      priority: 'critical',
      assignee: 'codex:thread:019e-meta',
      model: 'gpt-5.4-codex',
      thinking: 'low',
      dueAtIso: '2026-05-03',
      estimateMinutes: 30,
      actualMinutes: 25,
      version: task.version + 1,
    })
  })

  it('reorders a task into a new status after another task', async () => {
    const { service } = await createHarness()
    const other = await service.createTask({ title: 'Ready anchor' })
    const task = await service.createTask({ title: 'Move me' })
    const readyOther = await service.reorderTask(other.id, { version: other.version, status: 'ready' })

    const moved = await service.reorderTask(task.id, {
      version: task.version,
      status: 'ready',
      afterTaskId: readyOther.id,
    })

    expect(moved.status).toBe('ready')
    expect(moved.columnOrder).toBeGreaterThan(readyOther.columnOrder)
  })

  it('enforces transition policy when reorder changes status', async () => {
    const { service } = await createHarness()
    const task = await service.createTask({ title: 'Invalid reorder transition' })

    await expect(service.reorderTask(task.id, { version: task.version, status: 'done' }))
      .rejects
      .toThrow('Invalid status transition')
  })

  it('allows reorder directly to done only when done drag bypass is enabled', async () => {
    const { service } = await createHarness()
    await service.updateConfig({ allowDoneDragBypass: true })
    const task = await service.createTask({ title: 'Bypass done reorder' })

    const moved = await service.reorderTask(task.id, { version: task.version, status: 'done' })

    expect(moved.status).toBe('done')
  })

  it('bumps sibling versions when reorder changes their column order', async () => {
    const { service } = await createHarness()
    const taskA = await service.createTask({ title: 'Task A' })
    const taskB = await service.createTask({ title: 'Task B' })

    await service.reorderTask(taskB.id, {
      version: taskB.version,
      status: 'backlog',
      beforeTaskId: taskA.id,
    })

    await expect(service.updateTask(taskA.id, { version: taskA.version, title: 'Stale A' }))
      .rejects
      .toMatchObject({ code: 'version_conflict' })
    await expect(service.reorderTask(taskA.id, { version: taskA.version, status: 'backlog' }))
      .rejects
      .toMatchObject({ code: 'version_conflict' })
  })

  it('uses board default status and priority for created tasks', async () => {
    const { service } = await createHarness()
    await service.updateConfig({
      defaults: {
        status: 'ready',
        priority: 'high',
      },
    })

    const task = await service.createTask({ title: 'Default configured task' })

    expect(task.status).toBe('ready')
    expect(task.priority).toBe('high')
    expect(task.columnOrder).toBe(0)
  })

  it('uses the board default run profile for created tasks and accepts task overrides', async () => {
    const { service } = await createHarness()
    await service.updateConfig({ defaultRunProfileId: 'workspace-coding-network' })

    const defaulted = await service.createTask({ title: 'Default profile task' })
    const overridden = await service.createTask({
      title: 'Read-only task',
      runProfileId: 'read-only-planning',
    })

    expect(defaulted.runProfileId).toBe('workspace-coding-network')
    expect(overridden.runProfileId).toBe('read-only-planning')
    await expect(service.createTask({ title: 'Invalid profile task', runProfileId: 'missing-profile' }))
      .rejects
      .toThrow('Unknown Kanban run profile')
  })

  it('does not allow full-access operator as the board default run profile', async () => {
    const { service } = await createHarness()

    await expect(service.updateConfig({ defaultRunProfileId: FULL_ACCESS_KANBAN_RUN_PROFILE_ID }))
      .rejects
      .toThrow('Full-access run profile cannot be the board default')
  })
})
