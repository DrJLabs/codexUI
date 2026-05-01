import { createServer, type Server } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createCodexBridgeMiddleware } from '../../codexAppServerBridge'

const servers: Server[] = []
const codexHomeDirs: string[] = []
const disposers: Array<() => void> = []
const originalCodexHome = process.env.CODEX_HOME

afterEach(async () => {
  for (const dispose of disposers.splice(0)) {
    dispose()
  }
  await Promise.all(servers.splice(0).map(async (server) => await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve())
  })))
  await Promise.all(codexHomeDirs.splice(0).map(async (codexHomeDir) => {
    await rm(codexHomeDir, { recursive: true, force: true })
  }))
  if (originalCodexHome === undefined) {
    delete process.env.CODEX_HOME
  } else {
    process.env.CODEX_HOME = originalCodexHome
  }
})

async function createTestServer() {
  const codexHomeDir = await mkdtemp(join(tmpdir(), 'codexui-automation-routes-'))
  codexHomeDirs.push(codexHomeDir)
  process.env.CODEX_HOME = codexHomeDir

  const middleware = createCodexBridgeMiddleware()
  disposers.push(middleware.dispose)
  const server = createServer((req, res) => {
    void middleware(req, res, () => {
      res.statusCode = 404
      res.end('not found')
    })
  })
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('test server did not bind')
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
  }
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init)
  expect(response.ok).toBe(true)
  return await response.json() as T
}

describe('legacy thread automation routes', () => {
  it('serves data-wrapped responses and normalizes automation status casing', async () => {
    const { baseUrl } = await createTestServer()

    const initialList = await requestJson<{ data: Record<string, unknown> }>(`${baseUrl}/codex-api/thread-automations`)
    expect(initialList).toEqual({ data: {} })

    const created = await requestJson<{ data: { targetThreadId: string; status: string; name: string } }>(
      `${baseUrl}/codex-api/thread-automation`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          threadId: 'thread-route-1',
          name: 'Route Check',
          prompt: 'Check this thread',
          rrule: 'FREQ=DAILY',
          status: 'PAUSED',
        }),
      },
    )
    expect(created.data).toMatchObject({
      targetThreadId: 'thread-route-1',
      status: 'PAUSED',
      name: 'Route Check',
    })

    const read = await requestJson<{ data: { targetThreadId: string; status: string } }>(
      `${baseUrl}/codex-api/thread-automation?threadId=thread-route-1`,
    )
    expect(read.data).toMatchObject({ targetThreadId: 'thread-route-1', status: 'PAUSED' })

    const updated = await requestJson<{ data: { targetThreadId: string; status: string } }>(
      `${baseUrl}/codex-api/thread-automation`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          threadId: 'thread-route-1',
          name: 'Route Check',
          prompt: 'Check this thread',
          rrule: 'FREQ=DAILY',
          status: 'paused',
        }),
      },
    )
    expect(updated.data).toMatchObject({ targetThreadId: 'thread-route-1', status: 'PAUSED' })

    const list = await requestJson<{ data: Record<string, { status: string }> }>(`${baseUrl}/codex-api/thread-automations`)
    expect(list.data['thread-route-1']).toMatchObject({ status: 'PAUSED' })

    const deleted = await requestJson<{ data: { removed: boolean } }>(
      `${baseUrl}/codex-api/thread-automation?threadId=thread-route-1`,
      { method: 'DELETE' },
    )
    expect(deleted).toEqual({ data: { removed: true } })

    const missing = await requestJson<{ data: null }>(`${baseUrl}/codex-api/thread-automation?threadId=thread-route-1`)
    expect(missing).toEqual({ data: null })

  })
})
