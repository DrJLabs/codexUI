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

  it('refreshes stale Automations CSRF tokens using structured error codes', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string> | undefined
      if (url === '/codex-api/automations/csrf' && fetchMock.mock.calls.length === 1) return jsonResponse(200, { data: { csrfToken: 'old' } })
      if (url === '/codex-api/automations/auto_1/pause' && headers?.['x-codexui-automations-csrf'] === 'old') {
        return jsonResponse(403, { error: 'Forbidden', code: 'AUTOMATIONS_CSRF_INVALID' })
      }
      if (url === '/codex-api/automations/csrf') return jsonResponse(200, { data: { csrfToken: 'new' } })
      if (url === '/codex-api/automations/auto_1/pause' && headers?.['x-codexui-automations-csrf'] === 'new') return jsonResponse(200, { data: automationFixture({ id: 'auto_1', status: 'paused' }) })
      return jsonResponse(500, { error: 'unexpected request' })
    })
    vi.stubGlobal('fetch', fetchMock)
    const { pauseAutomation } = await import('./automationsGateway')
    await expect(pauseAutomation('auto_1')).resolves.toMatchObject({ id: 'auto_1', status: 'paused' })
    expect(fetchMock).toHaveBeenCalledTimes(4)
  })

  it('does not refresh ordinary 403 responses that are not CSRF failures', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === '/codex-api/automations/csrf') return jsonResponse(200, { data: { csrfToken: 'token' } })
      return jsonResponse(403, { error: 'Automations API requires trusted local or Tailscale access', code: 'AUTOMATIONS_UNTRUSTED_ACCESS' })
    })
    vi.stubGlobal('fetch', fetchMock)
    const { pauseAutomation } = await import('./automationsGateway')
    await expect(pauseAutomation('auto_1')).rejects.toThrow('Automations API requires trusted local or Tailscale access')
    expect(fetchMock).toHaveBeenCalledTimes(2)
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

  it('reports heartbeat renderer state through the protected state endpoint', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string> | undefined
      if (url === '/codex-api/automations/csrf') return jsonResponse(200, { data: { csrfToken: 'token' } })
      expect(url).toBe('/codex-api/automations/heartbeat-thread-state')
      expect(init?.method).toBe('POST')
      expect(headers?.['x-codexui-automations-csrf']).toBe('token')
      expect(JSON.parse(String(init?.body))).toEqual({
        threadId: 'thread_1',
        eligible: true,
        reason: null,
      })
      return jsonResponse(200, { data: { ok: true } })
    })
    vi.stubGlobal('fetch', fetchMock)
    const { reportHeartbeatThreadState } = await import('./automationsGateway')
    await expect(reportHeartbeatThreadState({ threadId: 'thread_1', eligible: true, reason: null })).resolves.toBeUndefined()
  })

  it('reads heartbeat live-state eligibility from the app-server renderer state endpoint', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      expect(url).toBe('/codex-api/thread-live-state?threadId=thread_1')
      return jsonResponse(200, { threadId: 'thread_1', isInProgress: true, liveStateError: null })
    }))
    const { readHeartbeatThreadLiveState } = await import('./automationsGateway')
    await expect(readHeartbeatThreadLiveState('thread_1')).resolves.toEqual({
      threadId: 'thread_1',
      eligible: false,
      reason: 'Heartbeat target thread is busy',
    })
  })

  it('preserves heartbeat live-state error messages from the app-server endpoint', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      expect(url).toBe('/codex-api/thread-live-state?threadId=missing_thread')
      return jsonResponse(200, {
        threadId: 'missing_thread',
        isInProgress: false,
        liveStateError: { kind: 'readFailed', message: 'thread/read failed: missing transcript' },
      })
    }))
    const { readHeartbeatThreadLiveState } = await import('./automationsGateway')
    await expect(readHeartbeatThreadLiveState('missing_thread')).resolves.toEqual({
      threadId: 'missing_thread',
      eligible: false,
      reason: 'thread/read failed: missing transcript',
    })
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

  it('posts run triage mutations with Automations CSRF protection', async () => {
    const mutationRequests: Array<{ url: string; method?: string; csrf?: string }> = []
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/codex-api/automations/csrf') return jsonResponse(200, { data: { csrfToken: 'token' } })
      const headers = init?.headers as Record<string, string> | undefined
      mutationRequests.push({
        url,
        method: init?.method,
        csrf: headers?.['x-codexui-automations-csrf'],
      })
      return jsonResponse(200, { data: automationRunFixture({ id: 'run_1', automationId: 'daily-check' }) })
    })
    vi.stubGlobal('fetch', fetchMock)
    const {
      archiveAutomationRun,
      markAutomationRunRead,
      unarchiveAutomationRun,
    } = await import('./automationsGateway')

    await expect(markAutomationRunRead('daily-check', 'run_1')).resolves.toMatchObject({ id: 'run_1' })
    await expect(archiveAutomationRun('daily-check', 'run_1')).resolves.toMatchObject({ id: 'run_1' })
    await expect(unarchiveAutomationRun('daily-check', 'run_1')).resolves.toMatchObject({ id: 'run_1' })

    expect(mutationRequests).toEqual([
      {
        url: '/codex-api/automations/daily-check/runs/run_1/read',
        method: 'POST',
        csrf: 'token',
      },
      {
        url: '/codex-api/automations/daily-check/runs/run_1/archive',
        method: 'POST',
        csrf: 'token',
      },
      {
        url: '/codex-api/automations/daily-check/runs/run_1/unarchive',
        method: 'POST',
        csrf: 'token',
      },
    ])
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
    cwds: [],
    runMode: null,
    model: null,
    reasoningEffort: null,
    localEnvironmentConfigPath: null,
    autoArchiveNoFindings: false,
    notifyOnFindings: false,
    kanbanProjection: { mode: 'off' },
    notes: '',
    storage: {
      nativeDirName: 'auto_1',
      nativePath: '/tmp/automations/auto_1/automation.toml',
      sidecarPath: '/tmp/automations/auto_1/codexui.local.json',
      memoryPath: '/tmp/automations/auto_1/memory.md',
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
    findings: null,
    inboxTitle: '',
    inboxSummary: '',
    readAtIso: null,
    archivedAtIso: null,
    kanbanTaskId: null,
    reviewPacketId: null,
    proposalIds: [],
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
