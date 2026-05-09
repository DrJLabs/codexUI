import { setTimeout as sleep } from 'node:timers/promises'
import { appendFile, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { hostname } from 'node:os'
import { dirname, join } from 'node:path'
import type { AutomationRun } from '../../types/automations'
import {
  closeDesktopAutomationSqlite,
  isoToMs,
  openDesktopAutomationSqlite,
  upsertDesktopAutomationRunRow,
} from './desktopSqlite'

// Desktop SQLite is mirrored for cross-app run/inbox state. Local JSON files remain
// only for CodexUI-private run details that do not exist in Desktop automation_runs.
const ACTIVE_RUN_INDEX_LOCK_TIMEOUT_MS = 5000
const ACTIVE_RUN_INDEX_LOCK_POLL_MS = 10
const ACTIVE_RUN_INDEX_STALE_LOCK_MS = 30_000
const ACTIVE_RUN_INDEX_LOCK_OWNER_FILENAME = 'owner.json'
const ACTIVE_RUN_INDEX_LOCK_HOSTNAME = hostname()

export type AutomationRunStore = {
  createRun(run: AutomationRun): Promise<AutomationRun>
  readRun(runId: string): Promise<AutomationRun>
  hasRun(runId: string): Promise<boolean>
  listActiveRuns(): Promise<AutomationRun[]>
  listRuns(options?: { limit?: number }): Promise<AutomationRun[]>
  updateRun(runId: string, update: Partial<AutomationRun>): Promise<AutomationRun>
  appendEvent(run: AutomationRun, event: Record<string, unknown>): Promise<void>
  appendLog(run: AutomationRun, message: string): Promise<void>
}

export function createAutomationRunStore(automationDirPath: string): AutomationRunStore {
  const runsRoot = join(automationDirPath, 'runs')
  const codexHomeDir = codexHomeDirFromAutomationDir(automationDirPath)
  const readRun = async (runId: string): Promise<AutomationRun> => {
    return parseRun(await readFile(runJsonPath(runsRoot, runId), 'utf8'), automationDirPath, runId)
  }
  const listRuns = async (options: { limit?: number } = {}): Promise<AutomationRun[]> => {
    let entries
    try {
      entries = await readdir(runsRoot, { withFileTypes: true })
    } catch (error) {
      if (!isErrorCode(error, 'ENOENT')) throw error
      return []
    }
    const runDirs = entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort((left, right) => right.localeCompare(left))
    const runs: AutomationRun[] = []
    for (const runId of runDirs) {
      try {
        runs.push(parseRun(await readFile(runJsonPath(runsRoot, runId), 'utf8'), automationDirPath, runId))
      } catch (error) {
        if (!isToleratedRunReadError(error)) throw error
        // Ignore stale or malformed run directories so one bad run does not hide the rest.
      }
    }
    const limit = normalizeListLimit(options.limit)
    const sortedRuns = runs
      .sort((a, b) => compareIsoDesc(a.createdAtIso, b.createdAtIso) || b.id.localeCompare(a.id))
    return Number.isFinite(limit) ? sortedRuns.slice(0, limit) : sortedRuns
  }

  return {
    async createRun(run) {
      const next = normalizeRunPaths(run, automationDirPath, run.id)
      await mkdir(dirname(next.runJsonPath), { recursive: true })
      await writeFile(next.runJsonPath, serializeRun(next), 'utf8')
      await syncActiveRunIndex(runsRoot, next)
      syncDesktopAutomationRun(next, codexHomeDir)
      return next
    },

    readRun,

    async hasRun(runId) {
      try {
        await readRun(runId)
        return true
      } catch (error) {
        if (!isErrorCode(error, 'ENOENT')) throw error
        return false
      }
    },

    async listActiveRuns() {
      const indexedRunIds = await readActiveRunIndex(runsRoot)
      if (indexedRunIds !== null) {
        const activeRuns: AutomationRun[] = []
        for (const runId of indexedRunIds) {
          try {
            const run = await readRun(runId)
            if (isActiveAutomationRunState(run.state)) activeRuns.push(run)
          } catch (error) {
            if (!isToleratedRunReadError(error)) throw error
            // Ignore stale index entries; the next run update will rewrite the index.
          }
        }
        return activeRuns.sort((a, b) => compareIsoDesc(a.createdAtIso, b.createdAtIso) || b.id.localeCompare(a.id))
      }
      const activeRuns = (await listRuns()).filter((run) => isActiveAutomationRunState(run.state))
      await withActiveRunIndexLock(runsRoot, async () => {
        const current = await readActiveRunIndex(runsRoot)
        if (!current || current.length === 0) await writeActiveRunIndex(runsRoot, activeRuns.map((run) => run.id))
      })
      return activeRuns
    },

    listRuns,

    async updateRun(runId, update) {
      const current = await readRun(runId)
      const next: AutomationRun = {
        ...current,
        ...update,
        updatedAtIso: update.updatedAtIso ?? new Date().toISOString(),
      }
      const canonical = normalizeRunPaths(next, automationDirPath, runId)
      await mkdir(dirname(canonical.runJsonPath), { recursive: true })
      await writeFile(canonical.runJsonPath, serializeRun(canonical), 'utf8')
      await syncActiveRunIndex(runsRoot, canonical)
      syncDesktopAutomationRun(canonical, codexHomeDir)
      return canonical
    },

    async appendEvent(run, event) {
      const paths = createAutomationRunPaths(automationDirPath, run.id)
      await mkdir(dirname(paths.eventsPath), { recursive: true })
      await appendFile(paths.eventsPath, `${JSON.stringify({ ...event, atIso: new Date().toISOString(), runId: run.id })}\n`, 'utf8')
    },

    async appendLog(run, message) {
      const paths = createAutomationRunPaths(automationDirPath, run.id)
      await mkdir(dirname(paths.logPath), { recursive: true })
      await appendFile(paths.logPath, `[${new Date().toISOString()}] ${message}\n`, 'utf8')
    },
  }
}

export function syncDesktopAutomationRun(run: AutomationRun, codexHomeDir: string | null): void {
  if (!codexHomeDir) return
  const handle = openDesktopAutomationSqlite(codexHomeDir ? { codexHomeDir } : {})
  try {
    upsertDesktopAutomationRunRow(handle, {
      threadId: desktopRunThreadId(run),
      automationId: run.automationId,
      status: desktopRunStatus(run),
      readAt: isoToMs(run.readAtIso),
      threadTitle: run.resultSummary,
      sourceCwd: run.cwd,
      inboxTitle: run.inboxTitle || run.automationName,
      inboxSummary: run.inboxSummary || run.errorMessage || run.resultSummary,
      createdAt: isoToMs(run.createdAtIso) ?? 0,
      updatedAt: isoToMs(run.updatedAtIso) ?? isoToMs(run.createdAtIso) ?? 0,
      archivedUserMessage: null,
      archivedAssistantMessage: null,
      archivedReason: run.archivedAtIso ? 'Archived in CodexUI' : null,
    })
  } finally {
    closeDesktopAutomationSqlite(handle)
  }
}

function codexHomeDirFromAutomationDir(automationDirPath: string): string | null {
  const normalized = automationDirPath.replace(/\\/gu, '/')
  const marker = '/automations/'
  const markerIndex = normalized.lastIndexOf(marker)
  if (markerIndex <= 0) return null
  return automationDirPath.slice(0, markerIndex)
}

function desktopRunThreadId(run: AutomationRun): string {
  return run.threadId || run.id
}

function desktopRunStatus(run: AutomationRun): 'IN_PROGRESS' | 'PENDING_REVIEW' | 'ACCEPTED' | 'ARCHIVED' {
  if (run.archivedAtIso) return 'ARCHIVED'
  if (run.readAtIso) return 'ACCEPTED'
  if (isActiveAutomationRunState(run.state)) return 'IN_PROGRESS'
  return 'PENDING_REVIEW'
}

export function createAutomationRunPaths(automationDirPath: string, runId: string): Pick<AutomationRun, 'runJsonPath' | 'eventsPath' | 'logPath'> {
  assertSafeRunId(runId)
  const runDir = join(automationDirPath, 'runs', runId)
  return {
    runJsonPath: join(runDir, 'run.json'),
    eventsPath: join(runDir, 'events.jsonl'),
    logPath: join(runDir, 'run.log'),
  }
}

export function isActiveAutomationRunState(state: string): boolean {
  return state === 'queued' || state === 'starting' || state === 'running'
}

function runJsonPath(runsRoot: string, runId: string): string {
  assertSafeRunId(runId)
  return join(runsRoot, runId, 'run.json')
}

function activeRunIndexPath(runsRoot: string): string {
  return join(dirname(runsRoot), '.active-runs.json')
}

async function readActiveRunIndex(runsRoot: string): Promise<string[] | null> {
  try {
    const parsed = JSON.parse(await readFile(activeRunIndexPath(runsRoot), 'utf8')) as unknown
    if (!Array.isArray(parsed)) return null
    return parsed.filter((runId): runId is string => {
      try {
        assertSafeRunId(runId)
        return true
      } catch {
        return false
      }
    })
  } catch {
    return null
  }
}

async function writeActiveRunIndex(runsRoot: string, runIds: string[]): Promise<void> {
  const uniqueRunIds = [...new Set(runIds)].filter((runId) => {
    try {
      assertSafeRunId(runId)
      return true
    } catch {
      return false
    }
  })
  await mkdir(runsRoot, { recursive: true })
  const indexPath = activeRunIndexPath(runsRoot)
  const tempPath = `${indexPath}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`
  try {
    await writeFile(tempPath, `${JSON.stringify(uniqueRunIds.sort(), null, 2)}\n`, 'utf8')
    await rename(tempPath, indexPath)
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => {})
    throw error
  }
}

