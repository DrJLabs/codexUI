import { mkdtemp } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import express from 'express'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FULL_ACCESS_KANBAN_RUN_PROFILE_ID, type KanbanExecutionPolicy, type KanbanTask } from '../../../types/kanban'
import type { CodexBridgeRuntime } from '../../codexAppServerBridge'
import { createKanbanMiddleware, type CreateKanbanMiddlewareOptions } from '../index'
import { KanbanStorage } from '../storage'

const servers: Server[] = []

const disabledPolicy: KanbanExecutionPolicy = {
  enabled: true,
  executionMode: 'disabled',
  executionEnabled: false,
  requireTrustedAccessForExecution: true,
  allowTailscaleAccess: true,
  requireLoopbackForExecution: false,
  disableExecutionWhenRemote: false,
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
  executionMode: 'trusted_remote',
  executionEnabled: true,
}

const bridge: CodexBridgeRuntime = {
  rpc: async <T = unknown>() => ({} as T),
  subscribeNotifications: vi.fn(() => () => {}),
  dispose: vi.fn(),
}

async function createTestServer(options: Partial<CreateKanbanMiddlewareOptions> = {}) {
  const dataDir = await mkdtemp(join(tmpdir(), 'codexui-kanban-policy-'))
  const projectRoot = join(dataDir, 'project')
  if (options.policy?.executionMode && options.policy.executionMode !== 'disabled') {
    const storage = new KanbanStorage({ dataDir, projectRoot })
    await storage.mutate((state) => {
      state.settings.kanbanConfig.executionMode = options.policy?.executionMode ?? 'disabled'
    })
  }
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

  it('returns a client error when a task run uses a disallowed run profile', async () => {
    const { baseUrl } = await createTestServer({ policy: enabledPolicy, bridge })
    const csrf = await requestJson<{ data: { csrfToken: string } }>(`${baseUrl}/codex-api/kanban/csrf`)
    const created = await requestJson<{ data: KanbanTask }>(
      `${baseUrl}/codex-api/kanban/tasks`,
      {
        method: 'POST',
        headers: { 'x-codexui-kanban-csrf': csrf.body.data.csrfToken },
        body: JSON.stringify({
          title: 'Disallowed profile task',
          runProfileId: FULL_ACCESS_KANBAN_RUN_PROFILE_ID,
        }),
      },
    )

    const response = await requestJson<{ error: string }>(
      `${baseUrl}/codex-api/kanban/tasks/${created.body.data.id}/run`,
      {
        method: 'POST',
        headers: { 'x-codexui-kanban-csrf': csrf.body.data.csrfToken },
        body: '{}',
      },
    )

    expect(response.status).toBe(403)
    expect(response.body.error).toContain('danger-full-access')
  })

  it('does not block run interrupts solely because execution is disabled', async () => {
    const { baseUrl } = await createTestServer({ policy: disabledPolicy, bridge })
    const csrf = await requestJson<{ data: { csrfToken: string } }>(`${baseUrl}/codex-api/kanban/csrf`)

    const response = await requestJson<{ error: string }>(
      `${baseUrl}/codex-api/kanban/runs/run_missing/interrupt`,
      {
        method: 'POST',
        headers: { 'x-codexui-kanban-csrf': csrf.body.data.csrfToken },
        body: '{}',
      },
    )

    expect(response.status).not.toBe(403)
    expect(response.body.error).not.toContain('Kanban execution is disabled')
  })

  it('honors board execution mode changes when checking task run access', async () => {
    const { baseUrl } = await createTestServer({ policy: disabledPolicy })
    const csrf = await requestJson<{ data: { csrfToken: string } }>(`${baseUrl}/codex-api/kanban/csrf`)

    const configResponse = await requestJson<{ data: { executionMode: string } }>(
      `${baseUrl}/codex-api/kanban/config`,
      {
        method: 'PUT',
        headers: { 'x-codexui-kanban-csrf': csrf.body.data.csrfToken },
        body: JSON.stringify({ executionMode: 'trusted_remote' }),
      },
    )
    const runResponse = await requestJson<{ error: string }>(
      `${baseUrl}/codex-api/kanban/tasks/task_1/run`,
      {
        method: 'POST',
        headers: { 'x-codexui-kanban-csrf': csrf.body.data.csrfToken },
        body: '{}',
      },
    )

    expect(configResponse.status).toBe(200)
    expect(configResponse.body.data.executionMode).toBe('trusted_remote')
    expect(runResponse.status).toBe(409)
    expect(runResponse.body.error).toContain('Kanban runner is not available yet')
  })

  it('blocks Tailscale execution in local-only mode', async () => {
    const { baseUrl } = await createTestServer({
      policy: {
        ...enabledPolicy,
        executionMode: 'local_only',
      },
    })

    const response = await requestJson<{ error: string }>(
      `${baseUrl}/codex-api/kanban/tasks/task_1/run`,
      {
        method: 'POST',
        headers: { 'x-forwarded-for': '100.100.100.100' },
        body: '{}',
      },
    )

    expect(response.status).toBe(403)
    expect(response.body.error).toContain('Kanban execution mode allows local access only')
  })

  it('blocks task runs when the request is forwarded or remote', async () => {
    const { baseUrl } = await createTestServer({ policy: enabledPolicy })

    const response = await requestJson<{ error: string }>(
      `${baseUrl}/codex-api/kanban/tasks/task_1/run`,
      {
        method: 'POST',
        headers: { 'x-forwarded-for': '203.0.113.10' },
        body: '{}',
      },
    )

    expect(response.status).toBe(403)
    expect(response.body.error).toContain('Kanban execution requires trusted local or Tailscale access')
  })

  it('allows Tailscale Serve forwarded clients to request a CSRF token', async () => {
    const { baseUrl } = await createTestServer({ policy: enabledPolicy })

    const csrf = await requestJson<{ data: { csrfToken: string } }>(
      `${baseUrl}/codex-api/kanban/csrf`,
      { headers: { 'x-forwarded-for': '100.100.100.100' } },
    )

    expect(csrf.status).toBe(200)
    expect(csrf.body.data.csrfToken).toMatch(/^[A-Za-z0-9_-]{43}$/)
  })

  it('allows CSRF tokens when execution policy does not require trusted access', async () => {
    const { baseUrl } = await createTestServer({
      policy: {
        ...enabledPolicy,
        requireTrustedAccessForExecution: false,
      },
    })

    const csrf = await requestJson<{ data: { csrfToken: string } }>(
      `${baseUrl}/codex-api/kanban/csrf`,
      { headers: { 'x-forwarded-for': '203.0.113.10' } },
    )

    expect(csrf.status).toBe(200)
    expect(csrf.body.data.csrfToken).toMatch(/^[A-Za-z0-9_-]{43}$/)
  })

  it('allows Tailscale Serve forwarded clients to pass execution access checks', async () => {
    const { baseUrl } = await createTestServer({ policy: enabledPolicy })
    const forwardedHeaders = { 'x-forwarded-for': '100.100.100.100' }
    const csrf = await requestJson<{ data: { csrfToken: string } }>(
      `${baseUrl}/codex-api/kanban/csrf`,
      { headers: forwardedHeaders },
    )

    const response = await requestJson<{ error: string }>(
      `${baseUrl}/codex-api/kanban/tasks/task_1/run`,
      {
        method: 'POST',
        headers: {
          ...forwardedHeaders,
          'x-codexui-kanban-csrf': csrf.body.data.csrfToken,
        },
        body: '{}',
      },
    )

    expect(response.status).toBe(409)
    expect(response.body.error).toContain('Kanban runner is not available yet')
  })

  it('rejects open remote mode until authenticated remote execution exists', async () => {
    const { baseUrl } = await createTestServer({
      policy: {
        ...enabledPolicy,
        executionMode: 'open_remote',
        requireTrustedAccessForExecution: false,
      },
    })

    const response = await requestJson<{ error: string }>(
      `${baseUrl}/codex-api/kanban/tasks/task_1/run`,
      {
        method: 'POST',
        headers: { 'x-forwarded-for': '203.0.113.10' },
        body: '{}',
      },
    )

    expect(response.status).toBe(403)
    expect(response.body.error).toContain('Open remote Kanban execution requires authenticated remote access')
  })

  it('honors policy that disables Tailscale execution access', async () => {
    const { baseUrl } = await createTestServer({
      policy: {
        ...enabledPolicy,
        allowTailscaleAccess: false,
      },
    })

    const response = await requestJson<{ error: string }>(
      `${baseUrl}/codex-api/kanban/tasks/task_1/run`,
      {
        method: 'POST',
        headers: { 'x-forwarded-for': '100.100.100.100' },
        body: '{}',
      },
    )

    expect(response.status).toBe(403)
    expect(response.body.error).toContain('Kanban execution does not allow Tailscale access')
  })

  it('honors policy that requires loopback execution access', async () => {
    const { baseUrl } = await createTestServer({
      policy: {
        ...enabledPolicy,
        requireLoopbackForExecution: true,
      },
    })

    const response = await requestJson<{ error: string }>(
      `${baseUrl}/codex-api/kanban/tasks/task_1/run`,
      {
        method: 'POST',
        headers: { 'x-forwarded-for': '100.100.100.100' },
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

  it('blocks manual run completion without a CSRF token', async () => {
    const { baseUrl } = await createTestServer({ policy: enabledPolicy })

    const response = await requestJson<{ error: string }>(
      `${baseUrl}/codex-api/kanban/runs/run_1/complete`,
      {
        method: 'POST',
        body: JSON.stringify({ result: 'Manual result' }),
      },
    )

    expect(response.status).toBe(403)
    expect(response.body.error).toContain('Invalid Kanban CSRF token')
  })

  it('blocks manual run completion from forwarded remote clients', async () => {
    const { baseUrl } = await createTestServer({ policy: enabledPolicy })

    const response = await requestJson<{ error: string }>(
      `${baseUrl}/codex-api/kanban/runs/run_1/complete`,
      {
        method: 'POST',
        headers: { 'x-forwarded-for': '203.0.113.10' },
        body: JSON.stringify({ result: 'Manual result' }),
      },
    )

    expect(response.status).toBe(403)
    expect(response.body.error).toContain('Kanban execution requires trusted local or Tailscale access')
  })

  it('accepts trusted CSRF-protected manual completion with an error-only body', async () => {
    const { baseUrl } = await createTestServer({ policy: enabledPolicy, bridge })
    const csrf = await requestJson<{ data: { csrfToken: string } }>(`${baseUrl}/codex-api/kanban/csrf`)

    const response = await requestJson<{ error: string }>(
      `${baseUrl}/codex-api/kanban/runs/run_missing/complete`,
      {
        method: 'POST',
        headers: { 'x-codexui-kanban-csrf': csrf.body.data.csrfToken },
        body: JSON.stringify({ error: 'manual failure only' }),
      },
    )

    expect(response.status).toBe(404)
    expect(response.body.error).toContain('Kanban run not found: run_missing')
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
