import type { CodexBridgeRuntime } from '../codexAppServerBridge'
import {
  createRestrictedCodexBridgeAdapter,
  type RestrictedCodexBridgeAdapter,
} from '../execution/codexBridgeAdapter'

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

export type KanbanCodexBridgeAdapter = RestrictedCodexBridgeAdapter

export function createKanbanCodexBridgeAdapter(runtime: CodexBridgeRuntime): KanbanCodexBridgeAdapter {
  return createRestrictedCodexBridgeAdapter(runtime, {
    label: 'Kanban Codex bridge',
    allowedMethods: KANBAN_CODEX_BRIDGE_ALLOWED_METHODS,
  })
}
