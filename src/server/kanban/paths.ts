import { createHash } from 'node:crypto'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

export function resolveKanbanDataDir(configuredDir: string, homeDir = homedir(), codexHome = process.env.CODEX_HOME ?? ''): string {
  const trimmed = configuredDir.trim()
  if (trimmed) return resolve(trimmed)

  const parentDir = codexHome.trim() || join(homeDir, '.codex')
  return join(resolve(parentDir), 'codexui-kanban')
}

export function projectHash(projectRoot: string): string {
  return createHash('sha256').update(resolve(projectRoot)).digest('hex').slice(0, 16)
}

export function resolveProjectStatePath(dataDir: string, projectRoot: string): string {
  return join(dataDir, 'state', `${projectHash(projectRoot)}.json`)
}

export function resolveProjectRunDir(dataDir: string, projectRoot: string, runId: string): string {
  return join(dataDir, 'runs', projectHash(projectRoot), runId)
}
