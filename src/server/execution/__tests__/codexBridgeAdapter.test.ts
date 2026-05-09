import { describe, expect, it, vi } from 'vitest'
import type { CodexBridgeRuntime } from '../../codexAppServerBridge'
import { createRestrictedCodexBridgeAdapter } from '../codexBridgeAdapter'

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

describe('createRestrictedCodexBridgeAdapter', () => {
  it('allows configured app-server methods', async () => {
    const rpcCalls: Array<{ method: string; params: unknown }> = []
    const runtime = createRuntime(rpcCalls)
    const adapter = createRestrictedCodexBridgeAdapter(runtime, {
      label: 'Test bridge',
      allowedMethods: ['thread/start', 'turn/start'] as const,
    })

    await expect(adapter.rpc('turn/start', { threadId: 'thread_1' })).resolves.toEqual({ ok: true })

    expect(rpcCalls).toEqual([{ method: 'turn/start', params: { threadId: 'thread_1' } }])
  })

  it('rejects non-allowlisted methods with the configured label', async () => {
    const rpcCalls: Array<{ method: string; params: unknown }> = []
    const runtime = createRuntime(rpcCalls)
    const adapter = createRestrictedCodexBridgeAdapter(runtime, {
      label: 'Automation bridge',
      allowedMethods: ['thread/start'] as const,
    })

    await expect(adapter.rpc('thread/shellCommand', { command: 'npm test' })).rejects.toThrow(
      'Automation bridge method is not allowed: thread/shellCommand',
    )
    expect(rpcCalls).toEqual([])
  })

  it('passes notifications through without exposing runtime disposal', () => {
    const unsubscribe = vi.fn()
    const runtime: CodexBridgeRuntime = {
      rpc: async <T = unknown>() => null as T,
      subscribeNotifications: vi.fn(() => unsubscribe),
      dispose: vi.fn(),
    }
    const adapter = createRestrictedCodexBridgeAdapter(runtime, {
      label: 'Test bridge',
      allowedMethods: ['turn/start'] as const,
    })
    const listener = vi.fn()

    expect(adapter.subscribeNotifications(listener)).toBe(unsubscribe)
    expect(runtime.subscribeNotifications).toHaveBeenCalledWith(listener)
    expect('dispose' in adapter).toBe(false)
  })
})
