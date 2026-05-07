import { readdirSync, readFileSync } from 'node:fs'

export type AutomationSchedulerPreference = {
  enabled: boolean
  shouldRun: () => boolean
}

export function resolveAutomationSchedulerPreference(
  env: NodeJS.ProcessEnv = process.env,
  isDesktopActive: () => boolean = detectCodexDesktopProcess,
): AutomationSchedulerPreference {
  const setting = readSchedulerSetting(env)
  if (setting === 'enabled') return { enabled: true, shouldRun: () => true }
  if (setting === 'disabled') return { enabled: false, shouldRun: () => false }
  return {
    enabled: true,
    shouldRun: () => !isDesktopActive(),
  }
}

function readSchedulerSetting(env: NodeJS.ProcessEnv): 'auto' | 'enabled' | 'disabled' {
  const raw = env.CODEXUI_AUTOMATIONS_SCHEDULER ?? env.CODEXUI_ENABLE_AUTOMATION_SCHEDULER ?? 'auto'
  const normalized = raw.trim().toLowerCase()
  if (['1', 'true', 'yes', 'on', 'enabled', 'enable', 'codexui'].includes(normalized)) return 'enabled'
  if (['0', 'false', 'no', 'off', 'disabled', 'disable', 'desktop'].includes(normalized)) return 'disabled'
  return 'auto'
}

export function detectCodexDesktopProcess(): boolean {
  if (process.platform !== 'linux') return false
  try {
    for (const entry of readdirSync('/proc', { withFileTypes: true })) {
      if (!entry.isDirectory() || !/^\d+$/.test(entry.name) || Number(entry.name) === process.pid) continue
      let cmdline = ''
      try {
        cmdline = readFileSync(`/proc/${entry.name}/cmdline`, 'utf8').replace(/\0/g, ' ')
      } catch {
        continue
      }
      if (
        cmdline.includes('/opt/codex-desktop/') ||
        cmdline.includes('codex-desktop') ||
        cmdline.includes('Codex.app/Contents/MacOS/Codex')
      ) {
        return true
      }
    }
  } catch {
    return false
  }
  return false
}
