import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AutomationRun } from '../../../types/automations'
import { FULL_ACCESS_CODEX_RUN_PROFILE_ID, type CodexRunProfile } from '../../../types/execution'
import type { KanbanExecutionPolicy } from '../../../types/kanban'
import type { CodexBridgeNotification, CodexBridgeRuntime } from '../../codexAppServerBridge'
import { serializeAutomationToml, type ThreadAutomationRecord } from '../nativeStore'
import { AutomationsService } from '../service'

const codexHomeDirs: string[] = []

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
  readThreadResponse?: unknown
  readThreadError?: Error
} = {}) {
  const codexHomeDir = await mkdtemp(join(tmpdir(), 'codexui-automation-runner-'))
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
      state: 'running',
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
})

function readRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}
