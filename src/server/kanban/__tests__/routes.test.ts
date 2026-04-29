import { mkdtemp, writeFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import express from 'express'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { KANBAN_CSRF_HEADER } from '../csrf'
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

    const created = await requestJson<{ data: { id: string; title: string; status: string; version: number; labels: Array<{ id: string; name: string }> } }>(
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
        body: JSON.stringify({ version: created.body.data.version, status: 'done' }),
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
    expect(invalidTransition.status).toBe(409)
    expect(invalidTransition.body.error).toContain('Invalid status transition')
    expect(emptyTitle.status).toBe(400)
    expect(emptyTitle.body.error).toContain('Task title is required')
    expect(missingCriteria.status).toBe(400)
    expect(missingCriteria.body.error).toContain('Acceptance criteria must be an array')
  })

  it('lists tasks with pagination metadata', async () => {
    const { baseUrl } = await createTestServer()
    await requestJson<{ data: unknown }>(`${baseUrl}/codex-api/kanban/tasks`, {
      method: 'POST',
      body: JSON.stringify({ title: 'Deploy dashboard' }),
    })

    const listed = await requestJson<{
      data: { items: Array<{ title: string }>; total: number; limit: number; offset: number; hasMore: boolean }
    }>(`${baseUrl}/codex-api/kanban/tasks?q=deploy&limit=20&offset=0`)

    expect(listed.status).toBe(200)
    expect(listed.body.data.items.map((task) => task.title)).toEqual(['Deploy dashboard'])
    expect(listed.body.data.total).toBe(1)
    expect(listed.body.data.limit).toBe(20)
    expect(listed.body.data.offset).toBe(0)
    expect(listed.body.data.hasMore).toBe(false)
  })

  it('honors priority, assignee, and label filters over HTTP', async () => {
    const { baseUrl } = await createTestServer()
    const high = await requestJson<{ data: { id: string; version: number } }>(
      `${baseUrl}/codex-api/kanban/tasks`,
      {
        method: 'POST',
        body: JSON.stringify({
          title: 'High deploy',
          labels: [{ name: 'Ops' }],
        }),
      },
    )
    await requestJson<{ data: unknown }>(
      `${baseUrl}/codex-api/kanban/tasks`,
      {
        method: 'POST',
        body: JSON.stringify({
          title: 'Normal docs',
          labels: [{ name: 'Docs' }],
        }),
      },
    )
    await requestJson<{ data: unknown }>(
      `${baseUrl}/codex-api/kanban/tasks/${high.body.data.id}`,
      {
        method: 'PATCH',
        body: JSON.stringify({
          version: high.body.data.version,
          priority: 'high',
          assignee: 'codex:auto',
        }),
      },
    )

    const listed = await requestJson<{
      data: { items: Array<{ id: string; priority: string; assignee: string }>; total: number }
    }>(`${baseUrl}/codex-api/kanban/tasks?priority=high&assignee=codex%3Aauto&label=Ops`)

    expect(listed.status).toBe(200)
    expect(listed.body.data.items).toEqual([
      expect.objectContaining({
        id: high.body.data.id,
        priority: 'high',
        assignee: 'codex:auto',
      }),
    ])
    expect(listed.body.data.total).toBe(1)
  })

  it('updates metadata fields and rejects invalid metadata patches over HTTP', async () => {
    const { baseUrl } = await createTestServer()
    const created = await requestJson<{ data: { id: string; version: number } }>(
      `${baseUrl}/codex-api/kanban/tasks`,
      {
        method: 'POST',
        body: JSON.stringify({ title: 'Metadata task' }),
      },
    )

    const updated = await requestJson<{
      data: {
        version: number
        priority: string
        assignee: string
        model: string
        thinking: string
        dueAtIso: string
        estimateMinutes: number
        actualMinutes: null
      }
    }>(
      `${baseUrl}/codex-api/kanban/tasks/${created.body.data.id}`,
      {
        method: 'PATCH',
        body: JSON.stringify({
          version: created.body.data.version,
          priority: 'critical',
          assignee: 'codex:thread:019e-route',
          model: 'gpt-5.4-codex',
          thinking: 'high',
          dueAtIso: '2026-05-04',
          estimateMinutes: 90,
          actualMinutes: null,
        }),
      },
    )
    const invalidActor = await requestJson<{ error: string }>(
      `${baseUrl}/codex-api/kanban/tasks/${created.body.data.id}`,
      {
        method: 'PATCH',
        body: JSON.stringify({ version: updated.body.data.version, assignee: 'codex:thread:' }),
      },
    )
    const invalidMinutes = await requestJson<{ error: string }>(
      `${baseUrl}/codex-api/kanban/tasks/${created.body.data.id}`,
      {
        method: 'PATCH',
        body: JSON.stringify({ version: updated.body.data.version, estimateMinutes: -1 }),
      },
    )

    expect(updated.status).toBe(200)
    expect(updated.body.data).toMatchObject({
      priority: 'critical',
      assignee: 'codex:thread:019e-route',
      model: 'gpt-5.4-codex',
      thinking: 'high',
      dueAtIso: '2026-05-04',
      estimateMinutes: 90,
      actualMinutes: null,
    })
    expect(invalidActor.status).toBe(400)
    expect(invalidActor.body.error).toContain('Invalid Kanban actor')
    expect(invalidMinutes.status).toBe(400)
    expect(invalidMinutes.body.error).toContain('estimateMinutes must be null or a nonnegative integer')
  })

  it('rejects invalid metadata due dates and allows date clearing over HTTP', async () => {
    const { baseUrl } = await createTestServer()
    const created = await requestJson<{ data: { id: string; version: number } }>(
      `${baseUrl}/codex-api/kanban/tasks`,
      {
        method: 'POST',
        body: JSON.stringify({ title: 'Due date task' }),
      },
    )
    const invalid = await requestJson<{ error: string }>(
      `${baseUrl}/codex-api/kanban/tasks/${created.body.data.id}`,
      {
        method: 'PATCH',
        body: JSON.stringify({ version: created.body.data.version, dueAtIso: 'tomorrow' }),
      },
    )
    const setDate = await requestJson<{ data: { version: number; dueAtIso: string } }>(
      `${baseUrl}/codex-api/kanban/tasks/${created.body.data.id}`,
      {
        method: 'PATCH',
        body: JSON.stringify({ version: created.body.data.version, dueAtIso: '2026-05-04' }),
      },
    )
    const cleared = await requestJson<{ data: { dueAtIso: string } }>(
      `${baseUrl}/codex-api/kanban/tasks/${created.body.data.id}`,
      {
        method: 'PATCH',
        body: JSON.stringify({ version: setDate.body.data.version, dueAtIso: '' }),
      },
    )

    expect(invalid.status).toBe(400)
    expect(invalid.body.error).toContain('dueAtIso must be empty or YYYY-MM-DD')
    expect(setDate.status).toBe(200)
    expect(setDate.body.data.dueAtIso).toBe('2026-05-04')
    expect(cleared.status).toBe(200)
    expect(cleared.body.data.dueAtIso).toBe('')
  })

  it('returns conflict details for stale task patches', async () => {
    const { baseUrl } = await createTestServer()
    const created = await requestJson<{ data: { id: string; version: number; title: string } }>(
      `${baseUrl}/codex-api/kanban/tasks`,
      {
        method: 'POST',
        body: JSON.stringify({ title: 'Original task' }),
      },
    )
    const fresh = await requestJson<{ data: { version: number; title: string } }>(
      `${baseUrl}/codex-api/kanban/tasks/${created.body.data.id}`,
      {
        method: 'PATCH',
        body: JSON.stringify({ version: created.body.data.version, title: 'Fresh task' }),
      },
    )

    const stale = await requestJson<{ error: string; serverVersion: number; latest: { title: string; version: number } }>(
      `${baseUrl}/codex-api/kanban/tasks/${created.body.data.id}`,
      {
        method: 'PATCH',
        body: JSON.stringify({ version: created.body.data.version, title: 'Stale task' }),
      },
    )

    expect(fresh.status).toBe(200)
    expect(stale.status).toBe(409)
    expect(stale.body.error).toBe('version_conflict')
    expect(stale.body.serverVersion).toBe(fresh.body.data.version)
    expect(stale.body.latest.title).toBe('Fresh task')
    expect(stale.body.latest.version).toBe(fresh.body.data.version)
  })

  it('reads and updates board config', async () => {
    const { baseUrl } = await createTestServer()

    const initial = await requestJson<{ data: { columns: Array<{ key: string; wipLimit: number | null }> } }>(
      `${baseUrl}/codex-api/kanban/config`,
    )
    const updated = await requestJson<{ data: { columns: Array<{ key: string; wipLimit: number | null }> } }>(
      `${baseUrl}/codex-api/kanban/config`,
      {
        method: 'PUT',
        body: JSON.stringify({
          columns: initial.body.data.columns.map((column) => (
            column.key === 'ready' ? { ...column, wipLimit: 3 } : column
          )),
        }),
      },
    )

    expect(initial.status).toBe(200)
    expect(initial.body.data.columns.find((column) => column.key === 'ready')?.wipLimit).toBeNull()
    expect(updated.status).toBe(200)
    expect(updated.body.data.columns.find((column) => column.key === 'ready')?.wipLimit).toBe(3)
  })

  it('creates, filters, approves, and rejects V2 proposals over HTTP', async () => {
    const { baseUrl } = await createTestServer()
    const csrf = await requestJson<{ data: { csrfToken: string } }>(`${baseUrl}/codex-api/kanban/csrf`)
    const csrfHeaders = { [KANBAN_CSRF_HEADER]: csrf.body.data.csrfToken }
    const task = await requestJson<{ data: { id: string; version: number } }>(
      `${baseUrl}/codex-api/kanban/tasks`,
      {
        method: 'POST',
        body: JSON.stringify({ title: 'Route proposal target' }),
      },
    )

    const created = await requestJson<{
      data: { id: string; type: string; status: string; payload: { taskId: string; patch: { blockedReason: string } } }
    }>(
      `${baseUrl}/codex-api/kanban/proposals`,
      {
        method: 'POST',
        headers: csrfHeaders,
        body: JSON.stringify({
          type: 'update',
          payload: {
            taskId: task.body.data.id,
            patch: { blockedReason: 'Needs credentials' },
          },
          sourceRunId: 'run_route',
          sourceThreadId: 'thread_route',
          proposedBy: 'codex:thread:thread_route',
        }),
      },
    )
    const pending = await requestJson<{ data: Array<{ id: string; status: string }> }>(
      `${baseUrl}/codex-api/kanban/proposals?status=pending`,
    )
    const approved = await requestJson<{ data: { status: string; resultTaskId: string; resolvedBy: string } }>(
      `${baseUrl}/codex-api/kanban/proposals/${created.body.data.id}/approve`,
      {
        method: 'POST',
        headers: csrfHeaders,
        body: JSON.stringify({ resolvedBy: 'operator', reason: 'Apply patch' }),
      },
    )
    const updatedTask = await requestJson<{ data: { blockedReason: string; version: number } }>(
      `${baseUrl}/codex-api/kanban/tasks/${task.body.data.id}`,
    )
    const rejectCandidate = await requestJson<{ data: { id: string } }>(
      `${baseUrl}/codex-api/kanban/proposals`,
      {
        method: 'POST',
        headers: csrfHeaders,
        body: JSON.stringify({
          type: 'create',
          payload: { title: 'Reject over HTTP' },
          sourceRunId: 'run_reject',
          sourceThreadId: 'thread_reject',
          proposedBy: 'operator',
        }),
      },
    )
    const rejected = await requestJson<{ data: { status: string; reason: string } }>(
      `${baseUrl}/codex-api/kanban/proposals/${rejectCandidate.body.data.id}/reject`,
      {
        method: 'POST',
        headers: csrfHeaders,
        body: JSON.stringify({ resolvedBy: 'operator', reason: 'No longer needed' }),
      },
    )

    expect(created.status).toBe(201)
    expect(created.body.data).toMatchObject({
      type: 'update',
      status: 'pending',
      payload: {
        taskId: task.body.data.id,
        patch: { blockedReason: 'Needs credentials' },
      },
    })
    expect(pending.body.data.map((proposal) => proposal.id)).toContain(created.body.data.id)
    expect(approved.status).toBe(200)
    expect(approved.body.data).toMatchObject({
      status: 'approved',
      resultTaskId: task.body.data.id,
      resolvedBy: 'operator',
    })
    expect(updatedTask.body.data.blockedReason).toBe('Needs credentials')
    expect(updatedTask.body.data.version).toBe(task.body.data.version + 1)
    expect(rejected.status).toBe(200)
    expect(rejected.body.data).toMatchObject({ status: 'rejected', reason: 'No longer needed' })
  })

  it('reorders a task into a new status over HTTP', async () => {
    const { baseUrl } = await createTestServer()
    const anchor = await requestJson<{ data: { id: string; version: number; columnOrder: number } }>(
      `${baseUrl}/codex-api/kanban/tasks`,
      {
        method: 'POST',
        body: JSON.stringify({ title: 'Ready anchor' }),
      },
    )
    const moving = await requestJson<{ data: { id: string; version: number } }>(
      `${baseUrl}/codex-api/kanban/tasks`,
      {
        method: 'POST',
        body: JSON.stringify({ title: 'Move over HTTP' }),
      },
    )
    const readyAnchor = await requestJson<{ data: { id: string; version: number; columnOrder: number } }>(
      `${baseUrl}/codex-api/kanban/tasks/${anchor.body.data.id}/reorder`,
      {
        method: 'POST',
        body: JSON.stringify({ version: anchor.body.data.version, status: 'ready' }),
      },
    )

    const moved = await requestJson<{ data: { id: string; status: string; columnOrder: number } }>(
      `${baseUrl}/codex-api/kanban/tasks/${moving.body.data.id}/reorder`,
      {
        method: 'POST',
        body: JSON.stringify({
          version: moving.body.data.version,
          status: 'ready',
          afterTaskId: readyAnchor.body.data.id,
        }),
      },
    )

    expect(moved.status).toBe(200)
    expect(moved.body.data.status).toBe('ready')
    expect(moved.body.data.columnOrder).toBeGreaterThan(readyAnchor.body.data.columnOrder)
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
