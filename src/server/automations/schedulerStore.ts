import {
  closeDesktopAutomationSqlite,
  isoToMs,
  msToIso,
  openDesktopAutomationSqlite,
  readDesktopAutomationRuntimeRow,
  resolveDesktopAutomationSqlitePath,
  updateDesktopAutomationTiming,
  type DesktopAutomationRuntimeRow,
  type DesktopAutomationSqliteHandle,
  type DesktopAutomationSqliteOptions,
} from './desktopSqlite'

// Desktop SQLite is the canonical shared runtime store for scheduler timing.
// This adapter intentionally does not create or update legacy scheduler.json files.
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

export type AutomationSchedulerStoreOptions = DesktopAutomationSqliteOptions

export function createAutomationSchedulerStore(
  _automationDirPath: string,
  options: AutomationSchedulerStoreOptions = {},
) {
  const databasePath = resolveDesktopAutomationSqlitePath(options)

  async function readPersistedState(input: MissingSchedulerStateInput): Promise<AutomationSchedulerState | null> {
    const identity = normalizeMissingSchedulerStateInput(input)

    return withDesktopSqlite(databasePath, (handle) => {
      const row = readDesktopAutomationRuntimeRow(handle, identity.automationId)
      if (!row) return null
      return mapRuntimeRowToSchedulerState(row, identity.sourceDirName)
    })
  }

  return {
    path: databasePath,

    async readState(input: MissingSchedulerStateInput): Promise<AutomationSchedulerState | null> {
      return await readPersistedState(input)
    },

    async readOrDefault(input: MissingSchedulerStateInput): Promise<AutomationSchedulerState> {
      const normalizedInput = normalizeMissingSchedulerStateInput(input)
      return await readPersistedState(normalizedInput) ?? createMissingSchedulerState(normalizedInput)
    },

    async writeState(state: AutomationSchedulerState): Promise<AutomationSchedulerState> {
      const normalized = parseState(JSON.stringify(state))
      const nextRunAt = isoToMs(normalized.nextDueAtIso)
      const lastRunAt = isoToMs(normalized.lastDueAtIso)
      const updatedAt = isoToMs(normalized.updatedAtIso)

      return withDesktopSqlite(databasePath, (handle) => {
        const existing = readDesktopAutomationRuntimeRow(handle, normalized.automationId)
        if (!existing) {
          return normalized
        }

        const persisted = updateDesktopAutomationTiming(handle, {
          id: normalized.automationId,
          nextRunAt,
          lastRunAt,
          updatedAt,
        })
        if (!persisted) throw new Error(`Failed to write automation scheduler state: ${normalized.automationId}`)

        return normalized
      })
    },

    async updateState(update: Partial<AutomationSchedulerState>): Promise<AutomationSchedulerState> {
      const defaultState = readDefaultFromUpdate(update)
      const current = await this.readState({
        automationId: defaultState.automationId,
        sourceDirName: defaultState.sourceDirName,
      }) ?? defaultState
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
  const automationId = readIdentity(parsed.automationId, 'automationId')
  const sourceDirName = readIdentity(parsed.sourceDirName, 'sourceDirName')
  return {
    automationId,
    sourceDirName,
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

function normalizeMissingSchedulerStateInput(input: MissingSchedulerStateInput): MissingSchedulerStateInput {
  return {
    automationId: readIdentity(input.automationId, 'automationId'),
    sourceDirName: readIdentity(input.sourceDirName, 'sourceDirName'),
  }
}

function readDefaultFromUpdate(update: Partial<AutomationSchedulerState>): AutomationSchedulerState {
  if (typeof update.automationId !== 'string' || typeof update.sourceDirName !== 'string') {
    throw new Error('Cannot update missing automation scheduler state')
  }
  return createMissingSchedulerState({
    automationId: update.automationId,
    sourceDirName: update.sourceDirName,
  })
}

function withDesktopSqlite<T>(databasePath: string, operation: (handle: DesktopAutomationSqliteHandle) => T): T {
  const handle = openDesktopAutomationSqlite({ databasePath })
  try {
    return operation(handle)
  } finally {
    closeDesktopAutomationSqlite(handle)
  }
}

function mapRuntimeRowToSchedulerState(
  row: DesktopAutomationRuntimeRow,
  sourceDirName: string,
): AutomationSchedulerState {
  const automationId = readIdentity(row.id, 'automationId')
  return {
    automationId,
    sourceDirName: readIdentity(sourceDirName, 'sourceDirName'),
    scheduleHash: '',
    nextDueAtIso: msToIso(row.nextRunAt),
    lastDueAtIso: msToIso(row.lastRunAt),
    lastScheduledRunId: null,
    lastEvaluatedAtIso: null,
    missedRunPolicy: 'one_catch_up',
    unsupportedReason: null,
    updatedAtIso: msToIso(row.updatedAt),
  }
}

function readIdentity(value: unknown, field: string): string {
  if (typeof value !== 'string' || !isSafeIdentity(value)) {
    throw new Error(`Invalid scheduler state ${field}`)
  }
  return value
}

function isSafeIdentity(value: string): boolean {
  return Boolean(value && value.trim() === value && value !== '.' && value !== '..' && !value.includes('/') && !value.includes('\\'))
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
