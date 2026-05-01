import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AutomationRun } from '../../../types/automations'
import { FULL_ACCESS_CODEX_RUN_PROFILE_ID, type CodexRunProfile } from '../../../types/execution'
import type { KanbanExecutionPolicy, KanbanTask } from '../../../types/kanban'
import type { CodexBridgeNotification, CodexBridgeRuntime } from '../../codexAppServerBridge'
import { KanbanStorage } from '../../kanban/storage'
import { KanbanTaskService } from '../../kanban/taskService'
import { MANAGED_WORKTREE_LOCK_FILENAME } from '../../workspaces/worktreeLocks'
import type { AutomationKanbanProjectionService } from '../kanbanProjection'
import { AutomationKanbanProjectionService as RealAutomationKanbanProjectionService } from '../kanbanProjection'
import { serializeAutomationToml, type ThreadAutomationRecord } from '../nativeStore'
import { createAutomationRunPaths, createAutomationRunStore } from '../runStore'
import type { AutomationSchedulerState } from '../schedulerStore'
import { AutomationsService } from '../service'

const codexHomeDirs: string[] = []
const execFileAsync = promisify(execFile)

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

const nativeRecord: ThreadAutomationRecord = {
  id: 'daily-check',
  kind: 'heartbeat',
  name: 'Daily Check',
  prompt: 'Review the thread',
  rrule: 'FREQ=DAILY;INTERVAL=1',
  rrulePrefix: null,
  status: 'ACTIVE',
  targetThreadId: 'thread-1',
  model: null,
  reasoningEffort: null,
  executionEnvironment: null,
  runMode: null,
  cwd: null,
  cwds: [],
  createdAtMs: 1710000000000,
  updatedAtMs: 1710000005000,
  nextRunAtMs: null,
}

afterEach(async () => {
  await Promise.all(codexHomeDirs.splice(0).map(async (codexHomeDir) => {
    await rm(codexHomeDir, { recursive: true, force: true })
  }))
})

async function createHarness(options: {
  policy?: KanbanExecutionPolicy
  turnStartDelayMs?: number
  turnStartError?: Error
  readThreadResponse?: unknown
  readThreadError?: Error
  beforeRpc?: (method: string) => Promise<void> | void
  afterTurnStart?: (turn: {
    threadId: string
    turnId: string
    notifyCompleted: () => Promise<void> | void
  }) => Promise<void> | void
  kanbanProjection?: AutomationKanbanProjectionService
} = {}) {
  const codexHomeDir = await mkdtemp(join(tmpdir(), 'codexui-automation-runner-'))
  codexHomeDirs.push(codexHomeDir)
  const rpcCalls: Array<{ method: string; params: unknown }> = []
  const notificationListeners: Array<(notification: CodexBridgeNotification) => void> = []
  const unsubscribe = vi.fn()
  let threadStartCount = 0
  let turnStartCount = 0
  const bridge: CodexBridgeRuntime = {
    rpc: async <T = unknown>(method: string, params?: unknown) => {
      await options.beforeRpc?.(method)
      rpcCalls.push({ method, params })
      if (method === 'thread/resume') return { thread: { id: readRecord(params).threadId } } as T
      if (method === 'thread/start') {
        threadStartCount += 1
        return { thread: { id: `thread_local_${threadStartCount}` } } as T
      }
      if (method === 'turn/start') {
        if (options.turnStartDelayMs) {
          await new Promise((resolve) => setTimeout(resolve, options.turnStartDelayMs))
        }
        if (options.turnStartError) throw options.turnStartError
        turnStartCount += 1
        const turnId = `turn_${turnStartCount}`
        const threadId = String(readRecord(params).threadId ?? '')
        await options.afterTurnStart?.({
          threadId,
          turnId,
          notifyCompleted: () => notificationListeners[0]?.({
            method: 'turn/completed',
            params: { threadId, turnId },
            atIso: new Date().toISOString(),
          }),
        })
        return { turn: { id: turnId } } as T
      }
      if (method === 'thread/read') {
        if (options.readThreadError) throw options.readThreadError
        return (options.readThreadResponse ?? {
          thread: {
            turns: [
              {
                id: 'turn_1',
                items: [{ type: 'agentMessage', text: 'No findings from the manual automation run.' }],
              },
            ],
          },
        }) as T
      }
      return {} as T
    },
    subscribeNotifications: vi.fn((listener) => {
      notificationListeners.push(listener)
      return unsubscribe
    }),
    dispose: vi.fn(),
  }
  const service = new AutomationsService({
    codexHomeDir,
    bridge,
    policy: options.policy ?? enabledPolicy,
    kanbanProjection: options.kanbanProjection,
  })
  return { codexHomeDir, service, bridge, rpcCalls, notificationListeners, unsubscribe }
}

async function createKanbanProjectionHarness() {
  const dataDir = await mkdtemp(join(tmpdir(), 'codexui-automation-runner-kanban-'))
  codexHomeDirs.push(dataDir)
  const projectRoot = join(dataDir, 'project')
  await mkdir(projectRoot, { recursive: true })
  const storage = new KanbanStorage({ dataDir, projectRoot })
  const taskService = new KanbanTaskService({ storage, projectRoot, policy: enabledPolicy })
  const kanbanProjection = new RealAutomationKanbanProjectionService({ storage, taskService })
  return { storage, taskService, kanbanProjection }
}

async function writeNative(codexHomeDir: string, dirName: string, record: ThreadAutomationRecord, sidecar: Record<string, unknown> = {}) {
  const dir = join(codexHomeDir, 'automations', dirName)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'automation.toml'), serializeAutomationToml(record), 'utf8')
  await writeFile(join(dir, 'codexui.json'), `${JSON.stringify(sidecar, null, 2)}\n`, 'utf8')
  return dir
}

async function writeScheduler(automationDir: string, state: Partial<AutomationSchedulerState> = {}) {
  const schedulerState: AutomationSchedulerState = {
    automationId: 'daily-check',
    sourceDirName: 'daily-check-dir',
    scheduleHash: 'test-schedule-hash',
    nextDueAtIso: '2026-04-30T09:00:00.000Z',
    lastDueAtIso: null,
    lastScheduledRunId: null,
    lastEvaluatedAtIso: null,
    missedRunPolicy: 'one_catch_up',
    unsupportedReason: null,
    updatedAtIso: '2026-04-30T08:00:00.000Z',
    ...state,
  }
  await writeFile(join(automationDir, 'scheduler.json'), `${JSON.stringify(schedulerState, null, 2)}\n`, 'utf8')
  return schedulerState
}

async function createGitRepo(): Promise<string> {
  const projectRoot = await mkdtemp(join(tmpdir(), 'codexui-automation-worktree-repo-'))
  codexHomeDirs.push(projectRoot)
  await runGit(projectRoot, ['init', '-b', 'main'])
  await runGit(projectRoot, ['config', 'user.name', 'CodexUI Test'])
  await runGit(projectRoot, ['config', 'user.email', 'codexui@example.test'])
  await runGit(projectRoot, ['commit', '--allow-empty', '-m', 'initial'])
  return projectRoot
}

async function runGit(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd })
  return stdout
}

async function listKanbanTasks(taskService: KanbanTaskService): Promise<KanbanTask[]> {
  return (await taskService.listTasks({ limit: 100, offset: 0 })).items
}

