import { mkdtemp, writeFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import express from 'express'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createKanbanMiddleware } from '../index'
import { resolveProjectStatePath } from '../paths'

const servers: Server[] = []

async function createTestServer() {
  const dataDir = await mkdtemp(join(tmpdir(), 'codexui-kanban-routes-'))
  const projectRoot = join(dataDir, 'project')
  const app = express()
  app.use('/codex-api/kanban', createKanbanMiddleware({ dataDir, projectRoot }))
  const server = createServer(app)
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Expected test server port')
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    dataDir,
    projectRoot,
  }
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

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve())
  })))
})

describe('createKanbanMiddleware', () => {
  it('serves health and initial state under /codex-api/kanban', async () => {
    const { baseUrl } = await createTestServer()

    const health = await requestJson<{ data: { ok: true } }>(`${baseUrl}/codex-api/kanban/health`)
    const state = await requestJson<{ data: { board: { title: string }; tasks: unknown[] } }>(`${baseUrl}/codex-api/kanban/state`)

    expect(health.status).toBe(200)
    expect(health.body.data.ok).toBe(true)
    expect(state.status).toBe(200)
    expect(state.body.data.board.title).toBe('Kanban')
    expect(state.body.data.tasks).toEqual([])
  })

  it('serves SSE with streaming-friendly headers', async () => {
    const { baseUrl } = await createTestServer()

    const response = await fetch(`${baseUrl}/codex-api/kanban/events`)
    await response.body?.cancel()

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/event-stream')
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('x-accel-buffering')).toBe('no')
  })

  it('creates tasks, normalizes labels, and rejects invalid status transitions', async () => {
    const { baseUrl } = await createTestServer()

    const created = await requestJson<{ data: { id: string; title: string; status: string; labels: Array<{ id: string; name: string }> } }>(
      `${baseUrl}/codex-api/kanban/tasks`,
      {
        method: 'POST',
        body: JSON.stringify({
          title: 'Route task',
          description: 'Created over HTTP',
          labels: [{ name: 'Bug' }, { name: 'bug' }],
        }),
      },
    )
    const invalidTransition = await requestJson<{ error: string }>(
      `${baseUrl}/codex-api/kanban/tasks/${created.body.data.id}/status`,
      {
        method: 'POST',
        body: JSON.stringify({ status: 'done' }),
      },
    )
    const emptyTitle = await requestJson<{ error: string }>(
      `${baseUrl}/codex-api/kanban/tasks/${created.body.data.id}`,
      {
        method: 'PATCH',
        body: JSON.stringify({ title: '   ' }),
      },
    )
    const missingCriteria = await requestJson<{ error: string }>(
      `${baseUrl}/codex-api/kanban/tasks/${created.body.data.id}/criteria/replace`,
      {
        method: 'POST',
        body: JSON.stringify({}),
      },
    )

    expect(created.status).toBe(201)
    expect(created.body.data.title).toBe('Route task')
    expect(created.body.data.status).toBe('backlog')
    expect(created.body.data.labels.map((label) => label.id)).toEqual(['label_bug', 'label_bug_2'])
    expect(invalidTransition.status).toBe(400)
    expect(invalidTransition.body.error).toContain('Invalid status transition')
    expect(emptyTitle.status).toBe(400)
    expect(emptyTitle.body.error).toContain('Task title is required')
    expect(missingCriteria.status).toBe(400)
    expect(missingCriteria.body.error).toContain('Acceptance criteria must be an array')
  })

  it('preserves 400 status for malformed JSON request bodies', async () => {
    const { baseUrl } = await createTestServer()

    const response = await requestJson<{ error: string }>(
      `${baseUrl}/codex-api/kanban/tasks`,
      {
        method: 'POST',
        body: '{ invalid json',
      },
    )

    expect(response.status).toBe(400)
    expect(response.body.error).toBeTruthy()
  })

  it('returns 500 for corrupt server-side state files', async () => {
    const { baseUrl, dataDir, projectRoot } = await createTestServer()
    await requestJson<{ data: unknown }>(`${baseUrl}/codex-api/kanban/state`)
    await writeFile(resolveProjectStatePath(dataDir, projectRoot), '{ invalid json', 'utf8')
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    try {
      const state = await requestJson<{ error: string }>(`${baseUrl}/codex-api/kanban/state`)

      expect(state.status).toBe(500)
      expect(state.body.error).toBe('Kanban request failed')
      expect(consoleError).toHaveBeenCalled()
    } finally {
      consoleError.mockRestore()
    }
  })
})
