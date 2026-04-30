import type { AutomationDefinition, AutomationRun, AutomationsState, AutomationTemplate, AutomationRunMode } from '../types/automations'

export type CreateAutomationInput = {
  kind: 'heartbeat'
  name: string
  prompt: string
  schedule: { type: 'rrule'; rrule: string }
  targetThreadId: string
  description?: string | null
  cwd?: string | null
  runMode?: AutomationRunMode | null
  runProfileId?: string | null
  model?: string | null
  reasoningEffort?: string | null
  notes?: string
}

export type PatchAutomationInput = Partial<Omit<CreateAutomationInput, 'kind' | 'targetThreadId'>> & {
  targetThreadId?: string | null
}

type AutomationsApiResponse<T> = {
  data: T
}

type AutomationsRequestError = Error & { status?: number; error?: string }

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

export async function listAutomationRuns(id: string): Promise<AutomationRun[]> {
  return await requestAutomations<AutomationRun[]>(`/${encodeURIComponent(id)}/runs`)
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
  return error instanceof Error
    && (error as AutomationsRequestError).status === 403
    && error.message.toLowerCase().includes('csrf')
}
