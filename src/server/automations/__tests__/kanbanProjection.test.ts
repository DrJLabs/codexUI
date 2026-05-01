import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import express from 'express'
import { afterEach, describe, expect, it } from 'vitest'
import type { AutomationDefinition, AutomationRun, AutomationRunState } from '../../../types/automations'
import type { CodexRunProfile } from '../../../types/execution'
import type { KanbanExecutionPolicy, KanbanTask } from '../../../types/kanban'
import { createKanbanMiddleware } from '../../kanban'
import { KANBAN_CSRF_HEADER } from '../../kanban/csrf'
import { KanbanStorage } from '../../kanban/storage'
import { KanbanTaskService } from '../../kanban/taskService'
import { AutomationKanbanProjectionService } from '../kanbanProjection'

const tempDirs: string[] = []
const servers: Server[] = []

const enabledPolicy: KanbanExecutionPolicy = {
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

const runProfile: CodexRunProfile = {
  id: 'default',
  name: 'Default',
  description: 'Default test profile',
  model: 'gpt-5.4',
  reasoningEffort: 'medium',
  sandboxMode: 'workspace-write',
  approvalPolicy: 'on-request',
  networkAccess: false,
  writableRoots: [],
  createdAtIso: '2026-04-30T00:00:00.000Z',
  updatedAtIso: '2026-04-30T00:00:00.000Z',
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve())
  })))
  await Promise.all(tempDirs.splice(0).map(async (dir) => {
    await rm(dir, { recursive: true, force: true })
  }))
})

async function createHarness() {
  const dataDir = await mkdtemp(join(tmpdir(), 'codexui-automation-kanban-projection-'))
  tempDirs.push(dataDir)
  const projectRoot = join(dataDir, 'project')
  await mkdir(projectRoot, { recursive: true })
  const storage = new KanbanStorage({ dataDir, projectRoot })
  const taskService = new KanbanTaskService({ storage, projectRoot, policy: enabledPolicy })
  const projection = new AutomationKanbanProjectionService({ storage, taskService })
  return { dataDir, projectRoot, storage, taskService, projection }
}

function createDefinition(overrides: Partial<AutomationDefinition> = {}): AutomationDefinition {
  return {
    id: 'automation_daily',
    kind: 'heartbeat',
    source: 'native',
    nativeId: 'automation_daily',
    name: 'Daily Review',
    description: 'Definition description',
    prompt: 'Review the thread',
    status: 'active',
    legacyStatus: 'ACTIVE',
    schedule: { type: 'rrule', rrule: 'FREQ=DAILY' },
    targetThreadId: 'thread-1',
    projectRoot: null,
    cwd: null,
    cwds: [],
    runMode: 'chat',
    runProfileId: null,
    model: null,
    reasoningEffort: null,
    autoArchiveNoFindings: false,
    notifyOnFindings: false,
    kanbanProjection: { mode: 'off' },
    notes: '',
    storage: {
      nativeDirName: 'automation_daily',
      nativePath: '/tmp/automation.toml',
      sidecarPath: '/tmp/codexui.json',
    },
    createdAtIso: '2026-04-30T00:00:00.000Z',
    updatedAtIso: '2026-04-30T00:00:00.000Z',
    lastRunAtIso: null,
    nextRunAtIso: null,
    version: 1,
    ...overrides,
  }
}

function createRun(overrides: Partial<AutomationRun> = {}): AutomationRun {
  const state = overrides.state ?? 'completed_with_findings'
  return {
    id: 'run_001',
    automationId: 'automation_daily',
    automationName: 'Daily Review',
    trigger: 'manual',
    runMode: 'chat',
    state,
    promptSnapshot: 'Review the thread',
    scheduleSnapshot: { type: 'rrule', rrule: 'FREQ=DAILY' },
    dueAtIso: null,
    nextDueAtIso: null,
    runProfileId: runProfile.id,
    runProfileSnapshot: runProfile,
    targetThreadId: 'thread-1',
    cwd: null,
    worktreePath: null,
    branchName: null,
    threadId: 'thread-1',
    turnId: 'turn-1',
    resultSummary: null,
    errorMessage: state === 'failed' ? 'Run failed' : null,
    findings: state === 'completed_with_findings',
    inboxTitle: 'Review found issues',
    inboxSummary: 'The automation found follow-up work.',
    readAtIso: null,
    archivedAtIso: null,
    kanbanTaskId: null,
    reviewPacketId: null,
    proposalIds: [],
    runJsonPath: '/tmp/runs/run_001/run.json',
    eventsPath: '/tmp/runs/run_001/events.jsonl',
    logPath: '/tmp/runs/run_001/run.log',
    createdAtIso: '2026-04-30T01:00:00.000Z',
    startedAtIso: '2026-04-30T01:00:01.000Z',
    completedAtIso: '2026-04-30T01:01:00.000Z',
    updatedAtIso: '2026-04-30T01:01:00.000Z',
    ...overrides,
  }
}

