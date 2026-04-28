import type {
  CreateKanbanTaskInput,
  KanbanApiResponse,
  KanbanStateSnapshot,
  KanbanStatus,
  KanbanTask,
  ReplaceKanbanAcceptanceCriteriaInput,
  UpdateKanbanTaskInput,
} from '../types/kanban'

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

export function subscribeKanbanEvents(handler: (event: unknown) => void): () => void {
  const source = new EventSource('/codex-api/kanban/events')
  source.addEventListener('task.created', (event) => handler(JSON.parse(event.data) as unknown))
  source.addEventListener('task.updated', (event) => handler(JSON.parse(event.data) as unknown))
  source.addEventListener('task.status_changed', (event) => handler(JSON.parse(event.data) as unknown))
  source.onerror = () => {
    source.close()
  }
  return () => source.close()
}
