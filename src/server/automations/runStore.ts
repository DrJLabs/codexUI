import { appendFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { AutomationRun } from '../../types/automations'

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
  const readRun = async (runId: string): Promise<AutomationRun> => {
    return parseRun(await readFile(runJsonPath(runsRoot, runId), 'utf8'), automationDirPath, runId)
  }
  const listRuns = async (options: { limit?: number } = {}): Promise<AutomationRun[]> => {
    let entries
    try {
      entries = await readdir(runsRoot, { withFileTypes: true })
    } catch {
      return []
    }
    const limit = normalizeListLimit(options.limit)
    const runDirs = entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort((left, right) => right.localeCompare(left))
    const runs: AutomationRun[] = []
    for (const runId of runDirs) {
      if (Number.isFinite(limit) && runs.length >= limit) break
      try {
        runs.push(parseRun(await readFile(runJsonPath(runsRoot, runId), 'utf8'), automationDirPath, runId))
      } catch {
        // Ignore stale or malformed run directories so one bad run does not hide the rest.
      }
    }
    return runs
      .sort((a, b) => compareIsoDesc(a.createdAtIso, b.createdAtIso) || b.id.localeCompare(a.id))
  }

  return {
    async createRun(run) {
      const next = normalizeRunPaths(run, automationDirPath, run.id)
      await mkdir(dirname(next.runJsonPath), { recursive: true })
      await writeFile(next.runJsonPath, serializeRun(next), 'utf8')
      await syncActiveRunIndex(runsRoot, next)
      return next
    },

    readRun,

    async hasRun(runId) {
      try {
        await readRun(runId)
        return true
      } catch {
        return false
      }
    },

    async listActiveRuns() {
      const indexedRunIds = await readActiveRunIndex(runsRoot)
      if (indexedRunIds) {
        const activeRuns: AutomationRun[] = []
        for (const runId of indexedRunIds) {
          try {
            const run = await readRun(runId)
            if (isActiveAutomationRunState(run.state)) activeRuns.push(run)
          } catch {
            // Ignore stale index entries; the next run update will rewrite the index.
          }
        }
        return activeRuns.sort((a, b) => compareIsoDesc(a.createdAtIso, b.createdAtIso) || b.id.localeCompare(a.id))
      }
      const activeRuns = (await listRuns()).filter((run) => isActiveAutomationRunState(run.state))
      await writeActiveRunIndex(runsRoot, activeRuns.map((run) => run.id))
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

export function createAutomationRunPaths(automationDirPath: string, runId: string): Pick<AutomationRun, 'runJsonPath' | 'eventsPath' | 'logPath'> {
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
  await writeFile(activeRunIndexPath(runsRoot), `${JSON.stringify(uniqueRunIds.sort(), null, 2)}\n`, 'utf8')
}

async function syncActiveRunIndex(runsRoot: string, run: AutomationRun): Promise<void> {
  const current = await readActiveRunIndex(runsRoot) ?? []
  const next = isActiveAutomationRunState(run.state)
    ? [...new Set([...current, run.id])]
    : current.filter((runId) => runId !== run.id)
  await writeActiveRunIndex(runsRoot, next)
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
    branchName: typeof parsed.branchName === 'string' ? parsed.branchName : null,
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

function compareIsoDesc(a: string, b: string): number {
  return Date.parse(b) - Date.parse(a)
}
