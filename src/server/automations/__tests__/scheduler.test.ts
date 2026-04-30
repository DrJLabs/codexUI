import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AutomationRun } from '../../../types/automations'
import type { CodexRunProfile } from '../../../types/execution'
import type { KanbanExecutionPolicy } from '../../../types/kanban'
import type { CodexBridgeNotification, CodexBridgeRuntime } from '../../codexAppServerBridge'
import { serializeAutomationToml, type ThreadAutomationRecord } from '../nativeStore'
import { createAutomationRunPaths, createAutomationRunStore } from '../runStore'
import { AutomationScheduler } from '../scheduler'
import type { AutomationSchedulerState } from '../schedulerStore'
import { AutomationsService } from '../service'

const codexHomeDirs: string[] = []

const enabledPolicy = {
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
  maxGlobalActiveRuns: 10,
  maxActiveRunsPerRepo: 10,
  maxActiveRunsPerTask: 1,
} as unknown as KanbanExecutionPolicy

const runProfileSnapshot: CodexRunProfile = {
  id: 'full-access',
  description: 'test profile',
  name: 'Full access',
  model: '',
  reasoningEffort: 'medium',
  approvalPolicy: 'on-request',
  sandboxMode: 'workspace-write',
  networkAccess: false,
  writableRoots: [],
  createdAtIso: '2026-04-30T00:00:00.000Z',
  updatedAtIso: '2026-04-30T00:00:00.000Z',
}

const nativeRecord: ThreadAutomationRecord = {
  id: 'daily-check',
  kind: 'heartbeat',
  name: 'Daily Check',
  prompt: 'Review the thread',
  rrule: 'FREQ=DAILY;INTERVAL=1',
  status: 'ACTIVE',
  targetThreadId: 'thread-1',
  createdAtMs: Date.parse('2026-04-28T09:00:00.000Z'),
  updatedAtMs: Date.parse('2026-04-28T09:00:00.000Z'),
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
} = {}) {
  const codexHomeDir = await mkdtemp(join(tmpdir(), 'codexui-automation-scheduler-'))
  codexHomeDirs.push(codexHomeDir)
  const rpcCalls: Array<{ method: string; params: unknown }> = []
  const notificationListeners: Array<(notification: CodexBridgeNotification) => void> = []
  let threadStartCount = 0
  let turnStartCount = 0
  const bridge: CodexBridgeRuntime = {
    rpc: async <T = unknown>(method: string, params?: unknown) => {
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
        turnStartCount += 1
        return { turn: { id: `turn_${turnStartCount}` } } as T
      }
      if (method === 'thread/read') {
        return { thread: { turns: [] } } as T
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
    enableScheduler: true,
  })
  return { codexHomeDir, service, bridge, rpcCalls, notificationListeners }
}