describe('AutomationRunner', () => {
  it('starts chat mode runs by resuming the target thread, starting a turn, and persisting a running record', async () => {
    const { codexHomeDir, service, rpcCalls } = await createHarness()
    const automationDir = await writeNative(codexHomeDir, 'daily-check-dir', nativeRecord, {
      runMode: 'chat',
      model: 'gpt-5.4',
      reasoningEffort: 'high',
    })

    const run = await service.runNow('daily-check')
    const storedRun = JSON.parse(await readFile(join(automationDir, 'runs', run.id, 'run.json'), 'utf8')) as AutomationRun
    const definition = await service.getDefinition('daily-check')

    expect(run).toMatchObject({
      automationId: 'daily-check',
      runMode: 'chat',
      state: 'running',
      targetThreadId: 'thread-1',
      threadId: 'thread-1',
      turnId: 'turn_1',
      promptSnapshot: 'Review the thread',
    })
    expect(storedRun).toMatchObject({
      id: run.id,
      trigger: 'manual',
      state: 'running',
      dueAtIso: null,
      nextDueAtIso: null,
      eventsPath: join(automationDir, 'runs', run.id, 'events.jsonl'),
      logPath: join(automationDir, 'runs', run.id, 'run.log'),
    })
    expect(definition.lastRunAtIso).toBe(run.startedAtIso)
    expect(definition.recentRuns?.[0]).toMatchObject({ id: run.id, state: 'running' })
    expect(rpcCalls.map((call) => call.method)).toEqual(['thread/resume', 'turn/start'])
    expect(rpcCalls[1]?.params).toMatchObject({
      threadId: 'thread-1',
      input: [{ type: 'text', text: 'Review the thread' }],
      model: 'gpt-5.4',
      effort: 'high',
      approvalPolicy: 'on-request',
      sandboxPolicy: { type: 'workspaceWrite', networkAccess: false },
    })
    await expect(readFile(storedRun.eventsPath, 'utf8')).resolves.toContain('manual_run.turn_started')
    await expect(readFile(storedRun.logPath, 'utf8')).resolves.toContain('Turn started')
  })

  it('starts local mode runs only with an absolute cwd and passes resolved run settings to the bridge', async () => {
    const { codexHomeDir, service, rpcCalls } = await createHarness()
    await writeNative(codexHomeDir, 'daily-check-dir', nativeRecord, {
      runMode: 'local',
      cwd: '/tmp/codexui-automation-local',
    })

    const run = await service.runNow('daily-check')

    expect(run).toMatchObject({
      state: 'running',
      runMode: 'local',
      cwd: '/tmp/codexui-automation-local',
      threadId: 'thread_local_1',
      turnId: 'turn_1',
    })
    expect(rpcCalls.map((call) => call.method)).toEqual(['thread/start', 'turn/start'])
    expect(rpcCalls[0]?.params).toEqual({ cwd: '/tmp/codexui-automation-local', title: 'Daily Check' })
    expect(rpcCalls[1]?.params).toMatchObject({
      threadId: 'thread_local_1',
      cwd: '/tmp/codexui-automation-local',
      input: [{ type: 'text', text: 'Review the thread' }],
      sandboxPolicy: {
        type: 'workspaceWrite',
        writableRoots: expect.arrayContaining(['/tmp/codexui-automation-local']),
      },
    })
  })

  it('rejects local mode without an absolute cwd before bridge calls', async () => {
    const { codexHomeDir, service, rpcCalls } = await createHarness()
    await writeNative(codexHomeDir, 'daily-check-dir', nativeRecord, { runMode: 'local' })

    await expect(service.runNow('daily-check')).rejects.toThrow('local automation runs require an absolute cwd')
    expect(rpcCalls).toEqual([])
  })

  it('surfaces non-missing sidecar read failures for definition reads', async () => {
    const { codexHomeDir, service } = await createHarness()
    const automationDir = await writeNative(codexHomeDir, 'daily-check-dir', nativeRecord, { runMode: 'chat' })
    await rm(join(automationDir, 'codexui.json'), { force: true })
    await mkdir(join(automationDir, 'codexui.json'), { recursive: true })

    await expect(service.getDefinition('daily-check')).rejects.toThrow()
  })

  it('starts worktree mode runs in a managed worktree, stores snapshots, and completes through turn notifications', async () => {
    const projectRoot = await createGitRepo()
    const { codexHomeDir, service, rpcCalls, notificationListeners } = await createHarness()
    const automationDir = await writeNative(codexHomeDir, 'daily-check-dir', nativeRecord, {
      runMode: 'worktree',
      cwd: projectRoot,
    })

    const first = await service.runNow('daily-check')
    const storedFirst = JSON.parse(await readFile(join(automationDir, 'runs', first.id, 'run.json'), 'utf8')) as AutomationRun
    const threadStart = rpcCalls.find((call) => call.method === 'thread/start')
    const turnStart = rpcCalls.find((call) => call.method === 'turn/start')
    const worktreeList = await runGit(projectRoot, ['worktree', 'list', '--porcelain'])

    expect(first).toMatchObject({
      state: 'running',
      runMode: 'worktree',
      cwd: projectRoot,
      worktreePath: expect.stringContaining('/worktrees/'),
      threadId: 'thread_local_1',
      turnId: 'turn_1',
    })
    expect(storedFirst.branchName).toMatch(/^codexui\/automation\/daily-check-/u)
    expect(storedFirst.worktreePath).toBe(first.worktreePath)
    expect(threadStart?.params).toEqual({ cwd: first.worktreePath, title: 'Daily Check' })
    expect(turnStart?.params).toMatchObject({
      threadId: 'thread_local_1',
      cwd: first.worktreePath,
      sandboxPolicy: {
        type: 'workspaceWrite',
        writableRoots: expect.arrayContaining([first.worktreePath]),
      },
    })
    expect(worktreeList).toContain(first.worktreePath)
    await expect(readFile(join(first.worktreePath!, '..', MANAGED_WORKTREE_LOCK_FILENAME), 'utf8'))
      .resolves
      .toContain('"source": "automation"')

    await Promise.resolve(notificationListeners[0]!({
      method: 'turn/completed',
      params: { threadId: 'thread_local_1', turnId: 'turn_1' },
      atIso: new Date().toISOString(),
    }))
    const completed = (await service.listRuns('daily-check'))[0]!
    const second = await service.runNow('daily-check')
    const worktreeListAfterSecond = await runGit(projectRoot, ['worktree', 'list', '--porcelain'])

    expect(completed).toMatchObject({ id: first.id, state: 'completed_no_findings' })
    expect(second.id).not.toBe(first.id)
    expect(worktreeListAfterSecond).toContain(first.worktreePath)
    expect(worktreeListAfterSecond).toContain(second.worktreePath)
  })

  it('treats automation worktree locks with missing run records as inactive', async () => {
    const projectRoot = await createGitRepo()
    const { codexHomeDir, service } = await createHarness()
    const automationDir = await writeNative(codexHomeDir, 'daily-check-dir', nativeRecord, {
      runMode: 'worktree',
      cwd: projectRoot,
    })
    const first = await service.runNow('daily-check')
    await rm(join(automationDir, 'runs', first.id), { recursive: true, force: true })

    const second = await service.runNow('daily-check')

    expect(second.id).not.toBe(first.id)
    expect(second.worktreePath).toContain('/worktrees/')
  })

  it('preserves a managed worktree when worktree mode startup fails', async () => {
    const projectRoot = await createGitRepo()
    const { codexHomeDir, service } = await createHarness({ turnStartError: new Error('turn start failed') })
    await writeNative(codexHomeDir, 'daily-check-dir', nativeRecord, {
      runMode: 'worktree',
      cwd: projectRoot,
    })

    await expect(service.runNow('daily-check')).rejects.toThrow('turn start failed')
    const failed = (await service.listRuns('daily-check'))[0]!
    const worktreeList = await runGit(projectRoot, ['worktree', 'list', '--porcelain'])

    expect(failed).toMatchObject({
      state: 'failed',
      worktreePath: expect.stringContaining('/worktrees/'),
      errorMessage: 'turn start failed',
      findings: true,
      inboxTitle: 'Run failed',
      readAtIso: null,
      archivedAtIso: null,
    })
    expect(failed.branchName).toMatch(/^codexui\/automation\/daily-check-/u)
    expect(worktreeList).toContain(failed.worktreePath)
  })

  it('releases active-run ownership when startup failure persistence also fails', async () => {
    let automationDir = ''
    let runId = ''
    const { codexHomeDir, service } = await createHarness({
      turnStartError: new Error('turn start failed'),
      beforeRpc: async (method) => {
        if (method !== 'turn/start') return
        const runIds = await readdir(join(automationDir, 'runs'))
        runId = runIds[0]!
        await rm(join(automationDir, 'runs', runId), { recursive: true, force: true })
      },
    })
    automationDir = await writeNative(codexHomeDir, 'daily-check-dir', nativeRecord, { runMode: 'chat' })

    await expect(service.runNow('daily-check')).rejects.toThrow('turn start failed')
    const runner = (service as unknown as { runner: { ownsActiveRun(runId: string): boolean } }).runner

    expect(runId).toMatch(/^automation_run_/u)
    expect(runner.ownsActiveRun(runId)).toBe(false)
  })

  it('unsubscribes from bridge notifications when disposed', async () => {
    const { service, unsubscribe } = await createHarness()

    ;(service as unknown as { dispose(): void }).dispose()

    expect(unsubscribe).toHaveBeenCalledOnce()
  })

  it('marks a matching completed turn as completed_no_findings and permits a later run', async () => {
    const { codexHomeDir, service, rpcCalls, notificationListeners } = await createHarness()
    await writeNative(codexHomeDir, 'daily-check-dir', nativeRecord, { runMode: 'chat' })
    const first = await service.runNow('daily-check')

    await Promise.resolve(notificationListeners[0]!({
      method: 'turn/completed',
      params: { threadId: 'thread-1', turnId: 'turn_1' },
      atIso: new Date().toISOString(),
    }))
    const completed = (await service.listRuns('daily-check'))[0]!
    const second = await service.runNow('daily-check')

    expect(completed).toMatchObject({
      id: first.id,
      state: 'completed_no_findings',
      resultSummary: 'No findings from the manual automation run.',
      findings: false,
      inboxTitle: 'No findings',
      readAtIso: expect.any(String),
      archivedAtIso: null,
    })
    expect(second.id).not.toBe(first.id)
    expect(rpcCalls.map((call) => call.method)).toEqual(['thread/resume', 'turn/start', 'thread/read', 'thread/resume', 'turn/start'])
  })

  it('indexes a started turn before awaiting run-state persistence', async () => {
    let automationDir = ''
    let notificationProcessed!: () => void
    let notificationFailed!: (error: unknown) => void
    const completedNotification = new Promise<void>((resolve, reject) => {
      notificationProcessed = resolve
      notificationFailed = reject
    })
    const { codexHomeDir, service } = await createHarness({
      afterTurnStart: async ({ notifyCompleted }) => {
        const lockPath = join(automationDir, '.active-runs.json.lock')
        await mkdir(lockPath, { recursive: true })
        await writeFile(join(lockPath, 'owner.json'), `${JSON.stringify({
          pid: process.pid,
          startedAtMs: Date.now(),
        })}\n`, 'utf8')
        setTimeout(() => {
          Promise.resolve(notifyCompleted()).then(notificationProcessed, notificationFailed)
          setTimeout(() => {
            void rm(lockPath, { recursive: true, force: true })
          }, 20)
        }, 0)
      },
    })
    automationDir = await writeNative(codexHomeDir, 'daily-check-dir', nativeRecord, { runMode: 'chat' })

    const run = await service.runNow('daily-check')
    await completedNotification
    const completed = (await service.listRuns('daily-check'))[0]!

    expect(completed).toMatchObject({
      id: run.id,
      state: 'completed_no_findings',
      threadId: 'thread-1',
      turnId: 'turn_1',
    })
  })

  it('accepts nested thread ids in completion notifications', async () => {
    const { codexHomeDir, service, notificationListeners } = await createHarness()
    await writeNative(codexHomeDir, 'daily-check-dir', nativeRecord, { runMode: 'chat' })
    const first = await service.runNow('daily-check')

    await Promise.resolve(notificationListeners[0]!({
      method: 'turn/completed',
      params: { thread: { threadId: 'thread-1' }, turn: { id: 'turn_1' } },
      atIso: new Date().toISOString(),
    }))
    const completed = (await service.listRuns('daily-check'))[0]!

    expect(completed).toMatchObject({ id: first.id, state: 'completed_no_findings' })
  })

  it('surfaces non-missing projection sidecar read failures during completion', async () => {
    const { codexHomeDir, service, notificationListeners } = await createHarness()
    const automationDir = await writeNative(codexHomeDir, 'daily-check-dir', nativeRecord, { runMode: 'chat' })
    await service.runNow('daily-check')
    await rm(join(automationDir, 'codexui.json'), { force: true })
    await mkdir(join(automationDir, 'codexui.json'), { recursive: true })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    try {
      await Promise.resolve(notificationListeners[0]!({
        method: 'turn/completed',
        params: { threadId: 'thread-1', turnId: 'turn_1' },
        atIso: new Date().toISOString(),
      }))
      expect(warn).toHaveBeenCalledWith(
        'Automation turn completion notification failed:',
        expect.objectContaining({ code: 'EISDIR' }),
      )
    } finally {
      warn.mockRestore()
    }
  })

  it('does not scan automation storage for unrelated completed turns', async () => {
    const { codexHomeDir, service, notificationListeners } = await createHarness()
    const automationDir = await writeNative(codexHomeDir, 'daily-check-dir', nativeRecord, { runMode: 'chat' })
    const run = await service.runNow('daily-check')
    await mkdir(join(codexHomeDir, 'automations', 'broken-dir', 'automation.toml'), { recursive: true })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    try {
      await Promise.resolve(notificationListeners[0]!({
        method: 'turn/completed',
        params: { threadId: 'unrelated-thread', turnId: 'unrelated-turn' },
        atIso: new Date().toISOString(),
      }))
      expect(warn).not.toHaveBeenCalled()
    } finally {
      warn.mockRestore()
    }
    const activeRun = await createAutomationRunStore(automationDir).readRun(run.id)

    expect(activeRun).toMatchObject({ id: run.id, state: 'running' })
  })

  it('marks completed turns with findings as unread completed_with_findings', async () => {
    const { codexHomeDir, service, notificationListeners } = await createHarness({
      readThreadResponse: {
        thread: {
          turns: [
            {
              id: 'turn_1',
              items: [{ type: 'agentMessage', text: 'RESULT: FINDINGS\n- Disk is full' }],
            },
          ],
        },
      },
    })
    await writeNative(codexHomeDir, 'daily-check-dir', nativeRecord, { runMode: 'chat' })
    const first = await service.runNow('daily-check')

    await Promise.resolve(notificationListeners[0]!({
      method: 'turn/completed',
      params: { threadId: 'thread-1', turnId: 'turn_1' },
      atIso: new Date().toISOString(),
    }))
    const completed = (await service.listRuns('daily-check'))[0]!

    expect(completed).toMatchObject({
      id: first.id,
      state: 'completed_with_findings',
      findings: true,
      inboxTitle: 'Findings reported',
      inboxSummary: 'RESULT: FINDINGS - Disk is full',
      readAtIso: null,
      archivedAtIso: null,
    })
    await expect(readFile(completed.logPath, 'utf8')).resolves.toContain('Manual run completed with findings')
  })

  it('extracts assistant completion text from turn messages and nested content blocks', async () => {
    const { codexHomeDir, service, notificationListeners } = await createHarness({
      readThreadResponse: {
        thread: {
          turns: [
            {
              id: 'turn_1',
              messages: [
                {
                  role: 'assistant',
                  content: [
                    { type: 'text', text: 'RESULT: FINDINGS' },
                    { type: 'text', text: '- Nested completion text' },
                  ],
                },
              ],
            },
          ],
        },
      },
    })
    await writeNative(codexHomeDir, 'daily-check-dir', nativeRecord, { runMode: 'chat' })
    await service.runNow('daily-check')

    await Promise.resolve(notificationListeners[0]!({
      method: 'turn/completed',
      params: { threadId: 'thread-1', turnId: 'turn_1' },
      atIso: new Date().toISOString(),
    }))
    const completed = (await service.listRuns('daily-check'))[0]!

    expect(completed).toMatchObject({
      state: 'completed_with_findings',
      findings: true,
      resultSummary: 'RESULT: FINDINGS\n- Nested completion text',
      inboxTitle: 'Findings reported',
    })
  })

  it('projects completed findings runs to one idle Kanban task and stores the task id', async () => {
    const { taskService, kanbanProjection } = await createKanbanProjectionHarness()
    const { codexHomeDir, service, notificationListeners } = await createHarness({
      kanbanProjection,
      readThreadResponse: {
        thread: {
          turns: [
            {
              id: 'turn_1',
              items: [{ type: 'agentMessage', text: 'RESULT: FINDINGS\n- Disk is full' }],
            },
          ],
        },
      },
    })
    await writeNative(codexHomeDir, 'daily-check-dir', nativeRecord, {
      runMode: 'chat',
      kanbanProjection: { mode: 'run_card', createFor: 'findings_only' },
    })
    const first = await service.runNow('daily-check')

    await Promise.resolve(notificationListeners[0]!({
      method: 'turn/completed',
      params: { threadId: 'thread-1', turnId: 'turn_1' },
      atIso: new Date().toISOString(),
    }))
    const completed = (await service.listRuns('daily-check'))[0]!
    const tasks = await listKanbanTasks(taskService)

    expect(completed).toMatchObject({
      id: first.id,
      state: 'completed_with_findings',
      kanbanTaskId: expect.any(String),
    })
    expect(tasks).toHaveLength(1)
    expect(tasks[0]).toMatchObject({
      id: completed.kanbanTaskId,
      title: 'Automation finding: Daily Check',
      status: 'backlog',
      runState: 'idle',
      currentRunId: '',
      runIds: [],
    })
    expect(tasks[0].labels.map((label) => label.name)).toContain(`automation:daily-check:run:${first.id}`)
  })

  it('keeps repeated completed notifications idempotent for run Kanban projection', async () => {
    const { taskService, kanbanProjection } = await createKanbanProjectionHarness()
    const { codexHomeDir, service, notificationListeners } = await createHarness({
      kanbanProjection,
      readThreadResponse: {
        thread: {
          turns: [
            {
              id: 'turn_1',
              items: [{ type: 'agentMessage', text: 'RESULT: FINDINGS\n- Disk is full' }],
            },
          ],
        },
      },
    })
    await writeNative(codexHomeDir, 'daily-check-dir', nativeRecord, {
      runMode: 'chat',
      kanbanProjection: { mode: 'run_card', createFor: 'findings_only' },
    })
    const first = await service.runNow('daily-check')

    await Promise.resolve(notificationListeners[0]!({
      method: 'turn/completed',
      params: { threadId: 'thread-1', turnId: 'turn_1' },
      atIso: new Date().toISOString(),
    }))
    const once = (await service.listRuns('daily-check'))[0]!
    await Promise.resolve(notificationListeners[0]!({
      method: 'turn/completed',
      params: { threadId: 'thread-1', turnId: 'turn_1' },
      atIso: new Date().toISOString(),
    }))
    const twice = (await service.listRuns('daily-check'))[0]!
    const tasks = await listKanbanTasks(taskService)

    expect(twice).toMatchObject({
      id: first.id,
      state: 'completed_with_findings',
      kanbanTaskId: once.kanbanTaskId,
    })
    expect(tasks).toHaveLength(1)
    expect(tasks[0].id).toBe(once.kanbanTaskId)
  })

  it('does not project completed_no_findings runs for findings_only run cards', async () => {
    const { taskService, kanbanProjection } = await createKanbanProjectionHarness()
    const { codexHomeDir, service, notificationListeners } = await createHarness({ kanbanProjection })
    await writeNative(codexHomeDir, 'daily-check-dir', nativeRecord, {
      runMode: 'chat',
      kanbanProjection: { mode: 'run_card', createFor: 'findings_only' },
    })
    await service.runNow('daily-check')

    await Promise.resolve(notificationListeners[0]!({
      method: 'turn/completed',
      params: { threadId: 'thread-1', turnId: 'turn_1' },
      atIso: new Date().toISOString(),
    }))
    const completed = (await service.listRuns('daily-check'))[0]!
    const tasks = await listKanbanTasks(taskService)

    expect(completed).toMatchObject({
      state: 'completed_no_findings',
      kanbanTaskId: null,
    })
    expect(tasks).toEqual([])
  })

  it('classifies only the completed turn when projecting runs', async () => {
    const { taskService, kanbanProjection } = await createKanbanProjectionHarness()
    const { codexHomeDir, service, notificationListeners } = await createHarness({
      kanbanProjection,
      readThreadResponse: {
        thread: {
          turns: [
            {
              turn_id: 'turn_1',
              items: [{ type: 'agentMessage', text: 'No findings from the completed automation turn.' }],
            },
            {
              id: 'unrelated_later_turn',
              items: [{ type: 'agentMessage', text: 'RESULT: FINDINGS\n- This belongs to a different turn' }],
            },
          ],
        },
      },
    })
    await writeNative(codexHomeDir, 'daily-check-dir', nativeRecord, {
      runMode: 'chat',
      kanbanProjection: { mode: 'run_card', createFor: 'findings_only' },
    })
    await service.runNow('daily-check')

    await Promise.resolve(notificationListeners[0]!({
      method: 'turn/completed',
      params: { threadId: 'thread-1', turnId: 'turn_1' },
      atIso: new Date().toISOString(),
    }))
    const completed = (await service.listRuns('daily-check'))[0]!
    const tasks = await listKanbanTasks(taskService)

    expect(completed).toMatchObject({
      state: 'completed_no_findings',
      findings: false,
      kanbanTaskId: null,
    })
    expect(tasks).toEqual([])
  })

  it('does not fall back to unrelated turns when the completed turn is missing from thread reads', async () => {
    const { taskService, kanbanProjection } = await createKanbanProjectionHarness()
    const { codexHomeDir, service, notificationListeners } = await createHarness({
      kanbanProjection,
      readThreadResponse: {
        thread: {
          turns: [
            {
              id: 'unrelated_later_turn',
              items: [{ type: 'agentMessage', text: 'RESULT: FINDINGS\n- This belongs to a different turn' }],
            },
          ],
        },
      },
    })
    await writeNative(codexHomeDir, 'daily-check-dir', nativeRecord, {
      runMode: 'chat',
      kanbanProjection: { mode: 'run_card', createFor: 'findings_only' },
    })
    await service.runNow('daily-check')

    await Promise.resolve(notificationListeners[0]!({
      method: 'turn/completed',
      params: { threadId: 'thread-1', turnId: 'turn_1' },
      atIso: new Date().toISOString(),
    }))
    const completed = (await service.listRuns('daily-check'))[0]!
    const tasks = await listKanbanTasks(taskService)

    expect(completed).toMatchObject({
      state: 'completed_no_findings',
      resultSummary: '',
      kanbanTaskId: null,
    })
    await expect(readFile(completed.logPath, 'utf8')).resolves.toContain('thread/read response did not include completed turn turn_1')
    expect(tasks).toEqual([])
  })

  it('does not fall back to unrelated turns when the completed turn has no assistant text', async () => {
    const { taskService, kanbanProjection } = await createKanbanProjectionHarness()
    const { codexHomeDir, service, notificationListeners } = await createHarness({
      kanbanProjection,
      readThreadResponse: {
        thread: {
          turns: [
            {
              id: 'turn_1',
              items: [{ type: 'userMessage', text: 'Original automation prompt' }],
            },
            {
              id: 'unrelated_later_turn',
              items: [{ type: 'agentMessage', text: 'RESULT: FINDINGS\n- This belongs to a different turn' }],
            },
          ],
        },
      },
    })
    await writeNative(codexHomeDir, 'daily-check-dir', nativeRecord, {
      runMode: 'chat',
      kanbanProjection: { mode: 'run_card', createFor: 'findings_only' },
    })
    await service.runNow('daily-check')

    await Promise.resolve(notificationListeners[0]!({
      method: 'turn/completed',
      params: { threadId: 'thread-1', turnId: 'turn_1' },
      atIso: new Date().toISOString(),
    }))
    const completed = (await service.listRuns('daily-check'))[0]!
    const tasks = await listKanbanTasks(taskService)

    expect(completed).toMatchObject({
      state: 'completed_no_findings',
      resultSummary: '',
      kanbanTaskId: null,
    })
    expect(tasks).toEqual([])
  })

  it('ignores non-assistant message items in the completed turn', async () => {
    const { taskService, kanbanProjection } = await createKanbanProjectionHarness()
    const { codexHomeDir, service, notificationListeners } = await createHarness({
      kanbanProjection,
      readThreadResponse: {
        thread: {
          turns: [
            {
              id: 'turn_1',
              items: [
                { type: 'message', role: 'user', content: 'RESULT: FINDINGS\n- User prompt text should not classify the run' },
                { type: 'message', role: 'system', content: 'RESULT: FINDINGS\n- System text should not classify the run' },
              ],
            },
          ],
        },
      },
    })
    await writeNative(codexHomeDir, 'daily-check-dir', nativeRecord, {
      runMode: 'chat',
      kanbanProjection: { mode: 'run_card', createFor: 'findings_only' },
    })
    await service.runNow('daily-check')

    await Promise.resolve(notificationListeners[0]!({
      method: 'turn/completed',
      params: { threadId: 'thread-1', turnId: 'turn_1' },
      atIso: new Date().toISOString(),
    }))
    const completed = (await service.listRuns('daily-check'))[0]!
    const tasks = await listKanbanTasks(taskService)

    expect(completed).toMatchObject({
      state: 'completed_no_findings',
      resultSummary: '',
      kanbanTaskId: null,
    })
    expect(tasks).toEqual([])
  })

  it('projects failed completion runs for failures_only run cards', async () => {
    const { taskService, kanbanProjection } = await createKanbanProjectionHarness()
    const { codexHomeDir, service, notificationListeners } = await createHarness({
      kanbanProjection,
      readThreadError: new Error('thread read unavailable'),
    })
    await writeNative(codexHomeDir, 'daily-check-dir', nativeRecord, {
      runMode: 'chat',
      kanbanProjection: { mode: 'run_card', createFor: 'failures_only' },
    })
    const first = await service.runNow('daily-check')

    await Promise.resolve(notificationListeners[0]!({
      method: 'turn/completed',
      params: { threadId: 'thread-1', turnId: 'turn_1' },
      atIso: new Date().toISOString(),
    }))
    const failed = (await service.listRuns('daily-check'))[0]!
    const tasks = await listKanbanTasks(taskService)

    expect(failed).toMatchObject({
      id: first.id,
      state: 'failed',
      errorMessage: 'thread read unavailable',
      kanbanTaskId: expect.any(String),
    })
    expect(tasks).toHaveLength(1)
    expect(tasks[0]).toMatchObject({
      id: failed.kanbanTaskId,
      title: 'Automation finding: Daily Check',
      status: 'backlog',
      runState: 'idle',
      currentRunId: '',
      runIds: [],
    })
    expect(tasks[0].description).toContain('Run state: failed')
  })

  it('keeps terminal run state when Kanban projection fails and records projection diagnostics', async () => {
    const projectionError = new Error('kanban write failed')
    const kanbanProjection = {
      projectDefinition: vi.fn(async () => ({ taskId: null })),
      projectRun: vi.fn(async () => {
        throw projectionError
      }),
      validateTask: vi.fn(async () => {}),
    } as unknown as AutomationKanbanProjectionService
    const { codexHomeDir, service, notificationListeners } = await createHarness({
      kanbanProjection,
      readThreadResponse: {
        thread: {
          turns: [
            {
              id: 'turn_1',
              items: [{ type: 'agentMessage', text: 'RESULT: FINDINGS\n- Disk is full' }],
            },
          ],
        },
      },
    })
    await writeNative(codexHomeDir, 'daily-check-dir', nativeRecord, {
      runMode: 'chat',
      kanbanProjection: { mode: 'run_card', createFor: 'findings_only' },
    })
    await service.runNow('daily-check')

    await Promise.resolve(notificationListeners[0]!({
      method: 'turn/completed',
      params: { threadId: 'thread-1', turnId: 'turn_1' },
      atIso: new Date().toISOString(),
    }))
    const completed = (await service.listRuns('daily-check'))[0]!

    expect(completed).toMatchObject({
      state: 'completed_with_findings',
      kanbanTaskId: null,
      errorMessage: null,
    })
    await expect(readFile(completed.eventsPath, 'utf8')).resolves.toContain('automation_projection.failed')
    await expect(readFile(completed.eventsPath, 'utf8')).resolves.toContain('kanban write failed')
    await expect(readFile(completed.logPath, 'utf8')).resolves.toContain('Kanban projection failed: kanban write failed')
  })

  it('marks completion read failures as failed so later manual runs are not wedged', async () => {
    const { codexHomeDir, service, notificationListeners } = await createHarness({
      readThreadError: new Error('thread read unavailable'),
    })
    await writeNative(codexHomeDir, 'daily-check-dir', nativeRecord, { runMode: 'chat' })
    const first = await service.runNow('daily-check')

    await Promise.resolve(notificationListeners[0]!({
      method: 'turn/completed',
      params: { threadId: 'thread-1', turnId: 'turn_1' },
      atIso: new Date().toISOString(),
    }))
    const failed = (await service.listRuns('daily-check'))[0]!
    const second = await service.runNow('daily-check')

    expect(failed).toMatchObject({
      id: first.id,
      state: 'failed',
      errorMessage: 'thread read unavailable',
      findings: true,
      inboxTitle: 'Run failed',
      readAtIso: null,
      archivedAtIso: null,
    })
    expect(second.id).not.toBe(first.id)
  })

  it('fails active runs left by a previous service instance before starting a new manual run', async () => {
    const { codexHomeDir, service, bridge } = await createHarness()
    await writeNative(codexHomeDir, 'daily-check-dir', nativeRecord, { runMode: 'chat' })
    const orphaned = await service.runNow('daily-check')
    const restartedService = new AutomationsService({
      codexHomeDir,
      bridge,
      policy: enabledPolicy,
    })

    const next = await restartedService.runNow('daily-check')
    const runs = await restartedService.listRuns('daily-check')

    expect(next.id).not.toBe(orphaned.id)
    expect(runs.find((run) => run.id === orphaned.id)).toMatchObject({
      state: 'failed',
      errorMessage: 'Automation manual run was left active by a previous server session',
      findings: true,
      inboxTitle: 'Run failed',
      readAtIso: null,
      archivedAtIso: null,
    })
  })

  it('projects orphaned failed manual runs for failures_only run cards before starting the next run', async () => {
    const { taskService, kanbanProjection } = await createKanbanProjectionHarness()
    const { codexHomeDir, service, bridge } = await createHarness({ kanbanProjection })
    await writeNative(codexHomeDir, 'daily-check-dir', nativeRecord, {
      runMode: 'chat',
      kanbanProjection: { mode: 'run_card', createFor: 'failures_only' },
    })
    const orphaned = await service.runNow('daily-check')
    const restartedService = new AutomationsService({
      codexHomeDir,
      bridge,
      policy: enabledPolicy,
      kanbanProjection,
    })

    await restartedService.runNow('daily-check')
    const runs = await restartedService.listRuns('daily-check')
    const failed = runs.find((run) => run.id === orphaned.id)!
    const tasks = await listKanbanTasks(taskService)

    expect(failed).toMatchObject({
      state: 'failed',
      errorMessage: 'Automation manual run was left active by a previous server session',
      kanbanTaskId: expect.any(String),
    })
    expect(tasks).toHaveLength(1)
    expect(tasks[0]).toMatchObject({
      id: failed.kanbanTaskId,
      title: 'Automation finding: Daily Check',
      runState: 'idle',
    })
  })

  it('rejects duplicate active runs and serializes concurrent starts per automation', async () => {
    const { codexHomeDir, service, rpcCalls } = await createHarness({ turnStartDelayMs: 20 })
    await writeNative(codexHomeDir, 'daily-check-dir', nativeRecord, { runMode: 'chat' })

    const results = await Promise.allSettled([
      service.runNow('daily-check'),
      service.runNow('daily-check'),
    ])
    await expect(service.runNow('daily-check')).rejects.toThrow('already has an active manual run')

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1)
    expect(rpcCalls.filter((call) => call.method === 'turn/start')).toHaveLength(1)
  })

  it('enforces the global active run limit for manual runs before bridge calls', async () => {
    const { codexHomeDir, service, rpcCalls } = await createHarness()
    await writeNative(codexHomeDir, 'daily-check-dir', nativeRecord, { runMode: 'chat' })
    await writeNative(codexHomeDir, 'second-check-dir', {
      ...nativeRecord,
      id: 'second-check',
      name: 'Second Check',
      targetThreadId: 'thread-2',
    }, { runMode: 'chat' })

    await service.runNow('daily-check')
    await expect(service.runNow('second-check')).rejects.toThrow('Automation global active run limit reached')

    expect(rpcCalls.filter((call) => call.method === 'turn/start')).toHaveLength(1)
  })

  it('recovers stale active runs before manual global-capacity checks when startup recovery has not run', async () => {
    const { codexHomeDir, service, bridge } = await createHarness()
    const firstAutomationDir = await writeNative(codexHomeDir, 'daily-check-dir', nativeRecord, { runMode: 'chat' })
    await writeNative(codexHomeDir, 'second-check-dir', {
      ...nativeRecord,
      id: 'second-check',
      name: 'Second Check',
      targetThreadId: 'thread-2',
    }, { runMode: 'chat' })
    const stale = await service.runNow('daily-check')
    const restartedService = new AutomationsService({
      codexHomeDir,
      bridge,
      policy: enabledPolicy,
    })

    try {
      const second = await restartedService.runNow('second-check')
      const failedStale = JSON.parse(await readFile(join(firstAutomationDir, 'runs', stale.id, 'run.json'), 'utf8')) as AutomationRun

      expect(second).toMatchObject({ automationId: 'second-check', state: 'running' })
      expect(failedStale).toMatchObject({
        id: stale.id,
        state: 'failed',
        errorMessage: 'Automation run was interrupted by a previous server session',
      })
    } finally {
      restartedService.dispose()
    }
  })

  it('serializes concurrent manual starts across automations before checking global capacity', async () => {
    const { codexHomeDir, service, rpcCalls } = await createHarness({ turnStartDelayMs: 20 })
    await writeNative(codexHomeDir, 'daily-check-dir', nativeRecord, { runMode: 'chat' })
    await writeNative(codexHomeDir, 'second-check-dir', {
      ...nativeRecord,
      id: 'second-check',
      name: 'Second Check',
      targetThreadId: 'thread-2',
    }, { runMode: 'chat' })

    const results = await Promise.allSettled([
      service.runNow('daily-check'),
      service.runNow('second-check'),
    ])

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1)
    expect(results.find((result) => result.status === 'rejected')).toMatchObject({
      reason: expect.objectContaining({ message: 'Automation global active run limit reached' }),
    })
    expect(rpcCalls.filter((call) => call.method === 'turn/start')).toHaveLength(1)
  })

  it('enforces the per-repo active run limit for manual local runs before bridge calls', async () => {
    const cwd = '/tmp/codexui-automation-local'
    const relaxedGlobalPolicy = { ...enabledPolicy, maxGlobalActiveRuns: 2, maxActiveRunsPerRepo: 1 } as unknown as KanbanExecutionPolicy
    const { codexHomeDir, service, rpcCalls } = await createHarness({
      policy: relaxedGlobalPolicy,
    })
    await writeNative(codexHomeDir, 'daily-check-dir', nativeRecord, { runMode: 'local', cwd })
    await writeNative(codexHomeDir, 'second-check-dir', {
      ...nativeRecord,
      id: 'second-check',
      name: 'Second Check',
      targetThreadId: null,
    }, { runMode: 'local', cwd })

    await service.runNow('daily-check')
    await expect(service.runNow('second-check')).rejects.toThrow(`Automation repo active run limit reached for ${cwd}`)

    expect(rpcCalls.filter((call) => call.method === 'thread/start')).toHaveLength(1)
  })

  it('runs cron automation records manually through the first-class API', async () => {
    const { codexHomeDir, service, rpcCalls } = await createHarness()
    await writeNative(codexHomeDir, 'cron-check-dir', { ...nativeRecord, id: 'cron-check', kind: 'cron' }, { runMode: 'chat' })

    const run = await service.runNow('cron-check')

    expect(run).toMatchObject({ automationId: 'cron-check', state: 'running', trigger: 'manual' })
    expect(rpcCalls.filter((call) => call.method === 'turn/start')).toHaveLength(1)
  })

  it('rejects disabled execution and blocked run profile policies before persistence or bridge calls', async () => {
    const disabled = await createHarness({ policy: { ...enabledPolicy, executionMode: 'disabled', executionEnabled: false } })
    await writeNative(disabled.codexHomeDir, 'daily-check-dir', nativeRecord, { runMode: 'chat' })
    await expect(disabled.service.runNow('daily-check')).rejects.toThrow('Automation execution is disabled')
    expect(disabled.rpcCalls).toEqual([])
    await expect(disabled.service.listRuns('daily-check')).resolves.toEqual([])

    const danger = await createHarness()
    await writeNative(danger.codexHomeDir, 'daily-check-dir', nativeRecord, {
      runMode: 'chat',
      runProfileId: FULL_ACCESS_CODEX_RUN_PROFILE_ID,
    })
    await expect(danger.service.runNow('daily-check')).rejects.toThrow('danger-full-access')
    expect(danger.rpcCalls).toEqual([])

    const neverProfile: CodexRunProfile = {
      id: 'approval-never',
      name: 'Approval never',
      description: '',
      model: '',
      reasoningEffort: 'medium',
      sandboxMode: 'workspace-write',
      approvalPolicy: 'never',
      networkAccess: false,
      writableRoots: [],
      createdAtIso: new Date().toISOString(),
      updatedAtIso: new Date().toISOString(),
    }
    await expect(danger.service.runNow('daily-check', { runProfiles: [neverProfile], runProfileId: 'approval-never' }))
      .rejects
      .toThrow('approval policy never')

    const network = await createHarness()
    await writeNative(network.codexHomeDir, 'daily-check-dir', nativeRecord, {
      runMode: 'chat',
      runProfileId: 'workspace-coding-network',
    })
    await expect(network.service.runNow('daily-check')).rejects.toThrow('network access')
    expect(network.rpcCalls).toEqual([])
  })

  it('lists persisted runs newest-first', async () => {
    const { codexHomeDir, service, notificationListeners } = await createHarness()
    await writeNative(codexHomeDir, 'daily-check-dir', nativeRecord, { runMode: 'chat' })
    const first = await service.runNow('daily-check')
    await Promise.resolve(notificationListeners[0]!({
      method: 'turn/completed',
      params: { threadId: 'thread-1', turnId: 'turn_1' },
      atIso: new Date().toISOString(),
    }))
    const second = await service.runNow('daily-check')

    const runs = await service.listRuns('daily-check')

    expect(runs.map((run) => run.id)).toEqual([second.id, first.id])
  })

  it('persists a queued scheduled run and advances scheduler state before bridge calls start', async () => {
    const dueAtIso = '2026-04-30T09:00:00.000Z'
    const nextDueAtIso = '2026-05-01T09:00:00.000Z'
    let inspectedBeforeBridge = false
    let automationDir = ''
    const { codexHomeDir, service, rpcCalls } = await createHarness({
      beforeRpc: async () => {
        if (inspectedBeforeBridge) return
        inspectedBeforeBridge = true
        expect(rpcCalls).toEqual([])
        const runDirs = await readdir(join(automationDir, 'runs'))
        expect(runDirs).toHaveLength(1)
        const queuedRun = JSON.parse(await readFile(join(automationDir, 'runs', runDirs[0]!, 'run.json'), 'utf8')) as AutomationRun
        const scheduler = JSON.parse(await readFile(join(automationDir, 'scheduler.json'), 'utf8')) as AutomationSchedulerState

        expect(queuedRun).toMatchObject({
          trigger: 'schedule',
          state: 'starting',
          dueAtIso,
          nextDueAtIso,
          startedAtIso: expect.any(String),
        })
        await expect(readFile(queuedRun.eventsPath, 'utf8')).resolves.toContain('scheduled_run.queued')
        expect(scheduler).toMatchObject({
          lastDueAtIso: dueAtIso,
          nextDueAtIso,
          lastScheduledRunId: queuedRun.id,
        })
        expect(scheduler.lastEvaluatedAtIso).toEqual(expect.any(String))
      },
    })
    automationDir = await writeNative(codexHomeDir, 'daily-check-dir', nativeRecord, { runMode: 'chat' })
    await writeScheduler(automationDir, { nextDueAtIso: dueAtIso })

    const run = await service.runScheduled('daily-check', { dueAtIso, nextDueAtIso })
    const storedRun = JSON.parse(await readFile(join(automationDir, 'runs', run.id, 'run.json'), 'utf8')) as AutomationRun

    expect(inspectedBeforeBridge).toBe(true)
    expect(run).toMatchObject({
      trigger: 'schedule',
      state: 'running',
      dueAtIso,
      nextDueAtIso,
      threadId: 'thread-1',
      turnId: 'turn_1',
    })
    expect(storedRun).toMatchObject({ id: run.id, trigger: 'schedule', state: 'running' })
    expect(rpcCalls.map((call) => call.method)).toEqual(['thread/resume', 'turn/start'])
    await expect(readFile(storedRun.eventsPath, 'utf8')).resolves.toContain('scheduled_run.queued')
    await expect(readFile(storedRun.logPath, 'utf8')).resolves.toContain('Scheduled run queued')
  })

  it('does not advance scheduler state if scheduled run queue persistence fails', async () => {
    const { codexHomeDir, service, rpcCalls } = await createHarness()
    const automationDir = await writeNative(codexHomeDir, 'daily-check-dir', nativeRecord, { runMode: 'chat' })
    const initialScheduler = await writeScheduler(automationDir)
    await writeFile(join(automationDir, 'runs'), 'not a directory', 'utf8')

    await expect(service.runScheduled('daily-check', {
      dueAtIso: '2026-04-30T09:00:00.000Z',
      nextDueAtIso: '2026-05-01T09:00:00.000Z',
    })).rejects.toThrow()
    const scheduler = JSON.parse(await readFile(join(automationDir, 'scheduler.json'), 'utf8')) as AutomationSchedulerState

    expect(scheduler).toEqual(initialScheduler)
    expect(rpcCalls).toEqual([])
  })

  it('marks scheduled runs failed when scheduler reservation persistence fails after run creation', async () => {
    const { codexHomeDir, service, rpcCalls } = await createHarness()
    const automationDir = await writeNative(codexHomeDir, 'daily-check-dir', nativeRecord, { runMode: 'chat' })
    await writeScheduler(automationDir)
    await rm(join(automationDir, 'scheduler.json'))
    await mkdir(join(automationDir, 'scheduler.json'))

    await expect(service.runScheduled('daily-check', {
      dueAtIso: '2026-04-30T09:00:00.000Z',
      nextDueAtIso: '2026-05-01T09:00:00.000Z',
    })).rejects.toThrow()
    const runs = await service.listRuns('daily-check')

    expect(runs).toHaveLength(1)
    expect(runs[0]).toMatchObject({
      trigger: 'schedule',
      state: 'failed',
      findings: true,
      inboxTitle: 'Run failed',
    })
    await expect(readFile(runs[0]!.eventsPath, 'utf8')).resolves.toContain('scheduled_run.failed')
    expect(rpcCalls).toEqual([])
  })

  it('rejects scheduled and manual starts while an active scheduled run exists', async () => {
    const { codexHomeDir, service } = await createHarness()
    const automationDir = await writeNative(codexHomeDir, 'daily-check-dir', nativeRecord, { runMode: 'chat' })
    await writeScheduler(automationDir)

    const first = await service.runScheduled('daily-check', {
      dueAtIso: '2026-04-30T09:00:00.000Z',
      nextDueAtIso: '2026-05-01T09:00:00.000Z',
    })

    await expect(service.runScheduled('daily-check', {
      dueAtIso: '2026-05-01T09:00:00.000Z',
      nextDueAtIso: '2026-05-02T09:00:00.000Z',
    })).rejects.toThrow('already has an active scheduled run')
    await expect(service.runNow('daily-check')).rejects.toThrow('already has an active scheduled run')
    expect((await service.listRuns('daily-check'))[0]).toMatchObject({ id: first.id, state: 'running' })
  })

  it('recovers stale scheduled runs for the same automation before a manual start', async () => {
    const { codexHomeDir, service, bridge } = await createHarness()
    const automationDir = await writeNative(codexHomeDir, 'daily-check-dir', nativeRecord, { runMode: 'chat' })
    await writeScheduler(automationDir)
    const stale = await service.runScheduled('daily-check', {
      dueAtIso: '2026-04-30T09:00:00.000Z',
      nextDueAtIso: '2026-05-01T09:00:00.000Z',
    })
    const restartedService = new AutomationsService({
      codexHomeDir,
      bridge,
      policy: enabledPolicy,
    })

    try {
      const next = await restartedService.runNow('daily-check')
      const runs = await restartedService.listRuns('daily-check')

      expect(next.id).not.toBe(stale.id)
      expect(runs.find((run) => run.id === stale.id)).toMatchObject({
        state: 'failed',
        errorMessage: 'Automation run was interrupted by a previous server session',
      })
    } finally {
      restartedService.dispose()
    }
  })

  it('recovers interrupted active runs and reconciles stale scheduler state from scheduled run snapshots', async () => {
    const { codexHomeDir, service } = await createHarness()
    const automationDir = await writeNative(codexHomeDir, 'daily-check-dir', nativeRecord, { runMode: 'chat' })
    await writeScheduler(automationDir, { nextDueAtIso: '2026-04-30T09:00:00.000Z' })
    const store = createAutomationRunStore(automationDir)
    const baseRun: Omit<AutomationRun, 'id' | 'trigger' | 'state' | 'dueAtIso' | 'nextDueAtIso' | 'runJsonPath' | 'eventsPath' | 'logPath'> = {
      automationId: 'daily-check',
      automationName: 'Daily Check',
      runMode: 'chat',
      promptSnapshot: 'Review the thread',
      scheduleSnapshot: { type: 'rrule', rrule: 'FREQ=DAILY;INTERVAL=1' },
      runProfileId: 'default',
      runProfileSnapshot: {
        id: 'default',
        name: 'Default',
        description: '',
        model: '',
        reasoningEffort: 'medium',
        sandboxMode: 'workspace-write',
        approvalPolicy: 'on-request',
        networkAccess: false,
        writableRoots: [],
        createdAtIso: '2026-04-30T08:00:00.000Z',
        updatedAtIso: '2026-04-30T08:00:00.000Z',
      },
      targetThreadId: 'thread-1',
      cwd: null,
      worktreePath: '/tmp/preserved-worktree',
      branchName: 'codexui/automation/preserved',
      threadId: null,
      turnId: null,
      resultSummary: null,
      errorMessage: null,
      findings: null,
      inboxTitle: '',
      inboxSummary: '',
      readAtIso: null,
      archivedAtIso: null,
      kanbanTaskId: null,
      reviewPacketId: null,
      proposalIds: [],
      createdAtIso: '2026-04-30T08:55:00.000Z',
      startedAtIso: null,
      completedAtIso: null,
      updatedAtIso: '2026-04-30T08:55:00.000Z',
    }
    const queuedScheduled: AutomationRun = {
      ...baseRun,
      id: 'scheduled-queued',
      trigger: 'schedule',
      state: 'queued',
      dueAtIso: '2026-04-30T09:00:00.000Z',
      nextDueAtIso: '2026-05-01T09:00:00.000Z',
      ...createAutomationRunPaths(automationDir, 'scheduled-queued'),
    }
    const startingManual: AutomationRun = {
      ...baseRun,
      id: 'manual-starting',
      trigger: 'manual',
      state: 'starting',
      dueAtIso: null,
      nextDueAtIso: null,
      ...createAutomationRunPaths(automationDir, 'manual-starting'),
    }
    const runningManual: AutomationRun = {
      ...baseRun,
      id: 'manual-running',
      trigger: 'manual',
      state: 'running',
      dueAtIso: null,
      nextDueAtIso: null,
      startedAtIso: '2026-04-30T08:56:00.000Z',
      threadId: 'thread-1',
      turnId: 'turn-1',
      ...createAutomationRunPaths(automationDir, 'manual-running'),
    }
    await store.createRun(queuedScheduled)
    await store.createRun(startingManual)
    await store.createRun(runningManual)

    const result = await service.recoverInterruptedRuns()
    const secondResult = await service.recoverInterruptedRuns()
    const runs = await service.listRuns('daily-check')
    const scheduler = JSON.parse(await readFile(join(automationDir, 'scheduler.json'), 'utf8')) as AutomationSchedulerState

    expect(result).toEqual({ recovered: 3 })
    expect(secondResult).toEqual({ recovered: 0 })
    for (const runId of ['scheduled-queued', 'manual-starting', 'manual-running']) {
      expect(runs.find((run) => run.id === runId)).toMatchObject({
        state: 'failed',
        errorMessage: 'Automation run was interrupted by a previous server session',
        findings: true,
        inboxTitle: 'Run failed',
        readAtIso: null,
        archivedAtIso: null,
        completedAtIso: expect.any(String),
        worktreePath: '/tmp/preserved-worktree',
      })
      await expect(readFile(join(automationDir, 'runs', runId, 'events.jsonl'), 'utf8')).resolves.toContain('scheduler.recovered_failed')
      await expect(readFile(join(automationDir, 'runs', runId, 'run.log'), 'utf8')).resolves.toContain('Automation run was interrupted')
    }
    expect(scheduler).toMatchObject({
      lastDueAtIso: queuedScheduled.dueAtIso,
      nextDueAtIso: queuedScheduled.nextDueAtIso,
      lastScheduledRunId: queuedScheduled.id,
    })
  })

  it('does not recover runs owned by the current service while a start is in progress', async () => {
    let recoverDuringStart: Promise<{ recovered: number }> | null = null
    const { codexHomeDir, service } = await createHarness({
      turnStartDelayMs: 10,
      beforeRpc: (method) => {
        if (method === 'turn/start' && !recoverDuringStart) {
          recoverDuringStart = service.recoverInterruptedRuns()
        }
      },
    })
    await writeNative(codexHomeDir, 'daily-check-dir', nativeRecord, { runMode: 'chat' })

    const run = await service.runNow('daily-check')
    await expect(recoverDuringStart).resolves.toEqual({ recovered: 0 })
    const runs = await service.listRuns('daily-check')

    expect(runs).toHaveLength(1)
    expect(runs[0]).toMatchObject({ id: run.id, state: 'running' })
  })

  it('projects recovered interrupted runs for failures_only run cards', async () => {
    const { taskService, kanbanProjection } = await createKanbanProjectionHarness()
    const { codexHomeDir, service } = await createHarness({ kanbanProjection })
    const automationDir = await writeNative(codexHomeDir, 'daily-check-dir', nativeRecord, {
      runMode: 'chat',
      kanbanProjection: { mode: 'run_card', createFor: 'failures_only' },
    })
    const runId = 'manual-running'
    await createAutomationRunStore(automationDir).createRun({
      id: runId,
      automationId: 'daily-check',
      automationName: 'Daily Check',
      trigger: 'manual',
      runMode: 'chat',
      state: 'running',
      promptSnapshot: 'Review the thread',
      scheduleSnapshot: { type: 'rrule', rrule: 'FREQ=DAILY;INTERVAL=1' },
      dueAtIso: null,
      nextDueAtIso: null,
      runProfileId: 'default',
      runProfileSnapshot: {
        id: 'default',
        name: 'Default',
        description: '',
        model: '',
        reasoningEffort: 'medium',
        sandboxMode: 'workspace-write',
        approvalPolicy: 'on-request',
        networkAccess: false,
        writableRoots: [],
        createdAtIso: '2026-04-30T08:00:00.000Z',
        updatedAtIso: '2026-04-30T08:00:00.000Z',
      },
      targetThreadId: 'thread-1',
      cwd: null,
      worktreePath: null,
      branchName: null,
      threadId: 'thread-1',
      turnId: 'turn-1',
      resultSummary: null,
      errorMessage: null,
      findings: null,
      inboxTitle: '',
      inboxSummary: '',
      readAtIso: null,
      archivedAtIso: null,
      kanbanTaskId: null,
      reviewPacketId: null,
      proposalIds: [],
      createdAtIso: '2026-04-30T08:55:00.000Z',
      startedAtIso: '2026-04-30T08:56:00.000Z',
      completedAtIso: null,
      updatedAtIso: '2026-04-30T08:56:00.000Z',
      ...createAutomationRunPaths(automationDir, runId),
    })

    expect(await service.recoverInterruptedRuns()).toEqual({ recovered: 1 })
    expect(await service.recoverInterruptedRuns()).toEqual({ recovered: 0 })
    const failed = (await service.listRuns('daily-check')).find((run) => run.id === runId)!
    const tasks = await listKanbanTasks(taskService)

    expect(failed).toMatchObject({
      state: 'failed',
      errorMessage: 'Automation run was interrupted by a previous server session',
      kanbanTaskId: expect.any(String),
    })
    expect(tasks).toHaveLength(1)
    expect(tasks[0]).toMatchObject({
      id: failed.kanbanTaskId,
      title: 'Automation finding: Daily Check',
      runState: 'idle',
    })
  })

  it('does not move scheduler state backwards while recovering an older scheduled run', async () => {
    const { codexHomeDir, service } = await createHarness()
    const automationDir = await writeNative(codexHomeDir, 'daily-check-dir', nativeRecord, { runMode: 'chat' })
    const newerScheduler = await writeScheduler(automationDir, {
      nextDueAtIso: '2026-05-03T09:00:00.000Z',
      lastDueAtIso: '2026-05-02T09:00:00.000Z',
      lastScheduledRunId: 'newer-run',
    })
    const runId = 'older-scheduled'
    await createAutomationRunStore(automationDir).createRun({
      id: runId,
      automationId: 'daily-check',
      automationName: 'Daily Check',
      trigger: 'schedule',
      runMode: 'chat',
      state: 'queued',
      promptSnapshot: 'Review the thread',
      scheduleSnapshot: { type: 'rrule', rrule: 'FREQ=DAILY;INTERVAL=1' },
      dueAtIso: '2026-04-30T09:00:00.000Z',
      nextDueAtIso: '2026-05-01T09:00:00.000Z',
      runProfileId: 'default',
      runProfileSnapshot: {
        id: 'default',
        name: 'Default',
        description: '',
        model: '',
        reasoningEffort: 'medium',
        sandboxMode: 'workspace-write',
        approvalPolicy: 'on-request',
        networkAccess: false,
        writableRoots: [],
        createdAtIso: '2026-04-30T08:00:00.000Z',
        updatedAtIso: '2026-04-30T08:00:00.000Z',
      },
      targetThreadId: 'thread-1',
      cwd: null,
      worktreePath: null,
      branchName: null,
      threadId: null,
      turnId: null,
      resultSummary: null,
      errorMessage: null,
      findings: null,
      inboxTitle: '',
      inboxSummary: '',
      readAtIso: null,
      archivedAtIso: null,
      kanbanTaskId: null,
      reviewPacketId: null,
      proposalIds: [],
      createdAtIso: '2026-04-30T08:55:00.000Z',
      startedAtIso: null,
      completedAtIso: null,
      updatedAtIso: '2026-04-30T08:55:00.000Z',
      ...createAutomationRunPaths(automationDir, runId),
    })

    expect(await service.recoverInterruptedRuns()).toEqual({ recovered: 1 })
    const scheduler = JSON.parse(await readFile(join(automationDir, 'scheduler.json'), 'utf8')) as AutomationSchedulerState

    expect(scheduler.nextDueAtIso).toBe(newerScheduler.nextDueAtIso)
    expect(scheduler.lastDueAtIso).toBe(newerScheduler.lastDueAtIso)
    expect(scheduler.lastScheduledRunId).toBe(newerScheduler.lastScheduledRunId)
  })
})

function readRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}
