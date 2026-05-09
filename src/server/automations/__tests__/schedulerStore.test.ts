import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  closeDesktopAutomationSqlite,
  isoToMs,
  openDesktopAutomationSqlite,
  readDesktopAutomationRuntimeRow,
  upsertDesktopAutomationRuntimeRow,
  type DesktopAutomationSqliteHandle,
} from '../desktopSqlite'
import { createAutomationSchedulerStore } from '../schedulerStore'

const tempDirs: string[] = []
const openHandles: DesktopAutomationSqliteHandle[] = []

afterEach(async () => {
  for (const handle of openHandles.splice(0)) {
    closeDesktopAutomationSqlite(handle)
  }
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function createTempAutomationDir() {
  const dir = await mkdtemp(join(tmpdir(), 'codexui-scheduler-store-'))
  tempDirs.push(dir)
  return dir
}

function openTempDatabase(databasePath: string): DesktopAutomationSqliteHandle {
  const handle = openDesktopAutomationSqlite({ databasePath })
  openHandles.push(handle)
  return handle
}

describe('createAutomationSchedulerStore', () => {
  it('returns deterministic missing state defaults without writing scheduler.json', async () => {
    const tempDir = await createTempAutomationDir()
    const automationDir = join(tempDir, 'automations', 'daily-check-dir')
    const databasePath = join(tempDir, 'sqlite', 'codex.db')
    const store = createAutomationSchedulerStore(automationDir, { databasePath })

    const state = await store.readOrDefault({
      automationId: 'daily-check',
      sourceDirName: 'daily-check-dir',
    })

    expect(state).toEqual({
      automationId: 'daily-check',
      sourceDirName: 'daily-check-dir',
      scheduleHash: '',
      nextDueAtIso: null,
      lastDueAtIso: null,
      lastScheduledRunId: null,
      lastEvaluatedAtIso: null,
      missedRunPolicy: 'one_catch_up',
      unsupportedReason: null,
      updatedAtIso: null,
    })
    expect(store.path).toBe(databasePath)
    await expect(readFile(join(automationDir, 'scheduler.json'), 'utf8')).rejects.toThrow()
  })

  it('writes and reads scheduler timing through Desktop SQLite millisecond columns', async () => {
    const tempDir = await createTempAutomationDir()
    const automationDir = join(tempDir, 'automations', 'daily-check-dir')
    const databasePath = join(tempDir, 'sqlite', 'codex.db')
    const handle = openTempDatabase(databasePath)
    upsertDesktopAutomationRuntimeRow(handle, {
      id: 'daily-check',
      name: 'Daily Check',
      prompt: 'Check the project',
      status: 'ACTIVE',
      nextRunAt: null,
      lastRunAt: null,
      cwds: '[]',
      rrule: 'FREQ=DAILY;BYHOUR=9;BYMINUTE=30',
      model: null,
      reasoningEffort: null,
      createdAt: isoToMs('2026-04-01T08:00:00.000Z')!,
      updatedAt: isoToMs('2026-04-01T08:05:00.000Z')!,
    })
    closeDesktopAutomationSqlite(openHandles.pop()!)
    const store = createAutomationSchedulerStore(automationDir, { databasePath })

    const written = await store.writeState({
      automationId: 'daily-check',
      sourceDirName: 'daily-check-dir',
      scheduleHash: 'hash-a',
      nextDueAtIso: '2026-04-30T09:30:00.000Z',
      lastDueAtIso: null,
      lastScheduledRunId: null,
      lastEvaluatedAtIso: '2026-04-30T08:00:00.000Z',
      missedRunPolicy: 'one_catch_up',
      unsupportedReason: null,
      updatedAtIso: '2026-04-30T08:00:00.000Z',
    })

    expect(await store.readState({
      automationId: 'daily-check',
      sourceDirName: 'daily-check-dir',
    })).toEqual({
      ...written,
      scheduleHash: '',
      lastScheduledRunId: null,
      lastEvaluatedAtIso: null,
      unsupportedReason: null,
    })
    const verifyHandle = openTempDatabase(databasePath)
    expect(readDesktopAutomationRuntimeRow(verifyHandle, 'daily-check')).toMatchObject({
      id: 'daily-check',
      nextRunAt: isoToMs('2026-04-30T09:30:00.000Z'),
      lastRunAt: null,
      updatedAt: isoToMs('2026-04-30T08:00:00.000Z'),
    })
    await expect(readFile(join(automationDir, 'scheduler.json'), 'utf8')).rejects.toThrow()
  })

  it('preserves existing Desktop automation metadata when writing scheduler timing', async () => {
    const tempDir = await createTempAutomationDir()
    const automationDir = join(tempDir, 'automations', 'daily-check-dir')
    const databasePath = join(tempDir, 'sqlite', 'codex.db')
    const handle = openTempDatabase(databasePath)
    upsertDesktopAutomationRuntimeRow(handle, {
      id: 'daily-check',
      name: 'Existing Name',
      prompt: 'Existing prompt',
      status: 'PAUSED',
      nextRunAt: isoToMs('2026-04-29T09:30:00.000Z'),
      lastRunAt: null,
      cwds: JSON.stringify(['/repo/existing']),
      rrule: 'FREQ=WEEKLY;BYDAY=MO',
      model: 'gpt-5.5',
      reasoningEffort: 'medium',
      createdAt: isoToMs('2026-04-01T08:00:00.000Z')!,
      updatedAt: isoToMs('2026-04-01T08:05:00.000Z')!,
    })
    closeDesktopAutomationSqlite(openHandles.pop()!)

    const store = createAutomationSchedulerStore(automationDir, { databasePath })
    await store.writeState({
      automationId: 'daily-check',
      sourceDirName: 'daily-check-dir',
      scheduleHash: 'hash-a',
      nextDueAtIso: '2026-04-30T09:30:00.000Z',
      lastDueAtIso: '2026-04-29T09:30:00.000Z',
      lastScheduledRunId: null,
      lastEvaluatedAtIso: '2026-04-30T08:00:00.000Z',
      missedRunPolicy: 'one_catch_up',
      unsupportedReason: null,
      updatedAtIso: '2026-04-30T08:00:00.000Z',
    })

    const verifyHandle = openTempDatabase(databasePath)
    expect(readDesktopAutomationRuntimeRow(verifyHandle, 'daily-check')).toEqual({
      id: 'daily-check',
      name: 'Existing Name',
      prompt: 'Existing prompt',
      status: 'PAUSED',
      nextRunAt: isoToMs('2026-04-30T09:30:00.000Z'),
      lastRunAt: isoToMs('2026-04-29T09:30:00.000Z'),
      cwds: JSON.stringify(['/repo/existing']),
      rrule: 'FREQ=WEEKLY;BYDAY=MO',
      model: 'gpt-5.5',
      reasoningEffort: 'medium',
      createdAt: isoToMs('2026-04-01T08:00:00.000Z')!,
      updatedAt: isoToMs('2026-04-30T08:00:00.000Z')!,
    })
  })

  it('updates by merging against the current readOrDefault state', async () => {
    const tempDir = await createTempAutomationDir()
    const automationDir = join(tempDir, 'automations', 'daily-check-dir')
    const databasePath = join(tempDir, 'sqlite', 'codex.db')
    const handle = openTempDatabase(databasePath)
    upsertDesktopAutomationRuntimeRow(handle, {
      id: 'daily-check',
      name: 'Daily Check',
      prompt: 'Check the project',
      status: 'ACTIVE',
      nextRunAt: null,
      lastRunAt: isoToMs('2026-04-29T09:30:00.000Z'),
      cwds: '[]',
      rrule: 'FREQ=DAILY;BYHOUR=9;BYMINUTE=30',
      model: null,
      reasoningEffort: null,
      createdAt: isoToMs('2026-04-01T08:00:00.000Z')!,
      updatedAt: isoToMs('2026-04-01T08:05:00.000Z')!,
    })
    closeDesktopAutomationSqlite(openHandles.pop()!)
    const store = createAutomationSchedulerStore(automationDir, { databasePath })
    await store.writeState({
      automationId: 'daily-check',
      sourceDirName: 'daily-check-dir',
      scheduleHash: 'hash-a',
      nextDueAtIso: '2026-04-30T09:30:00.000Z',
      lastDueAtIso: '2026-04-29T09:30:00.000Z',
      lastScheduledRunId: null,
      lastEvaluatedAtIso: null,
      missedRunPolicy: 'one_catch_up',
      unsupportedReason: null,
      updatedAtIso: '2026-04-30T08:00:00.000Z',
    })

    const updated = await store.updateState({
      automationId: 'daily-check',
      sourceDirName: 'daily-check-dir',
      scheduleHash: 'hash-b',
      nextDueAtIso: null,
      unsupportedReason: 'Scheduler execution for FREQ=MONTHLY is not implemented',
      updatedAtIso: '2026-04-30T10:00:00.000Z',
    })

    expect(updated).toMatchObject({
      automationId: 'daily-check',
      sourceDirName: 'daily-check-dir',
      scheduleHash: 'hash-b',
      nextDueAtIso: null,
      lastDueAtIso: '2026-04-29T09:30:00.000Z',
      lastScheduledRunId: null,
      lastEvaluatedAtIso: null,
      unsupportedReason: 'Scheduler execution for FREQ=MONTHLY is not implemented',
      updatedAtIso: '2026-04-30T10:00:00.000Z',
    })
    expect(await store.readState({
      automationId: 'daily-check',
      sourceDirName: 'daily-check-dir',
    })).toEqual({
      ...updated,
      scheduleHash: '',
      lastScheduledRunId: null,
      lastEvaluatedAtIso: null,
      unsupportedReason: null,
    })
  })

  it('cold reads persisted timing by explicit automation id when directory name differs', async () => {
    const tempDir = await createTempAutomationDir()
    const automationDir = join(tempDir, 'automations', 'daily-check-dir')
    const databasePath = join(tempDir, 'sqlite', 'codex.db')
    const handle = openTempDatabase(databasePath)
    upsertDesktopAutomationRuntimeRow(handle, {
      id: 'daily-check',
      name: 'Daily Check',
      prompt: 'Check the project',
      status: 'ACTIVE',
      nextRunAt: isoToMs('2026-04-30T09:30:00.000Z'),
      lastRunAt: isoToMs('2026-04-29T09:30:00.000Z'),
      cwds: JSON.stringify(['/repo']),
      rrule: 'FREQ=DAILY;BYHOUR=9;BYMINUTE=30',
      model: null,
      reasoningEffort: null,
      createdAt: isoToMs('2026-04-01T08:00:00.000Z')!,
      updatedAt: isoToMs('2026-04-30T08:00:00.000Z')!,
    })
    closeDesktopAutomationSqlite(openHandles.pop()!)

    const coldStore = createAutomationSchedulerStore(automationDir, { databasePath })
    await expect(coldStore.readState({
      automationId: 'daily-check',
      sourceDirName: 'daily-check-dir',
    })).resolves.toEqual({
      automationId: 'daily-check',
      sourceDirName: 'daily-check-dir',
      scheduleHash: '',
      nextDueAtIso: '2026-04-30T09:30:00.000Z',
      lastDueAtIso: '2026-04-29T09:30:00.000Z',
      lastScheduledRunId: null,
      lastEvaluatedAtIso: null,
      missedRunPolicy: 'one_catch_up',
      unsupportedReason: null,
      updatedAtIso: '2026-04-30T08:00:00.000Z',
    })
  })

  it('does not create a missing SQLite row for all-null default timing', async () => {
    const tempDir = await createTempAutomationDir()
    const automationDir = join(tempDir, 'automations', 'daily-check-dir')
    const databasePath = join(tempDir, 'sqlite', 'codex.db')
    const store = createAutomationSchedulerStore(automationDir, { databasePath })

    const written = await store.writeState({
      automationId: 'daily-check',
      sourceDirName: 'daily-check-dir',
      scheduleHash: '',
      nextDueAtIso: null,
      lastDueAtIso: null,
      lastScheduledRunId: null,
      lastEvaluatedAtIso: null,
      missedRunPolicy: 'one_catch_up',
      unsupportedReason: null,
      updatedAtIso: null,
    })

    expect(written.updatedAtIso).toBeNull()
    const handle = openTempDatabase(databasePath)
    expect(readDesktopAutomationRuntimeRow(handle, 'daily-check')).toBeNull()
  })

  it('returns deterministic state without creating a missing row when timing is provided', async () => {
    const tempDir = await createTempAutomationDir()
    const automationDir = join(tempDir, 'automations', 'daily-check-dir')
    const databasePath = join(tempDir, 'sqlite', 'codex.db')
    const store = createAutomationSchedulerStore(automationDir, { databasePath })

    const updated = await store.updateState({
      automationId: 'daily-check',
      sourceDirName: 'daily-check-dir',
      nextDueAtIso: '2026-04-30T09:30:00.000Z',
      updatedAtIso: '2026-04-30T08:00:00.000Z',
    })

    expect(updated).toEqual({
      automationId: 'daily-check',
      sourceDirName: 'daily-check-dir',
      scheduleHash: '',
      nextDueAtIso: '2026-04-30T09:30:00.000Z',
      lastDueAtIso: null,
      lastScheduledRunId: null,
      lastEvaluatedAtIso: null,
      missedRunPolicy: 'one_catch_up',
      unsupportedReason: null,
      updatedAtIso: '2026-04-30T08:00:00.000Z',
    })
    const handle = openTempDatabase(databasePath)
    expect(readDesktopAutomationRuntimeRow(handle, 'daily-check')).toBeNull()
  })

  it('rejects scheduler state with invalid ISO timestamp fields', async () => {
    const tempDir = await createTempAutomationDir()
    const automationDir = join(tempDir, 'automations', 'daily-check-dir')
    const databasePath = join(tempDir, 'sqlite', 'codex.db')
    const store = createAutomationSchedulerStore(automationDir, { databasePath })

    await expect(store.writeState({
      automationId: 'daily-check',
      sourceDirName: 'daily-check-dir',
      scheduleHash: 'hash-a',
      nextDueAtIso: 'not-an-iso',
      lastDueAtIso: null,
      lastScheduledRunId: null,
      lastEvaluatedAtIso: '2026-04-30T08:00:00.000Z',
      missedRunPolicy: 'one_catch_up',
      unsupportedReason: null,
      updatedAtIso: '2026-04-30T08:00:00.000Z',
    })).rejects.toThrow(/nextDueAtIso/)
  })

  it('rejects scheduler state with invalid identity fields', async () => {
    const tempDir = await createTempAutomationDir()
    const automationDir = join(tempDir, 'automations', 'daily-check-dir')
    const databasePath = join(tempDir, 'sqlite', 'codex.db')
    const store = createAutomationSchedulerStore(automationDir, { databasePath })

    await expect(store.writeState({
      automationId: '',
      sourceDirName: '../daily-check',
      scheduleHash: 'hash-a',
      nextDueAtIso: null,
      lastDueAtIso: null,
      lastScheduledRunId: null,
      lastEvaluatedAtIso: null,
      missedRunPolicy: 'one_catch_up',
      unsupportedReason: null,
      updatedAtIso: null,
    })).rejects.toThrow(/automationId/)
  })
})
