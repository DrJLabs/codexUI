import type { CodexBridgeRuntime } from '../codexAppServerBridge'

export type RestrictedCodexBridgeMethod<AllowedMethods extends readonly string[]> = AllowedMethods[number]

export type RestrictedCodexBridgeAdapter = {
  rpc<T = unknown>(method: string, params?: unknown): Promise<T>
  subscribeNotifications: CodexBridgeRuntime['subscribeNotifications']
}

export type RestrictedCodexBridgeAdapterOptions<AllowedMethods extends readonly string[] = readonly string[]> = {
  label: string
  allowedMethods: AllowedMethods
}

export function createRestrictedCodexBridgeAdapter<AllowedMethods extends readonly string[]>(
  runtime: CodexBridgeRuntime,
  options: RestrictedCodexBridgeAdapterOptions<AllowedMethods>,
): RestrictedCodexBridgeAdapter {
  const allowedMethods = new Set<string>(options.allowedMethods)

  return {
    async rpc<T = unknown>(method: string, params?: unknown): Promise<T> {
      if (!allowedMethods.has(method)) {
        throw new Error(`${options.label} method is not allowed: ${method}`)
      }
      return await runtime.rpc<T>(method, params)
    },
    subscribeNotifications(listener) {
      return runtime.subscribeNotifications(listener)
    },
  }
}
