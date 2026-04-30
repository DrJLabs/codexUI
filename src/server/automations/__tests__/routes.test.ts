import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { createServer as createHttpServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import express from 'express'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { KanbanExecutionPolicy } from '../../../types/kanban'
import type { CodexBridgeNotification, CodexBridgeRuntime } from '../../codexAppServerBridge'
import { createServer as createCodexUiServer } from '../../httpServer'
import { createAutomationsMiddleware } from '../index'
import { AUTOMATIONS_CSRF_HEADER } from '../csrf'
import {
  parseAutomationCreateInput,
  parseAutomationDeleteOptions,
  parseAutomationPatchInput,
  parseAutomationRouteParams,
} from '../schema'
import { serializeAutomationToml, type ThreadAutomationRecord } from '../nativeStore'

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
  status: 'ACTIVE',
  targetThreadId: 'thread-1',
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
  policy?: KanbanExecutionPolicy
} = {}) {
  const codexHomeDir = await mkdtemp(join(tmpdir(), 'codexui-automations-api-'))
  codexHomeDirs.push(codexHomeDir)
  const app = express()
  app.use('/codex-api/automations', createAutomationsMiddleware({
    codexHomeDir,
    bridge: options.bridge,
    policy: options.policy,
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
      return () => {}
    }),
    dispose: vi.fn(),
  }
  return { bridge, rpcCalls, notificationListeners }
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
    expect(() => parseAutomationCreateInput({ kind: 'cron' })).toThrow(/kind/)
    expect(() => parseAutomationCreateInput({ kind: 'heartbeat', name: '', prompt: 'p', schedule: { type: 'rrule', rrule: 'FREQ=DAILY' }, targetThreadId: 'thread' })).toThrow(/name/)
    expect(() => parseAutomationCreateInput({ kind: 'heartbeat', name: 'n', prompt: '', schedule: { type: 'rrule', rrule: 'FREQ=DAILY' }, targetThreadId: 'thread' })).toThrow(/prompt/)
    expect(() => parseAutomationCreateInput({ kind: 'heartbeat', name: 'n', prompt: 'p', schedule: { type: 'rrule', rrule: 'FREQ=DAILY;FREQ=HOURLY' }, targetThreadId: 'thread' })).toThrow(/RRULE/)
    expect(() => parseAutomationCreateInput({ kind: 'heartbeat', name: 'n', prompt: 'p', schedule: { type: 'rrule', rrule: 'FREQ=DAILY' }, targetThreadId: '' })).toThrow(/targetThreadId/)
    expect(() => parseAutomationPatchInput({ cwd: 'relative/path' })).toThrow(/cwd/)
    expect(() => parseAutomationPatchInput({ model: '' })).toThrow(/model/)
    expect(() => parseAutomationPatchInput({ runMode: 'shell' })).toThrow(/runMode/)
    expect(() => parseAutomationPatchInput({ notes: 'x'.repeat(4001) })).toThrow(/notes/)
    expect(() => parseAutomationRouteParams({ automationId: '' })).toThrow(/automationId/)
    expect(parseAutomationDeleteOptions({ removeNative: 'true' }, {})).toEqual({ removeNative: true })
    expect(() => parseAutomationDeleteOptions({}, { removeNative: 'yes' })).toThrow(/removeNative/)
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

  it('serves health, templates, state, list, and get with data-wrapped first-class definitions', async () => {
    const { baseUrl, codexHomeDir } = await createHarness()
    await writeNative(codexHomeDir, 'daily-check-dir', nativeRecord)
    await writeNative(codexHomeDir, 'detached-dir', { ...nativeRecord, id: 'detached-check', targetThreadId: null, status: 'PAUSED' })
    await writeNative(codexHomeDir, 'bad-dir', { ...nativeRecord, id: 'bad-check' }, 'status = "BROKEN"\n')

    const health = await requestJson<{ data: { ok: true } }>(`${baseUrl}/codex-api/automations/health`)
    const templates = await requestJson<{ data: Array<{ kind: string }> }>(`${baseUrl}/codex-api/automations/templates`)
    const state = await requestJson<{ data: { storageRoot: string; sourceCounts: { native: number }; diagnostics: unknown[]; definitions: Array<{ id: string }> } }>(`${baseUrl}/codex-api/automations/state`)
    const list = await requestJson<{ data: Array<{ id: string; status: string; legacyStatus: string; targetThreadId: string | null; storage: { nativeDirName: string } }> }>(`${baseUrl}/codex-api/automations`)
    const get = await requestJson<{ data: { id: string; targetThreadId: string | null; status: string } }>(`${baseUrl}/codex-api/automations/detached-check`)

    expect(health.status).toBe(200)
    expect(health.body.data.ok).toBe(true)
    expect(templates.status).toBe(200)
    expect(templates.body.data[0]).toMatchObject({ kind: 'heartbeat' })
    expect(state.status).toBe(200)
    expect(state.body.data.storageRoot).toBe(join(codexHomeDir, 'automations'))
    expect(state.body.data.sourceCounts.native).toBe(2)
    expect(state.body.data.diagnostics).toHaveLength(1)
    expect(state.body.data.definitions.map((definition) => definition.id).sort()).toEqual(['daily-check', 'detached-check'])
    expect(list.status).toBe(200)
    expect(list.body.data).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'daily-check', status: 'active', legacyStatus: 'ACTIVE', targetThreadId: 'thread-1' }),
      expect.objectContaining({ id: 'detached-check', status: 'paused', legacyStatus: 'PAUSED', targetThreadId: null, storage: expect.objectContaining({ nativeDirName: 'detached-dir' }) }),
    ]))
    expect(get.status).toBe(200)
    expect(get.body.data).toMatchObject({ id: 'detached-check', targetThreadId: null, status: 'paused' })
  })

  it('requires trusted access for CSRF issuance and trusted CSRF for mutations', async () => {
    const { baseUrl } = await createHarness()

    const untrustedCsrf = await requestJson<{ error: string }>(`${baseUrl}/codex-api/automations/csrf`, {
      headers: { 'x-forwarded-for': '203.0.113.10' },
    })
    expect(untrustedCsrf.status).toBe(403)

    const missingCsrf = await requestJson<{ error: string }>(`${baseUrl}/codex-api/automations`, {
      method: 'POST',
      body: JSON.stringify({ kind: 'heartbeat', name: 'Daily', prompt: 'Prompt', schedule: { type: 'rrule', rrule: 'FREQ=DAILY' }, targetThreadId: 'thread-1' }),
    })
    expect(missingCsrf.status).toBe(403)
    expect(missingCsrf.body.error).toContain('Invalid Automations CSRF token')

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

    const missingCsrf = await requestJson<{ error: string }>(`${baseUrl}/codex-api/automations/daily-check/run`, {
      method: 'POST',
      body: JSON.stringify({}),
    })
    expect(missingCsrf.status).toBe(403)
    expect(missingCsrf.body.error).toContain('Invalid Automations CSRF token')

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

  it('creates, patches, pauses, resumes, and deletes definitions without changing legacy bridge ownership', async () => {
    const { baseUrl, codexHomeDir } = await createHarness()
    const csrfHeaders = await readCsrfHeaders(baseUrl)

    const created = await requestJson<{ data: { id: string; targetThreadId: string; description: string; notes: string; model: string; runMode: null; storage: { sidecarPath: string } } }>(
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
    await expect(readFile(created.body.data.storage.sidecarPath, 'utf8')).resolves.toContain('"runMode": null')
    await expect(readFile(created.body.data.storage.sidecarPath, 'utf8')).resolves.toContain('"notes": "operator note"')

    const patched = await requestJson<{ data: { id: string; targetThreadId: null; status: string; cwd: string; runMode: 'chat'; notes: string; storage: { sidecarPath: string } } }>(
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
          runMode: 'chat',
          notes: 'updated note',
        }),
      },
    )
    expect(patched.status).toBe(200)
    expect(patched.body.data).toMatchObject({ targetThreadId: null, cwd: '/var/tmp', runMode: 'chat', notes: 'updated note' })
    await expect(readFile(patched.body.data.storage.sidecarPath, 'utf8')).resolves.toContain('"runMode": "chat"')

    const getDetached = await requestJson<{ data: { id: string; targetThreadId: null } }>(`${baseUrl}/codex-api/automations/${created.body.data.id}`)
    expect(getDetached.status).toBe(200)
    expect(getDetached.body.data.targetThreadId).toBeNull()

    const paused = await requestJson<{ data: { status: string; legacyStatus: string } }>(`${baseUrl}/codex-api/automations/${created.body.data.id}/pause`, {
      method: 'POST',
      headers: csrfHeaders,
    })
    const resumed = await requestJson<{ data: { status: string; legacyStatus: string } }>(`${baseUrl}/codex-api/automations/${created.body.data.id}/resume`, {
      method: 'POST',
      headers: csrfHeaders,
    })
    expect(paused.body.data).toMatchObject({ status: 'paused', legacyStatus: 'PAUSED' })
    expect(resumed.body.data).toMatchObject({ status: 'active', legacyStatus: 'ACTIVE' })

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
