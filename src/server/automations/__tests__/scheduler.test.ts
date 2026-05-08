import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AutomationRun } from '../../../types/automations'
import type { CodexRunProfile } from '../../../types/execution'
import type { AutomationExecutionPolicy } from '../policy'
import type { CodexBridgeNotification, CodexBridgeRuntime } from '../../codexAppServerBridge'
import { serializeAutomationToml, type ThreadAutomationRecord } from '../nativeStore'
import { createAutomationRunPaths, createAutomationRunStore } from '../runStore'
import { AutomationScheduler } from '../scheduler'
import { createAutomationSchedulerLeaseStore } from '../schedulerLease'
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
} as unknown as AutomationExecutionPolicy

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
  version: 1,
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
  localEnvironmentConfigPath: null,
  runMode: 'chat',
  cwd: null,
  cwds: [],
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
  policy?: AutomationExecutionPolicy
  turnStartDelayMs?: number
  threadReadById?: Record<string, unknown>
  projectlessHomeDir?: string
  availableModels?: string[]
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
        const threadId = readRecord(params).threadId
        const configured = options.threadReadById?.[threadId]
        if (configured instanceof Error) throw configured
        return (configured ?? { thread: { id: threadId, turns: [] } }) as T
      }
      if (method === 'model/list') {
        return {
          data: (options.availableModels ?? ['gpt-5.5']).map((id) => ({ id })),
          nextCursor: null,
        } as T
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
    projectlessHomeDir: options.projectlessHomeDir,
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
  state?: AutomationRun['state']
  startedAtIso?: string | null
  completedAtIso?: string | null
}) {
  const run: AutomationRun = {
    id: input.id,
    automationId: input.automationId,
    automationName: input.automationName ?? input.automationId,
    trigger: 'manual',
    runMode: input.runMode ?? 'chat',
    state: input.state ?? 'running',
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
    startedAtIso: input.startedAtIso ?? '2026-04-30T08:00:00.000Z',
    completedAtIso: input.completedAtIso ?? null,
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

function readTurnStartText(rpcCalls: Array<{ method: string; params: unknown }>): string {
  let turnStart: { method: string; params: unknown } | undefined
  for (let index = rpcCalls.length - 1; index >= 0; index -= 1) {
    if (rpcCalls[index].method === 'turn/start') {
      turnStart = rpcCalls[index]
      break
    }
  }
  const params = turnStart?.params
  if (!params || typeof params !== 'object' || !('input' in params) || !Array.isArray(params.input)) {
    throw new Error('Missing turn/start input')
  }
  const [firstInput] = params.input
  if (!firstInput || typeof firstInput !== 'object' || !('text' in firstInput) || typeof firstInput.text !== 'string') {
    throw new Error('Missing turn/start text')
  }
  return firstInput.text
}

function notifyHeartbeatRendererState(
  listeners: Array<(notification: CodexBridgeNotification) => void>,
  threadId: string,
  input: { eligible?: boolean; reason?: string | null } = {},
) {
  for (const listener of listeners) {
    listener({
      method: 'heartbeat-automation-thread-state-changed',
      params: {
        threadId,
        eligible: input.eligible ?? true,
        reason: input.reason ?? null,
      },
      atIso: '2026-04-30T09:00:00.000Z',
    })
  }
}

describe('AutomationScheduler', () => {
  it('includes Desktop cron automations as scheduler candidates', async () => {
    const { codexHomeDir, service } = await createHarness()
    await writeNative(codexHomeDir, 'cron-check-dir', {
      ...nativeRecord,
      id: 'cron-check',
      kind: 'cron',
      rrule: 'FREQ=HOURLY;INTERVAL=1',
      rrulePrefix: 'RRULE:',
      targetThreadId: null,
      executionEnvironment: 'worktree',
      runMode: 'worktree',
      cwd: '/tmp/project',
      cwds: ['/tmp/project'],
    })

    const entries = await service.listSchedulerEntries()

    expect(entries).toHaveLength(1)
    expect(entries[0].definition).toMatchObject({
      id: 'cron-check',
      kind: 'cron',
      runMode: 'worktree',
      cwd: '/tmp/project',
      cwds: ['/tmp/project'],
      schedule: {
        type: 'rrule',
        rrule: 'FREQ=HOURLY;INTERVAL=1',
        rawRrule: 'RRULE:FREQ=HOURLY;INTERVAL=1',
      },
    })
  })

  it('lists Desktop-deleted automations without scheduling them', async () => {
    const { codexHomeDir, service } = await createHarness()
    const automationDir = await writeNative(codexHomeDir, 'deleted-dir', {
      ...nativeRecord,
      id: 'deleted-check',
      status: 'DELETED',
      kind: 'cron',
      rrulePrefix: 'RRULE:',
      targetThreadId: null,
      executionEnvironment: 'local',
      runMode: 'local',
      cwd: '/tmp/project',
      cwds: ['/tmp/project'],
    })

    const definitions = await service.listDefinitions()
    const schedulerEntries = await service.listSchedulerEntries()

    expect(definitions).toHaveLength(1)
    expect(definitions[0]).toMatchObject({
      id: 'deleted-check',
      status: 'deleted',
      legacyStatus: 'DELETED',
    })
    expect(schedulerEntries).toEqual([])
    await expect(readFile(join(automationDir, 'automation.toml'), 'utf8')).resolves.toContain('status = "DELETED"')
  })

  it('does not run or revive Desktop-deleted automations', async () => {
    const { codexHomeDir, service } = await createHarness()
    await writeNative(codexHomeDir, 'deleted-dir', {
      ...nativeRecord,
      id: 'deleted-check',
      status: 'DELETED',
    })

    await expect(service.runNow('deleted-check')).rejects.toThrow('Deleted automations cannot be run')
    await expect(service.resumeDefinition('deleted-check')).rejects.toThrow('Deleted automations cannot be paused or resumed')
    await expect(service.patchDefinition('deleted-check', { name: 'Revived by stale client' })).rejects.toThrow('Deleted automations cannot be edited')
  })

  it('blocks manual heartbeat starts when the target thread is busy', async () => {
    const { codexHomeDir, service, rpcCalls, notificationListeners } = await createHarness({
      threadReadById: {
        'thread-1': { thread: { id: 'thread-1', turns: [{ id: 'turn-active', status: 'inProgress' }] } },
      },
    })
    const automationDir = await writeNative(codexHomeDir, 'daily-check-dir', nativeRecord)
    notifyHeartbeatRendererState(notificationListeners, 'thread-1')

    await expect(service.runNow('daily-check')).rejects.toThrow('Heartbeat target thread has an active turn')

    expect(await createAutomationRunStore(automationDir).listRuns()).toEqual([])
    expect(rpcCalls.map((call) => call.method)).toEqual(['config/read', 'thread/read'])
  })

  it('blocks scheduled heartbeat starts when the target thread is waiting for approval', async () => {
    const now = new Date('2026-04-30T10:00:00.000Z')
    const { codexHomeDir, service, rpcCalls, notificationListeners } = await createHarness({
      threadReadById: {
        'thread-1': { thread: { id: 'thread-1', pendingRequestState: 'approval', turns: [] } },
      },
    })
    const automationDir = await writeNative(codexHomeDir, 'daily-check-dir', nativeRecord)
    await writeFreshScheduler(service, 'daily-check', automationDir)
    notifyHeartbeatRendererState(notificationListeners, 'thread-1')

    await new AutomationScheduler({ service, now: () => now }).tick()

    const schedulerState = JSON.parse(await readFile(join(automationDir, 'scheduler.json'), 'utf8')) as AutomationSchedulerState
    expect(await createAutomationRunStore(automationDir).listRuns()).toEqual([])
    expect(Date.parse(schedulerState.nextDueAtIso ?? '')).toBeGreaterThan(now.getTime())
    expect(schedulerState.lastDueAtIso).toBe('2026-04-30T09:00:00.000Z')
    expect(schedulerState.lastScheduledRunId).toBeNull()
    expect(rpcCalls.map((call) => call.method)).toEqual(['config/read', 'thread/read'])
  })

  it('honors Desktop heartbeat renderer-state notifications before reading the target thread', async () => {
    const { codexHomeDir, service, rpcCalls, notificationListeners } = await createHarness()
    await writeNative(codexHomeDir, 'daily-check-dir', nativeRecord)
    notifyHeartbeatRendererState(notificationListeners, 'thread-1', {
      eligible: false,
      reason: 'Heartbeat renderer has not loaded an eligible collaboration mode',
    })

    await expect(service.runNow('daily-check')).rejects.toThrow('Heartbeat renderer has not loaded an eligible collaboration mode')

    expect(rpcCalls.map((call) => call.method)).toEqual(['config/read'])
  })

  it('treats renderer collaboration-mode blocks as authoritative even when copy mentions the thread', async () => {
    const { codexHomeDir, service, rpcCalls, notificationListeners } = await createHarness()
    await writeNative(codexHomeDir, 'daily-check-dir', nativeRecord)
    notifyHeartbeatRendererState(notificationListeners, 'thread-1', {
      eligible: false,
      reason: 'Thread is not in eligible collaboration mode',
    })

    await expect(service.runNow('daily-check')).rejects.toThrow('Thread is not in eligible collaboration mode')

    expect(rpcCalls.map((call) => call.method)).toEqual(['config/read'])
  })

  it('treats renderer mode-unavailable blocks as authoritative before transient state matching', async () => {
    const { codexHomeDir, service, rpcCalls, notificationListeners } = await createHarness()
    await writeNative(codexHomeDir, 'daily-check-dir', nativeRecord)
    notifyHeartbeatRendererState(notificationListeners, 'thread-1', {
      eligible: false,
      reason: 'Collaboration mode unavailable for heartbeat renderer',
    })

    await expect(service.runNow('daily-check')).rejects.toThrow('Collaboration mode unavailable for heartbeat renderer')

    expect(rpcCalls.map((call) => call.method)).toEqual(['config/read'])
  })

  it('wraps heartbeat turn input in the Desktop heartbeat envelope', async () => {
    const { codexHomeDir, service, rpcCalls, notificationListeners } = await createHarness()
    await writeNative(codexHomeDir, 'daily-check-dir', nativeRecord)
    notifyHeartbeatRendererState(notificationListeners, 'thread-1')

    await service.runNow('daily-check')

    const promptText = readTurnStartText(rpcCalls)
    expect(promptText).toMatch(/^<heartbeat>\n/)
    expect(promptText).toContain('  <automation_id>daily-check</automation_id>\n')
    expect(promptText).toMatch(/  <current_time_iso>\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z<\/current_time_iso>\n/)
    expect(promptText).toContain('  <instructions>\nReview the thread\n  </instructions>\n')
    expect(promptText.endsWith('</heartbeat>\n')).toBe(true)
  })

  it('prefixes cron turn input with Desktop automation memory metadata', async () => {
    const { codexHomeDir, service, rpcCalls } = await createHarness({ availableModels: ['gpt-5.5'] })
    const repo = join(codexHomeDir, 'repo')
    await mkdir(repo, { recursive: true })
    const automationDir = await writeNative(codexHomeDir, 'cron-check-dir', {
      ...nativeRecord,
      id: 'cron-check',
      kind: 'cron',
      name: 'Cron Check',
      prompt: 'Run the cron task',
      rrulePrefix: 'RRULE:',
      targetThreadId: null,
      executionEnvironment: 'local',
      runMode: 'local',
      cwd: repo,
      cwds: [repo],
    })
    await writeActiveRun(automationDir, {
      id: 'previous-cron-run',
      automationId: 'cron-check',
      automationName: 'Cron Check',
      runMode: 'local',
      cwd: repo,
      state: 'completed_no_findings',
      startedAtIso: '2026-04-30T09:00:00.000Z',
      completedAtIso: '2026-04-30T09:05:00.000Z',
    })

    await service.runNow('cron-check')

    const promptText = readTurnStartText(rpcCalls)
    const turnStart = rpcCalls.find((call) => call.method === 'turn/start')
    const turnStartParams = turnStart?.params as { sandboxPolicy?: { type: string; writableRoots?: string[] } } | undefined
    expect(promptText).toBe(`Automation: Cron Check
Automation ID: cron-check
Automation memory: ${automationDir}/memory.md
Last run: 2026-04-30T09:00:00.000Z (1777539600000)

Run the cron task`)
    expect(promptText).not.toContain('<heartbeat>')
    expect(turnStartParams?.sandboxPolicy).toMatchObject({
      type: 'workspaceWrite',
      writableRoots: [repo, automationDir],
    })
  })

  it('starts one scheduled cron run for each configured Desktop cwd', async () => {
    const { codexHomeDir, service, rpcCalls } = await createHarness()
    const repoOne = join(codexHomeDir, 'repo-one')
    const repoTwo = join(codexHomeDir, 'repo-two')
    await mkdir(repoOne, { recursive: true })
    await mkdir(repoTwo, { recursive: true })
    const automationDir = await writeNative(codexHomeDir, 'multi-cwd-dir', {
      ...nativeRecord,
      id: 'multi-cwd',
      kind: 'cron',
      name: 'Multi cwd',
      prompt: 'Run the cron task',
      rrulePrefix: 'RRULE:',
      targetThreadId: null,
      executionEnvironment: 'local',
      runMode: 'local',
      cwd: repoOne,
      cwds: [repoOne, repoTwo],
    })

    await service.runScheduled('multi-cwd', {
      dueAtIso: '2026-04-30T09:00:00.000Z',
      nextDueAtIso: '2026-04-30T10:00:00.000Z',
    })

    const runs = await createAutomationRunStore(automationDir).listRuns()
    expect(runs).toHaveLength(2)
    expect(runs.map((run) => run.cwd).sort()).toEqual([repoOne, repoTwo])
    expect(rpcCalls.filter((call) => call.method === 'thread/start').map((call) => (call.params as { cwd?: string }).cwd)).toEqual([
      repoOne,
      repoTwo,
    ])
    expect(rpcCalls.filter((call) => call.method === 'turn/start').map((call) => (call.params as { cwd?: string }).cwd)).toEqual([
      repoOne,
      repoTwo,
    ])
  })

  it('runs Desktop projectless cron automations in generated Documents/Codex folders', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-07T12:00:00.000Z'))
    try {
      const projectlessHomeDir = await mkdtemp(join(tmpdir(), 'codexui-projectless-home-'))
      codexHomeDirs.push(projectlessHomeDir)
      const { codexHomeDir, service, rpcCalls } = await createHarness({ projectlessHomeDir })
      const automationDir = await writeNative(codexHomeDir, 'projectless-dir', {
        ...nativeRecord,
        id: 'projectless-cron',
        kind: 'cron',
        name: 'Projectless cron',
        prompt: 'Investigate the bug report',
        rrulePrefix: 'RRULE:',
        targetThreadId: null,
        executionEnvironment: 'worktree',
        runMode: 'worktree',
        cwd: '~',
        cwds: ['~'],
      })

      await service.runScheduled('projectless-cron', {
        dueAtIso: '2026-05-07T12:00:00.000Z',
        nextDueAtIso: '2026-05-07T13:00:00.000Z',
      })

      const expectedCwd = join(projectlessHomeDir, 'Documents', 'Codex', '2026-05-07', 'investigate-the-bug-report')
      const runs = await createAutomationRunStore(automationDir).listRuns()
      const threadStartParams = rpcCalls.find((call) => call.method === 'thread/start')?.params as {
        cwd?: string
        developerInstructions?: string
      } | undefined
      const turnStartParams = rpcCalls.find((call) => call.method === 'turn/start')?.params as { cwd?: string } | undefined

      expect(runs).toHaveLength(1)
      expect(runs[0]).toMatchObject({
        runMode: 'local',
        cwd: expectedCwd,
      })
      expect(threadStartParams).toMatchObject({
        cwd: expectedCwd,
        developerInstructions: expect.stringContaining('### Projectless Chat'),
      })
      expect(threadStartParams?.developerInstructions).toContain(`put them in ${expectedCwd}`)
      expect(turnStartParams?.cwd).toBe(expectedCwd)
      expect(rpcCalls.filter((call) => call.method === 'config/read').map((call) => call.params)).toEqual([
        { includeLayers: true },
        { includeLayers: true, cwd: expectedCwd },
      ])
      await expect(readFile(join(automationDir, 'automation.toml'), 'utf8')).resolves.toContain('cwds = ["~"]')
    } finally {
      vi.useRealTimers()
    }
  })

  it('falls back to local execution for Desktop worktree automations outside git repositories', async () => {
    const { codexHomeDir, service, rpcCalls } = await createHarness()
    const plainDirectory = join(codexHomeDir, 'plain-directory')
    await mkdir(plainDirectory, { recursive: true })
    const automationDir = await writeNative(codexHomeDir, 'plain-worktree-dir', {
      ...nativeRecord,
      id: 'plain-worktree-cron',
      kind: 'cron',
      name: 'Plain worktree cron',
      rrulePrefix: 'RRULE:',
      targetThreadId: null,
      executionEnvironment: 'worktree',
      runMode: 'worktree',
      cwd: plainDirectory,
      cwds: [plainDirectory],
    })

    await service.runScheduled('plain-worktree-cron', {
      dueAtIso: '2026-05-07T12:00:00.000Z',
      nextDueAtIso: '2026-05-07T13:00:00.000Z',
    })

    const runs = await createAutomationRunStore(automationDir).listRuns()
    const threadStartParams = rpcCalls.find((call) => call.method === 'thread/start')?.params as { cwd?: string } | undefined
    const turnStartParams = rpcCalls.find((call) => call.method === 'turn/start')?.params as { cwd?: string } | undefined

    expect(runs).toHaveLength(1)
    expect(runs[0]).toMatchObject({
      runMode: 'local',
      cwd: plainDirectory,
      worktreePath: null,
      branchName: null,
    })
    expect(threadStartParams?.cwd).toBe(plainDirectory)
    expect(turnStartParams?.cwd).toBe(plainDirectory)
  })

  it('marks scheduled cron automations without cwds unsupported instead of starting runs', async () => {
    const { codexHomeDir, service, rpcCalls } = await createHarness()
    const automationDir = await writeNative(codexHomeDir, 'empty-cwds-dir', {
      ...nativeRecord,
      id: 'empty-cwds',
      kind: 'cron',
      name: 'Empty cwds',
      prompt: 'Run the cron task',
      rrulePrefix: 'RRULE:',
      targetThreadId: null,
      executionEnvironment: 'local',
      runMode: 'local',
      cwd: null,
      cwds: [],
    })

    const schedulerState = await service.refreshSchedulerState('empty-cwds', '2026-04-30T08:00:00.000Z')
    const state = await service.listState()

    expect(schedulerState).toMatchObject({
      nextDueAtIso: null,
      unsupportedReason: 'Scheduled run skipped: no folders configured',
    })
    expect(state.diagnostics).toEqual([
      expect.objectContaining({
        automationId: 'empty-cwds',
        message: 'Scheduled run skipped: no folders configured',
      }),
    ])
    await expect(service.runScheduled('empty-cwds', {
      dueAtIso: '2026-04-30T09:00:00.000Z',
      nextDueAtIso: '2026-04-30T10:00:00.000Z',
    })).rejects.toThrow('Scheduled run skipped: no folders configured')
    expect(await createAutomationRunStore(automationDir).listRuns()).toEqual([])
    expect(rpcCalls.filter((call) => call.method === 'thread/start' || call.method === 'turn/start')).toEqual([])
  })

  it('revalidates stale renderer busy state before scheduled heartbeat starts', async () => {
    const now = new Date('2026-04-30T10:00:00.000Z')
    const { codexHomeDir, service, rpcCalls, notificationListeners } = await createHarness({
      threadReadById: {
        'thread-1': { thread: { id: 'thread-1', turns: [{ id: 'turn-done', status: 'completed' }] } },
      },
    })
    const automationDir = await writeNative(codexHomeDir, 'daily-check-dir', nativeRecord)
    await writeFreshScheduler(service, 'daily-check', automationDir)
    notifyHeartbeatRendererState(notificationListeners, 'thread-1', {
      eligible: false,
      reason: 'Heartbeat target thread is busy',
    })

    await new AutomationScheduler({ service, now: () => now }).tick()

    const runs = await createAutomationRunStore(automationDir).listRuns()
    expect(runs).toHaveLength(1)
    expect(runs[0]).toMatchObject({ automationId: 'daily-check', trigger: 'schedule' })
    expect(rpcCalls.map((call) => call.method)).toEqual(['config/read', 'thread/read', 'thread/resume', 'turn/start'])
  })

  it('revalidates stale renderer pending-input state before scheduled heartbeat starts', async () => {
    const now = new Date('2026-04-30T10:00:00.000Z')
    const { codexHomeDir, service, rpcCalls, notificationListeners } = await createHarness({
      threadReadById: {
        'thread-1': { thread: { id: 'thread-1', turns: [] } },
      },
    })
    const automationDir = await writeNative(codexHomeDir, 'daily-check-dir', nativeRecord)
    await writeFreshScheduler(service, 'daily-check', automationDir)
    notifyHeartbeatRendererState(notificationListeners, 'thread-1', {
      eligible: false,
      reason: 'Heartbeat target thread is waiting for user input',
    })

    await new AutomationScheduler({ service, now: () => now }).tick()

    const runs = await createAutomationRunStore(automationDir).listRuns()
    expect(runs).toHaveLength(1)
    expect(rpcCalls.map((call) => call.method)).toEqual(['config/read', 'thread/read', 'thread/resume', 'turn/start'])
  })

  it('reports a clear manual heartbeat error when the target thread cannot be read', async () => {
    const { codexHomeDir, service, notificationListeners } = await createHarness({
      threadReadById: {
        'thread-1': new Error('thread not found'),
      },
    })
    await writeNative(codexHomeDir, 'daily-check-dir', nativeRecord)
    notifyHeartbeatRendererState(notificationListeners, 'thread-1')

    await expect(service.runNow('daily-check')).rejects.toThrow('Heartbeat target thread is unavailable: thread not found')
  })

  it('reports a clear manual heartbeat error when renderer state has not loaded', async () => {
    const { codexHomeDir, service, rpcCalls } = await createHarness()
    const automationDir = await writeNative(codexHomeDir, 'daily-check-dir', nativeRecord)

    await expect(service.runNow('daily-check')).rejects.toThrow('Heartbeat renderer state has not loaded for target thread')

    expect(await createAutomationRunStore(automationDir).listRuns()).toEqual([])
    expect(rpcCalls.map((call) => call.method)).toEqual(['config/read'])
  })

  it('marks scheduled heartbeats unavailable until renderer state is published', async () => {
    const now = new Date('2026-04-30T10:00:00.000Z')
    const { codexHomeDir, service, rpcCalls } = await createHarness()
    const automationDir = await writeNative(codexHomeDir, 'daily-check-dir', nativeRecord)
    await writeFreshScheduler(service, 'daily-check', automationDir)

    await new AutomationScheduler({ service, now: () => now }).tick()

    let schedulerState = JSON.parse(await readFile(join(automationDir, 'scheduler.json'), 'utf8')) as AutomationSchedulerState
    expect(await createAutomationRunStore(automationDir).listRuns()).toEqual([])
    expect(schedulerState.nextDueAtIso).toBeNull()
    expect(schedulerState.unsupportedReason).toBe('Heartbeat renderer state has not loaded for target thread')
    expect(rpcCalls.map((call) => call.method)).toEqual(['config/read'])

    await service.recordHeartbeatThreadState({ threadId: 'thread-1', eligible: true, reason: null })

    schedulerState = JSON.parse(await readFile(join(automationDir, 'scheduler.json'), 'utf8')) as AutomationSchedulerState
    expect(schedulerState.unsupportedReason).toBeNull()
    expect(schedulerState.nextDueAtIso).toEqual(expect.any(String))
  })

  it('uses canonical TOML fields instead of stale legacy sidecar execution metadata', async () => {
    const { codexHomeDir, service } = await createHarness()
    const canonicalRepo = join(codexHomeDir, 'canonical-repo')
    const secondRepo = join(codexHomeDir, 'second-repo')
    await writeNative(codexHomeDir, 'canonical-dir', {
      ...nativeRecord,
      id: 'canonical-check',
      kind: 'cron',
      rrulePrefix: 'RRULE:',
      targetThreadId: null,
      model: 'gpt-5.5',
      reasoningEffort: 'low',
      executionEnvironment: 'local',
      runMode: 'local',
      cwd: canonicalRepo,
      cwds: [canonicalRepo, secondRepo],
      localEnvironmentConfigPath: join(canonicalRepo, '.codex', 'local-env.toml'),
    }, {
      cwd: '/stale/sidecar/repo',
      runMode: 'worktree',
      runProfileId: 'stale-profile',
      model: 'gpt-5.4',
      reasoningEffort: 'high',
    })

    const [definition] = await service.listDefinitions()

    expect(definition).toMatchObject({
      id: 'canonical-check',
      cwd: canonicalRepo,
      cwds: [canonicalRepo, secondRepo],
      runMode: 'local',
      model: 'gpt-5.5',
      reasoningEffort: 'low',
      localEnvironmentConfigPath: join(canonicalRepo, '.codex', 'local-env.toml'),
      storage: {
        sidecarPath: join(codexHomeDir, 'automations', 'canonical-dir', 'codexui.local.json'),
      },
    })
  })

  it('creates Desktop-readable TOML plus private local sidecar metadata', async () => {
    const { codexHomeDir, service } = await createHarness()
    const repo = join(codexHomeDir, 'repo')

    const created = await service.createDefinition({
      kind: 'cron',
      name: 'Local cron',
      description: 'Private description',
      prompt: 'Run local maintenance',
      schedule: { type: 'rrule', rrule: 'FREQ=DAILY;BYHOUR=9;BYMINUTE=0' },
      targetThreadId: null,
      cwd: repo,
      cwds: [repo],
      runMode: 'local',
      model: 'gpt-5.5',
      reasoningEffort: 'low',
      localEnvironmentConfigPath: null,
      kanbanProjection: { mode: 'off' },
      notes: 'Private notes',
    })

    const automationDir = join(codexHomeDir, 'automations', created.id)
    const toml = await readFile(join(automationDir, 'automation.toml'), 'utf8')
    const localSidecar = JSON.parse(await readFile(join(automationDir, 'codexui.local.json'), 'utf8')) as Record<string, unknown>

    expect(toml).toContain('cwds = [')
    expect(toml).toContain(`"${repo}"`)
    expect(toml).toContain('model = "gpt-5.5"')
    expect(toml).toContain('reasoning_effort = "low"')
    expect(toml).toContain('execution_environment = "local"')
    expect(toml).not.toContain('runProfileId')
    expect(toml).not.toContain('description')
    expect(localSidecar).toEqual({
      description: 'Private description',
      kanbanProjection: { mode: 'off' },
      notes: 'Private notes',
    })
    await expect(readFile(join(automationDir, 'codexui.json'), 'utf8')).rejects.toThrow()
  })

  it('does not serialize chat run mode as a Desktop execution environment', async () => {
    const { codexHomeDir, service } = await createHarness()

    const created = await service.createDefinition({
      kind: 'heartbeat',
      name: 'Thread heartbeat',
      description: null,
      prompt: 'Check this thread',
      schedule: { type: 'rrule', rrule: 'FREQ=DAILY;BYHOUR=9;BYMINUTE=0' },
      targetThreadId: 'thread-chat',
      cwd: null,
      cwds: [],
      runMode: 'chat',
      model: null,
      reasoningEffort: null,
      localEnvironmentConfigPath: null,
      kanbanProjection: { mode: 'off' },
      notes: '',
    })

    const automationDir = join(codexHomeDir, 'automations', created.id)
    await expect(readFile(join(automationDir, 'automation.toml'), 'utf8')).resolves.not.toContain('execution_environment = "chat"')
  })

  it('blocks a second active heartbeat automation for the same target thread', async () => {
    const { codexHomeDir, service } = await createHarness()
    await writeNative(codexHomeDir, 'active-thread-dir', {
      ...nativeRecord,
      id: 'active-thread-check',
      targetThreadId: 'thread-duplicate',
      status: 'ACTIVE',
    })

    await expect(service.createDefinition({
      kind: 'heartbeat',
      name: 'Duplicate heartbeat',
      description: null,
      prompt: 'Check this thread',
      schedule: { type: 'rrule', rrule: 'FREQ=MINUTELY;INTERVAL=15' },
      targetThreadId: 'thread-duplicate',
      cwd: null,
      cwds: [],
      runMode: 'chat',
      model: null,
      reasoningEffort: null,
      localEnvironmentConfigPath: null,
      kanbanProjection: { mode: 'off' },
      notes: '',
    })).rejects.toThrow('Automation already exists for targetThreadId')
  })

  it('allows a new heartbeat target when only a paused automation uses that thread', async () => {
    const { codexHomeDir, service } = await createHarness()
    await writeNative(codexHomeDir, 'paused-thread-dir', {
      ...nativeRecord,
      id: 'paused-thread-check',
      targetThreadId: 'thread-paused-duplicate',
      status: 'PAUSED',
    })

    const created = await service.createDefinition({
      kind: 'heartbeat',
      name: 'Replacement heartbeat',
      description: null,
      prompt: 'Check this thread',
      schedule: { type: 'rrule', rrule: 'FREQ=MINUTELY;INTERVAL=15' },
      targetThreadId: 'thread-paused-duplicate',
      cwd: null,
      cwds: [],
      runMode: 'chat',
      model: null,
      reasoningEffort: null,
      localEnvironmentConfigPath: null,
      kanbanProjection: { mode: 'off' },
      notes: '',
    })

    expect(created).toMatchObject({
      kind: 'heartbeat',
      status: 'active',
      targetThreadId: 'thread-paused-duplicate',
    })
  })

  it('blocks patching an automation onto another active heartbeat target', async () => {
    const { codexHomeDir, service } = await createHarness()
    await writeNative(codexHomeDir, 'active-thread-dir', {
      ...nativeRecord,
      id: 'active-thread-check',
      targetThreadId: 'thread-owned',
      status: 'ACTIVE',
    })
    const repo = join(codexHomeDir, 'repo')
    const created = await service.createDefinition({
      kind: 'cron',
      name: 'Local cron',
      description: null,
      prompt: 'Run local maintenance',
      schedule: { type: 'rrule', rrule: 'FREQ=DAILY;BYHOUR=9;BYMINUTE=0' },
      targetThreadId: null,
      cwd: repo,
      cwds: [repo],
      runMode: 'local',
      model: null,
      reasoningEffort: null,
      localEnvironmentConfigPath: null,
      kanbanProjection: { mode: 'off' },
      notes: '',
    })

    await expect(service.patchDefinition(created.id, {
      targetThreadId: 'thread-owned',
      cwd: null,
      cwds: [],
      runMode: 'chat',
    })).rejects.toThrow('Automation already exists for targetThreadId')
  })

  it('deletes the canonical Desktop automation when removeNative is true', async () => {
    const { codexHomeDir, service } = await createHarness()
    const created = await service.createDefinition({
      kind: 'heartbeat',
      name: 'Thread heartbeat',
      description: null,
      prompt: 'Check this thread',
      schedule: { type: 'rrule', rrule: 'FREQ=MINUTELY;INTERVAL=15' },
      targetThreadId: 'thread-delete',
      cwd: null,
      cwds: [],
      runMode: 'chat',
      model: null,
      reasoningEffort: null,
      localEnvironmentConfigPath: null,
      kanbanProjection: { mode: 'off' },
      notes: '',
    })
    const automationDir = join(codexHomeDir, 'automations', created.id)

    await expect(service.deleteDefinition(created.id, { removeNative: true })).resolves.toEqual({
      removed: true,
      removedNative: true,
    })
    await expect(readFile(join(automationDir, 'automation.toml'), 'utf8')).rejects.toThrow()
  })

  it('keeps sidecar-only deletion available for explicit debug maintenance', async () => {
    const { codexHomeDir, service } = await createHarness()
    const created = await service.createDefinition({
      kind: 'heartbeat',
      name: 'Thread heartbeat',
      description: 'Local metadata',
      prompt: 'Check this thread',
      schedule: { type: 'rrule', rrule: 'FREQ=MINUTELY;INTERVAL=15' },
      targetThreadId: 'thread-sidecar-delete',
      cwd: null,
      cwds: [],
      runMode: 'chat',
      model: null,
      reasoningEffort: null,
      localEnvironmentConfigPath: null,
      kanbanProjection: { mode: 'off' },
      notes: 'Debug metadata',
    })
    const automationDir = join(codexHomeDir, 'automations', created.id)

    await expect(service.deleteDefinition(created.id, { removeNative: false })).resolves.toEqual({
      removed: true,
      removedNative: false,
    })
    await expect(readFile(join(automationDir, 'automation.toml'), 'utf8')).resolves.toContain('Thread heartbeat')
    await expect(readFile(join(automationDir, 'codexui.local.json'), 'utf8')).rejects.toThrow()
  })

  it('removes Desktop execution environment when a target is patched back to chat', async () => {
    const { codexHomeDir, service } = await createHarness()
    const repo = join(codexHomeDir, 'repo')
    const created = await service.createDefinition({
      kind: 'cron',
      name: 'Local cron',
      description: null,
      prompt: 'Run local maintenance',
      schedule: { type: 'rrule', rrule: 'FREQ=DAILY;BYHOUR=9;BYMINUTE=0' },
      targetThreadId: null,
      cwd: repo,
      cwds: [repo],
      runMode: 'local',
      model: null,
      reasoningEffort: null,
      localEnvironmentConfigPath: null,
      kanbanProjection: { mode: 'off' },
      notes: '',
    })

    await service.patchDefinition(created.id, {
      targetThreadId: 'thread-chat',
      cwd: null,
      cwds: [],
      runMode: 'chat',
    })

    const automationDir = join(codexHomeDir, 'automations', created.id)
    const toml = await readFile(join(automationDir, 'automation.toml'), 'utf8')
    expect(toml).not.toContain('execution_environment = "chat"')
    expect(toml).not.toContain('execution_environment = "local"')
  })

  it('cleans legacy chat execution environment during unrelated patches', async () => {
    const { codexHomeDir, service } = await createHarness()
    const automationDir = await writeNative(codexHomeDir, 'legacy-chat-dir', {
      ...nativeRecord,
      id: 'legacy-chat',
      executionEnvironment: 'chat',
      runMode: 'chat',
      targetThreadId: 'thread-chat',
    })

    await service.patchDefinition('legacy-chat', { name: 'Renamed legacy chat' })

    const toml = await readFile(join(automationDir, 'automation.toml'), 'utf8')
    expect(toml).toContain('name = "Renamed legacy chat"')
    expect(toml).not.toContain('execution_environment = "chat"')
  })

  it('excludes Desktop cron automations with unsupported execution environments from scheduler candidates', async () => {
    const { codexHomeDir, service } = await createHarness()
    const automationDir = await writeNative(codexHomeDir, 'desktop-special-dir', {
      ...nativeRecord,
      id: 'desktop-special',
      kind: 'cron',
      rrule: 'FREQ=HOURLY;INTERVAL=1',
      rrulePrefix: 'RRULE:',
      targetThreadId: null,
      executionEnvironment: 'desktop-special',
      runMode: null,
      cwd: '/tmp/project',
      cwds: ['/tmp/project'],
    })

    const entries = await service.listSchedulerEntries()

    expect(entries).toHaveLength(0)
    const schedulerState = JSON.parse(await readFile(join(automationDir, 'scheduler.json'), 'utf8')) as AutomationSchedulerState
    expect(schedulerState).toMatchObject({
      automationId: 'desktop-special',
      sourceDirName: 'desktop-special-dir',
      nextDueAtIso: null,
      lastEvaluatedAtIso: expect.any(String),
      unsupportedReason: 'Unsupported automation execution_environment: desktop-special',
    })

    const refreshed = await service.refreshSchedulerState('desktop-special', '2026-04-30T10:00:00.000Z')
    expect(refreshed).toMatchObject({
      nextDueAtIso: null,
      lastEvaluatedAtIso: '2026-04-30T10:00:00.000Z',
      unsupportedReason: 'Unsupported automation execution_environment: desktop-special',
    })
  })

  it('recomputes scheduler state when Desktop execution environment support changes', async () => {
    const { codexHomeDir, service } = await createHarness()
    const automationDir = await writeNative(codexHomeDir, 'desktop-special-dir', {
      ...nativeRecord,
      id: 'desktop-special',
      kind: 'cron',
      rrule: 'FREQ=HOURLY;INTERVAL=1',
      rrulePrefix: 'RRULE:',
      targetThreadId: null,
      executionEnvironment: 'desktop-special',
      runMode: null,
      cwd: '/tmp/project',
      cwds: ['/tmp/project'],
    })
    await service.listSchedulerEntries()

    await writeFile(join(automationDir, 'automation.toml'), serializeAutomationToml({
      ...nativeRecord,
      id: 'desktop-special',
      kind: 'cron',
      rrule: 'FREQ=HOURLY;INTERVAL=1',
      rrulePrefix: 'RRULE:',
      targetThreadId: null,
      executionEnvironment: 'worktree',
      runMode: 'worktree',
      cwd: '/tmp/project',
      cwds: ['/tmp/project'],
    }), 'utf8')

    const entries = await service.listSchedulerEntries()

    expect(entries).toHaveLength(1)
    expect(entries[0]?.schedulerState).toMatchObject({
      unsupportedReason: null,
    })
    expect(entries[0]?.schedulerState?.nextDueAtIso).toEqual(expect.any(String))
  })

  it('scans persisted active definitions and starts one due scheduled run', async () => {
    const now = new Date('2026-04-30T10:00:00.000Z')
    const { codexHomeDir, service, rpcCalls, notificationListeners } = await createHarness()
    const automationDir = await writeNative(codexHomeDir, 'daily-check-dir', nativeRecord)
    await writeFreshScheduler(service, 'daily-check', automationDir)
    notifyHeartbeatRendererState(notificationListeners, 'thread-1')

    await new AutomationScheduler({ service, now: () => now }).tick()

    const runs = await createAutomationRunStore(automationDir).listRuns()
    const schedulerState = JSON.parse(await readFile(join(automationDir, 'scheduler.json'), 'utf8')) as AutomationSchedulerState
    const turnStartParams = rpcCalls.find((call) => call.method === 'turn/start')?.params as Record<string, unknown> | undefined
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
    expect(rpcCalls.map((call) => call.method)).toEqual(['config/read', 'thread/read', 'thread/resume', 'turn/start'])
    expect(turnStartParams).toMatchObject({ model: null, effort: null })
  })

  it('passes canonical cron model settings to thread and turn startup', async () => {
    const { codexHomeDir, service, rpcCalls } = await createHarness()
    const repo = join(codexHomeDir, 'cron-model-repo')
    await mkdir(repo, { recursive: true })
    const automationDir = await writeNative(codexHomeDir, 'cron-model-dir', {
      ...nativeRecord,
      id: 'cron-model-check',
      kind: 'cron',
      name: 'Cron model check',
      rrulePrefix: 'RRULE:',
      targetThreadId: null,
      executionEnvironment: 'local',
      runMode: 'local',
      cwd: repo,
      cwds: [repo],
      model: 'gpt-5.5',
      reasoningEffort: 'low',
    })

    await service.runScheduled('cron-model-check', {
      dueAtIso: '2026-05-07T12:00:00.000Z',
      nextDueAtIso: '2026-05-07T13:00:00.000Z',
    })

    const runs = await createAutomationRunStore(automationDir).listRuns()
    const threadStartParams = rpcCalls.find((call) => call.method === 'thread/start')?.params as Record<string, unknown> | undefined
    const cronTurnStartParams = rpcCalls.find((call) => call.method === 'turn/start')?.params as Record<string, unknown> | undefined

    expect(runs).toHaveLength(1)
    expect(threadStartParams).toMatchObject({
      cwd: repo,
      model: 'gpt-5.5',
      modelProvider: null,
      approvalPolicy: 'on-request',
      sandbox: 'workspace-write',
      config: {},
      personality: null,
      ephemeral: null,
      dynamicTools: null,
      mockExperimentalField: null,
      experimentalRawEvents: false,
      persistExtendedHistory: true,
    })
    expect(cronTurnStartParams).toMatchObject({
      cwd: repo,
      model: 'gpt-5.5',
      effort: 'low',
      summary: 'auto',
      personality: null,
      outputSchema: null,
      collaborationMode: null,
    })
  })

  it('falls back to the first available Desktop model when a stored cron model is unavailable', async () => {
    const { codexHomeDir, service, rpcCalls } = await createHarness({ availableModels: ['gpt-5.4'] })
    const repo = join(codexHomeDir, 'cron-model-fallback-repo')
    await mkdir(repo, { recursive: true })
    await writeNative(codexHomeDir, 'cron-model-fallback-dir', {
      ...nativeRecord,
      id: 'cron-model-fallback',
      kind: 'cron',
      name: 'Cron model fallback',
      rrulePrefix: 'RRULE:',
      targetThreadId: null,
      executionEnvironment: 'local',
      runMode: 'local',
      cwd: repo,
      cwds: [repo],
      model: 'missing-model',
      reasoningEffort: 'low',
    })

    await service.runScheduled('cron-model-fallback', {
      dueAtIso: '2026-05-07T12:00:00.000Z',
      nextDueAtIso: '2026-05-07T13:00:00.000Z',
    })

    const threadStartParams = rpcCalls.find((call) => call.method === 'thread/start')?.params as Record<string, unknown> | undefined
    const cronTurnStartParams = rpcCalls.find((call) => call.method === 'turn/start')?.params as Record<string, unknown> | undefined

    expect(rpcCalls.find((call) => call.method === 'model/list')?.params).toEqual({
      includeHidden: true,
      cursor: null,
      limit: 100,
    })
    expect(threadStartParams).toMatchObject({ model: 'gpt-5.4' })
    expect(cronTurnStartParams).toMatchObject({ model: 'gpt-5.4', effort: 'low' })
  })

  it('projects Desktop inbox directives into local run history without storing the directive in the summary', async () => {
    const { codexHomeDir, service, notificationListeners } = await createHarness({
      threadReadById: {
        thread_local_1: {
          thread: {
            id: 'thread_local_1',
            turns: [{
              id: 'turn_1',
              items: [{
                type: 'assistantMessage',
                text: 'The PR comments are addressed.\n::inbox-item{title="PR comments addressed" summary="Ready for re-review; focus on auth edge case"}',
              }],
            }],
          },
        },
      },
    })
    const repo = join(codexHomeDir, 'cron-inbox-repo')
    await mkdir(repo, { recursive: true })
    const automationDir = await writeNative(codexHomeDir, 'cron-inbox-dir', {
      ...nativeRecord,
      id: 'cron-inbox-check',
      kind: 'cron',
      name: 'Cron inbox check',
      rrulePrefix: 'RRULE:',
      targetThreadId: null,
      executionEnvironment: 'local',
      runMode: 'local',
      cwd: repo,
      cwds: [repo],
    })

    await service.runNow('cron-inbox-check')
    await Promise.all(notificationListeners.map(async (listener) => {
      await listener({
        method: 'turn/completed',
        params: { threadId: 'thread_local_1', turnId: 'turn_1' },
        atIso: '2026-05-07T12:00:00.000Z',
      })
    }))

    const [run] = await createAutomationRunStore(automationDir).listRuns()
    expect(run).toMatchObject({
      state: 'completed_with_findings',
      resultSummary: 'The PR comments are addressed.',
      inboxTitle: 'PR comments addressed',
      inboxSummary: 'Ready for re-review; focus on auth edge case',
      readAtIso: null,
    })
  })

  it('does not start a due run while another CodexUI scheduler owns the lease', async () => {
    const now = new Date('2026-04-30T10:00:00.000Z')
    const { codexHomeDir, service, rpcCalls, notificationListeners } = await createHarness()
    const automationDir = await writeNative(codexHomeDir, 'daily-check-dir', nativeRecord)
    await writeFreshScheduler(service, 'daily-check', automationDir)
    notifyHeartbeatRendererState(notificationListeners, 'thread-1')
    await createAutomationSchedulerLeaseStore(automationDir, {
      ownerId: 'other-codexui-instance',
      pid: 12345,
      hostname: 'other-host',
      ttlMs: 10 * 60_000,
    }).acquire({
      automationId: 'daily-check',
      sourceDirName: 'daily-check-dir',
      dueAtIso: '2026-04-30T09:00:00.000Z',
      nowIso: '2026-04-30T09:59:00.000Z',
    })

    await new AutomationScheduler({ service, now: () => now }).tick()

    expect(await createAutomationRunStore(automationDir).listRuns()).toEqual([])
    expect(rpcCalls).toEqual([])
  })

  it('replaces a stale scheduler lease and releases the acquired generation after queuing a run', async () => {
    const now = new Date('2026-04-30T10:00:00.000Z')
    const { codexHomeDir, service, rpcCalls, notificationListeners } = await createHarness()
    const automationDir = await writeNative(codexHomeDir, 'daily-check-dir', nativeRecord)
    await writeFreshScheduler(service, 'daily-check', automationDir)
    notifyHeartbeatRendererState(notificationListeners, 'thread-1')
    await createAutomationSchedulerLeaseStore(automationDir, {
      ownerId: 'stale-codexui-instance',
      pid: 12345,
      hostname: 'other-host',
      ttlMs: 60_000,
    }).acquire({
      automationId: 'daily-check',
      sourceDirName: 'daily-check-dir',
      dueAtIso: '2026-04-30T09:00:00.000Z',
      nowIso: '2026-04-30T08:00:00.000Z',
    })

    await new AutomationScheduler({ service, now: () => now }).tick()

    const runs = await createAutomationRunStore(automationDir).listRuns()
    expect(runs).toHaveLength(1)
    await expect(readFile(join(automationDir, 'scheduler-lock.json'), 'utf8')).resolves.toContain('"ownerId": "stale-codexui-instance"')
    await expect(readFile(join(automationDir, 'scheduler-lock.1.json'), 'utf8')).resolves.toContain('"releasedAtIso":')
    expect(rpcCalls.map((call) => call.method)).toEqual(['config/read', 'thread/read', 'thread/resume', 'turn/start'])
  })

  it('starts at most three due automations per tick like Desktop', async () => {
    const now = new Date('2026-04-30T10:00:00.000Z')
    const { codexHomeDir, service } = await createHarness()
    const repo = join(codexHomeDir, 'repo')
    await mkdir(repo, { recursive: true })
    const automationDirs: string[] = []
    for (let index = 1; index <= 4; index += 1) {
      const automationId = `cron-check-${index}`
      const automationDir = await writeNative(codexHomeDir, `${automationId}-dir`, {
        ...nativeRecord,
        id: automationId,
        kind: 'cron',
        name: `Cron Check ${index}`,
        rrulePrefix: 'RRULE:',
        targetThreadId: null,
        executionEnvironment: 'local',
        runMode: 'local',
        cwd: repo,
        cwds: [repo],
      })
      automationDirs.push(automationDir)
      await writeFreshScheduler(service, automationId, automationDir, {
        automationId,
        sourceDirName: `${automationId}-dir`,
      })
    }

    await new AutomationScheduler({ service, now: () => now }).tick()

    const runCounts = await Promise.all(automationDirs.map(async (automationDir) => {
      return (await createAutomationRunStore(automationDir).listRuns()).length
    }))
    expect(runCounts.reduce((sum, count) => sum + count, 0)).toBe(3)
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
    const { codexHomeDir, service, notificationListeners } = await createHarness()
    const automationDir = await writeNative(codexHomeDir, 'daily-check-dir', nativeRecord)
    notifyHeartbeatRendererState(notificationListeners, 'thread-1')

    await new AutomationScheduler({ service, now: () => now }).tick()

    const schedulerState = JSON.parse(await readFile(join(automationDir, 'scheduler.json'), 'utf8')) as AutomationSchedulerState
    const runs = await createAutomationRunStore(automationDir).listRuns()
    expect(schedulerState.automationId).toBe('daily-check')
    expect(runs).toHaveLength(1)
    expect(runs[0]?.dueAtIso).toBe('2026-04-29T09:00:00.000Z')
    expect(Date.parse(schedulerState.nextDueAtIso ?? '')).toBeGreaterThan(now.getTime())
  })

  it('lists scheduler entries without reading automation run history', async () => {
    const { codexHomeDir, service } = await createHarness()
    const automationDir = await writeNative(codexHomeDir, 'daily-check-dir', nativeRecord)
    await writeFreshScheduler(service, 'daily-check', automationDir)
    await writeFile(join(automationDir, 'runs'), 'not a run directory', 'utf8')

    const entries = await service.listSchedulerEntries()

    expect(entries).toHaveLength(1)
    expect(entries[0]?.definition).toMatchObject({
      id: 'daily-check',
      recentRuns: [],
      lastRunAtIso: null,
    })
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
    const { codexHomeDir, service, notificationListeners } = await createHarness()
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
    notifyHeartbeatRendererState(notificationListeners, 'thread-bad')
    notifyHeartbeatRendererState(notificationListeners, 'thread-healthy')

    await new AutomationScheduler({ service, now: () => now }).tick()

    const healthyRuns = await createAutomationRunStore(healthyDir).listRuns()
    const repairedBadScheduler = JSON.parse(await readFile(join(badDir, 'scheduler.json'), 'utf8')) as AutomationSchedulerState
    expect(repairedBadScheduler.nextDueAtIso).toEqual(expect.any(String))
    expect(healthyRuns).toHaveLength(1)
    expect(healthyRuns[0]).toMatchObject({ automationId: 'healthy-check', trigger: 'schedule' })
  })

  it('continues scanning healthy due automations when one due automation cannot run', async () => {
    const now = new Date('2026-04-30T10:00:00.000Z')
    const { codexHomeDir, service, notificationListeners } = await createHarness()
    const badDir = await writeNative(codexHomeDir, 'bad-dir', {
      ...nativeRecord,
      id: 'bad-check',
      name: 'Bad Check',
      targetThreadId: null,
    })
    const healthyDir = await writeNative(codexHomeDir, 'healthy-dir', {
      ...nativeRecord,
      id: 'healthy-check',
      name: 'Healthy Check',
      targetThreadId: 'thread-healthy',
    })
    await writeFreshScheduler(service, 'bad-check', badDir)
    await writeFreshScheduler(service, 'healthy-check', healthyDir, {
      automationId: 'healthy-check',
      sourceDirName: 'healthy-dir',
    })
    notifyHeartbeatRendererState(notificationListeners, 'thread-healthy')

    await new AutomationScheduler({ service, now: () => now }).tick()

    const badRuns = await createAutomationRunStore(badDir).listRuns()
    const healthyRuns = await createAutomationRunStore(healthyDir).listRuns()
    expect(badRuns).toEqual([])
    expect(healthyRuns).toHaveLength(1)
    expect(healthyRuns[0]).toMatchObject({ automationId: 'healthy-check', trigger: 'schedule' })
  })

  it('starts only one catch-up run per automation tick and advances next due beyond now', async () => {
    const now = new Date('2026-04-30T10:00:00.000Z')
    const { codexHomeDir, service, notificationListeners } = await createHarness()
    const automationDir = await writeNative(codexHomeDir, 'daily-check-dir', {
      ...nativeRecord,
      rrule: 'FREQ=MINUTELY;INTERVAL=1',
    })
    await writeFreshScheduler(service, 'daily-check', automationDir, { nextDueAtIso: '2026-04-30T09:30:00.000Z' })
    notifyHeartbeatRendererState(notificationListeners, 'thread-1')

    await new AutomationScheduler({ service, now: () => now }).tick()

    const runs = await createAutomationRunStore(automationDir).listRuns()
    const schedulerState = JSON.parse(await readFile(join(automationDir, 'scheduler.json'), 'utf8')) as AutomationSchedulerState
    expect(runs).toHaveLength(1)
    expect(runs[0]?.dueAtIso).toBe('2026-04-30T09:30:00.000Z')
    expect(Date.parse(schedulerState.nextDueAtIso ?? '')).toBeGreaterThan(now.getTime())
  })

  it('requeues an incomplete scheduler reservation when the recorded run is missing', async () => {
    const now = new Date('2026-04-30T10:00:00.000Z')
    const { codexHomeDir, service, notificationListeners } = await createHarness()
    const automationDir = await writeNative(codexHomeDir, 'daily-check-dir', nativeRecord)
    await writeFreshScheduler(service, 'daily-check', automationDir, {
      nextDueAtIso: '2026-05-01T09:00:00.000Z',
      lastDueAtIso: '2026-04-30T09:00:00.000Z',
      lastScheduledRunId: 'missing-run',
    })
    notifyHeartbeatRendererState(notificationListeners, 'thread-1')

    await new AutomationScheduler({ service, now: () => now }).tick()

    const runs = await createAutomationRunStore(automationDir).listRuns()
    const schedulerState = JSON.parse(await readFile(join(automationDir, 'scheduler.json'), 'utf8')) as AutomationSchedulerState
    expect(runs).toHaveLength(1)
    expect(runs[0]?.dueAtIso).toBe('2026-04-30T09:00:00.000Z')
    expect(schedulerState.lastScheduledRunId).toBe(runs[0]?.id)
    expect(Date.parse(schedulerState.nextDueAtIso ?? '')).toBeGreaterThan(now.getTime())
  })

  it('leaves next due unchanged when the global active run limit blocks scheduling', async () => {
    const policy = { ...enabledPolicy, maxGlobalActiveRuns: 1 } as unknown as AutomationExecutionPolicy
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
    const policy = { ...enabledPolicy, maxGlobalActiveRuns: 10, maxActiveRunsPerRepo: 1 } as unknown as AutomationExecutionPolicy
    const { codexHomeDir, service, rpcCalls } = await createHarness({ policy })
    const repo = join(codexHomeDir, 'repo')
    await mkdir(repo, { recursive: true })
    const firstDir = await writeNative(codexHomeDir, 'first-dir', {
      ...nativeRecord,
      id: 'first-check',
      name: 'First Check',
      kind: 'cron',
      rrulePrefix: 'RRULE:',
      targetThreadId: null,
      executionEnvironment: 'local',
      runMode: 'local',
      cwd: repo,
      cwds: [repo],
    })
    const secondDir = await writeNative(codexHomeDir, 'second-dir', {
      ...nativeRecord,
      id: 'second-check',
      name: 'Second Check',
      kind: 'cron',
      rrulePrefix: 'RRULE:',
      targetThreadId: null,
      executionEnvironment: 'local',
      runMode: 'local',
      cwd: repo,
      cwds: [repo],
    })
    await writeFreshScheduler(service, 'first-check', firstDir, { automationId: 'first-check', sourceDirName: 'first-dir' })
    await writeFreshScheduler(service, 'second-check', secondDir, { automationId: 'second-check', sourceDirName: 'second-dir' })

    await new AutomationScheduler({ service, now: () => new Date('2026-04-30T10:00:00.000Z') }).tick()

    const firstRuns = await createAutomationRunStore(firstDir).listRuns()
    const secondRuns = await createAutomationRunStore(secondDir).listRuns()
    const startedCount = firstRuns.length + secondRuns.length
    expect(startedCount).toBe(1)
    expect(rpcCalls.map((call) => call.method)).toEqual(['config/read', 'config/read', 'config/read', 'thread/start', 'turn/start'])
    expect(rpcCalls.filter((call) => call.method === 'config/read').map((call) => call.params)).toEqual([
      { includeLayers: true },
      { includeLayers: true, cwd: repo },
      { includeLayers: true, cwd: repo },
    ])
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
    const { codexHomeDir, service, rpcCalls, notificationListeners } = await createHarness()
    const automationDir = await writeNative(codexHomeDir, 'daily-check-dir', nativeRecord)
    await writeFreshScheduler(service, 'daily-check', automationDir)
    notifyHeartbeatRendererState(notificationListeners, 'thread-1')
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
    expect(rpcCalls.map((call) => call.method)).toEqual(['config/read', 'thread/read', 'thread/resume', 'turn/start'])
  })

  it('does not run startup recovery while scheduler ownership is deferred', async () => {
    const { service } = await createHarness()
    vi.spyOn(service, 'recoverInterruptedRuns').mockResolvedValue({ recovered: 0 })
    const scheduler = new AutomationScheduler({
      service,
      intervalMs: 60_000,
      shouldRun: () => false,
    })

    scheduler.start()
    await scheduler.tick()
    scheduler.stop()

    expect(service.recoverInterruptedRuns).not.toHaveBeenCalled()
  })

  it('retries startup recovery after a failure and then schedules due work', async () => {
    const { codexHomeDir, service, rpcCalls, notificationListeners } = await createHarness()
    const automationDir = await writeNative(codexHomeDir, 'daily-check-dir', nativeRecord)
    await writeFreshScheduler(service, 'daily-check', automationDir)
    notifyHeartbeatRendererState(notificationListeners, 'thread-1')
    const recoveryError = new Error('first recovery failed')
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(service, 'recoverInterruptedRuns')
      .mockRejectedValueOnce(recoveryError)
      .mockResolvedValueOnce({ recovered: 0 })
    const scheduler = new AutomationScheduler({
      service,
      intervalMs: 60_000,
      now: () => new Date('2026-04-30T10:00:00.000Z'),
    })

    scheduler.start()
    await expect(scheduler.tick()).rejects.toThrow('first recovery failed')
    expect(await createAutomationRunStore(automationDir).listRuns()).toEqual([])

    await scheduler.tick()
    scheduler.stop()

    const runs = await createAutomationRunStore(automationDir).listRuns()
    expect(service.recoverInterruptedRuns).toHaveBeenCalledTimes(2)
    expect(runs).toHaveLength(1)
    expect(runs[0]).toMatchObject({ automationId: 'daily-check', trigger: 'schedule' })
    expect(rpcCalls.map((call) => call.method)).toEqual(['config/read', 'thread/read', 'thread/resume', 'turn/start'])
  })
})
