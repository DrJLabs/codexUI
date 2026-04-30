import { appendFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { AutomationRun } from '../../types/automations'

export type AutomationRunStore = {
  createRun(run: AutomationRun): Promise<AutomationRun>
  readRun(runId: string): Promise<AutomationRun>
  listRuns(): Promise<AutomationRun[]>
  updateRun(runId: string, update: Partial<AutomationRun>): Promise<AutomationRun>
  appendEvent(run: AutomationRun, event: Record<string, unknown>): Promise<void>
  appendLog(run: AutomationRun, message: string): Promise<void>
}

export function createAutomationRunStore(automationDirPath: string): AutomationRunStore {
  const runsRoot = join(automationDirPath, 'runs')
  const readRun = async (runId: string): Promise<AutomationRun> => {
    return parseRun(await readFile(runJsonPath(runsRoot, runId), 'utf8'))
  }

  return {
    async createRun(run) {
      await mkdir(dirname(run.runJsonPath), { recursive: true })
      await writeFile(run.runJsonPath, serializeRun(run), 'utf8')
      return run
    },

    readRun,

    async listRuns() {
      let entries
      try {
        entries = await readdir(runsRoot, { withFileTypes: true })
      } catch {
        return []
      }
      const runs = await Promise.all(entries
        .filter((entry) => entry.isDirectory())
        .map(async (entry) => {
          try {
            return parseRun(await readFile(runJsonPath(runsRoot, entry.name), 'utf8'))
          } catch {
            return null
          }
        }))
      return runs
        .filter((run): run is AutomationRun => run !== null)
        .sort((a, b) => compareIsoDesc(a.createdAtIso, b.createdAtIso) || b.id.localeCompare(a.id))
    },

    async updateRun(runId, update) {
      const current = await readRun(runId)
      const next: AutomationRun = {
        ...current,
        ...update,
        updatedAtIso: update.updatedAtIso ?? new Date().toISOString(),
      }
      await mkdir(dirname(next.runJsonPath), { recursive: true })
      await writeFile(next.runJsonPath, serializeRun(next), 'utf8')
      return next
    },

    async appendEvent(run, event) {
      await mkdir(dirname(run.eventsPath), { recursive: true })
      await appendFile(run.eventsPath, `${JSON.stringify({ ...event, atIso: new Date().toISOString(), runId: run.id })}\n`, 'utf8')
    },

    async appendLog(run, message) {
      await mkdir(dirname(run.logPath), { recursive: true })
      await appendFile(run.logPath, `[${new Date().toISOString()}] ${message}\n`, 'utf8')
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
  return join(runsRoot, runId, 'run.json')
}

function parseRun(raw: string): AutomationRun {
  const parsed = JSON.parse(raw) as Partial<AutomationRun>
  return {
    ...parsed,
    trigger: parsed.trigger === 'schedule' ? 'schedule' : 'manual',
    dueAtIso: typeof parsed.dueAtIso === 'string' ? parsed.dueAtIso : null,
    nextDueAtIso: typeof parsed.nextDueAtIso === 'string' ? parsed.nextDueAtIso : null,
    branchName: typeof parsed.branchName === 'string' ? parsed.branchName : null,
  } as AutomationRun
}

function serializeRun(run: AutomationRun): string {
  return `${JSON.stringify(run, null, 2)}\n`
}

function compareIsoDesc(a: string, b: string): number {
  return Date.parse(b) - Date.parse(a)
}
