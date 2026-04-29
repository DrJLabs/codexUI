import type {
  CreateKanbanTaskInput,
  CreateKanbanProposalInput,
  KanbanApiResponse,
  KanbanBoardConfig,
  KanbanStateSnapshot,
  KanbanRun,
  KanbanReviewPacket,
  KanbanProposal,
  KanbanProposalStatus,
  KanbanTask,
  KanbanTaskListResult,
  ListKanbanTasksParams,
  ReplaceKanbanAcceptanceCriteriaInput,
  ReorderKanbanTaskInput,
  ResolveKanbanProposalInput,
  StartKanbanRunResponse,
  InterruptKanbanRunResponse,
  UpdateKanbanBoardConfigInput,
  VersionedSetKanbanTaskStatusInput,
  VersionedUpdateKanbanTaskInput,
} from '../types/kanban'

let csrfToken = ''

type KanbanRequestError = Error & { status?: number; error?: string }

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
    throw Object.assign(new Error(message), payload, { status: response.status }) as KanbanRequestError
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

async function requestProtectedKanban<T>(path: string, init: RequestInit = {}, retried = false): Promise<T> {
  const token = await readCsrfToken()
  try {
    return await requestKanban<T>(path, {
      ...init,
      headers: {
        ...init.headers,
        'x-codexui-kanban-csrf': token,
      },
    })
  } catch (error) {
    if (!retried && isStaleCsrfError(error)) {
      csrfToken = ''
      return await requestProtectedKanban<T>(path, init, true)
    }
    throw error
  }
}

export async function loadKanbanState(): Promise<KanbanStateSnapshot> {
  return await requestKanban<KanbanStateSnapshot>('/state')
}

function formatListKanbanTasksQuery(params: ListKanbanTasksParams): string {
  const query = new URLSearchParams()
  if (params.q) query.set('q', params.q)
  for (const priority of params.priority ?? []) {
    query.append('priority', priority)
  }
  if (params.assignee) query.set('assignee', params.assignee)
  if (params.label) query.set('label', params.label)
  if (typeof params.limit === 'number') query.set('limit', String(params.limit))
  if (typeof params.offset === 'number') query.set('offset', String(params.offset))
  const encoded = query.toString()
  return encoded ? `?${encoded}` : ''
}

export async function listKanbanTasks(params: ListKanbanTasksParams): Promise<KanbanTaskListResult> {
  return await requestKanban<KanbanTaskListResult>(`/tasks${formatListKanbanTasksQuery(params)}`)
}

export async function loadKanbanConfig(): Promise<KanbanBoardConfig> {
  return await requestKanban<KanbanBoardConfig>('/config')
}

export async function updateKanbanConfig(input: UpdateKanbanBoardConfigInput): Promise<KanbanBoardConfig> {
  return await requestProtectedKanban<KanbanBoardConfig>('/config', {
    method: 'PUT',
    body: JSON.stringify(input),
  })
}

export async function createKanbanTask(input: CreateKanbanTaskInput): Promise<KanbanTask> {
  return await requestProtectedKanban<KanbanTask>('/tasks', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export async function updateKanbanTask(taskId: string, patch: VersionedUpdateKanbanTaskInput): Promise<KanbanTask> {
  return await requestProtectedKanban<KanbanTask>(`/tasks/${encodeURIComponent(taskId)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  })
}

export async function setKanbanTaskStatus(taskId: string, input: VersionedSetKanbanTaskStatusInput): Promise<KanbanTask> {
  return await requestProtectedKanban<KanbanTask>(`/tasks/${encodeURIComponent(taskId)}/status`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export async function archiveKanbanTask(taskId: string, version: number): Promise<KanbanTask> {
  return await requestProtectedKanban<KanbanTask>(`/tasks/${encodeURIComponent(taskId)}/archive`, {
    method: 'POST',
    body: JSON.stringify({ version }),
  })
}

export async function reorderKanbanTask(taskId: string, input: ReorderKanbanTaskInput): Promise<KanbanTask> {
  return await requestProtectedKanban<KanbanTask>(`/tasks/${encodeURIComponent(taskId)}/reorder`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export async function deleteKanbanTask(taskId: string, version: number): Promise<KanbanTask> {
  return await requestProtectedKanban<KanbanTask>(`/tasks/${encodeURIComponent(taskId)}`, {
    method: 'DELETE',
    body: JSON.stringify({ version }),
  })
}

export async function replaceKanbanAcceptanceCriteria(
  taskId: string,
  input: ReplaceKanbanAcceptanceCriteriaInput,
): Promise<KanbanTask> {
  return await requestProtectedKanban<KanbanTask>(`/tasks/${encodeURIComponent(taskId)}/criteria/replace`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export async function startKanbanTaskRun(taskId: string): Promise<StartKanbanRunResponse> {
  return await requestProtectedKanban<StartKanbanRunResponse>(`/tasks/${encodeURIComponent(taskId)}/run`, {
    method: 'POST',
    body: JSON.stringify({}),
  })
}

export async function interruptKanbanRun(runId: string): Promise<InterruptKanbanRunResponse> {
  return await requestProtectedKanban<InterruptKanbanRunResponse>(`/runs/${encodeURIComponent(runId)}/interrupt`, {
    method: 'POST',
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

export async function regenerateKanbanReviewPacket(taskId: string): Promise<{ packet: KanbanReviewPacket; task: KanbanTask }> {
  return await requestProtectedKanban<{ packet: KanbanReviewPacket; task: KanbanTask }>(`/tasks/${encodeURIComponent(taskId)}/review-packet/regenerate`, {
    method: 'POST',
    body: JSON.stringify({}),
  })
}

export async function listKanbanProposals(status?: KanbanProposalStatus): Promise<KanbanProposal[]> {
  const query = new URLSearchParams()
  if (status) query.set('status', status)
  const encoded = query.toString()
  return await requestKanban<KanbanProposal[]>(`/proposals${encoded ? `?${encoded}` : ''}`)
}

export async function createKanbanProposal(input: CreateKanbanProposalInput): Promise<KanbanProposal> {
  return await requestProtectedKanban<KanbanProposal>('/proposals', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export async function approveKanbanProposal(proposalId: string, input: ResolveKanbanProposalInput = {}): Promise<KanbanProposal> {
  return await requestProtectedKanban<KanbanProposal>(`/proposals/${encodeURIComponent(proposalId)}/approve`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export async function rejectKanbanProposal(proposalId: string, input: ResolveKanbanProposalInput = {}): Promise<KanbanProposal> {
  return await requestProtectedKanban<KanbanProposal>(`/proposals/${encodeURIComponent(proposalId)}/reject`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

function isStaleCsrfError(error: unknown): error is KanbanRequestError {
  return error instanceof Error
    && (error as KanbanRequestError).status === 403
    && error.message.toLowerCase().includes('csrf')
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
  source.addEventListener('proposal.created', (event) => handleKanbanEvent(event, handler))
  source.addEventListener('proposal.resolved', (event) => handleKanbanEvent(event, handler))
  source.onerror = (error) => {
    options.onError?.(error)
  }
  return () => source.close()
}