async function writeNative(
  codexHomeDir: string,
  dirName: string,
  record: ThreadAutomationRecord,
  sidecar: Record<string, unknown> = {},
) {
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

async function writeFreshScheduler(
  service: AutomationsService,
  automationId: string,
  automationDir: string,
  state: Partial<AutomationSchedulerState> = {},
) {
  const current = await service.refreshSchedulerState(automationId, '2026-04-30T08:00:00.000Z')
  return await writeScheduler(automationDir, {
    scheduleHash: current.scheduleHash,
    unsupportedReason: current.unsupportedReason,
    ...state,
  })
}

async function writeActiveRun(automationDir: string, input: {
  id: string
  automationId: string
  automationName?: string
  runMode?: AutomationRun['runMode']
  cwd?: string | null
}) {
  const run: AutomationRun = {
    id: input.id,
    automationId: input.automationId,
    automationName: input.automationName ?? input.automationId,
    trigger: 'manual',
    runMode: input.runMode ?? 'chat',
    state: 'running',
    promptSnapshot: 'Prompt',
    scheduleSnapshot: { type: 'rrule', rrule: 'FREQ=DAILY;INTERVAL=1' },
    dueAtIso: null,
    nextDueAtIso: null,
    runProfileId: runProfileSnapshot.id,
    runProfileSnapshot,
    targetThreadId: 'thread-active',
    cwd: input.cwd ?? null,
    worktreePath: null,
    branchName: null,
    threadId: 'thread-active',
    turnId: input.id,
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
    ...createAutomationRunPaths(automationDir, input.id),
    createdAtIso: '2026-04-30T08:00:00.000Z',
    startedAtIso: '2026-04-30T08:00:00.000Z',
    completedAtIso: null,
    updatedAtIso: '2026-04-30T08:00:00.000Z',
  }
  await createAutomationRunStore(automationDir).createRun(run)
  return run
}

function readRecord(params: unknown): { threadId: string } {
  if (params && typeof params === 'object' && 'threadId' in params && typeof params.threadId === 'string') {
    return { threadId: params.threadId }
  }
  throw new Error('Missing threadId')
}

describe('AutomationScheduler', () => {
  it('scans persisted active definitions and starts one due scheduled run', async () => {
    const now = new Date('2026-04-30T10:00:00.000Z')
    const { codexHomeDir, service, rpcCalls } = await createHarness()
    const automationDir = await writeNative(codexHomeDir, 'daily-check-dir', nativeRecord)
    await writeFreshScheduler(service, 'daily-check', automationDir)

    await new AutomationScheduler({ service, now: () => now }).tick()

    const runs = await createAutomationRunStore(automationDir).listRuns()
    const schedulerState = JSON.parse(await readFile(join(automationDir, 'scheduler.json'), 'utf8')) as AutomationSchedulerState
    expect(runs).toHaveLength(1)
    expect(runs[0]).toMatchObject({
      automationId: 'daily-check',
      trigger: 'schedule',
      state: 'running',
      dueAtIso: '2026-04-30T09:00:00.000Z',
    })
    expect(Date.parse(schedulerState.nextDueAtIso ?? '')).toBeGreaterThan(now.getTime())
    expect(schedulerState.lastDueAtIso).toBe('2026-04-30T09:00:00.000Z')
    expect(schedulerState.lastScheduledRunId).toBe(runs[0]?.id)
    expect(rpcCalls.map((call) => call.method)).toEqual(['thread/resume', 'turn/start'])
  })

  it('skips paused definitions and unsupported monthly or yearly scheduler states', async () => {
    const { codexHomeDir, service, rpcCalls } = await createHarness()
    const pausedDir = await writeNative(codexHomeDir, 'paused-dir', {
      ...nativeRecord,
      id: 'paused-check',
      name: 'Paused Check',
      status: 'PAUSED',
      targetThreadId: 'thread-paused',
    })
    const monthlyDir = await writeNative(codexHomeDir, 'monthly-dir', {
      ...nativeRecord,
      id: 'monthly-check',
      name: 'Monthly Check',
      rrule: 'FREQ=MONTHLY;BYHOUR=9;BYMINUTE=0',
      targetThreadId: 'thread-monthly',
    })
    await writeFreshScheduler(service, 'paused-check', pausedDir, { automationId: 'paused-check', sourceDirName: 'paused-dir' })
    await writeFreshScheduler(service, 'monthly-check', monthlyDir, {
      automationId: 'monthly-check',
      sourceDirName: 'monthly-dir',
      nextDueAtIso: null,
      unsupportedReason: 'Scheduler execution for FREQ=MONTHLY is not implemented',
    })

    await new AutomationScheduler({ service, now: () => new Date('2026-04-30T10:00:00.000Z') }).tick()

    expect(await createAutomationRunStore(pausedDir).listRuns()).toEqual([])
    expect(await createAutomationRunStore(monthlyDir).listRuns()).toEqual([])
    expect(rpcCalls).toEqual([])
  })

  it('lazily initializes imported native automations before scheduling decisions', async () => {
    const now = new Date('2026-04-30T10:00:00.000Z')
    const { codexHomeDir, service } = await createHarness()
    const automationDir = await writeNative(codexHomeDir, 'daily-check-dir', nativeRecord)

    await new AutomationScheduler({ service, now: () => now }).tick()

    const schedulerState = JSON.parse(await readFile(join(automationDir, 'scheduler.json'), 'utf8')) as AutomationSchedulerState
    const runs = await createAutomationRunStore(automationDir).listRuns()
    expect(schedulerState.automationId).toBe('daily-check')
    expect(runs).toHaveLength(1)
    expect(runs[0]?.dueAtIso).toBe('2026-04-29T09:00:00.000Z')
    expect(Date.parse(schedulerState.nextDueAtIso ?? '')).toBeGreaterThan(now.getTime())
  })

  it('refreshes stale scheduler state before evaluating due work', async () => {
    const now = new Date('2026-04-30T10:00:00.000Z')
    const { codexHomeDir, service } = await createHarness()
    const automationDir = await writeNative(codexHomeDir, 'daily-check-dir', nativeRecord)
    await service.refreshSchedulerState('daily-check', '2026-04-29T08:00:00.000Z')
    await writeScheduler(automationDir, {
      scheduleHash: 'stale-hash',
      nextDueAtIso: '2026-04-30T09:00:00.000Z',
    })
    await writeFile(join(automationDir, 'automation.toml'), serializeAutomationToml({
      ...nativeRecord,
      rrule: 'FREQ=WEEKLY;BYDAY=FR;BYHOUR=9;BYMINUTE=0',
      updatedAtMs: Date.parse('2026-04-30T08:00:00.000Z'),
    }), 'utf8')

    await new AutomationScheduler({ service, now: () => now }).tick()

    const runs = await createAutomationRunStore(automationDir).listRuns()
    const schedulerState = JSON.parse(await readFile(join(automationDir, 'scheduler.json'), 'utf8')) as AutomationSchedulerState
    expect(runs).toEqual([])
    expect(schedulerState.scheduleHash).not.toBe('stale-hash')
    expect(schedulerState.nextDueAtIso).toBe('2026-05-01T09:00:00.000Z')
  })

  it('does not rewind the scheduler cursor after execution-only sidecar edits', async () => {
    const now = new Date('2026-04-30T10:00:00.000Z')
    const { codexHomeDir, service } = await createHarness()
    const automationDir = await writeNative(codexHomeDir, 'daily-check-dir', nativeRecord)
    await writeFreshScheduler(service, 'daily-check', automationDir, {
      nextDueAtIso: '2026-05-01T09:00:00.000Z',
    })
    await writeFile(join(automationDir, 'codexui.json'), `${JSON.stringify({ model: 'gpt-5.4' }, null, 2)}\n`, 'utf8')

    await new AutomationScheduler({ service, now: () => now }).tick()

    const runs = await createAutomationRunStore(automationDir).listRuns()
    const schedulerState = JSON.parse(await readFile(join(automationDir, 'scheduler.json'), 'utf8')) as AutomationSchedulerState
    expect(runs).toEqual([])
    expect(schedulerState.nextDueAtIso).toBe('2026-05-01T09:00:00.000Z')
  })

  it('keeps scheduling healthy automations when another scheduler state file is invalid', async () => {
    const now = new Date('2026-04-30T10:00:00.000Z')
    const { codexHomeDir, service } = await createHarness()
    const badDir = await writeNative(codexHomeDir, 'bad-dir', {
      ...nativeRecord,
      id: 'bad-check',
      name: 'Bad Check',
      targetThreadId: 'thread-bad',
    })
    const healthyDir = await writeNative(codexHomeDir, 'healthy-dir', {
      ...nativeRecord,
      id: 'healthy-check',
      name: 'Healthy Check',
      targetThreadId: 'thread-healthy',
    })
    await writeFile(join(badDir, 'scheduler.json'), '{not-valid-json', 'utf8')
    await writeFreshScheduler(service, 'healthy-check', healthyDir, {
      automationId: 'healthy-check',
      sourceDirName: 'healthy-dir',
    })

    await new AutomationScheduler({ service, now: () => now }).tick()

    const healthyRuns = await createAutomationRunStore(healthyDir).listRuns()
    const repairedBadScheduler = JSON.parse(await readFile(join(badDir, 'scheduler.json'), 'utf8')) as AutomationSchedulerState
    expect(repairedBadScheduler.nextDueAtIso).toEqual(expect.any(String))
    expect(healthyRuns).toHaveLength(1)
    expect(healthyRuns[0]).toMatchObject({ automationId: 'healthy-check', trigger: 'schedule' })
  })

  it('starts only one catch-up run per automation tick and advances next due beyond now', async () => {
    const now = new Date('2026-04-30T10:00:00.000Z')
    const { codexHomeDir, service } = await createHarness()
    const automationDir = await writeNative(codexHomeDir, 'daily-check-dir', {
      ...nativeRecord,
      rrule: 'FREQ=MINUTELY;INTERVAL=1',
    })
    await writeFreshScheduler(service, 'daily-check', automationDir, { nextDueAtIso: '2026-04-30T09:30:00.000Z' })

    await new AutomationScheduler({ service, now: () => now }).tick()

    const runs = await createAutomationRunStore(automationDir).listRuns()
    const schedulerState = JSON.parse(await readFile(join(automationDir, 'scheduler.json'), 'utf8')) as AutomationSchedulerState
    expect(runs).toHaveLength(1)
    expect(runs[0]?.dueAtIso).toBe('2026-04-30T09:30:00.000Z')
    expect(Date.parse(schedulerState.nextDueAtIso ?? '')).toBeGreaterThan(now.getTime())
  })

  it('requeues an incomplete scheduler reservation when the recorded run is missing', async () => {
    const now = new Date('2026-04-30T10:00:00.000Z')
    const { codexHomeDir, service } = await createHarness()
    const automationDir = await writeNative(codexHomeDir, 'daily-check-dir', nativeRecord)
    await writeFreshScheduler(service, 'daily-check', automationDir, {
      nextDueAtIso: '2026-05-01T09:00:00.000Z',
      lastDueAtIso: '2026-04-30T09:00:00.000Z',
      lastScheduledRunId: 'missing-run',
    })

    await new AutomationScheduler({ service, now: () => now }).tick()

    const runs = await createAutomationRunStore(automationDir).listRuns()
    const schedulerState = JSON.parse(await readFile(join(automationDir, 'scheduler.json'), 'utf8')) as AutomationSchedulerState
    expect(runs).toHaveLength(1)
    expect(runs[0]?.dueAtIso).toBe('2026-04-30T09:00:00.000Z')
    expect(schedulerState.lastScheduledRunId).toBe(runs[0]?.id)
    expect(Date.parse(schedulerState.nextDueAtIso ?? '')).toBeGreaterThan(now.getTime())
  })

  it('leaves next due unchanged when the global active run limit blocks scheduling', async () => {
    const policy = { ...enabledPolicy, maxGlobalActiveRuns: 1 } as unknown as KanbanExecutionPolicy
    const { codexHomeDir, service, rpcCalls } = await createHarness({ policy })
    const activeDir = await writeNative(codexHomeDir, 'active-dir', {
      ...nativeRecord,
      id: 'active-check',
      name: 'Active Check',
      targetThreadId: 'thread-active',
    })
    const dueDir = await writeNative(codexHomeDir, 'due-dir', {
      ...nativeRecord,
      id: 'due-check',
      name: 'Due Check',
      targetThreadId: 'thread-due',
    })
    await writeActiveRun(activeDir, { id: 'active-run', automationId: 'active-check' })
    await writeFreshScheduler(service, 'due-check', dueDir, { automationId: 'due-check', sourceDirName: 'due-dir' })

    await new AutomationScheduler({ service, now: () => new Date('2026-04-30T10:00:00.000Z') }).tick()

    const schedulerState = JSON.parse(await readFile(join(dueDir, 'scheduler.json'), 'utf8')) as AutomationSchedulerState
    expect(await createAutomationRunStore(dueDir).listRuns()).toEqual([])
    expect(schedulerState.nextDueAtIso).toBe('2026-04-30T09:00:00.000Z')
    expect(rpcCalls).toEqual([])
  })

  it('conservatively enforces per-repo active run limits across due local automations', async () => {
    const policy = { ...enabledPolicy, maxGlobalActiveRuns: 10, maxActiveRunsPerRepo: 1 } as unknown as KanbanExecutionPolicy
    const { codexHomeDir, service, rpcCalls } = await createHarness({ policy })
    const repo = join(codexHomeDir, 'repo')
    await mkdir(repo, { recursive: true })
    const firstDir = await writeNative(codexHomeDir, 'first-dir', {
      ...nativeRecord,
      id: 'first-check',
      name: 'First Check',
      targetThreadId: 'thread-first',
    }, { runMode: 'local', cwd: repo })
    const secondDir = await writeNative(codexHomeDir, 'second-dir', {
      ...nativeRecord,
      id: 'second-check',
      name: 'Second Check',
      targetThreadId: 'thread-second',
    }, { runMode: 'local', cwd: repo })
    await writeFreshScheduler(service, 'first-check', firstDir, { automationId: 'first-check', sourceDirName: 'first-dir' })
    await writeFreshScheduler(service, 'second-check', secondDir, { automationId: 'second-check', sourceDirName: 'second-dir' })

    await new AutomationScheduler({ service, now: () => new Date('2026-04-30T10:00:00.000Z') }).tick()

    const firstRuns = await createAutomationRunStore(firstDir).listRuns()
    const secondRuns = await createAutomationRunStore(secondDir).listRuns()
    const startedCount = firstRuns.length + secondRuns.length
    expect(startedCount).toBe(1)
    expect(rpcCalls.map((call) => call.method)).toEqual(['thread/start', 'turn/start'])
  })

  it('serializes overlapping ticks', async () => {
    const { codexHomeDir, service } = await createHarness()
    const automationDir = await writeNative(codexHomeDir, 'daily-check-dir', nativeRecord)
    await writeFreshScheduler(service, 'daily-check', automationDir)
    let releaseRun: () => void = () => {}
    const runStarted = new Promise<void>((resolve) => {
      const original = service.runScheduled.bind(service)
      vi.spyOn(service, 'runScheduled').mockImplementation(async (...args) => {
        resolve()
        await new Promise<void>((release) => {
          releaseRun = release
        })
        return await original(...args)
      })
    })
    const scheduler = new AutomationScheduler({ service, now: () => new Date('2026-04-30T10:00:00.000Z') })

    const firstTick = scheduler.tick()
    await runStarted
    const secondTick = scheduler.tick()
    await Promise.resolve()

    expect(service.runScheduled).toHaveBeenCalledTimes(1)
    releaseRun()
    await Promise.all([firstTick, secondTick])
    expect(service.runScheduled).toHaveBeenCalledTimes(1)
  })

  it('runs startup recovery before the first due scan and waits for delayed recovery', async () => {
    const { codexHomeDir, service, rpcCalls } = await createHarness()
    const automationDir = await writeNative(codexHomeDir, 'daily-check-dir', nativeRecord)
    await writeFreshScheduler(service, 'daily-check', automationDir)
    let releaseRecovery: () => void = () => {}
    const recoveryStarted = new Promise<void>((resolve) => {
      vi.spyOn(service, 'recoverInterruptedRuns').mockImplementation(async () => {
        resolve()
        await new Promise<void>((release) => {
          releaseRecovery = release
        })
        return { recovered: 0 }
      })
    })
    const scheduler = new AutomationScheduler({
      service,
      intervalMs: 60_000,
      now: () => new Date('2026-04-30T10:00:00.000Z'),
    })

    scheduler.start()
    await recoveryStarted
    const tickPromise = scheduler.tick()
    await Promise.resolve()
    expect(rpcCalls).toEqual([])

    releaseRecovery()
    await tickPromise
    scheduler.stop()

    expect(service.recoverInterruptedRuns).toHaveBeenCalledTimes(1)
    expect(rpcCalls.map((call) => call.method)).toEqual(['thread/resume', 'turn/start'])
  })
})
