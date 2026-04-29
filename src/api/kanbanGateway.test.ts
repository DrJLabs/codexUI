import { beforeEach, describe, expect, it, vi } from 'vitest'

describe('kanbanGateway CSRF handling', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.unstubAllGlobals()
  })

  it('refreshes a stale CSRF token once after a protected mutation returns 403', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/codex-api/kanban/csrf' && fetchMock.mock.calls.length === 1) {
        return jsonResponse(200, { data: { csrfToken: 'token-old' } })
      }
      if (url === '/codex-api/kanban/tasks' && (init?.headers as Record<string, string>)?.['x-codexui-kanban-csrf'] === 'token-old') {
        return jsonResponse(403, { error: 'Invalid Kanban CSRF token' })
      }
      if (url === '/codex-api/kanban/csrf') {
        return jsonResponse(200, { data: { csrfToken: 'token-new' } })
      }
      if (url === '/codex-api/kanban/tasks' && (init?.headers as Record<string, string>)?.['x-codexui-kanban-csrf'] === 'token-new') {
        return jsonResponse(201, { data: { id: 'task_1', title: 'Created after refresh' } })
      }
      return jsonResponse(500, { error: 'unexpected request' })
    })
    vi.stubGlobal('fetch', fetchMock)
    const { createKanbanTask } = await import('./kanbanGateway')

    const task = await createKanbanTask({ title: 'Created after refresh' })

    expect(task).toMatchObject({ id: 'task_1' })
    expect(fetchMock).toHaveBeenCalledTimes(4)
  })

  it('subscribes to run lifecycle events from the Kanban event stream', async () => {
    const eventSources: MockEventSource[] = []
    vi.stubGlobal('EventSource', class extends MockEventSource {
      constructor(url: string) {
        super(url)
        eventSources.push(this)
      }
    })
    const { subscribeKanbanEvents } = await import('./kanbanGateway')

    const unsubscribe = subscribeKanbanEvents(() => {})

    expect(eventSources).toHaveLength(1)
    expect(eventSources[0]!.listeners.map((listener) => listener.type)).toEqual(expect.arrayContaining([
      'run.started',
      'run.completed',
      'run.cancelled',
    ]))
    unsubscribe()
    expect(eventSources[0]!.closed).toBe(true)
  })
})

function jsonResponse(status: number, payload: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  } as Response
}

class MockEventSource {
  readonly listeners: Array<{ type: string; listener: EventListenerOrEventListenerObject }> = []
  onerror: ((error: Event) => void) | null = null
  closed = false

  constructor(readonly url: string) {}

  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    this.listeners.push({ type, listener })
  }

  close(): void {
    this.closed = true
  }
}
