import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import {
  closeDesktopAutomationSqlite,
  isoToMs,
  openDesktopAutomationSqlite,
  readDesktopAutomationRuntimeRow,
  upsertDesktopAutomationRuntimeRow,
} from './desktopSqlite'
import { getNativeAutomationsRoot, listNativeAutomationEntries, type NativeAutomationEntry, type NativeAutomationStoreOptions } from './nativeStore'
import { createAutomationRunStore, syncDesktopAutomationRun } from './runStore'

const MIGRATION_MARKER_FILENAME = '.codexui-runtime-migrated-to-desktop-sqlite'

export type LegacyRuntimeMigrationResult = {
  skipped: boolean
  markerPath: string
  migratedSchedulerStates: number
  migratedRuns: number
}

export async function migrateLegacyAutomationRuntimeToDesktopSqlite(
  options: NativeAutomationStoreOptions = {},
): Promise<LegacyRuntimeMigrationResult> {
  const automationRoot = getNativeAutomationsRoot(options)
  const codexHomeDir = options.codexHomeDir ?? dirname(automationRoot)
  const markerPath = join(automationRoot, MIGRATION_MARKER_FILENAME)
  if (await fileExists(markerPath)) {
    return { skipped: true, markerPath, migratedSchedulerStates: 0, migratedRuns: 0 }
  }

  const entries = await listNativeAutomationEntries(options)
  let migratedSchedulerStates = 0
  let migratedRuns = 0
  const handle = openDesktopAutomationSqlite(options)
  try {
    for (const entry of entries.records) {
      const schedulerState = await readLegacySchedulerState(entry)
      const existing = readDesktopAutomationRuntimeRow(handle, entry.record.id)
      const createdAt = existing?.createdAt ?? entry.record.createdAtMs ?? Date.now()
      const updatedAt = existing?.updatedAt ?? entry.record.updatedAtMs ?? createdAt
      upsertDesktopAutomationRuntimeRow(handle, {
        id: entry.record.id,
        name: entry.record.name,
        prompt: entry.record.prompt,
        status: entry.record.status,
        nextRunAt: existing?.nextRunAt ?? schedulerState.nextRunAt,
        lastRunAt: existing?.lastRunAt ?? schedulerState.lastRunAt,
        cwds: JSON.stringify(entry.record.cwds),
        rrule: entry.record.rrule,
        model: entry.record.model,
        reasoningEffort: entry.record.reasoningEffort,
        createdAt,
        updatedAt: schedulerState.updatedAt ?? updatedAt,
      })
      if (schedulerState.found) migratedSchedulerStates += 1

      const runStore = createAutomationRunStore(entry.automationDirPath)
      for (const run of await listLegacyRunsForMigration(runStore)) {
        syncDesktopAutomationRun(run, codexHomeDir)
        migratedRuns += 1
      }
    }
  } finally {
    closeDesktopAutomationSqlite(handle)
  }

  await mkdir(automationRoot, { recursive: true })
  await writeFile(markerPath, `${JSON.stringify({
    migratedAtIso: new Date().toISOString(),
    migratedSchedulerStates,
    migratedRuns,
  }, null, 2)}\n`, 'utf8')

  return { skipped: false, markerPath, migratedSchedulerStates, migratedRuns }
}

async function listLegacyRunsForMigration(
  runStore: ReturnType<typeof createAutomationRunStore>,
) {
  try {
    return await runStore.listRuns()
  } catch {
    return []
  }
}

async function readLegacySchedulerState(entry: NativeAutomationEntry): Promise<{
  found: boolean
  nextRunAt: number | null
  lastRunAt: number | null
  updatedAt: number | null
}> {
  try {
    const parsed = JSON.parse(await readFile(join(entry.automationDirPath, 'scheduler.json'), 'utf8')) as Record<string, unknown>
    return {
      found: true,
      nextRunAt: readOptionalIsoMs(parsed.nextDueAtIso),
      lastRunAt: readOptionalIsoMs(parsed.lastDueAtIso),
      updatedAt: readOptionalIsoMs(parsed.updatedAtIso),
    }
  } catch {
    return { found: false, nextRunAt: null, lastRunAt: null, updatedAt: null }
  }
}

function readOptionalIsoMs(value: unknown): number | null {
  return typeof value === 'string' ? isoToMs(value) : null
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}
