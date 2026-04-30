import { homedir } from 'node:os'
import { join } from 'node:path'
import type { NativeAutomationStoreOptions } from './nativeStore'

export function resolveCodexHomeDir(options?: NativeAutomationStoreOptions): string {
  const injected = options?.codexHomeDir?.trim()
  if (injected) return injected
  const codexHome = process.env.CODEX_HOME?.trim()
  return codexHome && codexHome.length > 0 ? codexHome : join(homedir(), '.codex')
}
