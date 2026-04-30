import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

export type AutomationSchedulerState = {
  automationId: string
  sourceDirName: string
  scheduleHash: string
  nextDueAtIso: string | null
  lastDueAtIso: string | null
  lastScheduledRunId: string | null
  lastEvaluatedAtIso: string | null
  missedRunPolicy: 'one_catch_up'
  unsupportedReason: string | null
  updatedAtIso: string | null
}

export type MissingSchedulerStateInput = {
  automationId: string
  sourceDirName: string
}

export function createAutomationSchedulerStore(automationDirPath: string) {
  const schedulerJsonPath = join(automationDirPath, 'scheduler.json')

  return {
    path: schedulerJsonPath,

    async readState(): Promise<AutomationSchedulerState | null> {
      try {
        return parseState(await readFile(schedulerJsonPath, 'utf8'))
      } catch (error) {
        if (isNodeError(error) && error.code === 'ENOENT') return null
        throw error
      }
    },

    async readOrDefault(input: MissingSchedulerStateInput): Promise<AutomationSchedulerState> {
      return await this.readState() ?? createMissingSchedulerState(input)
    },

    async writeState(state: AutomationSchedulerState): Promise<AutomationSchedulerState> {
      await mkdir(dirname(schedulerJsonPath), { recursive: true })
      await writeFile(schedulerJsonPath, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
      return state
    },

    async updateState(update: Partial<AutomationSchedulerState>): Promise<AutomationSchedulerState> {
      const current = await this.readState()
      if (!current) throw new Error('Cannot update missing automation scheduler state')
      return await this.writeState({ ...current, ...update })
    },
  }
}

export function createMissingSchedulerState(input: MissingSchedulerStateInput): AutomationSchedulerState {
  return {
    automationId: input.automationId,
    sourceDirName: input.sourceDirName,
    scheduleHash: '',
    nextDueAtIso: null,
    lastDueAtIso: null,
    lastScheduledRunId: null,
    lastEvaluatedAtIso: null,
    missedRunPolicy: 'one_catch_up',
    unsupportedReason: null,
    updatedAtIso: null,
  }
}

function parseState(raw: string): AutomationSchedulerState {
  const parsed = JSON.parse(raw) as Partial<AutomationSchedulerState>
  return {
    automationId: typeof parsed.automationId === 'string' ? parsed.automationId : '',
    sourceDirName: typeof parsed.sourceDirName === 'string' ? parsed.sourceDirName : '',
    scheduleHash: typeof parsed.scheduleHash === 'string' ? parsed.scheduleHash : '',
    nextDueAtIso: readNullableIso(parsed.nextDueAtIso, 'nextDueAtIso'),
    lastDueAtIso: readNullableIso(parsed.lastDueAtIso, 'lastDueAtIso'),
    lastScheduledRunId: typeof parsed.lastScheduledRunId === 'string' ? parsed.lastScheduledRunId : null,
    lastEvaluatedAtIso: readNullableIso(parsed.lastEvaluatedAtIso, 'lastEvaluatedAtIso'),
    missedRunPolicy: 'one_catch_up',
    unsupportedReason: typeof parsed.unsupportedReason === 'string' ? parsed.unsupportedReason : null,
    updatedAtIso: readNullableIso(parsed.updatedAtIso, 'updatedAtIso'),
  }
}

function readNullableIso(value: unknown, field: string): string | null {
  if (value === null || value === undefined) return null
  if (typeof value !== 'string') throw new Error(`Invalid scheduler state ${field}`)
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== value) {
    throw new Error(`Invalid scheduler state ${field}`)
  }
  return value
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error
}
