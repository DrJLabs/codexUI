import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  getComputerUseApps,
  getComputerUseStatus,
  listDirectoryComposioConnectors,
  mapComputerUseClientPointToScreenshotPoint,
  startThreadTurn,
} from './codexGateway'

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

describe('listDirectoryComposioConnectors', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('sends search queries as query params expected by the server', async () => {
    const requests: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      requests.push(String(input))
      return new Response(JSON.stringify({
        data: [],
        nextCursor: null,
        total: 0,
      }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
        },
      })
    }))

    await listDirectoryComposioConnectors('instagram', '50', 25)

    expect(requests).toEqual(['/codex-api/composio/connectors?query=instagram&cursor=50&limit=25'])
  })
})

describe('mapComputerUseClientPointToScreenshotPoint', () => {
  it('maps displayed image coordinates to natural screenshot pixels', () => {
    expect(mapComputerUseClientPointToScreenshotPoint({
      clientX: 150,
      clientY: 75,
      rect: { left: 50, top: 25, width: 200, height: 100 },
      screenshot: { width: 1000, height: 500 },
    })).toEqual({ x: 500, y: 250 })
  })

  it('clamps coordinates to screenshot bounds', () => {
    expect(mapComputerUseClientPointToScreenshotPoint({
      clientX: 999,
      clientY: -10,
      rect: { left: 0, top: 0, width: 100, height: 100 },
      screenshot: { width: 640, height: 480 },
    })).toEqual({ x: 639, y: 0 })
  })
})

describe('getComputerUseApps', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('surfaces failed Computer Use tool envelopes', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      ok: false,
      tool: 'list_apps',
      error: 'accessibility unavailable',
    }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
      },
    })))

    await expect(getComputerUseApps()).rejects.toThrow('accessibility unavailable')
  })
})

describe('getComputerUseStatus', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('marks status error payloads as unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      disabled: false,
      binary: { executable: true },
      mcp: { initialized: true, running: true, toolCount: 15 },
      doctor: null,
      error: 'doctor failed',
    }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
      },
    })))

    await expect(getComputerUseStatus()).resolves.toMatchObject({
      readiness: 'unavailable',
      lastError: 'doctor failed',
    })
  })
})
