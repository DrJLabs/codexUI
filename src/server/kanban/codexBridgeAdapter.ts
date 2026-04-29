import type { CodexBridgeRuntime } from '../codexAppServerBridge'

export const KANBAN_CODEX_BRIDGE_ALLOWED_METHODS = [
  'thread/start',
  'thread/resume',
  'thread/read',
  'turn/start',
  'turn/interrupt',
  'review/start',
  'command/exec',
] as const

export type KanbanCodexBridgeMethod = typeof KANBAN_CODEX_BRIDGE_ALLOWED_METHODS[number]

const ALLOWED_METHODS = new Set<string>(KANBAN_CODEX_BRIDGE_ALLOWED_METHODS)

export type KanbanCodexBridgeAdapter = {
  rpc<T = unknown>(method: string, params?: unknown): Promise<T>
  subscribeNotifications: CodexBridgeRuntime['subscribeNotifications']
}

export function createKanbanCodexBridgeAdapter(runtime: CodexBridgeRuntime): KanbanCodexBridgeAdapter {
  return {
    async rpc<T = unknown>(method: string, params?: unknown): Promise<T> {
      if (!ALLOWED_METHODS.has(method)) {
        throw new Error(`Kanban Codex bridge method is not allowed: ${method}`)
      }
      return await runtime.rpc<T>(method, params)
    },
    subscribeNotifications(listener) {
      return runtime.subscribeNotifications(listener)
    },
  }
}