async function listTasks(taskService: KanbanTaskService): Promise<KanbanTask[]> {
  return (await taskService.listTasks({ limit: 100, offset: 0 })).items
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<{ status: number; body: T }> {
  const response = await fetch(url, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...init?.headers,
    },
  })
  return {
    status: response.status,
    body: await response.json() as T,
  }
}

async function readCsrfHeaders(baseUrl: string): Promise<Record<string, string>> {
  const csrf = await requestJson<{ data: { csrfToken: string } }>(`${baseUrl}/codex-api/kanban/csrf`)
  expect(csrf.status).toBe(200)
  return { [KANBAN_CSRF_HEADER]: csrf.body.data.csrfToken }
}

describe('AutomationKanbanProjectionService', () => {
  it('returns no task id when projection is off', async () => {
    const { projection, taskService } = await createHarness()

    const result = await projection.projectDefinition({
      definition: createDefinition({ kanbanProjection: { mode: 'off' } }),
    })

    expect(result).toEqual({ taskId: null })
    expect(await listTasks(taskService)).toEqual([])
  })

  it('creates one idle definition task per automation and returns the same task id on repeat', async () => {
    const { projection, taskService } = await createHarness()
    const definition = createDefinition({ kanbanProjection: { mode: 'definition_card' } })
    const secondDefinition = createDefinition({
      id: 'automation_weekly',
      name: 'Weekly Review',
      kanbanProjection: { mode: 'definition_card' },
    })

    const first = await projection.projectDefinition({ definition })
    const second = await projection.projectDefinition({ definition })
    const third = await projection.projectDefinition({ definition: secondDefinition })
    const tasks = await listTasks(taskService)

    expect(first.taskId).toEqual(expect.any(String))
    expect(second.taskId).toBe(first.taskId)
    expect(third.taskId).toEqual(expect.any(String))
    expect(third.taskId).not.toBe(first.taskId)
    expect(tasks).toHaveLength(2)
    const task = tasks.find((candidate) => candidate.id === first.taskId)
    expect(task).toMatchObject({
      id: first.taskId,
      title: 'Automation: Daily Review',
      status: 'backlog',
      runState: 'idle',
      currentRunId: '',
      runIds: [],
    })
    expect(task?.labels.map((label) => label.name)).toContain('automation:automation_daily:definition')
  })

  it('keeps definition projection idempotent under concurrent calls', async () => {
    const { projection, taskService } = await createHarness()
    const definition = createDefinition({ kanbanProjection: { mode: 'definition_card' } })

    const results = await Promise.all(Array.from({ length: 8 }, async () => await projection.projectDefinition({ definition })))
    const tasks = await listTasks(taskService)

    expect(new Set(results.map((result) => result.taskId)).size).toBe(1)
    expect(tasks).toHaveLength(1)
    expect(tasks[0].labels.map((label) => label.name)).toContain('automation:automation_daily:definition')
  })

  it.each([
    ['completed_with_findings', true],
    ['completed_no_findings', false],
  ] as Array<[AutomationRunState, boolean]>)('projects findings_only run cards for %s: %s', async (state, shouldCreate) => {
    const { projection, taskService } = await createHarness()
    const definition = createDefinition({ kanbanProjection: { mode: 'run_card', createFor: 'findings_only' } })

    const result = await projection.projectRun({ definition, run: createRun({ state }) })
    const tasks = await listTasks(taskService)

    expect(result.taskId).toEqual(shouldCreate ? expect.any(String) : null)
    expect(tasks).toHaveLength(shouldCreate ? 1 : 0)
    if (shouldCreate) {
      expect(tasks[0]).toMatchObject({
        title: 'Automation finding: Daily Review',
        runState: 'idle',
        currentRunId: '',
        runIds: [],
      })
      expect(tasks[0].description).toContain('Run state: completed_with_findings')
      expect(tasks[0].description).toContain('Inbox title: Review found issues')
      expect(tasks[0].description).toContain('Inbox summary: The automation found follow-up work.')
      expect(tasks[0].description).toContain('Log path: /tmp/runs/run_001/run.log')
      expect(tasks[0].labels.map((label) => label.name)).toContain('automation:automation_daily:run:run_001')
    }
  })

  it.each([
    ['failed', true],
    ['completed_with_findings', false],
    ['completed_no_findings', false],
  ] as Array<[AutomationRunState, boolean]>)('projects failures_only run cards for %s: %s', async (state, shouldCreate) => {
    const { projection, taskService } = await createHarness()
    const definition = createDefinition({ kanbanProjection: { mode: 'run_card', createFor: 'failures_only' } })

    const result = await projection.projectRun({ definition, run: createRun({ state }) })
    const tasks = await listTasks(taskService)

    expect(result.taskId).toEqual(shouldCreate ? expect.any(String) : null)
    expect(tasks).toHaveLength(shouldCreate ? 1 : 0)
    if (shouldCreate) {
      expect(tasks[0].title).toBe('Automation finding: Daily Review')
      expect(tasks[0].description).toContain('Run state: failed')
    }
  })

  it('validates attach_existing_task targets without mutating active tasks and rejects missing or archived tasks', async () => {
    const { projection, taskService } = await createHarness()
    const activeTask = await taskService.createTask({ title: 'Existing active task' })
    const archivedTask = await taskService.createTask({ title: 'Existing archived task' })
    await taskService.archiveTask(archivedTask.id, { version: archivedTask.version })

    const attached = await projection.projectDefinition({
      definition: createDefinition({ kanbanProjection: { mode: 'attach_existing_task', taskId: activeTask.id } }),
    })

    expect(attached).toEqual({ taskId: activeTask.id })
    expect(await taskService.getTask(activeTask.id)).toEqual(activeTask)
    await expect(projection.projectDefinition({
      definition: createDefinition({ kanbanProjection: { mode: 'attach_existing_task', taskId: 'task_missing' } }),
    })).rejects.toThrow('Kanban projection task not found')
    await expect(projection.projectDefinition({
      definition: createDefinition({ kanbanProjection: { mode: 'attach_existing_task', taskId: archivedTask.id } }),
    })).rejects.toThrow('Kanban projection task is archived')
  })

  it('keeps created tasks inert and does not start execution', async () => {
    const { projection, taskService } = await createHarness()

    const result = await projection.projectRun({
      definition: createDefinition({ kanbanProjection: { mode: 'run_card', createFor: 'every_run' } }),
      run: createRun({ id: 'run_inert', state: 'completed_with_findings' }),
    })
    const task = await taskService.getTask(result.taskId ?? '')

    expect(task.runState).toBe('idle')
    expect(task.status).toBe((await taskService.getConfig()).defaults.status)
    expect(task.currentRunId).toBe('')
    expect(task.runIds).toEqual([])
  })

  it('allows projection and Kanban API to share the same storage and task service instances', async () => {
    const { dataDir, projectRoot, storage, taskService, projection } = await createHarness()
    const app = express()
    app.use('/codex-api/kanban', createKanbanMiddleware({ dataDir, projectRoot, storage, taskService }))
    const server = createServer(app)
    servers.push(server)
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Expected test server port')
    const baseUrl = `http://127.0.0.1:${address.port}`
    const csrfHeaders = await readCsrfHeaders(baseUrl)

    const apiCreated = await requestJson<{ data: { id: string } }>(
      `${baseUrl}/codex-api/kanban/tasks`,
      {
        method: 'POST',
        headers: csrfHeaders,
        body: JSON.stringify({ title: 'Created by API' }),
      },
    )
    const projected = await projection.projectDefinition({
      definition: createDefinition({ kanbanProjection: { mode: 'definition_card' } }),
    })
    const tasks = await listTasks(taskService)

    expect(apiCreated.status).toBe(201)
    expect(tasks.map((task) => task.id).sort()).toEqual([apiCreated.body.data.id, projected.taskId].sort())
    expect((await storage.load()).tasks[projected.taskId ?? '']).toBeTruthy()
  })
})
