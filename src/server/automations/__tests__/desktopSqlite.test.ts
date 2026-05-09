import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  closeDesktopAutomationSqlite,
  isoToMs,
  listDesktopAutomationRunRows,
  listDesktopAutomationRuntimeRows,
  msToIso,
  openDesktopAutomationSqlite,
  readDesktopAutomationRunRow,
  readDesktopAutomationRuntimeRow,
  resolveDesktopAutomationSqlitePath,
  updateDesktopAutomationRunRow,
  updateDesktopAutomationTiming,
  upsertDesktopAutomationRunRow,
  upsertDesktopAutomationRuntimeRow,
  type DesktopAutomationRunRow,
  type DesktopAutomationSqliteHandle,
  type DesktopAutomationRuntimeRow,
} from '../desktopSqlite'

const tempDirs: string[] = []
const openHandles: DesktopAutomationSqliteHandle[] = []
const originalCodexHome = process.env.CODEX_HOME
const BetterSqlite3 = createRequire(import.meta.url)('better-sqlite3') as new (filename: string) => {
  exec(sql: string): void
  close(): void
}

afterEach(async () => {
  if (originalCodexHome === undefined) delete process.env.CODEX_HOME
  else process.env.CODEX_HOME = originalCodexHome
  for (const handle of openHandles.splice(0)) {
    closeDesktopAutomationSqlite(handle)
  }
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function createTempDir() {
  const dir = await mkdtemp(join(tmpdir(), 'codexui-desktop-sqlite-'))
  tempDirs.push(dir)
  return dir
}

function openTempDatabase(databasePath: string): DesktopAutomationSqliteHandle {
  const handle = openDesktopAutomationSqlite({ databasePath })
  openHandles.push(handle)
  return handle
}

type TableInfoRow = {
  cid: number
  name: string
  type: string
  notnull: number
  dflt_value: string | null
  pk: number
}

function tableInfo(handle: DesktopAutomationSqliteHandle, tableName: string): TableInfoRow[] {
  return handle.database.prepare(`PRAGMA table_info(${tableName})`).all() as TableInfoRow[]
}

function comparableTableInfo(handle: DesktopAutomationSqliteHandle, tableName: string) {
  return tableInfo(handle, tableName).map(({ name, type, notnull, dflt_value, pk }) => ({
    name,
    type,
    notnull,
    dflt_value,
    pk,
  }))
}

const baseAutomationRow: DesktopAutomationRuntimeRow = {
  id: 'daily-check',
  name: 'Daily Check',
  prompt: 'Check the thread',
  status: 'ACTIVE',
  nextRunAt: isoToMs('2026-05-09T12:00:00.000Z'),
  lastRunAt: null,
  cwds: JSON.stringify(['/repo/one']),
  rrule: 'FREQ=DAILY;INTERVAL=1',
  model: 'gpt-5.5',
  reasoningEffort: 'low',
  createdAt: isoToMs('2026-05-09T10:00:00.000Z')!,
  updatedAt: isoToMs('2026-05-09T10:30:00.000Z')!,
}

const baseRunRow: DesktopAutomationRunRow = {
  threadId: 'thread-a',
  automationId: 'daily-check',
  status: 'IN_PROGRESS',
  readAt: null,
  threadTitle: 'Daily Check Run',
  sourceCwd: '/repo/one',
  inboxTitle: 'Daily Check',
  inboxSummary: 'Running',
  createdAt: isoToMs('2026-05-09T12:01:00.000Z')!,
  updatedAt: isoToMs('2026-05-09T12:01:30.000Z')!,
  archivedUserMessage: null,
  archivedAssistantMessage: null,
  archivedReason: null,
}

describe('desktop automation SQLite access', () => {
  it('creates only the Desktop-compatible automation tables and columns', async () => {
    const tempDir = await createTempDir()
    const handle = openTempDatabase(join(tempDir, 'sqlite', 'codex.db'))

    expect(comparableTableInfo(handle, 'automations')).toEqual([
      { name: 'id', type: 'TEXT', notnull: 0, dflt_value: null, pk: 1 },
      { name: 'name', type: 'TEXT', notnull: 1, dflt_value: null, pk: 0 },
      { name: 'prompt', type: 'TEXT', notnull: 1, dflt_value: null, pk: 0 },
      { name: 'status', type: 'TEXT', notnull: 1, dflt_value: "'ACTIVE'", pk: 0 },
      { name: 'next_run_at', type: 'INTEGER', notnull: 0, dflt_value: null, pk: 0 },
      { name: 'last_run_at', type: 'INTEGER', notnull: 0, dflt_value: null, pk: 0 },
      { name: 'cwds', type: 'TEXT', notnull: 1, dflt_value: "'[]'", pk: 0 },
      { name: 'rrule', type: 'TEXT', notnull: 1, dflt_value: "'FREQ=HOURLY;INTERVAL=24;BYMINUTE=0'", pk: 0 },
      { name: 'model', type: 'TEXT', notnull: 0, dflt_value: null, pk: 0 },
      { name: 'reasoning_effort', type: 'TEXT', notnull: 0, dflt_value: null, pk: 0 },
      { name: 'created_at', type: 'INTEGER', notnull: 1, dflt_value: null, pk: 0 },
      { name: 'updated_at', type: 'INTEGER', notnull: 1, dflt_value: null, pk: 0 },
    ])
    expect(comparableTableInfo(handle, 'automation_runs')).toEqual([
      { name: 'thread_id', type: 'TEXT', notnull: 0, dflt_value: null, pk: 1 },
      { name: 'automation_id', type: 'TEXT', notnull: 1, dflt_value: null, pk: 0 },
      { name: 'status', type: 'TEXT', notnull: 1, dflt_value: null, pk: 0 },
      { name: 'read_at', type: 'INTEGER', notnull: 0, dflt_value: null, pk: 0 },
      { name: 'thread_title', type: 'TEXT', notnull: 0, dflt_value: null, pk: 0 },
      { name: 'source_cwd', type: 'TEXT', notnull: 0, dflt_value: null, pk: 0 },
      { name: 'inbox_title', type: 'TEXT', notnull: 0, dflt_value: null, pk: 0 },
      { name: 'inbox_summary', type: 'TEXT', notnull: 0, dflt_value: null, pk: 0 },
      { name: 'created_at', type: 'INTEGER', notnull: 1, dflt_value: null, pk: 0 },
      { name: 'updated_at', type: 'INTEGER', notnull: 1, dflt_value: null, pk: 0 },
      { name: 'archived_user_message', type: 'TEXT', notnull: 0, dflt_value: null, pk: 0 },
      { name: 'archived_assistant_message', type: 'TEXT', notnull: 0, dflt_value: null, pk: 0 },
      { name: 'archived_reason', type: 'TEXT', notnull: 0, dflt_value: null, pk: 0 },
    ])
  })

  it('resolves Desktop SQLite path under CODEX_HOME and prefers codex-dev.db when present', async () => {
    const codexHomeDir = await createTempDir()
    const sqliteDir = join(codexHomeDir, 'sqlite')
    const devPath = join(sqliteDir, 'codex-dev.db')
    const prodPath = join(sqliteDir, 'codex.db')

    expect(resolveDesktopAutomationSqlitePath({ codexHomeDir })).toBe(prodPath)

    await mkdir(sqliteDir, { recursive: true })
    await writeFile(prodPath, '')
    await writeFile(devPath, '')

    expect(resolveDesktopAutomationSqlitePath({ codexHomeDir })).toBe(devPath)
    expect(resolveDesktopAutomationSqlitePath({
      codexHomeDir,
      databasePath: join(codexHomeDir, 'custom.db'),
    })).toBe(join(codexHomeDir, 'custom.db'))
  })

  it('uses CODEX_HOME when no codexHomeDir is injected', async () => {
    const codexHomeDir = await createTempDir()
    process.env.CODEX_HOME = codexHomeDir

    expect(resolveDesktopAutomationSqlitePath()).toBe(join(codexHomeDir, 'sqlite', 'codex.db'))
  })

  it('adds missing Desktop columns to existing older automation tables', async () => {
    const tempDir = await createTempDir()
    const databasePath = join(tempDir, 'sqlite', 'codex.db')
    await mkdir(join(tempDir, 'sqlite'), { recursive: true })
    const database = new BetterSqlite3(databasePath)
    try {
      database.exec(`
        CREATE TABLE automations (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          prompt TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'ACTIVE',
          next_run_at INTEGER,
          last_run_at INTEGER,
          cwds TEXT NOT NULL DEFAULT '[]',
          rrule TEXT NOT NULL DEFAULT 'FREQ=HOURLY;INTERVAL=24;BYMINUTE=0',
          model TEXT,
          reasoning_effort TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE TABLE automation_runs (
          thread_id TEXT PRIMARY KEY,
          automation_id TEXT NOT NULL,
          status TEXT NOT NULL,
          read_at INTEGER,
          thread_title TEXT,
          source_cwd TEXT,
          inbox_title TEXT,
          inbox_summary TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
      `)
    } finally {
      database.close()
    }

    const handle = openTempDatabase(databasePath)

    expect(comparableTableInfo(handle, 'automation_runs').map((column) => column.name)).toEqual([
      'thread_id',
      'automation_id',
      'status',
      'read_at',
      'thread_title',
      'source_cwd',
      'inbox_title',
      'inbox_summary',
      'created_at',
      'updated_at',
      'archived_user_message',
      'archived_assistant_message',
      'archived_reason',
    ])
  })

  it('rebuilds populated partial tables when missing required Desktop columns', async () => {
    const tempDir = await createTempDir()
    const databasePath = join(tempDir, 'sqlite', 'codex.db')
    await mkdir(join(tempDir, 'sqlite'), { recursive: true })
    const database = new BetterSqlite3(databasePath)
    try {
      database.exec(`
        CREATE TABLE automations (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL
        );
        INSERT INTO automations (id, name) VALUES ('partial-automation', 'Partial Automation');
        CREATE TABLE automation_runs (
          thread_id TEXT PRIMARY KEY,
          automation_id TEXT NOT NULL,
          status TEXT NOT NULL
        );
        INSERT INTO automation_runs (thread_id, automation_id, status) VALUES ('thread-partial', 'partial-automation', 'IN_PROGRESS');
      `)
    } finally {
      database.close()
    }

    const handle = openTempDatabase(databasePath)
    const automation = readDesktopAutomationRuntimeRow(handle, 'partial-automation')
    const run = readDesktopAutomationRunRow(handle, 'thread-partial')

    expect(automation).toMatchObject({
      id: 'partial-automation',
      name: 'Partial Automation',
      status: 'ACTIVE',
      cwds: '[]',
      rrule: 'FREQ=HOURLY;INTERVAL=24;BYMINUTE=0',
    })
    expect(automation?.createdAt).toEqual(expect.any(Number))
    expect(run).toMatchObject({
      threadId: 'thread-partial',
      automationId: 'partial-automation',
      status: 'IN_PROGRESS',
    })
    expect(run?.createdAt).toEqual(expect.any(Number))
  })

  it('upserts automation runtime rows and updates Desktop timing columns as millisecond integers', async () => {
    const tempDir = await createTempDir()
    const handle = openTempDatabase(join(tempDir, 'sqlite', 'codex.db'))
    const nextRunAt = isoToMs('2026-05-10T12:00:00.000Z')
    const lastRunAt = isoToMs('2026-05-09T12:00:00.000Z')
    const updatedAt = isoToMs('2026-05-09T12:05:00.000Z')

    expect(upsertDesktopAutomationRuntimeRow(handle, baseAutomationRow)).toEqual(baseAutomationRow)
    expect(listDesktopAutomationRuntimeRows(handle)).toEqual([baseAutomationRow])

    const updated = updateDesktopAutomationTiming(handle, {
      id: baseAutomationRow.id,
      nextRunAt,
      lastRunAt,
      updatedAt,
    })

    expect(updated).toEqual({
      ...baseAutomationRow,
      nextRunAt,
      lastRunAt,
      updatedAt,
    })
    expect(readDesktopAutomationRuntimeRow(handle, baseAutomationRow.id)?.nextRunAt).toBe(nextRunAt)
    expect(msToIso(readDesktopAutomationRuntimeRow(handle, baseAutomationRow.id)?.lastRunAt)).toBe('2026-05-09T12:00:00.000Z')
  })

  it('preserves automation created_at on conflict upserts', async () => {
    const tempDir = await createTempDir()
    const handle = openTempDatabase(join(tempDir, 'sqlite', 'codex.db'))

    upsertDesktopAutomationRuntimeRow(handle, baseAutomationRow)
    const updated = upsertDesktopAutomationRuntimeRow(handle, {
      ...baseAutomationRow,
      name: 'Updated Daily Check',
      createdAt: isoToMs('2026-05-01T10:00:00.000Z')!,
      updatedAt: isoToMs('2026-05-09T13:00:00.000Z')!,
    })

    expect(updated).toMatchObject({
      name: 'Updated Daily Check',
      createdAt: baseAutomationRow.createdAt,
      updatedAt: isoToMs('2026-05-09T13:00:00.000Z')!,
    })
  })

  it('upserts, lists, reads, and updates automation run rows', async () => {
    const tempDir = await createTempDir()
    const handle = openTempDatabase(join(tempDir, 'sqlite', 'codex.db'))
    const olderRun: DesktopAutomationRunRow = {
      ...baseRunRow,
      threadId: 'thread-older',
      createdAt: isoToMs('2026-05-09T11:01:00.000Z')!,
    }

    expect(upsertDesktopAutomationRunRow(handle, olderRun)).toEqual(olderRun)
    expect(upsertDesktopAutomationRunRow(handle, baseRunRow)).toEqual(baseRunRow)
    expect(listDesktopAutomationRunRows(handle).map((run) => run.threadId)).toEqual(['thread-a', 'thread-older'])

    const readAt = isoToMs('2026-05-09T12:06:00.000Z')
    const updated = updateDesktopAutomationRunRow(handle, baseRunRow.threadId, {
      status: 'ARCHIVED',
      readAt,
      inboxSummary: 'Done',
      archivedUserMessage: 'Archive this run',
      archivedAssistantMessage: 'Archived',
      archivedReason: 'no_findings',
      updatedAt: isoToMs('2026-05-09T12:07:00.000Z')!,
    })

    expect(updated).toMatchObject({
      ...baseRunRow,
      status: 'ARCHIVED',
      readAt,
      inboxSummary: 'Done',
      archivedUserMessage: 'Archive this run',
      archivedAssistantMessage: 'Archived',
      archivedReason: 'no_findings',
      updatedAt: isoToMs('2026-05-09T12:07:00.000Z')!,
    })
    expect(readDesktopAutomationRunRow(handle, baseRunRow.threadId)).toEqual(updated)
  })

  it('preserves run created_at on conflict upserts and ignores undefined partial updates', async () => {
    const tempDir = await createTempDir()
    const handle = openTempDatabase(join(tempDir, 'sqlite', 'codex.db'))

    upsertDesktopAutomationRunRow(handle, baseRunRow)
    const upserted = upsertDesktopAutomationRunRow(handle, {
      ...baseRunRow,
      status: 'PENDING_REVIEW',
      inboxSummary: 'Needs review',
      createdAt: isoToMs('2026-05-01T12:01:00.000Z')!,
      updatedAt: isoToMs('2026-05-09T12:08:00.000Z')!,
    })
    const updated = updateDesktopAutomationRunRow(handle, baseRunRow.threadId, {
      inboxSummary: undefined,
      threadTitle: undefined,
      readAt: null,
      updatedAt: isoToMs('2026-05-09T12:09:00.000Z')!,
    })

    expect(upserted).toMatchObject({
      status: 'PENDING_REVIEW',
      inboxSummary: 'Needs review',
      createdAt: baseRunRow.createdAt,
      updatedAt: isoToMs('2026-05-09T12:08:00.000Z')!,
    })
    expect(updated).toMatchObject({
      inboxSummary: 'Needs review',
      threadTitle: baseRunRow.threadTitle,
      readAt: null,
      updatedAt: isoToMs('2026-05-09T12:09:00.000Z')!,
    })
  })
})
