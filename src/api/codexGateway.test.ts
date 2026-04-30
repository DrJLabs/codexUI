import { afterEach, describe, expect, it, vi } from 'vitest'
import { listWorkspaceArtifacts, startThreadTurn } from './codexGateway'

function mockRpcFetch(): { requests: Array<{ method: string, params: Record<string, unknown> }> } {
  const requests: Array<{ method: string, params: Record<string, unknown> }> = []

  vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    const body = typeof init?.body === 'string'
      ? JSON.parse(init.body) as { method: string, params: Record<string, unknown> }
      : { method: '', params: {} }

    requests.push(body)

    return new Response(JSON.stringify({
      result: {
        turn: {
          id: `turn-${requests.length}`,
        },
      },
    }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
      },
    })
  }))

  return { requests }
}

describe('startThreadTurn collaboration mode payloads', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('sends default collaboration mode explicitly after a plan turn', async () => {
    const { requests } = mockRpcFetch()

    await startThreadTurn('thread-1', 'make a plan', [], 'gpt-5.4', 'medium', undefined, [], 'plan')
    await startThreadTurn('thread-1', 'implement it', [], 'gpt-5.4', 'medium', undefined, [], 'default')

    expect(requests).toHaveLength(2)
    expect(requests[0].method).toBe('turn/start')
    expect(requests[0].params.collaborationMode).toEqual({
      mode: 'plan',
      settings: {
        model: 'gpt-5.4',
        reasoning_effort: 'medium',
        developer_instructions: null,
      },
    })
    expect(requests[1].method).toBe('turn/start')
    expect(requests[1].params.collaborationMode).toEqual({
      mode: 'default',
      settings: {
        model: 'gpt-5.4',
        reasoning_effort: 'medium',
        developer_instructions: null,
      },
    })
  })
})

describe('listWorkspaceArtifacts', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('serializes automation filters and normalizes automation artifacts', async () => {
    const requests: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      requests.push(String(input))
      return new Response(JSON.stringify({
        data: [{
          id: 'automation:evidence:daily-check:run_1',
          kind: 'evidence',
          source: 'automation',
          title: 'Run evidence run_1',
          automationId: 'daily-check',
          runId: 'run_1',
          logPath: '/tmp/run.log',
        }],
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }))

    const artifacts = await listWorkspaceArtifacts({ source: 'automation', automationId: 'daily-check' })

    expect(requests).toEqual(['/codex-api/artifacts?source=automation&automationId=daily-check'])
    expect(artifacts).toEqual([expect.objectContaining({
      id: 'automation:evidence:daily-check:run_1',
      source: 'automation',
      automationId: 'daily-check',
      kind: 'evidence',
    })])
  })
})
