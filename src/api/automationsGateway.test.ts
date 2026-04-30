import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AutomationDefinition, AutomationRun } from '../types/automations'

describe('automationsGateway', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.unstubAllGlobals()
  })

  it('loads the Automations state from the first-class API', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      expect(url).toBe('/codex-api/automations/state')
      return jsonResponse(200, {
        data: {
          storageRoot: '/tmp/automations',
          featureFlags: { scheduler: false, manualRun: false, kanbanProjection: false, artifactIndexing: false },
          sourceCounts: { native: 0, codexui: 0 },
          diagnostics: [],
          definitions: [],
        },
      })
    }))
    const { loadAutomationsState } = await import('./automationsGateway')
    await expect(loadAutomationsState()).resolves.toMatchObject({ storageRoot: '/tmp/automations' })
  })

  it('refreshes a stale Automations CSRF token once for protected mutations', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string> | undefined
      if (url === '/codex-api/automations/csrf' && fetchMock.mock.calls.length === 1) return jsonResponse(200, { data: { csrfToken: 'old' } })
      if (url === '/codex-api/automations/auto_1/pause' && headers?.['x-codexui-automations-csrf'] === 'old') return jsonResponse(403, { error: 'Invalid Automations CSRF token' })
      if (url === '/codex-api/automations/csrf') return jsonResponse(200, { data: { csrfToken: 'new' } })
      if (url === '/codex-api/automations/auto_1/pause' && headers?.['x-codexui-automations-csrf'] === 'new') return jsonResponse(200, { data: automationFixture({ id: 'auto_1', status: 'paused' }) })
      return jsonResponse(500, { error: 'unexpected request' })
    })
    vi.stubGlobal('fetch', fetchMock)
    const { pauseAutomation } = await import('./automationsGateway')
    await expect(pauseAutomation('auto_1')).resolves.toMatchObject({ id: 'auto_1', status: 'paused' })
    expect(fetchMock).toHaveBeenCalledTimes(4)
  })

  it('sends destructive delete with removeNative=true when requested', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === '/codex-api/automations/csrf') return jsonResponse(200, { data: { csrfToken: 'token' } })
      expect(url).toBe('/codex-api/automations/auto_1?removeNative=true')
      return jsonResponse(200, { data: { removed: true, removedNative: true } })
    })
    vi.stubGlobal('fetch', fetchMock)
    const { deleteAutomation } = await import('./automationsGateway')
    await expect(deleteAutomation('auto_1', { removeNative: true })).resolves.toEqual({ removed: true, removedNative: true })
  })

  it('starts manual runs through the protected run endpoint', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string> | undefined
      if (url === '/codex-api/automations/csrf') return jsonResponse(200, { data: { csrfToken: 'token' } })
      expect(url).toBe('/codex-api/automations/auto_1/run')
      expect(init?.method).toBe('POST')
      expect(headers?.['x-codexui-automations-csrf']).toBe('token')
      return jsonResponse(202, { data: automationRunFixture({ id: 'run_1', automationId: 'auto_1' }) })
    })
    vi.stubGlobal('fetch', fetchMock)
    const { runAutomationNow } = await import('./automationsGateway')
    await expect(runAutomationNow('auto_1')).resolves.toMatchObject({ id: 'run_1', automationId: 'auto_1' })
  })

  it('lists manual run history for an automation', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      expect(url).toBe('/codex-api/automations/auto_1/runs')
      return jsonResponse(200, { data: [automationRunFixture({ id: 'run_2' }), automationRunFixture({ id: 'run_1' })] })
    }))
    const { listAutomationRuns } = await import('./automationsGateway')
    await expect(listAutomationRuns('auto_1')).resolves.toEqual([
      expect.objectContaining({ id: 'run_2' }),
      expect.objectContaining({ id: 'run_1' }),
    ])
  })

  it('refreshes stale CSRF tokens once for manual run requests', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string> | undefined
      if (url === '/codex-api/automations/csrf' && fetchMock.mock.calls.length === 1) return jsonResponse(200, { data: { csrfToken: 'old' } })
      if (url === '/codex-api/automations/auto_1/run' && headers?.['x-codexui-automations-csrf'] === 'old') return jsonResponse(403, { error: 'Invalid Automations CSRF token' })
      if (url === '/codex-api/automations/csrf') return jsonResponse(200, { data: { csrfToken: 'new' } })
      if (url === '/codex-api/automations/auto_1/run' && headers?.['x-codexui-automations-csrf'] === 'new') return jsonResponse(202, { data: automationRunFixture({ id: 'run_1' }) })
      return jsonResponse(500, { error: 'unexpected request' })
    })
    vi.stubGlobal('fetch', fetchMock)
    const { runAutomationNow } = await import('./automationsGateway')
    await expect(runAutomationNow('auto_1')).resolves.toMatchObject({ id: 'run_1' })
    expect(fetchMock).toHaveBeenCalledTimes(4)
  })

  it('throws API error messages from error payloads', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(422, { error: 'Invalid RRULE' })))
    const { loadAutomationsState } = await import('./automationsGateway')
    await expect(loadAutomationsState()).rejects.toThrow('Invalid RRULE')
  })
})