async function syncActiveRunIndex(runsRoot: string, run: AutomationRun): Promise<void> {
  await withActiveRunIndexLock(runsRoot, async () => {
    const current = await readActiveRunIndex(runsRoot) ?? []
    const next = isActiveAutomationRunState(run.state)
      ? [...new Set([...current, run.id])]
      : current.filter((runId) => runId !== run.id)
    await writeActiveRunIndex(runsRoot, next)
  })
}

async function withActiveRunIndexLock<T>(runsRoot: string, fn: () => Promise<T>): Promise<T> {
  const lockPath = `${activeRunIndexPath(runsRoot)}.lock`
  const startedAt = Date.now()
  await mkdir(dirname(lockPath), { recursive: true })
  for (;;) {
    try {
      await mkdir(lockPath)
      await writeActiveRunIndexLockOwner(lockPath)
      break
    } catch (error) {
      if (!isErrorCode(error, 'EEXIST')) throw error
      if (await reclaimStaleActiveRunIndexLock(lockPath)) continue
      if (Date.now() - startedAt >= ACTIVE_RUN_INDEX_LOCK_TIMEOUT_MS) {
        throw new Error(`Timed out waiting for automation active run index lock at ${lockPath}`)
      }
      await sleep(ACTIVE_RUN_INDEX_LOCK_POLL_MS)
    }
  }
  try {
    return await fn()
  } finally {
    await rm(lockPath, { recursive: true, force: true })
  }
}

