import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { CodexRunProfile } from '../../types/kanban'
import type { LocalActionCommand, LocalActionKind, LocalActionPolicy } from '../../types/localActions'

const ACTION_SCRIPT_NAMES: Record<LocalActionKind, string[]> = {
  build: ['build'],
  test: ['test', 'test:unit', 'vitest'],
  dev: ['dev', 'start'],
}

export function discoverLocalActions(options: {
  cwd: string
  runProfile: CodexRunProfile
  policy: LocalActionPolicy
  nowIso?: string
}): LocalActionCommand[] {
  const scripts = readPackageScripts(options.cwd)
  const actions: LocalActionCommand[] = []
  for (const kind of Object.keys(ACTION_SCRIPT_NAMES) as LocalActionKind[]) {
    const scriptName = ACTION_SCRIPT_NAMES[kind].find((candidate) => scripts.has(candidate))
    if (!scriptName) continue
    const command = formatPackageScriptCommand(resolvePackageManager(options.cwd), scriptName)
    const scriptCommand = scripts.get(scriptName) ?? ''
    actions.push({
      id: `local:${kind}:${scriptName}`,
      kind,
      label: formatActionLabel(kind, scriptName),
      command,
      scriptCommand,
      cwd: options.cwd,
      executionMode: options.policy.executionMode,
      runProfile: options.runProfile,
      createdAtIso: options.nowIso ?? new Date().toISOString(),
    })
  }
  return actions
}

export function assertLocalActionAllowed(action: LocalActionCommand, policy: LocalActionPolicy): void {
  if (!policy.executionEnabled || policy.executionMode === 'disabled') {
    throw new Error('Local actions are disabled by execution policy')
  }
  if (!policy.trustedForExecution) {
    throw new Error('Local actions require a trusted execution context')
  }
  if (action.runProfile.sandboxMode === 'danger-full-access' && !policy.allowDangerFullAccess) {
    throw new Error('Local action requires danger-full-access to be explicitly enabled')
  }
  if (action.runProfile.approvalPolicy === 'never' && !policy.allowApprovalNever) {
    throw new Error('Local action requires approval-never to be explicitly enabled')
  }
  if (containsGitPushOrMerge(action.command) || containsGitPushOrMerge(action.scriptCommand ?? '')) {
    throw new Error('Local actions cannot push, pull, merge, or rebase without a separate explicit confirmation flow')
  }
}

function readPackageScripts(cwd: string): Map<string, string> {
  try {
    const parsed = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8')) as unknown
    if (!isRecord(parsed) || !isRecord(parsed.scripts)) return new Map()
    return new Map(Object.entries(parsed.scripts)
      .filter(([, value]) => typeof value === 'string')
      .map(([key, value]) => [key, value as string]))
  } catch {
    return new Map()
  }
}

function containsGitPushOrMerge(command: string): boolean {
  const normalized = command.trim()
  if (!normalized) return false
  return /(?:^|[;&|()\s])(?:command\s+)?git(?:\s+-C\s+(?:"[^"]+"|'[^']+'|[^\s;&|()]+))*\s+(push|pull|merge|rebase)(?:\s|$)/u.test(normalized)
}

function resolvePackageManager(cwd: string): 'npm' | 'pnpm' | 'yarn' | 'bun' {
  if (existsSync(join(cwd, 'pnpm-lock.yaml'))) return 'pnpm'
  if (existsSync(join(cwd, 'yarn.lock'))) return 'yarn'
  if (existsSync(join(cwd, 'bun.lock')) || existsSync(join(cwd, 'bun.lockb'))) return 'bun'
  return 'npm'
}

function formatPackageScriptCommand(packageManager: 'npm' | 'pnpm' | 'yarn' | 'bun', scriptName: string): string {
  const quoted = quoteShellTokenIfNeeded(scriptName)
  if (packageManager === 'npm') return `npm run ${quoted}`
  if (packageManager === 'pnpm') return `pnpm run ${quoted}`
  if (packageManager === 'bun') return `bun run ${quoted}`
  return `yarn ${quoted}`
}

function formatActionLabel(kind: LocalActionKind, scriptName: string): string {
  return scriptName === kind ? kind : `${kind}: ${scriptName}`
}

function quoteShellTokenIfNeeded(value: string): string {
  return /^[A-Za-z0-9_./:@-]+$/u.test(value) ? value : `'${value.replace(/'/gu, `'\\''`)}'`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
