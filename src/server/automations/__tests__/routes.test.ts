import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { createServer as createHttpServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import express from 'express'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { KanbanExecutionPolicy } from '../../../types/kanban'
import type { CodexBridgeNotification, CodexBridgeRuntime } from '../../codexAppServerBridge'
import { createServer as createCodexUiServer } from '../../httpServer'
import { KanbanStorage } from '../../kanban/storage'
import { KanbanTaskService } from '../../kanban/taskService'
import { createAutomationsMiddleware } from '../index'
import { AutomationKanbanProjectionService } from '../kanbanProjection'
import { AUTOMATIONS_CSRF_HEADER } from '../csrf'
import {
  parseAutomationCreateInput,
  parseAutomationDeleteOptions,
  parseAutomationPatchInput,
  parseAutomationRouteParams,
} from '../schema'
import { AutomationValidationError } from '../errors'
import { serializeAutomationToml, type ThreadAutomationRecord } from '../nativeStore'
import { AutomationsService } from '../service'

const servers: Server[] = []
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
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve())
  })))
  await Promise.all(codexHomeDirs.splice(0).map(async (codexHomeDir) => {
    await rm(codexHomeDir, { recursive: true, force: true })
  }))
})

async function createHarness(options: {
  bridge?: CodexBridgeRuntime
  service?: AutomationsService
  policy?: KanbanExecutionPolicy
  enableScheduler?: boolean
  projectRoot?: string
  kanbanDataDir?: string
  kanbanStorage?: KanbanStorage
  kanbanProjection?: AutomationKanbanProjectionService
  kanbanProjectionTaskValidator?: {
    validateTask(taskId: string): Promise<void>
  } | null
  artifactIndexing?: boolean
} = {}) {
  const codexHomeDir = await mkdtemp(join(tmpdir(), 'codexui-automations-api-'))
  codexHomeDirs.push(codexHomeDir)
  const app = express()
  app.use('/codex-api/automations', createAutomationsMiddleware({
    codexHomeDir,
    service: options.service,
    bridge: options.bridge,
    policy: options.policy,
    enableScheduler: options.enableScheduler,
    projectRoot: options.projectRoot,
    kanbanDataDir: options.kanbanDataDir,
    kanbanStorage: options.kanbanStorage,
    kanbanProjection: options.kanbanProjection,
    kanbanProjectionTaskValidator: options.kanbanProjectionTaskValidator,
    artifactIndexing: options.artifactIndexing,
  }))
  app.use('/codex-api', (_req, res) => {
    res.status(599).json({ error: 'generic bridge reached' })
  })
  const server = createHttpServer(app)
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Expected test server port')
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    codexHomeDir,
  }
}

function createBridge() {
  const rpcCalls: Array<{ method: string; params: unknown }> = []
  const notificationListeners: Array<(notification: CodexBridgeNotification) => void> = []
  const unsubscribe = vi.fn()
  let turnStartCount = 0
  const bridge: CodexBridgeRuntime = {
    rpc: async <T = unknown>(method: string, params?: unknown) => {
      rpcCalls.push({ method, params })
      if (method === 'thread/resume') return { thread: { id: readRecord(params).threadId } } as T
      if (method === 'turn/start') {
        turnStartCount += 1
        return { turn: { id: `turn_${turnStartCount}` } } as T
      }
      if (method === 'thread/read') {
        return {
          thread: {
            turns: [
              {
                id: 'turn_1',
                items: [{ type: 'agentMessage', text: 'Manual route run completed.' }],
              },
            ],
          },
        } as T
      }
      return {} as T
    },
    subscribeNotifications: vi.fn((listener) => {
      notificationListeners.push(listener)
      return unsubscribe
    }),
    dispose: vi.fn(),
  }
  return { bridge, rpcCalls, notificationListeners, unsubscribe }
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
  const csrf = await requestJson<{ data: { csrfToken: string; headerName: string } }>(`${baseUrl}/codex-api/automations/csrf`)
  expect(csrf.status).toBe(200)
  expect(csrf.body.data.headerName).toBe(AUTOMATIONS_CSRF_HEADER)
  return { [AUTOMATIONS_CSRF_HEADER]: csrf.body.data.csrfToken }
}

async function writeNative(codexHomeDir: string, dirName: string, record: ThreadAutomationRecord, extra = '') {
  const dir = join(codexHomeDir, 'automations', dirName)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'automation.toml'), `${serializeAutomationToml(record)}${extra}`, 'utf8')
  return dir
}

describe('automation request schema', () => {
  it('rejects invalid create, patch, delete, and route inputs', () => {
    expect(() => parseAutomationCreateInput({ kind: 'scheduled_chat' })).toThrow(/kind/)
    expect(() => parseAutomationCreateInput({ kind: 'heartbeat', name: '', prompt: 'p', schedule: { type: 'rrule', rrule: 'FREQ=DAILY' }, targetThreadId: 'thread' })).toThrow(/name/)
    expect(() => parseAutomationCreateInput({ kind: 'heartbeat', name: 'n', prompt: '', schedule: { type: 'rrule', rrule: 'FREQ=DAILY' }, targetThreadId: 'thread' })).toThrow(/prompt/)
    expect(() => parseAutomationCreateInput({ kind: 'heartbeat', name: 'n', prompt: 'p', schedule: { type: 'rrule', rrule: 'FREQ=DAILY;FREQ=HOURLY' }, targetThreadId: 'thread' })).toThrow(/RRULE/)
    expect(() => parseAutomationCreateInput({ kind: 'heartbeat', name: 'n', prompt: 'p', schedule: { type: 'rrule', rrule: 'FREQ=DAILY' }, targetThreadId: '' })).toThrow(/targetThreadId/)
    expect(() => parseAutomationPatchInput({ cwd: 'relative/path' })).toThrow(/cwd/)
    expect(() => parseAutomationPatchInput({ model: '' })).toThrow(/model/)
    expect(() => parseAutomationPatchInput({ runMode: 'shell' })).toThrow(/runMode/)
    expect(() => parseAutomationPatchInput({ runMode: 'local', cwd: null })).toThrow(/cwd/)
    expect(() => parseAutomationPatchInput({ runMode: 'worktree', cwd: null })).toThrow(/cwd/)
    expect(() => parseAutomationPatchInput({ runMode: 'chat', targetThreadId: null })).toThrow(/targetThreadId/)
    expect(() => parseAutomationPatchInput({ notes: 'x'.repeat(4001) })).toThrow(/notes/)
    expect(() => parseAutomationRouteParams({ automationId: '' })).toThrow(/automationId/)
    expect(() => parseAutomationRouteParams({ automationId: '../daily-check' })).toThrow(/automationId/)
    expect(() => parseAutomationRouteParams({ automationId: '.' })).toThrow(/automationId/)
    expect(parseAutomationDeleteOptions({ removeNative: 'true' }, {})).toEqual({ removeNative: true })
    expect(() => parseAutomationDeleteOptions({}, { removeNative: 'yes' })).toThrow(/removeNative/)
  })

  it('accepts Desktop cron create payloads and normalizes RRULE prefixes', () => {
    expect(parseAutomationCreateInput({
      kind: 'cron',
      name: 'Hourly',
      prompt: 'Run',
      schedule: { type: 'rrule', rrule: 'RRULE:FREQ=HOURLY;INTERVAL=1;BYMINUTE=0' },
      targetThreadId: null,
      cwd: '/tmp',
      runMode: 'worktree',
    })).toMatchObject({
      kind: 'cron',
      schedule: { type: 'rrule', rrule: 'FREQ=HOURLY;INTERVAL=1;BYMINUTE=0' },
      targetThreadId: null,
      cwd: '/tmp',
      runMode: 'worktree',
    })
  })

  it('parses valid kanban projection settings and rejects malformed inputs', () => {
    const baseCreate = {
      kind: 'heartbeat',
      name: 'Daily',
      prompt: 'Prompt',
      schedule: { type: 'rrule', rrule: 'FREQ=DAILY' },
      targetThreadId: 'thread-1',
    }

    expect(parseAutomationCreateInput({ ...baseCreate, kanbanProjection: { mode: 'off' } }).kanbanProjection).toEqual({ mode: 'off' })
    expect(parseAutomationCreateInput({ ...baseCreate, kanbanProjection: { mode: 'definition_card' } }).kanbanProjection).toEqual({ mode: 'definition_card' })
    expect(parseAutomationCreateInput({ ...baseCreate, kanbanProjection: { mode: 'definition_card', taskId: 'task_existing' } }).kanbanProjection).toEqual({ mode: 'definition_card', taskId: 'task_existing' })
    expect(parseAutomationCreateInput({ ...baseCreate, kanbanProjection: { mode: 'run_card', createFor: 'findings_only' } }).kanbanProjection).toEqual({ mode: 'run_card', createFor: 'findings_only' })
    expect(parseAutomationCreateInput({ ...baseCreate, kanbanProjection: { mode: 'attach_existing_task', taskId: 'task_existing' } }).kanbanProjection).toEqual({ mode: 'attach_existing_task', taskId: 'task_existing' })
    expect(parseAutomationPatchInput({ kanbanProjection: { mode: 'run_card', createFor: 'failures_only' } }).kanbanProjection).toEqual({ mode: 'run_card', createFor: 'failures_only' })

    expect(() => parseAutomationCreateInput({ ...baseCreate, kanbanProjection: { mode: 'run_card', createFor: 'everything' } })).toThrow(/kanbanProjection/)
    expect(() => parseAutomationCreateInput({ ...baseCreate, kanbanProjection: { mode: 'attach_existing_task', taskId: '' } })).toThrow(/kanbanProjection/)
    expect(() => parseAutomationCreateInput({ ...baseCreate, kanbanProjection: { mode: 'attach_existing_task', taskId: '../task' } })).toThrow(/kanbanProjection/)
    expect(() => parseAutomationCreateInput({ ...baseCreate, kanbanProjection: { mode: 'auto_run' } })).toThrow(/kanbanProjection/)
  })
})

