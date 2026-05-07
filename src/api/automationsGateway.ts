import type { AutomationDefinition, AutomationRun, AutomationsState, AutomationTemplate, AutomationRunMode } from '../types/automations'

export type CreateAutomationInput = {
  kind: 'heartbeat' | 'cron'
  name: string
  prompt: string
  schedule: { type: 'rrule'; rrule: string }
  targetThreadId: string | null
  description?: string | null
  cwd?: string | null
  cwds?: string[]
  runMode?: AutomationRunMode | null
  model?: string | null
  reasoningEffort?: string | null
  localEnvironmentConfigPath?: string | null
  notes?: string
}

export type PatchAutomationInput = Partial<Omit<CreateAutomationInput, 'kind' | 'targetThreadId'>> & {
  targetThreadId?: string | null
}

export type HeartbeatThreadStateInput = {
  threadId: string
  eligible: boolean
  reason?: string | null
}

type AutomationsApiResponse<T> = {
  data: T
}

type AutomationsRequestError = Error & { status?: number; error?: string; code?: string }

let csrfToken = ''

async function requestAutomations<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`/codex-api/automations${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...init.headers,
    },
  })
  const payload = await response.json().catch(() => null) as AutomationsApiResponse<T> | { error?: string } | null
  if (!response.ok) {
    const message = payload && 'error' in payload && typeof payload.error === 'string'
      ? payload.error
      : `Automations request failed (${response.status})`
    throw Object.assign(new Error(message), payload, { status: response.status }) as AutomationsRequestError
  }
  if (!payload || !('data' in payload)) {
    throw new Error('Automations response did not include data')
  }
  return payload.data
}

async function readCsrfToken(): Promise<string> {
  if (csrfToken) return csrfToken
  const response = await requestAutomations<{ csrfToken: string }>('/csrf')
  csrfToken = response.csrfToken
  return csrfToken
}

async function requestProtectedAutomations<T>(path: string, init: RequestInit = {}, retried = false): Promise<T> {
  const token = await readCsrfToken()
  try {
    return await requestAutomations<T>(path, {
      ...init,
      headers: {
        ...init.headers,
        'x-codexui-automations-csrf': token,
      },
    })
  } catch (error) {
    if (!retried && isStaleCsrfError(error)) {
      csrfToken = ''
      return await requestProtectedAutomations<T>(path, init, true)
    }
    throw error
  }
}

export async function loadAutomationsState(): Promise<AutomationsState> {
  return await requestAutomations<AutomationsState>('/state')
}

export async function listAutomationTemplates(): Promise<AutomationTemplate[]> {
  return await requestAutomations<AutomationTemplate[]>('/templates')
}

export async function createAutomation(input: CreateAutomationInput): Promise<AutomationDefinition> {
  return await requestProtectedAutomations<AutomationDefinition>('/', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export async function updateAutomation(id: string, patch: PatchAutomationInput): Promise<AutomationDefinition> {
  return await requestProtectedAutomations<AutomationDefinition>(`/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  })
}

export async function runAutomationNow(id: string): Promise<AutomationRun> {
  return await requestProtectedAutomations<AutomationRun>(`/${encodeURIComponent(id)}/run`, {
    method: 'POST',
    body: JSON.stringify({}),
  })
}

export async function reportHeartbeatThreadState(input: HeartbeatThreadStateInput): Promise<void> {
  await requestProtectedAutomations<{ ok: true }>('/heartbeat-thread-state', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export async function readHeartbeatThreadLiveState(threadId: string): Promise<HeartbeatThreadStateInput> {
  try {
    const response = await fetch(`/codex-api/thread-live-state?threadId=${encodeURIComponent(threadId)}`)
    const payload = await response.json().catch(() => null) as Record<string, unknown> | null
    if (!response.ok) {
      return { threadId, eligible: false, reason: readErrorMessage(payload, `Heartbeat renderer state failed to load (${response.status})`) }
    }
    if (payload?.liveStateError) {
      return { threadId, eligible: false, reason: readErrorMessage(payload.liveStateError, 'Heartbeat renderer state failed to load') }
    }
    if (payload?.isInProgress === true) {
      return { threadId, eligible: false, reason: 'Heartbeat target thread is busy' }
    }
    return { threadId, eligible: true, reason: null }
  } catch (error) {
    return {
      threadId,
      eligible: false,
      reason: error instanceof Error ? error.message : 'Heartbeat renderer state failed to load',
    }
  }
}

export async function listAutomationRuns(id: string): Promise<AutomationRun[]> {
  return await requestAutomations<AutomationRun[]>(`/${encodeURIComponent(id)}/runs`)
}

export async function markAutomationRunRead(automationId: string, runId: string): Promise<AutomationRun> {
  return await requestProtectedAutomations<AutomationRun>(
    `/${encodeURIComponent(automationId)}/runs/${encodeURIComponent(runId)}/read`,
    {
      method: 'POST',
      body: JSON.stringify({}),
    },
  )
}

export async function archiveAutomationRun(automationId: string, runId: string): Promise<AutomationRun> {
  return await requestProtectedAutomations<AutomationRun>(
    `/${encodeURIComponent(automationId)}/runs/${encodeURIComponent(runId)}/archive`,
    {
      method: 'POST',
      body: JSON.stringify({}),
    },
  )
}

export async function unarchiveAutomationRun(automationId: string, runId: string): Promise<AutomationRun> {
  return await requestProtectedAutomations<AutomationRun>(
    `/${encodeURIComponent(automationId)}/runs/${encodeURIComponent(runId)}/unarchive`,
    {
      method: 'POST',
      body: JSON.stringify({}),
    },
  )
}

export async function pauseAutomation(id: string): Promise<AutomationDefinition> {
  return await requestProtectedAutomations<AutomationDefinition>(`/${encodeURIComponent(id)}/pause`, {
    method: 'POST',
    body: JSON.stringify({}),
  })
}

export async function resumeAutomation(id: string): Promise<AutomationDefinition> {
  return await requestProtectedAutomations<AutomationDefinition>(`/${encodeURIComponent(id)}/resume`, {
    method: 'POST',
    body: JSON.stringify({}),
  })
}

export async function deleteAutomation(id: string, options: { removeNative?: boolean } = {}): Promise<{ removed: boolean; removedNative: boolean }> {
  const query = new URLSearchParams()
  if (options.removeNative === true) query.set('removeNative', 'true')
  const encodedQuery = query.toString()
  return await requestProtectedAutomations<{ removed: boolean; removedNative: boolean }>(
    `/${encodeURIComponent(id)}${encodedQuery ? `?${encodedQuery}` : ''}`,
    {
      method: 'DELETE',
      body: JSON.stringify({}),
    },
  )
}

function isStaleCsrfError(error: unknown): error is AutomationsRequestError {
  if (!(error instanceof Error)) return false
  const requestError = error as AutomationsRequestError
  return requestError.status === 403
    && (requestError.code === 'AUTOMATIONS_CSRF_INVALID' || error.message.toLowerCase().includes('csrf'))
}

function readErrorMessage(value: unknown, fallback: string): string {
  if (typeof value === 'string' && value.trim()) return value.trim()
  if (value && typeof value === 'object' && 'error' in value && typeof (value as { error?: unknown }).error === 'string') {
    return (value as { error: string }).error
  }
  if (value && typeof value === 'object' && 'message' in value && typeof (value as { message?: unknown }).message === 'string') {
    return (value as { message: string }).message
  }
  return fallback
}