async function writeActiveRunIndexLockOwner(lockPath: string): Promise<void> {
  try {
    await writeFile(join(lockPath, ACTIVE_RUN_INDEX_LOCK_OWNER_FILENAME), `${JSON.stringify({
      pid: process.pid,
      hostname: ACTIVE_RUN_INDEX_LOCK_HOSTNAME,
      startedAtMs: Date.now(),
    }, null, 2)}\n`, 'utf8')
  } catch (error) {
    await rm(lockPath, { recursive: true, force: true }).catch(() => {})
    throw error
  }
}

async function reclaimStaleActiveRunIndexLock(lockPath: string): Promise<boolean> {
  const owner = await readActiveRunIndexLockOwner(lockPath)
  if (
    owner?.hostname === ACTIVE_RUN_INDEX_LOCK_HOSTNAME &&
    (!isProcessAlive(owner.pid) || Date.now() - owner.startedAtMs >= ACTIVE_RUN_INDEX_STALE_LOCK_MS)
  ) {
    await rm(lockPath, { recursive: true, force: true })
    return true
  }
  if (!owner || owner.hostname !== ACTIVE_RUN_INDEX_LOCK_HOSTNAME) {
    try {
      const lockStat = await stat(lockPath)
      if (Date.now() - lockStat.mtimeMs >= ACTIVE_RUN_INDEX_STALE_LOCK_MS) {
        await rm(lockPath, { recursive: true, force: true })
        return true
      }
    } catch (error) {
      return isErrorCode(error, 'ENOENT')
    }
  }
  return false
}

