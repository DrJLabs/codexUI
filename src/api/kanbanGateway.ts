import type {
  CreateKanbanTaskInput,
  KanbanApiResponse,
  KanbanStateSnapshot,
  KanbanRun,
  KanbanStatus,
  KanbanTask,
  ReplaceKanbanAcceptanceCriteriaInput,
  StartKanbanRunResponse,
  InterruptKanbanRunResponse,
  UpdateKanbanTaskInput,
} from '../types/kanban'

let csrfToken = ''

async function requestKanban<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`/codex-api/kanban${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...init.headers,
    },
  })
  const payload = await response.json().catch(() => null) as KanbanApiResponse<T> | { error?: string } | null
  if (!response.ok) {
    const message = payload && 'error' in payload && typeof payload.error === 'string'
      ? payload.error
      : `Kanban request failed (${response.status})`
    throw new Error(message)
  }
  if (!payload || !('data' in payload)) {
    throw new Error('Kanban response did not include data')
  }
  return payload.data
}

async function requestKanbanText(path: string, init: RequestInit = {}): Promise<string> {
  const response = await fetch(`/codex-api/kanban${path}`, init)
  if (!response.ok) {
    throw new Error(`Kanban request failed (${response.status})`)
  }
  return await response.text()
}

async function readCsrfToken(): Promise<string> {
  if (csrfToken) return csrfToken
  const response = await requestKanban<{ csrfToken: string }>('/csrf')
  csrfToken = response.csrfToken
  return csrfToken
}

export async function loadKanbanState(): Promise<KanbanStateSnapshot> {
  return await requestKanban<KanbanStateSnapshot>('/state')
}

export async function createKanbanTask(input: CreateKanbanTaskInput): Promise<KanbanTask> {
  return await requestKanban<KanbanTask>('/tasks', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export async function updateKanbanTask(taskId: string, patch: UpdateKanbanTaskInput): Promise<KanbanTask> {
  return await requestKanban<KanbanTask>(`/tasks/${encodeURIComponent(taskId)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  })
}

export async function setKanbanTaskStatus(taskId: string, status: KanbanStatus, reason?: string): Promise<KanbanTask> {
  return await requestKanban<KanbanTask>(`/tasks/${encodeURIComponent(taskId)}/status`, {
    method: 'POST',
    body: JSON.stringify({ status, reason }),
  })
}

export async function archiveKanbanTask(taskId: string): Promise<KanbanTask> {
  return await requestKanban<KanbanTask>(`/tasks/${encodeURIComponent(taskId)}/archive`, {
    method: 'POST',
    body: JSON.stringify({}),
  })
}

export async function replaceKanbanAcceptanceCriteria(
  taskId: string,
  criteria: ReplaceKanbanAcceptanceCriteriaInput['criteria'],
): Promise<KanbanTask> {
  return await requestKanban<KanbanTask>(`/tasks/${encodeURIComponent(taskId)}/criteria/replace`, {
    method: 'POST',
    body: JSON.stringify({ criteria }),
  })
}

export async function startKanbanTaskRun(taskId: string): Promise<StartKanbanRunResponse> {
  const token = await readCsrfToken()
  return await requestKanban<StartKanbanRunResponse>(`/tasks/${encodeURIComponent(taskId)}/run`, {
    method: 'POST',
    headers: { 'x-codexui-kanban-csrf': token },
    body: JSON.stringify({}),
  })
}

export async function interruptKanbanRun(runId: string): Promise<InterruptKanbanRunResponse> {
  const token = await readCsrfToken()
  return await requestKanban<InterruptKanbanRunResponse>(`/runs/${encodeURIComponent(runId)}/interrupt`, {
    method: 'POST',
    headers: { 'x-codexui-kanban-csrf': token },
    body: JSON.stringify({}),
  })
}

export async function loadKanbanRun(runId: string): Promise<KanbanRun> {
  return await requestKanban<KanbanRun>(`/runs/${encodeURIComponent(runId)}`)
}

export async function loadKanbanRunLogs(runId: string): Promise<string> {
  return await requestKanbanText(`/runs/${encodeURIComponent(runId)}/logs`)
}

export async function loadKanbanRunEvents(runId: string): Promise<string> {
  return await requestKanbanText(`/runs/${encodeURIComponent(runId)}/events`)
}

type KanbanEventSubscriptionOptions = {
  onError?: (error: Event) => void
}

function handleKanbanEvent(event: MessageEvent, handler: (event: unknown) => void): void {
  try {
    handler(JSON.parse(event.data) as unknown)
  } catch (error) {
    console.warn('Ignoring malformed Kanban event payload', error)
  }
}

export function subscribeKanbanEvents(
  handler: (event: unknown) => void,
  options: KanbanEventSubscriptionOptions = {},
): () => void {
  const source = new EventSource('/codex-api/kanban/events')
  source.addEventListener('task.created', (event) => handleKanbanEvent(event, handler))
  source.addEventListener('task.updated', (event) => handleKanbanEvent(event, handler))
  source.addEventListener('task.status_changed', (event) => handleKanbanEvent(event, handler))
  source.onerror = (error) => {
    options.onError?.(error)
  }
  return () => source.close()
}
