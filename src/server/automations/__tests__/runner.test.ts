import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AutomationRun } from '../../../types/automations'
import { FULL_ACCESS_CODEX_RUN_PROFILE_ID, type CodexRunProfile } from '../../../types/execution'
import type { KanbanExecutionPolicy } from '../../../types/kanban'
import type { CodexBridgeNotification, CodexBridgeRuntime } from '../../codexAppServerBridge'
import { MANAGED_WORKTREE_LOCK_FILENAME } from '../../workspaces/worktreeLocks'
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
  status: 'ACTIVE',
  targetThreadId: 'thread-1',
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
} = {}) {
  const codexHomeDir = await mkdtemp(join(tmpdir(), 'codexui-automation-runner-'))
  codexHomeDirs.push(codexHomeDir)
  const rpcCalls: Array<{ method: string; params: unknown }> = []
  const notificationListeners: Array<(notification: CodexBridgeNotification) => void> = []
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
        return { turn: { id: `turn_${turnStartCount}` } } as T
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
      return () => {}
    }),
    dispose: vi.fn(),
  }
  const service = new AutomationsService({
    codexHomeDir,
    bridge,
    policy: options.policy ?? enabledPolicy,
  })
  return { codexHomeDir, service, bridge, rpcCalls, notificationListeners }
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
    })
    expect(failed.branchName).toMatch(/^codexui\/automation\/daily-check-/u)
    expect(worktreeList).toContain(failed.worktreePath)
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
    })
    expect(second.id).not.toBe(first.id)
    expect(rpcCalls.map((call) => call.method)).toEqual(['thread/resume', 'turn/start', 'thread/read', 'thread/resume', 'turn/start'])
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
