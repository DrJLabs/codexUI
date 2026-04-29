import { describe, expect, it, vi } from 'vitest'
import { createKanbanCodexBridgeAdapter } from '../codexBridgeAdapter'
import type { CodexBridgeRuntime } from '../../codexAppServerBridge'

function createRuntime(rpcCalls: Array<{ method: string; params: unknown }> = []): CodexBridgeRuntime {
  return {
    rpc: async <T = unknown>(method: string, params?: unknown) => {
      rpcCalls.push({ method, params })
      return { ok: true } as T
    },
    subscribeNotifications: vi.fn(() => () => {}),
    dispose: vi.fn(),
  }
}

describe('createKanbanCodexBridgeAdapter', () => {
  it('forwards allowed app-server methods to the shared bridge runtime', async () => {
    const rpcCalls: Array<{ method: string; params: unknown }> = []
    const runtime = createRuntime(rpcCalls)
    const adapter = createKanbanCodexBridgeAdapter(runtime)

    await expect(adapter.rpc('turn/start', { threadId: 'thread_1' })).resolves.toEqual({ ok: true })

    expect(rpcCalls).toEqual([{ method: 'turn/start', params: { threadId: 'thread_1' } }])
  })

  it('rejects shell command RPC even when a caller passes it directly', async () => {
    const rpcCalls: Array<{ method: string; params: unknown }> = []
    const runtime = createRuntime(rpcCalls)
    const adapter = createKanbanCodexBridgeAdapter(runtime)

    await expect(adapter.rpc('thread/shellCommand', { command: 'npm test' })).rejects.toThrow(
      'Kanban Codex bridge method is not allowed: thread/shellCommand',
    )
    expect(rpcCalls).toEqual([])
  })

  it('passes notifications through without exposing unrestricted runtime access', () => {
    const unsubscribe = vi.fn()
    const runtime: CodexBridgeRuntime = {
      rpc: async <T = unknown>() => null as T,
      subscribeNotifications: vi.fn(() => unsubscribe),
      dispose: vi.fn(),
    }
    const adapter = createKanbanCodexBridgeAdapter(runtime)
    const listener = vi.fn()

    expect(adapter.subscribeNotifications(listener)).toBe(unsubscribe)
    expect(runtime.subscribeNotifications).toHaveBeenCalledWith(listener)
  })
})
