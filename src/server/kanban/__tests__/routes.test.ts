import { mkdtemp } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import express from 'express'
import { afterEach, describe, expect, it } from 'vitest'
import { createKanbanMiddleware } from '../index'

const servers: Server[] = []

async function createTestServer() {
  const dataDir = await mkdtemp(join(tmpdir(), 'codexui-kanban-routes-'))
  const app = express()
  app.use('/codex-api/kanban', createKanbanMiddleware({ dataDir, projectRoot: join(dataDir, 'project') }))
  const server = createServer(app)
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Expected test server port')
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
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

  it('creates tasks and rejects invalid status transitions', async () => {
    const { baseUrl } = await createTestServer()

    const created = await requestJson<{ data: { id: string; title: string; status: string } }>(
      `${baseUrl}/codex-api/kanban/tasks`,
      {
        method: 'POST',
        body: JSON.stringify({ title: 'Route task', description: 'Created over HTTP' }),
      },
    )
    const invalidTransition = await requestJson<{ error: string }>(
      `${baseUrl}/codex-api/kanban/tasks/${created.body.data.id}/status`,
      {
        method: 'POST',
        body: JSON.stringify({ status: 'done' }),
      },
    )

    expect(created.status).toBe(201)
    expect(created.body.data.title).toBe('Route task')
    expect(created.body.data.status).toBe('backlog')
    expect(invalidTransition.status).toBe(400)
    expect(invalidTransition.body.error).toContain('Invalid status transition')
  })
})
