import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { KanbanStorage } from '../storage'
import { KanbanTaskService } from '../taskService'
import { resolveProjectStatePath } from '../paths'

async function createHarness() {
  const dataDir = await mkdtemp(join(tmpdir(), 'codexui-kanban-test-'))
  const projectRoot = join(dataDir, 'project')
  const storage = new KanbanStorage({ dataDir, projectRoot })
  const service = new KanbanTaskService({
    storage,
    projectRoot,
    policy: {
      enabled: true,
      executionEnabled: false,
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
  })
  return { dataDir, projectRoot, storage, service }
}

describe('KanbanStorage', () => {
  it('creates an empty state file with a project board', async () => {
    const { storage, projectRoot } = await createHarness()

    const state = await storage.load()
    const boards = Object.values(state.boards)

    expect(state.schemaVersion).toBe(1)
    expect(state.projectRoot).toBe(projectRoot)
    expect(boards).toHaveLength(1)
    expect(boards[0]?.title).toBe('Kanban')
    expect(state.tasks).toEqual({})
  })

  it('persists task creation across storage instances', async () => {
    const { dataDir, projectRoot, service } = await createHarness()

    const task = await service.createTask({
      title: 'Build board',
      description: 'Server-backed task state',
      acceptanceCriteria: [{ text: 'state survives reload' }],
    })
    const nextService = new KanbanTaskService({
      storage: new KanbanStorage({ dataDir, projectRoot }),
      projectRoot,
      policy: service.policy,
    })
    const snapshot = await nextService.listState()

    expect(snapshot.tasks).toHaveLength(1)
    expect(snapshot.tasks[0]?.id).toBe(task.id)
    expect(snapshot.tasks[0]?.acceptanceCriteria[0]?.text).toBe('state survives reload')
  })

  it('serializes concurrent mutations so tasks are not lost', async () => {
    const { service } = await createHarness()

    await Promise.all(Array.from({ length: 8 }, (_, index) => service.createTask({ title: `Task ${index}` })))
    const snapshot = await service.listState()

    expect(snapshot.tasks).toHaveLength(8)
  })

  it('increments version on update and archives without deleting', async () => {
    const { service } = await createHarness()

    const task = await service.createTask({ title: 'Original' })
    const updated = await service.updateTask(task.id, { title: 'Updated' })
    const archived = await service.archiveTask(task.id)
    const snapshot = await service.listState()

    expect(updated.version).toBe(task.version + 1)
    expect(archived.archived).toBe(true)
    expect(snapshot.tasks).toHaveLength(1)
    expect(snapshot.tasks[0]?.archived).toBe(true)
  })

  it('preserves criterion metadata when replacement ids include whitespace', async () => {
    const { service } = await createHarness()

    const task = await service.createTask({
      title: 'Criteria task',
      acceptanceCriteria: [{ text: 'Existing criterion' }],
    })
    const criterion = task.acceptanceCriteria[0]
    if (!criterion) throw new Error('Expected criterion')
    const replaced = await service.replaceAcceptanceCriteria(task.id, {
      criteria: [{ id: ` ${criterion.id} `, text: 'Updated criterion', checked: true }],
    })

    expect(replaced.acceptanceCriteria[0]?.id).toBe(criterion.id)
    expect(replaced.acceptanceCriteria[0]?.createdAtIso).toBe(criterion.createdAtIso)
    expect(replaced.acceptanceCriteria[0]?.text).toBe('Updated criterion')
  })

  it('rejects invalid status transitions and allows valid ones', async () => {
    const { service } = await createHarness()

    const task = await service.createTask({ title: 'Transition task' })

    await expect(service.setTaskStatus(task.id, { status: 'done' })).rejects.toThrow('Invalid status transition')
    await expect(service.setTaskStatus(task.id, { status: 'ready' })).resolves.toMatchObject({ status: 'ready' })
  })

  it('backs up corrupt state files before throwing an operator-visible error', async () => {
    const { dataDir, projectRoot, storage } = await createHarness()
    await storage.load()
    const statePath = resolveProjectStatePath(dataDir, projectRoot)
    await writeFile(statePath, '{ invalid json', 'utf8')

    await expect(storage.load()).rejects.toThrow('Kanban state file is corrupt; backup written to')

    const backups = await readdir(join(dataDir, 'backups'))
    expect(backups.some((name) => name.endsWith('.json'))).toBe(true)
    const backupContent = await readFile(join(dataDir, 'backups', backups[0] ?? ''), 'utf8')
    expect(backupContent).toBe('{ invalid json')
  })

  it('backs up invalid migrated state files before throwing an operator-visible error', async () => {
    const { dataDir, projectRoot, storage } = await createHarness()
    await storage.load()
    const statePath = resolveProjectStatePath(dataDir, projectRoot)
    await writeFile(statePath, JSON.stringify({ schemaVersion: 1, boards: [] }), 'utf8')

    await expect(storage.load()).rejects.toThrow('Kanban state file is corrupt; backup written to')

    const backups = await readdir(join(dataDir, 'backups'))
    expect(backups.some((name) => name.endsWith('.json'))).toBe(true)
  })
})