function automationFixture(overrides: Partial<AutomationDefinition> = {}): AutomationDefinition {
  return {
    id: 'auto_1',
    kind: 'heartbeat',
    source: 'native',
    nativeId: 'auto_1',
    name: 'Daily check',
    description: null,
    prompt: 'Check this thread',
    status: 'active',
    legacyStatus: 'ACTIVE',
    schedule: { type: 'rrule', rrule: 'FREQ=DAILY;BYHOUR=9;BYMINUTE=0' },
    targetThreadId: 'thread_1',
    projectRoot: null,
    cwd: null,
    runMode: null,
    runProfileId: null,
    model: null,
    reasoningEffort: null,
    autoArchiveNoFindings: false,
    notifyOnFindings: false,
    kanbanProjection: { mode: 'off' },
    notes: '',
    storage: {
      nativeDirName: 'auto_1',
      nativePath: '/tmp/automations/auto_1/automation.toml',
      sidecarPath: '/tmp/automations/auto_1/codexui.json',
    },
    createdAtIso: '2026-04-30T00:00:00.000Z',
    updatedAtIso: '2026-04-30T00:00:00.000Z',
    lastRunAtIso: null,
    nextRunAtIso: null,
    version: 1,
    ...overrides,
  }
}

function automationRunFixture(overrides: Partial<AutomationRun> = {}): AutomationRun {
  return {
    id: 'run_1',
    automationId: 'auto_1',
    automationName: 'Daily check',
    trigger: 'manual',
    runMode: 'chat',
    state: 'running',
    promptSnapshot: 'Check this thread',
    scheduleSnapshot: { type: 'rrule', rrule: 'FREQ=DAILY;BYHOUR=9;BYMINUTE=0' },
    dueAtIso: null,
    nextDueAtIso: null,
    runProfileId: 'workspace-coding',
    runProfileSnapshot: {
      id: 'workspace-coding',
      name: 'Workspace coding',
      description: '',
      model: '',
      reasoningEffort: 'medium',
      sandboxMode: 'workspace-write',
      approvalPolicy: 'on-request',
      networkAccess: false,
      writableRoots: [],
      createdAtIso: '2026-04-30T00:00:00.000Z',
      updatedAtIso: '2026-04-30T00:00:00.000Z',
    },
    targetThreadId: 'thread_1',
    cwd: null,
    worktreePath: null,
    branchName: null,
    threadId: 'thread_1',
    turnId: 'turn_1',
    resultSummary: null,
    errorMessage: null,
    runJsonPath: '/tmp/run.json',
    eventsPath: '/tmp/events.jsonl',
    logPath: '/tmp/run.log',
    createdAtIso: '2026-04-30T00:00:00.000Z',
    startedAtIso: '2026-04-30T00:00:00.000Z',
    completedAtIso: null,
    updatedAtIso: '2026-04-30T00:00:00.000Z',
    ...overrides,
  }
}

function jsonResponse(status: number, payload: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  } as Response
}
