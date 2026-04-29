import { mkdtemp } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import express from 'express'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { KanbanExecutionPolicy } from '../../../types/kanban'
import { createKanbanMiddleware, type CreateKanbanMiddlewareOptions } from '../index'

const servers: Server[] = []

const disabledPolicy: KanbanExecutionPolicy = {
  enabled: true,
  executionEnabled: false,
  requireLoopbackForExecution: true,
  disableExecutionWhenRemote: true,
  sandboxMode: 'workspace-write',
  approvalPolicy: 'on-request',
  networkAccess: false,
  allowDangerFullAccess: false,
  allowApprovalNever: false,
  allowAcceptForSession: false,
  useThreadShellCommand: false,
  maxGlobalActiveRuns: 1,
  maxActiveRunsPerRepo: 1,
  maxActiveRunsPerTask: 1,
}

const enabledPolicy: KanbanExecutionPolicy = {
  ...disabledPolicy,
  executionEnabled: true,
}

async function createTestServer(options: Partial<CreateKanbanMiddlewareOptions> = {}) {
  const dataDir = await mkdtemp(join(tmpdir(), 'codexui-kanban-policy-'))
  const projectRoot = join(dataDir, 'project')
  const app = express()
  app.use('/codex-api/kanban', createKanbanMiddleware({
    dataDir,
    projectRoot,
    ...options,
  }))
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

describe('Kanban execution policy', () => {
  it('blocks task runs when execution is disabled', async () => {
    const { baseUrl } = await createTestServer({ policy: disabledPolicy })

    const response = await requestJson<{ error: string }>(
      `${baseUrl}/codex-api/kanban/tasks/task_1/run`,
      { method: 'POST', body: '{}' },
    )

    expect(response.status).toBe(403)
    expect(response.body.error).toContain('Kanban execution is disabled')
  })

  it('blocks task runs when the request is forwarded or remote', async () => {
    const { baseUrl } = await createTestServer({ policy: enabledPolicy })

    const response = await requestJson<{ error: string }>(
      `${baseUrl}/codex-api/kanban/tasks/task_1/run`,
      {
        method: 'POST',
        headers: { 'x-forwarded-for': '100.64.0.10' },
        body: '{}',
      },
    )

    expect(response.status).toBe(403)
    expect(response.body.error).toContain('Kanban execution requires loopback access')
  })

  it('blocks execution mutations without a CSRF token', async () => {
    const { baseUrl } = await createTestServer({ policy: enabledPolicy })

    const response = await requestJson<{ error: string }>(
      `${baseUrl}/codex-api/kanban/tasks/task_1/run`,
      { method: 'POST', body: '{}' },
    )

    expect(response.status).toBe(403)
    expect(response.body.error).toContain('Invalid Kanban CSRF token')
  })

  it('fails closed when audit append fails before the runner is wired', async () => {
    const append = vi.fn(async () => {
      throw new Error('audit disk full')
    })
    const { baseUrl } = await createTestServer({
      policy: enabledPolicy,
      auditLog: { append },
    })
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    try {
      const csrf = await requestJson<{ data: { csrfToken: string } }>(`${baseUrl}/codex-api/kanban/csrf`)
      const response = await requestJson<{ error: string }>(
        `${baseUrl}/codex-api/kanban/tasks/task_1/run`,
        {
          method: 'POST',
          headers: { 'x-codexui-kanban-csrf': csrf.body.data.csrfToken },
          body: '{}',
        },
      )

      expect(csrf.status).toBe(200)
      expect(append).toHaveBeenCalledOnce()
      expect(response.status).toBe(500)
      expect(response.body.error).toBe('Kanban request failed')
    } finally {
      consoleError.mockRestore()
    }
  })
})