async function readActiveRunIndexLockOwner(lockPath: string): Promise<{ pid: number; hostname: string | null; startedAtMs: number } | null> {
  try {
    const parsed = JSON.parse(await readFile(join(lockPath, ACTIVE_RUN_INDEX_LOCK_OWNER_FILENAME), 'utf8')) as unknown
    if (!parsed || typeof parsed !== 'object') return null
    const pid = (parsed as { pid?: unknown }).pid
    const parsedHostname = (parsed as { hostname?: unknown }).hostname
    const startedAtMs = (parsed as { startedAtMs?: unknown }).startedAtMs
    if (!Number.isInteger(pid) || Number(pid) <= 0 || typeof startedAtMs !== 'number') return null
    return {
      pid: Number(pid),
      hostname: typeof parsedHostname === 'string' && parsedHostname.trim() ? parsedHostname : null,
      startedAtMs,
    }
  } catch {
    return null
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    if (isErrorCode(error, 'ESRCH')) return false
    return true
  }
}

function isErrorCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: unknown }).code === code
}

function assertSafeRunId(runId: string): void {
  if (!runId || runId.trim() !== runId || runId === '.' || runId === '..' || !/^[A-Za-z0-9._-]+$/u.test(runId)) {
    throw new Error('Invalid automation run id')
  }
}

function parseRun(raw: string, automationDirPath: string, runId: string): AutomationRun {
  const parsed = JSON.parse(raw) as Partial<AutomationRun>
  const normalized = {
    ...parsed,
    id: runId,
    trigger: parsed.trigger === 'schedule' ? 'schedule' : 'manual',
    dueAtIso: typeof parsed.dueAtIso === 'string' ? parsed.dueAtIso : null,
    nextDueAtIso: typeof parsed.nextDueAtIso === 'string' ? parsed.nextDueAtIso : null,
    targetThreadId: typeof parsed.targetThreadId === 'string' ? parsed.targetThreadId : null,
    cwd: typeof parsed.cwd === 'string' ? parsed.cwd : null,
    worktreePath: typeof parsed.worktreePath === 'string' ? parsed.worktreePath : null,
    branchName: typeof parsed.branchName === 'string' ? parsed.branchName : null,
    threadId: typeof parsed.threadId === 'string' ? parsed.threadId : null,
    turnId: typeof parsed.turnId === 'string' ? parsed.turnId : null,
    resultSummary: typeof parsed.resultSummary === 'string' ? parsed.resultSummary : null,
    errorMessage: typeof parsed.errorMessage === 'string' ? parsed.errorMessage : null,
    findings: typeof parsed.findings === 'boolean' ? parsed.findings : null,
    inboxTitle: typeof parsed.inboxTitle === 'string' ? parsed.inboxTitle : '',
    inboxSummary: typeof parsed.inboxSummary === 'string' ? parsed.inboxSummary : '',
    readAtIso: typeof parsed.readAtIso === 'string' ? parsed.readAtIso : null,
    archivedAtIso: typeof parsed.archivedAtIso === 'string' ? parsed.archivedAtIso : null,
    kanbanTaskId: typeof parsed.kanbanTaskId === 'string' ? parsed.kanbanTaskId : null,
    reviewPacketId: typeof parsed.reviewPacketId === 'string' ? parsed.reviewPacketId : null,
    proposalIds: Array.isArray(parsed.proposalIds)
      ? parsed.proposalIds.filter((proposalId): proposalId is string => typeof proposalId === 'string')
      : [],
  } as AutomationRun
  return normalizeRunPaths(normalized, automationDirPath, runId)
}

function normalizeRunPaths(run: AutomationRun, automationDirPath: string, runId: string): AutomationRun {
  assertSafeRunId(runId)
  return {
    ...run,
    id: runId,
    ...createAutomationRunPaths(automationDirPath, runId),
  }
}

function serializeRun(run: AutomationRun): string {
  return `${JSON.stringify(run, null, 2)}\n`
}

function normalizeListLimit(limit: number | undefined): number {
  if (limit === undefined) return Number.POSITIVE_INFINITY
  if (!Number.isInteger(limit) || limit < 1) return Number.POSITIVE_INFINITY
  return limit
}

function isToleratedRunReadError(error: unknown): boolean {
  return error instanceof SyntaxError || isErrorCode(error, 'ENOENT')
}

function compareIsoDesc(a: string, b: string): number {
  return Date.parse(b) - Date.parse(a)
}