describe('createAutomationsMiddleware', () => {
  it('keeps first-class automations health ahead of the generic production bridge route', async () => {
    const instance = createCodexUiServer()
    const server = createHttpServer(instance.app)
    servers.push(server)
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Expected test server port')

    const health = await requestJson<{ data: { ok: true } }>(`http://127.0.0.1:${address.port}/codex-api/automations/health`)

    expect(health.status).toBe(200)
    expect(health.body).toEqual({ data: { ok: true } })
    instance.dispose()
  })

  it('reports execution feature flags as disabled for default shared server policy', async () => {
    const instance = createCodexUiServer()
    const server = createHttpServer(instance.app)
    servers.push(server)
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Expected test server port')

    const state = await requestJson<{
      data: {
        featureFlags: {
          scheduler: boolean
          manualRun: boolean
          kanbanProjection: boolean
          artifactIndexing: boolean
        }
      }
    }>(`http://127.0.0.1:${address.port}/codex-api/automations/state`)

    expect(state.status).toBe(200)
    expect(state.body.data.featureFlags).toMatchObject({
      scheduler: false,
      manualRun: false,
      kanbanProjection: true,
      artifactIndexing: true,
    })
    instance.dispose()
  })

  it('does not start the production scheduler interval when execution is disabled', () => {
    vi.useFakeTimers()
    try {
      const instance = createCodexUiServer()
      expect(vi.getTimerCount()).toBe(0)

      instance.dispose()

      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('starts and disposes the production scheduler interval when execution is enabled', () => {
    const previous = process.env.CODEXUI_KANBAN_EXECUTION_ENABLED
    process.env.CODEXUI_KANBAN_EXECUTION_ENABLED = '1'
    vi.useFakeTimers()
    try {
      const instance = createCodexUiServer()
      expect(vi.getTimerCount()).toBeGreaterThan(0)

      instance.dispose()

      expect(vi.getTimerCount()).toBe(0)
    } finally {
      if (previous === undefined) {
        delete process.env.CODEXUI_KANBAN_EXECUTION_ENABLED
      } else {
        process.env.CODEXUI_KANBAN_EXECUTION_ENABLED = previous
      }
      vi.useRealTimers()
    }
  })

  it('disposes the automation service bridge subscription during middleware teardown', () => {
    const { bridge, unsubscribe } = createBridge()
    const middleware = createAutomationsMiddleware({
      bridge,
      policy: enabledPolicy,
    })

    middleware.dispose?.()

    expect(unsubscribe).toHaveBeenCalledOnce()
  })

  it('does not dispose a caller-owned automation service during middleware teardown', () => {
    const { bridge, unsubscribe } = createBridge()
    const service = new AutomationsService({
      bridge,
      policy: enabledPolicy,
    })
    const middleware = createAutomationsMiddleware({
      service,
      bridge,
      policy: enabledPolicy,
    })

    middleware.dispose?.()

    expect(unsubscribe).not.toHaveBeenCalled()
    service.dispose()
  })

  it('starts scheduler for caller-owned runnable services without a separate bridge option', () => {
    vi.useFakeTimers()
    const { bridge, unsubscribe } = createBridge()
    const service = new AutomationsService({
      bridge,
      policy: enabledPolicy,
      enableScheduler: true,
    })
    try {
      const middleware = createAutomationsMiddleware({
        service,
        policy: enabledPolicy,
        enableScheduler: true,
      })

      expect(vi.getTimerCount()).toBeGreaterThan(0)

      middleware.dispose?.()

      expect(vi.getTimerCount()).toBe(0)
      expect(unsubscribe).not.toHaveBeenCalled()
    } finally {
      service.dispose()
      vi.useRealTimers()
    }
  })

  it('serves health, templates, state, list, and get with data-wrapped first-class definitions', async () => {
    const { baseUrl, codexHomeDir } = await createHarness()
    await writeNative(codexHomeDir, 'daily-check-dir', nativeRecord)
    const detachedDir = await writeNative(codexHomeDir, 'detached-dir', { ...nativeRecord, id: 'detached-check', targetThreadId: null, status: 'PAUSED' })
    await writeFile(join(detachedDir, 'scheduler.json'), '{not-valid-json', 'utf8')
    await writeNative(codexHomeDir, 'bad-dir', { ...nativeRecord, id: 'bad-check' }, 'status = "BROKEN"\n')

    const health = await requestJson<{ data: { ok: true } }>(`${baseUrl}/codex-api/automations/health`)
    const templates = await requestJson<{ data: Array<{ kind: string }> }>(`${baseUrl}/codex-api/automations/templates`)
    const state = await requestJson<{ data: { storageRoot: string; featureFlags: { scheduler: boolean; kanbanProjection: boolean; artifactIndexing: boolean }; sourceCounts: { native: number }; diagnostics: unknown[]; definitions: Array<{ id: string; nextRunAtIso: string | null }> } }>(`${baseUrl}/codex-api/automations/state`)
    const list = await requestJson<{ data: Array<{ id: string; status: string; legacyStatus: string; targetThreadId: string | null; nextRunAtIso: string | null; storage: { nativeDirName: string } }> }>(`${baseUrl}/codex-api/automations`)
    const get = await requestJson<{ data: { id: string; targetThreadId: string | null; status: string; nextRunAtIso: string | null } }>(`${baseUrl}/codex-api/automations/detached-check`)

    expect(health.status).toBe(200)
    expect(health.body.data.ok).toBe(true)
    expect(templates.status).toBe(200)
    expect(templates.body.data[0]).toMatchObject({ kind: 'heartbeat' })
    expect(state.status).toBe(200)
    expect(state.body.data.storageRoot).toBe(join(codexHomeDir, 'automations'))
    expect(state.body.data.featureFlags.scheduler).toBe(false)
    expect(state.body.data.featureFlags.kanbanProjection).toBe(false)
    expect(state.body.data.featureFlags.artifactIndexing).toBe(false)
    expect(state.body.data.sourceCounts.native).toBe(2)
    expect(state.body.data.diagnostics).toHaveLength(2)
    expect(state.body.data.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: join(detachedDir, 'scheduler.json'), message: 'Invalid scheduler.json state' }),
    ]))
    expect(state.body.data.definitions.map((definition) => definition.id).sort()).toEqual(['daily-check', 'detached-check'])
    expect(state.body.data.definitions.find((definition) => definition.id === 'daily-check')?.nextRunAtIso).toEqual(expect.any(String))
    expect(list.status).toBe(200)
    expect(list.body.data).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'daily-check', status: 'active', legacyStatus: 'ACTIVE', targetThreadId: 'thread-1', nextRunAtIso: expect.any(String) }),
      expect.objectContaining({ id: 'detached-check', status: 'paused', legacyStatus: 'PAUSED', targetThreadId: null, storage: expect.objectContaining({ nativeDirName: 'detached-dir' }) }),
    ]))
    expect(get.status).toBe(200)
    expect(get.body.data).toMatchObject({ id: 'detached-check', targetThreadId: null, status: 'paused', nextRunAtIso: expect.any(String) })
  })

  it('reports scheduler support in state when enabled for the service', async () => {
    const { bridge } = createBridge()
    const { baseUrl } = await createHarness({ bridge, policy: enabledPolicy, enableScheduler: true })

    const state = await requestJson<{ data: { featureFlags: { scheduler: boolean; manualRun: boolean } } }>(`${baseUrl}/codex-api/automations/state`)

    expect(state.status).toBe(200)
    expect(state.body.data.featureFlags.scheduler).toBe(true)
    expect(state.body.data.featureFlags.manualRun).toBe(true)
  })

  it('reports manual run and scheduler support as unavailable when execution policy is disabled', async () => {
    const { bridge } = createBridge()
    const { baseUrl } = await createHarness({
      bridge,
      policy: { ...enabledPolicy, executionMode: 'disabled', executionEnabled: false },
      enableScheduler: true,
    })

    const state = await requestJson<{ data: { featureFlags: { scheduler: boolean; manualRun: boolean } } }>(`${baseUrl}/codex-api/automations/state`)

    expect(state.status).toBe(200)
    expect(state.body.data.featureFlags.scheduler).toBe(false)
    expect(state.body.data.featureFlags.manualRun).toBe(false)
  })

  it('reports scheduler support as unavailable for services without a runner', async () => {
    const service = new AutomationsService({
      policy: enabledPolicy,
      enableScheduler: true,
    })
    const { baseUrl } = await createHarness({
      service,
      policy: enabledPolicy,
      enableScheduler: true,
    })

    const state = await requestJson<{ data: { featureFlags: { scheduler: boolean; manualRun: boolean } } }>(`${baseUrl}/codex-api/automations/state`)

    expect(state.status).toBe(200)
    expect(state.body.data.featureFlags.scheduler).toBe(false)
    expect(state.body.data.featureFlags.manualRun).toBe(false)
    service.dispose()
  })

  it('reports projection and artifact indexing support only when wired for the service', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'codexui-automations-kanban-'))
    codexHomeDirs.push(dataDir)
    const projectRoot = join(dataDir, 'project')
    await mkdir(projectRoot, { recursive: true })
    const kanbanStorage = new KanbanStorage({ dataDir, projectRoot })
    const taskService = new KanbanTaskService({ storage: kanbanStorage, projectRoot, policy: enabledPolicy })
    const kanbanProjection = new AutomationKanbanProjectionService({ storage: kanbanStorage, taskService })
    const { baseUrl } = await createHarness({ kanbanProjection, artifactIndexing: true })

    const state = await requestJson<{ data: { featureFlags: { kanbanProjection: boolean; artifactIndexing: boolean } } }>(`${baseUrl}/codex-api/automations/state`)

    expect(state.status).toBe(200)
    expect(state.body.data.featureFlags.kanbanProjection).toBe(true)
    expect(state.body.data.featureFlags.artifactIndexing).toBe(true)
  })

  it('requires trusted access for sensitive reads, CSRF issuance, and trusted CSRF for mutations', async () => {
    const { baseUrl, codexHomeDir } = await createHarness()
    await writeNative(codexHomeDir, 'daily-check-dir', nativeRecord)

    const untrustedCsrf = await requestJson<{ error: string }>(`${baseUrl}/codex-api/automations/csrf`, {
      headers: { 'x-forwarded-for': '203.0.113.10' },
    })
    expect(untrustedCsrf.status).toBe(403)
    const untrustedHeaders = { 'x-forwarded-for': '203.0.113.10' }
    const untrustedState = await requestJson<{ error: string }>(`${baseUrl}/codex-api/automations/state`, { headers: untrustedHeaders })
    const untrustedTemplates = await requestJson<{ error: string }>(`${baseUrl}/codex-api/automations/templates`, { headers: untrustedHeaders })
    const untrustedList = await requestJson<{ error: string }>(`${baseUrl}/codex-api/automations`, { headers: untrustedHeaders })
    const untrustedGet = await requestJson<{ error: string }>(`${baseUrl}/codex-api/automations/daily-check`, { headers: untrustedHeaders })
    const untrustedRuns = await requestJson<{ error: string }>(`${baseUrl}/codex-api/automations/daily-check/runs`, { headers: untrustedHeaders })
    for (const response of [untrustedState, untrustedTemplates, untrustedList, untrustedGet, untrustedRuns]) {
      expect(response.status).toBe(403)
      expect(response.body.error).toContain('trusted local or Tailscale')
    }

    const missingCsrf = await requestJson<{ error: string; code?: string }>(`${baseUrl}/codex-api/automations`, {
      method: 'POST',
      body: JSON.stringify({ kind: 'heartbeat', name: 'Daily', prompt: 'Prompt', schedule: { type: 'rrule', rrule: 'FREQ=DAILY' }, targetThreadId: 'thread-1' }),
    })
    expect(missingCsrf.status).toBe(403)
    expect(missingCsrf.body.error).toContain('Invalid Automations CSRF token')
    expect(missingCsrf.body.code).toBe('AUTOMATIONS_CSRF_INVALID')

    const csrfHeaders = await readCsrfHeaders(baseUrl)
    const untrustedMutation = await requestJson<{ error: string }>(`${baseUrl}/codex-api/automations`, {
      method: 'POST',
      headers: { ...csrfHeaders, 'x-forwarded-for': '203.0.113.10' },
      body: JSON.stringify({ kind: 'heartbeat', name: 'Daily', prompt: 'Prompt', schedule: { type: 'rrule', rrule: 'FREQ=DAILY' }, targetThreadId: 'thread-1' }),
    })
    expect(untrustedMutation.status).toBe(403)
    expect(untrustedMutation.body.error).toContain('trusted local or Tailscale')
  })

  it('requires trusted CSRF-protected access for manual run requests', async () => {
    const { bridge, rpcCalls } = createBridge()
    const { baseUrl, codexHomeDir } = await createHarness({ bridge, policy: enabledPolicy })
    await writeNative(codexHomeDir, 'daily-check-dir', nativeRecord)

    const missingCsrf = await requestJson<{ error: string; code?: string }>(`${baseUrl}/codex-api/automations/daily-check/run`, {
      method: 'POST',
      body: JSON.stringify({}),
    })
    expect(missingCsrf.status).toBe(403)
    expect(missingCsrf.body.error).toContain('Invalid Automations CSRF token')
    expect(missingCsrf.body.code).toBe('AUTOMATIONS_CSRF_INVALID')

    const csrfHeaders = await readCsrfHeaders(baseUrl)
    const untrusted = await requestJson<{ error: string }>(`${baseUrl}/codex-api/automations/daily-check/run`, {
      method: 'POST',
      headers: { ...csrfHeaders, 'x-forwarded-for': '203.0.113.10' },
      body: JSON.stringify({}),
    })
    expect(untrusted.status).toBe(403)
    expect(untrusted.body.error).toContain('trusted local or Tailscale')

    const started = await requestJson<{ data: { id: string; state: string; threadId: string; turnId: string } }>(
      `${baseUrl}/codex-api/automations/daily-check/run`,
      { method: 'POST', headers: csrfHeaders, body: JSON.stringify({}) },
    )
    expect(started.status).toBe(202)
    expect(started.body.data).toMatchObject({ state: 'running', threadId: 'thread-1', turnId: 'turn_1' })
    expect(rpcCalls.map((call) => call.method)).toEqual(['thread/resume', 'turn/start'])
  })

  it('rejects manual run requests clearly when the bridge is unavailable', async () => {
    const { baseUrl, codexHomeDir } = await createHarness({ policy: enabledPolicy })
    await writeNative(codexHomeDir, 'daily-check-dir', nativeRecord)
    const csrfHeaders = await readCsrfHeaders(baseUrl)

    const response = await requestJson<{ error: string }>(
      `${baseUrl}/codex-api/automations/daily-check/run`,
      { method: 'POST', headers: csrfHeaders, body: JSON.stringify({}) },
    )
    const runs = await requestJson<{ data: unknown[] }>(`${baseUrl}/codex-api/automations/daily-check/runs`)

    expect(response.status).toBe(503)
    expect(response.body.error).toContain('Codex bridge is not available')
    expect(runs.status).toBe(200)
    expect(runs.body.data).toEqual([])
  })

  it('returns manual run history newest-first from persisted runs', async () => {
    const { bridge, notificationListeners } = createBridge()
    const { baseUrl, codexHomeDir } = await createHarness({ bridge, policy: enabledPolicy })
    await writeNative(codexHomeDir, 'daily-check-dir', nativeRecord)
    const csrfHeaders = await readCsrfHeaders(baseUrl)

    const first = await requestJson<{ data: { id: string } }>(
      `${baseUrl}/codex-api/automations/daily-check/run`,
      { method: 'POST', headers: csrfHeaders, body: JSON.stringify({}) },
    )
    expect(first.status).toBe(202)
    await Promise.resolve(notificationListeners[0]!({
      method: 'turn/completed',
      params: { threadId: 'thread-1', turnId: 'turn_1' },
      atIso: new Date().toISOString(),
    }))
    const second = await requestJson<{ data: { id: string } }>(
      `${baseUrl}/codex-api/automations/daily-check/run`,
      { method: 'POST', headers: csrfHeaders, body: JSON.stringify({}) },
    )
    const runs = await requestJson<{ data: Array<{ id: string; state: string; resultSummary: string | null }> }>(
      `${baseUrl}/codex-api/automations/daily-check/runs`,
    )

    expect(second.status).toBe(202)
    expect(runs.status).toBe(200)
    expect(runs.body.data.map((run) => run.id)).toEqual([second.body.data.id, first.body.data.id])
    expect(runs.body.data[1]).toMatchObject({ state: 'completed_no_findings', resultSummary: 'Manual route run completed.' })
  })

  it('marks automation runs read, archived, and unarchived through CSRF-protected triage routes', async () => {
    const { bridge, notificationListeners } = createBridge()
    const { baseUrl, codexHomeDir } = await createHarness({ bridge, policy: enabledPolicy })
    await writeNative(codexHomeDir, 'daily-check-dir', nativeRecord)
    const csrfHeaders = await readCsrfHeaders(baseUrl)

    const started = await requestJson<{ data: { id: string } }>(
      `${baseUrl}/codex-api/automations/daily-check/run`,
      { method: 'POST', headers: csrfHeaders, body: JSON.stringify({}) },
    )
    expect(started.status).toBe(202)
    await Promise.resolve(notificationListeners[0]!({
      method: 'turn/completed',
      params: { threadId: 'thread-1', turnId: 'turn_1' },
      atIso: new Date().toISOString(),
    }))

    const read = await requestJson<{ data: { id: string; readAtIso: string | null; archivedAtIso: string | null } }>(
      `${baseUrl}/codex-api/automations/daily-check/runs/${started.body.data.id}/read`,
      { method: 'POST', headers: csrfHeaders },
    )
    const archived = await requestJson<{ data: { id: string; readAtIso: string | null; archivedAtIso: string | null } }>(
      `${baseUrl}/codex-api/automations/daily-check/runs/${started.body.data.id}/archive`,
      { method: 'POST', headers: csrfHeaders },
    )
    const unarchived = await requestJson<{ data: { id: string; readAtIso: string | null; archivedAtIso: string | null } }>(
      `${baseUrl}/codex-api/automations/daily-check/runs/${started.body.data.id}/unarchive`,
      { method: 'POST', headers: csrfHeaders },
    )

    expect(read.status).toBe(200)
    expect(read.body.data).toMatchObject({ id: started.body.data.id, readAtIso: expect.any(String), archivedAtIso: null })
    expect(archived.status).toBe(200)
    expect(archived.body.data).toMatchObject({ id: started.body.data.id, archivedAtIso: expect.any(String) })
    expect(unarchived.status).toBe(200)
    expect(unarchived.body.data).toMatchObject({ id: started.body.data.id, archivedAtIso: null })
  })

  it('returns 404 when a triage route targets a missing automation run', async () => {
    const { baseUrl, codexHomeDir } = await createHarness()
    await writeNative(codexHomeDir, 'daily-check-dir', nativeRecord)
    const csrfHeaders = await readCsrfHeaders(baseUrl)

    const response = await requestJson<{ error: string }>(
      `${baseUrl}/codex-api/automations/daily-check/runs/missing-run/read`,
      { method: 'POST', headers: csrfHeaders },
    )

    expect(response.status).toBe(404)
    expect(response.body.error).toContain('Automation run not found')
  })

  it('rejects path-like run IDs before triage routes can reach the run store', async () => {
    const { baseUrl, codexHomeDir } = await createHarness()
    await writeNative(codexHomeDir, 'daily-check-dir', nativeRecord)
    const csrfHeaders = await readCsrfHeaders(baseUrl)

    const response = await requestJson<{ error: string }>(
      `${baseUrl}/codex-api/automations/daily-check/runs/${encodeURIComponent('../../other-dir/runs/run_1')}/read`,
      { method: 'POST', headers: csrfHeaders },
    )

    expect(response.status).toBe(400)
    expect(response.body.error).toContain('runId is required')
  })

  it('creates, patches, pauses, resumes, and deletes definitions without changing legacy bridge ownership', async () => {
    const { baseUrl, codexHomeDir } = await createHarness()
    const csrfHeaders = await readCsrfHeaders(baseUrl)

    const created = await requestJson<{ data: { id: string; targetThreadId: string; description: string; notes: string; model: string; runMode: null; nextRunAtIso: string | null; storage: { nativeDirName: string; sidecarPath: string } } }>(
      `${baseUrl}/codex-api/automations`,
      {
        method: 'POST',
        headers: csrfHeaders,
        body: JSON.stringify({
          kind: 'heartbeat',
          name: 'Daily API',
          description: 'created through API',
          prompt: 'Prompt',
          schedule: { type: 'rrule', rrule: 'FREQ=DAILY;BYHOUR=9;BYMINUTE=30;BYDAY=MO,WE' },
          targetThreadId: 'thread-api',
          cwd: '/tmp',
          runMode: null,
          runProfileId: 'default',
          model: 'gpt-5',
          reasoningEffort: 'medium',
          notes: 'operator note',
        }),
      },
    )
    expect(created.status).toBe(201)
    expect(created.body.data).toMatchObject({
      targetThreadId: 'thread-api',
      description: 'created through API',
      notes: 'operator note',
      model: 'gpt-5',
      runMode: null,
    })
    expect(created.body.data.nextRunAtIso).toEqual(expect.any(String))
    const schedulerPath = join(codexHomeDir, 'automations', created.body.data.storage.nativeDirName, 'scheduler.json')
    const createdScheduler = JSON.parse(await readFile(schedulerPath, 'utf8')) as Record<string, unknown>
    expect(createdScheduler).toMatchObject({
      automationId: created.body.data.id,
      sourceDirName: created.body.data.storage.nativeDirName,
      scheduleHash: expect.any(String),
      nextDueAtIso: created.body.data.nextRunAtIso,
      missedRunPolicy: 'one_catch_up',
      unsupportedReason: null,
    })
    await expect(readFile(created.body.data.storage.sidecarPath, 'utf8')).resolves.toContain('"runMode": null')
    await expect(readFile(created.body.data.storage.sidecarPath, 'utf8')).resolves.toContain('"notes": "operator note"')

    const patched = await requestJson<{ data: { id: string; targetThreadId: null; status: string; cwd: string; runMode: 'local'; notes: string; nextRunAtIso: string | null; storage: { sidecarPath: string } } }>(
      `${baseUrl}/codex-api/automations/${created.body.data.id}`,
      {
        method: 'PATCH',
        headers: csrfHeaders,
        body: JSON.stringify({
          targetThreadId: null,
          name: 'Detached API',
          prompt: 'Updated prompt',
          schedule: { type: 'rrule', rrule: 'FREQ=HOURLY;INTERVAL=2' },
          cwd: '/var/tmp',
          runMode: 'local',
          notes: 'updated note',
        }),
      },
    )
    expect(patched.status).toBe(200)
    expect(patched.body.data).toMatchObject({ targetThreadId: null, cwd: '/var/tmp', runMode: 'local', notes: 'updated note' })
    expect(patched.body.data.nextRunAtIso).toEqual(expect.any(String))
    const patchedScheduler = JSON.parse(await readFile(schedulerPath, 'utf8')) as Record<string, unknown>
    expect(patchedScheduler.scheduleHash).not.toBe(createdScheduler.scheduleHash)
    expect(patchedScheduler.nextDueAtIso).toBe(patched.body.data.nextRunAtIso)
    await expect(readFile(patched.body.data.storage.sidecarPath, 'utf8')).resolves.toContain('"runMode": "local"')

    const getDetached = await requestJson<{ data: { id: string; targetThreadId: null; nextRunAtIso: string | null } }>(`${baseUrl}/codex-api/automations/${created.body.data.id}`)
    expect(getDetached.status).toBe(200)
    expect(getDetached.body.data.targetThreadId).toBeNull()
    expect(getDetached.body.data.nextRunAtIso).toBe(patched.body.data.nextRunAtIso)

    const stateAfterPatch = await requestJson<{ data: { definitions: Array<{ id: string; nextRunAtIso: string | null }> } }>(`${baseUrl}/codex-api/automations/state`)
    const listedAfterPatch = await requestJson<{ data: Array<{ id: string; nextRunAtIso: string | null }> }>(`${baseUrl}/codex-api/automations`)
    expect(stateAfterPatch.body.data.definitions.find((definition) => definition.id === created.body.data.id)?.nextRunAtIso).toBe(patched.body.data.nextRunAtIso)
    expect(listedAfterPatch.body.data.find((definition) => definition.id === created.body.data.id)?.nextRunAtIso).toBe(patched.body.data.nextRunAtIso)

    const overdueDue = '2026-04-30T09:00:00.000Z'
    await writeFile(schedulerPath, `${JSON.stringify({ ...patchedScheduler, nextDueAtIso: overdueDue }, null, 2)}\n`, 'utf8')
    const notesOnly = await requestJson<{ data: { notes: string; nextRunAtIso: string | null } }>(
      `${baseUrl}/codex-api/automations/${created.body.data.id}`,
      {
        method: 'PATCH',
        headers: csrfHeaders,
        body: JSON.stringify({ notes: 'metadata-only update' }),
      },
    )
    expect(notesOnly.status).toBe(200)
    expect(notesOnly.body.data).toMatchObject({ notes: 'metadata-only update', nextRunAtIso: overdueDue })
    const metadataOnlyScheduler = JSON.parse(await readFile(schedulerPath, 'utf8')) as Record<string, unknown>
    expect(metadataOnlyScheduler.nextDueAtIso).toBe(overdueDue)
    expect(metadataOnlyScheduler.scheduleHash).toBe(patchedScheduler.scheduleHash)

    const paused = await requestJson<{ data: { status: string; legacyStatus: string } }>(`${baseUrl}/codex-api/automations/${created.body.data.id}/pause`, {
      method: 'POST',
      headers: csrfHeaders,
    })
    await writeFile(schedulerPath, `${JSON.stringify({ ...patchedScheduler, scheduleHash: 'stale-hash', nextDueAtIso: null }, null, 2)}\n`, 'utf8')
    const resumed = await requestJson<{ data: { status: string; legacyStatus: string; nextRunAtIso: string | null } }>(`${baseUrl}/codex-api/automations/${created.body.data.id}/resume`, {
      method: 'POST',
      headers: csrfHeaders,
    })
    expect(paused.body.data).toMatchObject({ status: 'paused', legacyStatus: 'PAUSED' })
    expect(resumed.body.data).toMatchObject({ status: 'active', legacyStatus: 'ACTIVE' })
    expect(resumed.body.data.nextRunAtIso).toEqual(expect.any(String))
    const resumedScheduler = JSON.parse(await readFile(schedulerPath, 'utf8')) as Record<string, unknown>
    expect(resumedScheduler.scheduleHash).toBe(patchedScheduler.scheduleHash)
    expect(resumedScheduler.nextDueAtIso).toBe(resumed.body.data.nextRunAtIso)

    const sidecarOnlyDelete = await requestJson<{ data: { removed: boolean; removedNative: boolean } }>(
      `${baseUrl}/codex-api/automations/${created.body.data.id}`,
      { method: 'DELETE', headers: csrfHeaders },
    )
    expect(sidecarOnlyDelete.body.data).toEqual({ removed: true, removedNative: false })
    await expect(stat(join(codexHomeDir, 'automations', created.body.data.id, 'automation.toml'))).resolves.toBeTruthy()
    await expect(stat(created.body.data.storage.sidecarPath)).rejects.toThrow()

    const nativeDelete = await requestJson<{ data: { removed: boolean; removedNative: boolean } }>(
      `${baseUrl}/codex-api/automations/${created.body.data.id}?removeNative=true`,
      { method: 'DELETE', headers: csrfHeaders },
    )
    expect(nativeDelete.body.data).toEqual({ removed: true, removedNative: true })
    await expect(stat(join(codexHomeDir, 'automations', created.body.data.id))).rejects.toThrow()

    const bridgeCheck = await requestJson<{ data: { ok: true } }>(`${baseUrl}/codex-api/automations/health`)
    expect(bridgeCheck.status).toBe(200)
    expect(bridgeCheck.body.data.ok).toBe(true)
  })

  it('rejects patch transitions that would leave invalid run targets', async () => {
    const { baseUrl } = await createHarness()
    const csrfHeaders = await readCsrfHeaders(baseUrl)

    const created = await requestJson<{ data: { id: string } }>(
      `${baseUrl}/codex-api/automations`,
      {
        method: 'POST',
        headers: csrfHeaders,
        body: JSON.stringify({
          kind: 'heartbeat',
          name: 'Patch Target API',
          prompt: 'Prompt',
          schedule: { type: 'rrule', rrule: 'FREQ=DAILY' },
          targetThreadId: 'thread-patch-target',
        }),
      },
    )
    expect(created.status).toBe(201)

    const chatWithoutThread = await requestJson<{ error: string }>(
      `${baseUrl}/codex-api/automations/${created.body.data.id}`,
      { method: 'PATCH', headers: csrfHeaders, body: JSON.stringify({ targetThreadId: null }) },
    )
    const localWithoutCwd = await requestJson<{ error: string }>(
      `${baseUrl}/codex-api/automations/${created.body.data.id}`,
      { method: 'PATCH', headers: csrfHeaders, body: JSON.stringify({ runMode: 'local' }) },
    )
    const afterInvalidPatches = await requestJson<{ data: { runMode: string | null; targetThreadId: string; cwd: string | null } }>(
      `${baseUrl}/codex-api/automations/${created.body.data.id}`,
    )
    const validLocal = await requestJson<{ data: { runMode: string; cwd: string; targetThreadId: string | null } }>(
      `${baseUrl}/codex-api/automations/${created.body.data.id}`,
      { method: 'PATCH', headers: csrfHeaders, body: JSON.stringify({ runMode: 'local', cwd: '/tmp', targetThreadId: null }) },
    )
    const localWithoutMergedCwd = await requestJson<{ error: string }>(
      `${baseUrl}/codex-api/automations/${created.body.data.id}`,
      { method: 'PATCH', headers: csrfHeaders, body: JSON.stringify({ cwd: null }) },
    )
    const validChat = await requestJson<{ data: { runMode: string; targetThreadId: string } }>(
      `${baseUrl}/codex-api/automations/${created.body.data.id}`,
      { method: 'PATCH', headers: csrfHeaders, body: JSON.stringify({ runMode: 'chat', targetThreadId: 'thread-patch-target-return' }) },
    )

    expect(chatWithoutThread.status).toBe(400)
    expect(chatWithoutThread.body.error).toContain('targetThreadId')
    expect(localWithoutCwd.status).toBe(400)
    expect(localWithoutCwd.body.error).toContain('cwd')
    expect(afterInvalidPatches.status).toBe(200)
    expect(afterInvalidPatches.body.data).toMatchObject({ runMode: null, targetThreadId: 'thread-patch-target', cwd: null })
    expect(validLocal.status).toBe(200)
    expect(validLocal.body.data).toMatchObject({ runMode: 'local', cwd: '/tmp', targetThreadId: null })
    expect(localWithoutMergedCwd.status).toBe(400)
    expect(localWithoutMergedCwd.body.error).toContain('cwd')
    expect(validChat.status).toBe(200)
    expect(validChat.body.data).toMatchObject({ runMode: 'chat', targetThreadId: 'thread-patch-target-return' })
  })

  it('does not expose native cron automations through heartbeat API lookups', async () => {
    const { baseUrl, codexHomeDir } = await createHarness()
    const csrfHeaders = await readCsrfHeaders(baseUrl)
    const cronDir = await writeNative(codexHomeDir, 'cron-source-dir', {
      ...nativeRecord,
      id: 'cron-check',
      kind: 'cron',
      targetThreadId: 'thread-cron',
    })

    const list = await requestJson<{ data: Array<{ id: string }> }>(`${baseUrl}/codex-api/automations`)
    const getById = await requestJson<{ error: string }>(`${baseUrl}/codex-api/automations/cron-check`)
    const getByDir = await requestJson<{ error: string }>(`${baseUrl}/codex-api/automations/cron-source-dir`)
    const patchById = await requestJson<{ error: string }>(
      `${baseUrl}/codex-api/automations/cron-check`,
      { method: 'PATCH', headers: csrfHeaders, body: JSON.stringify({ name: 'Mutated Cron' }) },
    )
    const deleteByDir = await requestJson<{ error: string }>(
      `${baseUrl}/codex-api/automations/cron-source-dir?removeNative=true`,
      { method: 'DELETE', headers: csrfHeaders },
    )

    expect(list.body.data.map((definition) => definition.id)).not.toContain('cron-check')
    expect(getById.status).toBe(404)
    expect(getByDir.status).toBe(404)
    expect(patchById.status).toBe(404)
    expect(deleteByDir.status).toBe(404)
    await expect(stat(join(cronDir, 'automation.toml'))).resolves.toBeTruthy()
  })

  it('creates local and worktree automations without an attached thread id', async () => {
    const { baseUrl } = await createHarness()
    const csrfHeaders = await readCsrfHeaders(baseUrl)
    const local = await requestJson<{ data?: { targetThreadId: string | null; cwd: string; runMode: string }; error?: string }>(
      `${baseUrl}/codex-api/automations`,
      {
        method: 'POST',
        headers: csrfHeaders,
        body: JSON.stringify({
          kind: 'heartbeat',
          name: 'Local Check',
          prompt: 'Inspect local project',
          schedule: { type: 'rrule', rrule: 'FREQ=DAILY' },
          targetThreadId: null,
          cwd: '/tmp',
          runMode: 'local',
        }),
      },
    )
    const worktree = await requestJson<{ data?: { targetThreadId: string | null; cwd: string; runMode: string }; error?: string }>(
      `${baseUrl}/codex-api/automations`,
      {
        method: 'POST',
        headers: csrfHeaders,
        body: JSON.stringify({
          kind: 'heartbeat',
          name: 'Worktree Check',
          prompt: 'Inspect worktree project',
          schedule: { type: 'rrule', rrule: 'FREQ=DAILY' },
          targetThreadId: null,
          cwd: '/var/tmp',
          runMode: 'worktree',
        }),
      },
    )

    expect(local.status).toBe(201)
    expect(local.body.data).toMatchObject({ targetThreadId: null, cwd: '/tmp', runMode: 'local' })
    expect(worktree.status).toBe(201)
    expect(worktree.body.data).toMatchObject({ targetThreadId: null, cwd: '/var/tmp', runMode: 'worktree' })
  })

  it('persists kanban projection settings while preserving omitted patch values and legacy defaults', async () => {
    const { baseUrl, codexHomeDir } = await createHarness({
      kanbanProjectionTaskValidator: {
        async validateTask() {},
      },
    })
    const legacyDir = await writeNative(codexHomeDir, 'legacy-check-dir', {
      ...nativeRecord,
      id: 'legacy-check',
      targetThreadId: 'thread-legacy',
    })
    await writeFile(join(legacyDir, 'codexui.json'), JSON.stringify({ notes: 'legacy sidecar' }, null, 2), 'utf8')
    const csrfHeaders = await readCsrfHeaders(baseUrl)

    const legacy = await requestJson<{ data: { kanbanProjection: unknown } }>(`${baseUrl}/codex-api/automations/legacy-check`)
    expect(legacy.status).toBe(200)
    expect(legacy.body.data.kanbanProjection).toEqual({ mode: 'off' })

    const created = await requestJson<{ data: { id: string; kanbanProjection: unknown; storage: { sidecarPath: string } } }>(
      `${baseUrl}/codex-api/automations`,
      {
        method: 'POST',
        headers: csrfHeaders,
        body: JSON.stringify({
          kind: 'heartbeat',
          name: 'Projection API',
          prompt: 'Prompt',
          schedule: { type: 'rrule', rrule: 'FREQ=DAILY' },
          targetThreadId: 'thread-projection',
          kanbanProjection: { mode: 'run_card', createFor: 'findings_only' },
        }),
      },
    )
    expect(created.status).toBe(201)
    expect(created.body.data.kanbanProjection).toEqual({ mode: 'run_card', createFor: 'findings_only' })
    await expect(readFile(created.body.data.storage.sidecarPath, 'utf8')).resolves.toContain('"kanbanProjection"')

    const notesOnly = await requestJson<{ data: { kanbanProjection: unknown; notes: string } }>(
      `${baseUrl}/codex-api/automations/${created.body.data.id}`,
      {
        method: 'PATCH',
        headers: csrfHeaders,
        body: JSON.stringify({ notes: 'projection preserved' }),
      },
    )
    expect(notesOnly.status).toBe(200)
    expect(notesOnly.body.data).toMatchObject({
      notes: 'projection preserved',
      kanbanProjection: { mode: 'run_card', createFor: 'findings_only' },
    })

    const attached = await requestJson<{ data: { kanbanProjection: unknown } }>(
      `${baseUrl}/codex-api/automations/${created.body.data.id}`,
      {
        method: 'PATCH',
        headers: csrfHeaders,
        body: JSON.stringify({ kanbanProjection: { mode: 'attach_existing_task', taskId: 'task_existing' } }),
      },
    )
    expect(attached.status).toBe(200)
    expect(attached.body.data.kanbanProjection).toEqual({ mode: 'attach_existing_task', taskId: 'task_existing' })

    const definitionCard = await requestJson<{ data: { kanbanProjection: unknown } }>(
      `${baseUrl}/codex-api/automations/${created.body.data.id}`,
      {
        method: 'PATCH',
        headers: csrfHeaders,
        body: JSON.stringify({ kanbanProjection: { mode: 'definition_card' } }),
      },
    )
    expect(definitionCard.status).toBe(200)
    expect(definitionCard.body.data.kanbanProjection).toEqual({ mode: 'definition_card' })

    const off = await requestJson<{ data: { kanbanProjection: unknown } }>(
      `${baseUrl}/codex-api/automations/${created.body.data.id}`,
      {
        method: 'PATCH',
        headers: csrfHeaders,
        body: JSON.stringify({ kanbanProjection: { mode: 'off' } }),
      },
    )
    expect(off.status).toBe(200)
    expect(off.body.data.kanbanProjection).toEqual({ mode: 'off' })

    const malformed = await requestJson<{ error: string }>(
      `${baseUrl}/codex-api/automations/${created.body.data.id}`,
      {
        method: 'PATCH',
        headers: csrfHeaders,
        body: JSON.stringify({ kanbanProjection: { mode: 'attach_existing_task', taskId: '../task' } }),
      },
    )
    expect(malformed.status).toBe(400)
    expect(malformed.body.error).toContain('kanbanProjection.taskId')

    const malformedCreate = await requestJson<{ error: string }>(
      `${baseUrl}/codex-api/automations`,
      {
        method: 'POST',
        headers: csrfHeaders,
        body: JSON.stringify({
          kind: 'heartbeat',
          name: 'Bad Projection API',
          prompt: 'Prompt',
          schedule: { type: 'rrule', rrule: 'FREQ=DAILY' },
          targetThreadId: 'thread-bad-projection',
          kanbanProjection: { mode: 'run_card', createFor: 'everything' },
        }),
      },
    )
    expect(malformedCreate.status).toBe(400)
    expect(malformedCreate.body.error).toContain('kanbanProjection.createFor')
  })

  it('rejects attach-existing kanban projection targets that cannot be validated', async () => {
    const validator = {
      async validateTask(taskId: string) {
        if (taskId === 'task_missing') throw new AutomationValidationError('Kanban projection task not found')
        if (taskId === 'task_archived') throw new AutomationValidationError('Kanban projection task is archived')
      },
    }
    const { baseUrl, codexHomeDir } = await createHarness({ kanbanProjectionTaskValidator: validator })
    await writeNative(codexHomeDir, 'daily-check-dir', nativeRecord)
    const csrfHeaders = await readCsrfHeaders(baseUrl)

    const missing = await requestJson<{ error: string }>(
      `${baseUrl}/codex-api/automations/daily-check`,
      {
        method: 'PATCH',
        headers: csrfHeaders,
        body: JSON.stringify({ kanbanProjection: { mode: 'attach_existing_task', taskId: 'task_missing' } }),
      },
    )
    const archived = await requestJson<{ error: string }>(
      `${baseUrl}/codex-api/automations/daily-check`,
      {
        method: 'PATCH',
        headers: csrfHeaders,
        body: JSON.stringify({ kanbanProjection: { mode: 'attach_existing_task', taskId: 'task_archived' } }),
      },
    )
    const afterRejected = await requestJson<{ data: { kanbanProjection: unknown } }>(
      `${baseUrl}/codex-api/automations/daily-check`,
    )
    const { baseUrl: noValidatorBaseUrl } = await createHarness({ kanbanProjectionTaskValidator: null })
    const noValidatorCsrfHeaders = await readCsrfHeaders(noValidatorBaseUrl)
    const unavailable = await requestJson<{ error: string }>(
      `${noValidatorBaseUrl}/codex-api/automations`,
      {
        method: 'POST',
        headers: noValidatorCsrfHeaders,
        body: JSON.stringify({
          kind: 'heartbeat',
          name: 'No Validator',
          prompt: 'Prompt',
          schedule: { type: 'rrule', rrule: 'FREQ=DAILY' },
          targetThreadId: 'thread-no-validator',
          kanbanProjection: { mode: 'attach_existing_task', taskId: 'task_existing' },
        }),
      },
    )

    expect(missing.status).toBe(400)
    expect(missing.body.error).toContain('Kanban projection task not found')
    expect(archived.status).toBe(400)
    expect(archived.body.error).toContain('Kanban projection task is archived')
    expect(afterRejected.status).toBe(200)
    expect(afterRejected.body.data.kanbanProjection).toEqual({ mode: 'off' })
    expect(unavailable.status).toBe(400)
    expect(unavailable.body.error).toContain('Kanban projection task validation is unavailable')
  })

  it('validates attach-existing kanban projection targets against Kanban storage', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'codexui-automation-kanban-projection-'))
    codexHomeDirs.push(dataDir)
    const projectRoot = join(dataDir, 'project')
    const kanbanStorage = new KanbanStorage({ dataDir, projectRoot })
    const taskService = new KanbanTaskService({ storage: kanbanStorage, projectRoot, policy: enabledPolicy })
    const activeTask = await taskService.createTask({ title: 'Active projection target' })
    const archivedTask = await taskService.createTask({ title: 'Archived projection target' })
    await taskService.archiveTask(archivedTask.id, { version: archivedTask.version })
    const { baseUrl, codexHomeDir } = await createHarness({ kanbanStorage, kanbanDataDir: dataDir, projectRoot })
    await writeNative(codexHomeDir, 'daily-check-dir', nativeRecord)
    const csrfHeaders = await readCsrfHeaders(baseUrl)

    const active = await requestJson<{ data: { kanbanProjection: unknown } }>(
      `${baseUrl}/codex-api/automations/daily-check`,
      {
        method: 'PATCH',
        headers: csrfHeaders,
        body: JSON.stringify({ kanbanProjection: { mode: 'attach_existing_task', taskId: activeTask.id } }),
      },
    )
    const missing = await requestJson<{ error: string }>(
      `${baseUrl}/codex-api/automations/daily-check`,
      {
        method: 'PATCH',
        headers: csrfHeaders,
        body: JSON.stringify({ kanbanProjection: { mode: 'attach_existing_task', taskId: 'task_missing' } }),
      },
    )
    const archived = await requestJson<{ error: string }>(
      `${baseUrl}/codex-api/automations/daily-check`,
      {
        method: 'PATCH',
        headers: csrfHeaders,
        body: JSON.stringify({ kanbanProjection: { mode: 'attach_existing_task', taskId: archivedTask.id } }),
      },
    )

    expect(active.status).toBe(200)
    expect(active.body.data.kanbanProjection).toEqual({ mode: 'attach_existing_task', taskId: activeTask.id })
    expect(missing.status).toBe(400)
    expect(missing.body.error).toContain('Kanban projection task not found')
    expect(archived.status).toBe(400)
    expect(archived.body.error).toContain('Kanban projection task is archived')
  })

  it('projects definition-card settings during create and patch with a stable task id', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'codexui-automation-definition-projection-'))
    codexHomeDirs.push(dataDir)
    const projectRoot = join(dataDir, 'project')
    const kanbanStorage = new KanbanStorage({ dataDir, projectRoot })
    const taskService = new KanbanTaskService({ storage: kanbanStorage, projectRoot, policy: enabledPolicy })
    const kanbanProjection = new AutomationKanbanProjectionService({ storage: kanbanStorage, taskService })
    const { baseUrl } = await createHarness({ kanbanStorage, kanbanDataDir: dataDir, projectRoot, kanbanProjection })
    const csrfHeaders = await readCsrfHeaders(baseUrl)

    const created = await requestJson<{ data: { id: string; kanbanProjection: { mode: string; taskId?: string } } }>(
      `${baseUrl}/codex-api/automations`,
      {
        method: 'POST',
        headers: csrfHeaders,
        body: JSON.stringify({
          kind: 'heartbeat',
          name: 'Definition Projection',
          prompt: 'Prompt',
          schedule: { type: 'rrule', rrule: 'FREQ=DAILY' },
          targetThreadId: 'thread-definition-projection',
          kanbanProjection: { mode: 'definition_card' },
        }),
      },
    )
    const repeatedPatch = await requestJson<{ data: { kanbanProjection: { mode: string; taskId?: string } } }>(
      `${baseUrl}/codex-api/automations/${created.body.data.id}`,
      {
        method: 'PATCH',
        headers: csrfHeaders,
        body: JSON.stringify({ kanbanProjection: { mode: 'definition_card' } }),
      },
    )
    const tasks = await taskService.listTasks({ limit: 100, offset: 0 })

    expect(created.status).toBe(201)
    expect(created.body.data.kanbanProjection).toEqual({ mode: 'definition_card', taskId: expect.any(String) })
    expect(repeatedPatch.status).toBe(200)
    expect(repeatedPatch.body.data.kanbanProjection).toEqual(created.body.data.kanbanProjection)
    expect(tasks.items).toHaveLength(1)
    expect(tasks.items[0]).toMatchObject({
      id: created.body.data.kanbanProjection.taskId,
      title: 'Automation: Definition Projection',
      runState: 'idle',
      currentRunId: '',
    })
  })

  it('accepts monthly and yearly RRULEs while clearing scheduler due state as unsupported', async () => {
    const { baseUrl, codexHomeDir } = await createHarness()
    const csrfHeaders = await readCsrfHeaders(baseUrl)

    const created = await requestJson<{ data: { id: string; nextRunAtIso: string | null; storage: { nativeDirName: string } } }>(
      `${baseUrl}/codex-api/automations`,
      {
        method: 'POST',
        headers: csrfHeaders,
        body: JSON.stringify({
          kind: 'heartbeat',
          name: 'Monthly API',
          prompt: 'Prompt',
          schedule: { type: 'rrule', rrule: 'FREQ=MONTHLY;BYHOUR=9;BYMINUTE=0' },
          targetThreadId: 'thread-monthly',
        }),
      },
    )
    expect(created.status).toBe(201)
    expect(created.body.data.nextRunAtIso).toBeNull()
    const schedulerPath = join(codexHomeDir, 'automations', created.body.data.storage.nativeDirName, 'scheduler.json')
    const monthlyScheduler = JSON.parse(await readFile(schedulerPath, 'utf8')) as Record<string, unknown>
    expect(monthlyScheduler).toMatchObject({
      nextDueAtIso: null,
      unsupportedReason: expect.stringContaining('MONTHLY'),
    })

    const patched = await requestJson<{ data: { nextRunAtIso: string | null } }>(
      `${baseUrl}/codex-api/automations/${created.body.data.id}`,
      {
        method: 'PATCH',
        headers: csrfHeaders,
        body: JSON.stringify({ schedule: { type: 'rrule', rrule: 'FREQ=YEARLY;BYHOUR=9;BYMINUTE=0' } }),
      },
    )
    expect(patched.status).toBe(200)
    expect(patched.body.data.nextRunAtIso).toBeNull()
    const yearlyScheduler = JSON.parse(await readFile(schedulerPath, 'utf8')) as Record<string, unknown>
    expect(yearlyScheduler).toMatchObject({
      nextDueAtIso: null,
      unsupportedReason: expect.stringContaining('YEARLY'),
    })
  })

  it('resolves exact native record ids before source directory names for get, patch, and delete', async () => {
    const { baseUrl, codexHomeDir } = await createHarness()
    const csrfHeaders = await readCsrfHeaders(baseUrl)
    const ambiguousId = 'aaa-native-id'
    const sourceDirMatch = await writeNative(codexHomeDir, ambiguousId, {
      ...nativeRecord,
      id: 'source-dir-record',
      name: 'Source Dir Match',
      targetThreadId: 'thread-source-dir',
    })
    const nativeIdMatch = await writeNative(codexHomeDir, 'zzz-other-source-dir', {
      ...nativeRecord,
      id: ambiguousId,
      name: 'Native Id Match',
      targetThreadId: 'thread-native-id',
    })
    await writeFile(join(sourceDirMatch, 'codexui.json'), JSON.stringify({ notes: 'source sidecar' }, null, 2), 'utf8')
    await writeFile(join(nativeIdMatch, 'codexui.json'), JSON.stringify({ notes: 'native sidecar' }, null, 2), 'utf8')

    const read = await requestJson<{ data: { id: string; targetThreadId: string; name: string } }>(
      `${baseUrl}/codex-api/automations/${ambiguousId}`,
    )
    const patched = await requestJson<{ data: { id: string; targetThreadId: string; name: string } }>(
      `${baseUrl}/codex-api/automations/${ambiguousId}`,
      {
        method: 'PATCH',
        headers: csrfHeaders,
        body: JSON.stringify({ name: 'Patched Native Id Match' }),
      },
    )
    const deleted = await requestJson<{ data: { removed: boolean; removedNative: boolean } }>(
      `${baseUrl}/codex-api/automations/${ambiguousId}`,
      { method: 'DELETE', headers: csrfHeaders },
    )

    expect(read.status).toBe(200)
    expect(read.body.data).toMatchObject({ id: ambiguousId, targetThreadId: 'thread-native-id', name: 'Native Id Match' })
    expect(patched.status).toBe(200)
    expect(patched.body.data).toMatchObject({ id: ambiguousId, targetThreadId: 'thread-native-id', name: 'Patched Native Id Match' })
    expect(deleted.status).toBe(200)
    expect(deleted.body.data).toEqual({ removed: true, removedNative: false })
    await expect(stat(join(nativeIdMatch, 'codexui.json'))).rejects.toThrow()
    await expect(stat(join(sourceDirMatch, 'codexui.json'))).resolves.toBeTruthy()
  })

  it('rejects duplicate creates for an existing heartbeat targetThreadId', async () => {
    const { baseUrl, codexHomeDir } = await createHarness()
    await writeNative(codexHomeDir, 'daily-check-dir', nativeRecord)
    const csrfHeaders = await readCsrfHeaders(baseUrl)

    const duplicate = await requestJson<{ error: string }>(
      `${baseUrl}/codex-api/automations`,
      {
        method: 'POST',
        headers: csrfHeaders,
        body: JSON.stringify({
          kind: 'heartbeat',
          name: 'Duplicate Daily Check',
          prompt: 'This must not overwrite the existing native record',
          schedule: { type: 'rrule', rrule: 'FREQ=HOURLY' },
          targetThreadId: 'thread-1',
        }),
      },
    )
    const existing = await requestJson<{ data: { id: string; name: string; prompt: string; schedule: { rrule: string } } }>(
      `${baseUrl}/codex-api/automations/daily-check`,
    )

    expect(duplicate.status).toBe(409)
    expect(duplicate.body.error).toContain('Automation already exists for targetThreadId')
    expect(existing.status).toBe(200)
    expect(existing.body.data).toMatchObject({
      id: 'daily-check',
      name: 'Daily Check',
      prompt: 'Review the thread',
      schedule: { rrule: 'FREQ=DAILY;INTERVAL=1' },
    })
  })

  it('rejects duplicate patch targetThreadId without mutating the patched automation', async () => {
    const { baseUrl, codexHomeDir } = await createHarness()
    await writeNative(codexHomeDir, 'daily-check-dir', nativeRecord)
    await writeNative(codexHomeDir, 'other-check-dir', {
      ...nativeRecord,
      id: 'other-check',
      name: 'Other Check',
      prompt: 'Keep this prompt',
      rrule: 'FREQ=WEEKLY',
      targetThreadId: 'thread-2',
    })
    const csrfHeaders = await readCsrfHeaders(baseUrl)

    const duplicate = await requestJson<{ error: string }>(
      `${baseUrl}/codex-api/automations/other-check`,
      {
        method: 'PATCH',
        headers: csrfHeaders,
        body: JSON.stringify({
          targetThreadId: 'thread-1',
          name: 'Must Not Persist',
          prompt: 'Must not overwrite',
        }),
      },
    )
    const existing = await requestJson<{ data: { id: string; name: string; prompt: string; targetThreadId: string; schedule: { rrule: string } } }>(
      `${baseUrl}/codex-api/automations/other-check`,
    )

    expect(duplicate.status).toBe(409)
    expect(duplicate.body.error).toContain('Automation already exists for targetThreadId')
    expect(existing.status).toBe(200)
    expect(existing.body.data).toMatchObject({
      id: 'other-check',
      name: 'Other Check',
      prompt: 'Keep this prompt',
      targetThreadId: 'thread-2',
      schedule: { rrule: 'FREQ=WEEKLY' },
    })
  })

  it('falls back for invalid sidecar fields on read and reports a warning diagnostic', async () => {
    const { baseUrl, codexHomeDir } = await createHarness()
    const dir = await writeNative(codexHomeDir, 'daily-check-dir', nativeRecord)
    await writeFile(join(dir, 'codexui.json'), JSON.stringify({
      description: 'valid description',
      cwd: 'relative/path',
      runProfileId: '',
      model: '',
      reasoningEffort: '',
      notes: 'x'.repeat(4001),
    }, null, 2), 'utf8')

    const state = await requestJson<{
      data: {
        diagnostics: Array<{ automationId: string; severity: string; message: string; path: string }>
        definitions: Array<{
          id: string
          description: string | null
          cwd: string | null
          runProfileId: string | null
          model: string | null
          reasoningEffort: string | null
          notes: string
        }>
      }
    }>(`${baseUrl}/codex-api/automations/state`)
    const definition = state.body.data.definitions.find((item) => item.id === 'daily-check')

    expect(state.status).toBe(200)
    expect(definition).toMatchObject({
      description: 'valid description',
      cwd: null,
      runProfileId: null,
      model: null,
      reasoningEffort: null,
      notes: '',
    })
    expect(state.body.data.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        automationId: 'daily-check',
        severity: 'warning',
        message: expect.stringContaining('Invalid codexui.json sidecar'),
        path: join(dir, 'codexui.json'),
      }),
    ]))
  })
})

function readRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}
