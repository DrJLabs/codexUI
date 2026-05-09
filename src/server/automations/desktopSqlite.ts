import { existsSync, mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { resolveCodexHomeDir } from './paths'

type SqliteBindValue = string | number | null
type SqliteBindParams = SqliteBindValue | Record<string, SqliteBindValue>

type SqliteRunResult = {
  changes: number
  lastInsertRowid: number | bigint
}

type SqliteStatement = {
  run(...params: SqliteBindParams[]): SqliteRunResult
  get(...params: SqliteBindParams[]): unknown
  all(...params: SqliteBindParams[]): unknown[]
}

export type DesktopSqliteDatabase = {
  exec(sql: string): void
  prepare(sql: string): SqliteStatement
  close(): void
}

const BetterSqlite3 = createRequire(import.meta.url)('better-sqlite3') as new (filename: string) => DesktopSqliteDatabase

export type DesktopAutomationSqliteOptions = {
  codexHomeDir?: string
  databasePath?: string
}

export type DesktopAutomationSqliteHandle = {
  database: DesktopSqliteDatabase
  databasePath: string
  close(): void
}

export type DesktopAutomationStatus = 'ACTIVE' | 'PAUSED' | 'DELETED'

export type DesktopAutomationRuntimeRow = {
  id: string
  name: string
  prompt: string
  status: DesktopAutomationStatus
  nextRunAt: number | null
  lastRunAt: number | null
  cwds: string
  rrule: string
  model: string | null
  reasoningEffort: string | null
  createdAt: number
  updatedAt: number
}

export type DesktopAutomationTimingUpdate = {
  id: string
  nextRunAt: number | null
  lastRunAt: number | null
  updatedAt?: number | null
}

export type DesktopAutomationRunStatus = 'IN_PROGRESS' | 'PENDING_REVIEW' | 'ACCEPTED' | 'ARCHIVED'

export type DesktopAutomationRunRow = {
  threadId: string
  automationId: string
  status: DesktopAutomationRunStatus
  readAt: number | null
  threadTitle: string | null
  sourceCwd: string | null
  inboxTitle: string | null
  inboxSummary: string | null
  createdAt: number
  updatedAt: number
  archivedUserMessage: string | null
  archivedAssistantMessage: string | null
  archivedReason: string | null
}

export type DesktopAutomationRunUpdate = Partial<Omit<DesktopAutomationRunRow, 'threadId'>>

const AUTOMATION_RUN_UPDATE_COLUMNS = [
  ['automationId', 'automation_id'],
  ['status', 'status'],
  ['readAt', 'read_at'],
  ['threadTitle', 'thread_title'],
  ['sourceCwd', 'source_cwd'],
  ['inboxTitle', 'inbox_title'],
  ['inboxSummary', 'inbox_summary'],
  ['createdAt', 'created_at'],
  ['updatedAt', 'updated_at'],
  ['archivedUserMessage', 'archived_user_message'],
  ['archivedAssistantMessage', 'archived_assistant_message'],
  ['archivedReason', 'archived_reason'],
] as const satisfies readonly (readonly [keyof DesktopAutomationRunUpdate, string])[]

const DESKTOP_AUTOMATIONS_COLUMN_DEFINITIONS = [
  ['id', 'TEXT PRIMARY KEY'],
  ['name', 'TEXT NOT NULL'],
  ['prompt', 'TEXT NOT NULL'],
  ['status', "TEXT NOT NULL DEFAULT 'ACTIVE'"],
  ['next_run_at', 'INTEGER'],
  ['last_run_at', 'INTEGER'],
  ['cwds', "TEXT NOT NULL DEFAULT '[]'"],
  ['rrule', "TEXT NOT NULL DEFAULT 'FREQ=HOURLY;INTERVAL=24;BYMINUTE=0'"],
  ['model', 'TEXT'],
  ['reasoning_effort', 'TEXT'],
  ['created_at', 'INTEGER NOT NULL'],
  ['updated_at', 'INTEGER NOT NULL'],
] as const

const DESKTOP_AUTOMATION_RUNS_COLUMN_DEFINITIONS = [
  ['thread_id', 'TEXT PRIMARY KEY'],
  ['automation_id', 'TEXT NOT NULL'],
  ['status', 'TEXT NOT NULL'],
  ['read_at', 'INTEGER'],
  ['thread_title', 'TEXT'],
  ['source_cwd', 'TEXT'],
  ['inbox_title', 'TEXT'],
  ['inbox_summary', 'TEXT'],
  ['created_at', 'INTEGER NOT NULL'],
  ['updated_at', 'INTEGER NOT NULL'],
  ['archived_user_message', 'TEXT'],
  ['archived_assistant_message', 'TEXT'],
  ['archived_reason', 'TEXT'],
] as const

export function resolveDesktopAutomationSqlitePath(options: DesktopAutomationSqliteOptions = {}): string {
  const injectedPath = options.databasePath?.trim()
  if (injectedPath) return isAbsolute(injectedPath) ? injectedPath : resolve(injectedPath)

  const sqliteDir = join(resolveCodexHomeDir(options), 'sqlite')
  const devPath = join(sqliteDir, 'codex-dev.db')
  return existsSync(devPath) ? devPath : join(sqliteDir, 'codex.db')
}

export function openDesktopAutomationSqlite(options: DesktopAutomationSqliteOptions = {}): DesktopAutomationSqliteHandle {
  const databasePath = resolveDesktopAutomationSqlitePath(options)
  mkdirSync(dirname(databasePath), { recursive: true })
  const database = new BetterSqlite3(databasePath)
  ensureDesktopAutomationSchema(database)
  return {
    database,
    databasePath,
    close() {
      database.close()
    },
  }
}

export function closeDesktopAutomationSqlite(handle: DesktopAutomationSqliteHandle): void {
  handle.close()
}

export function ensureDesktopAutomationSchema(databaseOrHandle: DesktopSqliteDatabase | DesktopAutomationSqliteHandle): void {
  const database = 'database' in databaseOrHandle ? databaseOrHandle.database : databaseOrHandle
  database.exec(`
    CREATE TABLE IF NOT EXISTS automations (
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

    CREATE TABLE IF NOT EXISTS automation_runs (
      thread_id TEXT PRIMARY KEY,
      automation_id TEXT NOT NULL,
      status TEXT NOT NULL,
      read_at INTEGER,
      thread_title TEXT,
      source_cwd TEXT,
      inbox_title TEXT,
      inbox_summary TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      archived_user_message TEXT,
      archived_assistant_message TEXT,
      archived_reason TEXT
    );
  `)
  reconcileDesktopColumns(database, 'automations', DESKTOP_AUTOMATIONS_COLUMN_DEFINITIONS)
  reconcileDesktopColumns(database, 'automation_runs', DESKTOP_AUTOMATION_RUNS_COLUMN_DEFINITIONS)
}

export function isoToMs(value: string | null | undefined): number | null {
  if (value === null || value === undefined) return null
  const ms = Date.parse(value)
  if (!Number.isFinite(ms) || new Date(ms).toISOString() !== value) {
    throw new Error(`Invalid ISO timestamp: ${value}`)
  }
  return ms
}

export function msToIso(value: number | null | undefined): string | null {
  if (value === null || value === undefined) return null
  if (!Number.isSafeInteger(value)) throw new Error(`Invalid millisecond timestamp: ${value}`)
  return new Date(value).toISOString()
}

export function upsertDesktopAutomationRuntimeRow(
  handle: DesktopAutomationSqliteHandle,
  row: DesktopAutomationRuntimeRow,
): DesktopAutomationRuntimeRow {
  handle.database.prepare(`
    INSERT INTO automations (
      id,
      name,
      prompt,
      status,
      next_run_at,
      last_run_at,
      cwds,
      rrule,
      model,
      reasoning_effort,
      created_at,
      updated_at
    ) VALUES (
      @id,
      @name,
      @prompt,
      @status,
      @nextRunAt,
      @lastRunAt,
      @cwds,
      @rrule,
      @model,
      @reasoningEffort,
      @createdAt,
      @updatedAt
    )
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      prompt = excluded.prompt,
      status = excluded.status,
      next_run_at = excluded.next_run_at,
      last_run_at = excluded.last_run_at,
      cwds = excluded.cwds,
      rrule = excluded.rrule,
      model = excluded.model,
      reasoning_effort = excluded.reasoning_effort,
      updated_at = excluded.updated_at
  `).run(row)
  const persisted = readDesktopAutomationRuntimeRow(handle, row.id)
  if (!persisted) throw new Error(`Failed to upsert automation runtime row: ${row.id}`)
  return persisted
}

export function readDesktopAutomationRuntimeRow(
  handle: DesktopAutomationSqliteHandle,
  automationId: string,
): DesktopAutomationRuntimeRow | null {
  const row = handle.database.prepare(`
    SELECT
      id,
      name,
      prompt,
      status,
      next_run_at,
      last_run_at,
      cwds,
      rrule,
      model,
      reasoning_effort,
      created_at,
      updated_at
    FROM automations
    WHERE id = ?
  `).get(automationId)
  return row === undefined ? null : normalizeAutomationRuntimeRow(row)
}

export function deleteDesktopAutomationRuntimeRow(handle: DesktopAutomationSqliteHandle, automationId: string): boolean {
  const result = handle.database.prepare('DELETE FROM automations WHERE id = ?').run(automationId)
  return result.changes > 0
}

export function listDesktopAutomationRuntimeRows(handle: DesktopAutomationSqliteHandle): DesktopAutomationRuntimeRow[] {
  return handle.database.prepare(`
    SELECT
      id,
      name,
      prompt,
      status,
      next_run_at,
      last_run_at,
      cwds,
      rrule,
      model,
      reasoning_effort,
      created_at,
      updated_at
    FROM automations
    ORDER BY id ASC
  `).all().map(normalizeAutomationRuntimeRow)
}

export function updateDesktopAutomationTiming(
  handle: DesktopAutomationSqliteHandle,
  update: DesktopAutomationTimingUpdate,
): DesktopAutomationRuntimeRow | null {
  handle.database.prepare(`
    UPDATE automations
    SET
      next_run_at = @nextRunAt,
      last_run_at = @lastRunAt,
      updated_at = COALESCE(@updatedAt, updated_at)
    WHERE id = @id
  `).run({
    id: update.id,
    nextRunAt: update.nextRunAt,
    lastRunAt: update.lastRunAt,
    updatedAt: update.updatedAt ?? null,
  })
  return readDesktopAutomationRuntimeRow(handle, update.id)
}

export function upsertDesktopAutomationRunRow(
  handle: DesktopAutomationSqliteHandle,
  row: DesktopAutomationRunRow,
): DesktopAutomationRunRow {
  handle.database.prepare(`
    INSERT INTO automation_runs (
      thread_id,
      automation_id,
      status,
      read_at,
      thread_title,
      source_cwd,
      inbox_title,
      inbox_summary,
      created_at,
      updated_at,
      archived_user_message,
      archived_assistant_message,
      archived_reason
    ) VALUES (
      @threadId,
      @automationId,
      @status,
      @readAt,
      @threadTitle,
      @sourceCwd,
      @inboxTitle,
      @inboxSummary,
      @createdAt,
      @updatedAt,
      @archivedUserMessage,
      @archivedAssistantMessage,
      @archivedReason
    )
    ON CONFLICT(thread_id) DO UPDATE SET
      automation_id = excluded.automation_id,
      status = excluded.status,
      read_at = excluded.read_at,
      thread_title = excluded.thread_title,
      source_cwd = excluded.source_cwd,
      inbox_title = excluded.inbox_title,
      inbox_summary = excluded.inbox_summary,
      updated_at = excluded.updated_at,
      archived_user_message = excluded.archived_user_message,
      archived_assistant_message = excluded.archived_assistant_message,
      archived_reason = excluded.archived_reason
  `).run(row)
  const persisted = readDesktopAutomationRunRow(handle, row.threadId)
  if (!persisted) throw new Error(`Failed to upsert automation run row: ${row.threadId}`)
  return persisted
}

export function readDesktopAutomationRunRow(
  handle: DesktopAutomationSqliteHandle,
  threadId: string,
): DesktopAutomationRunRow | null {
  const row = handle.database.prepare(`
    SELECT
      thread_id,
      automation_id,
      status,
      read_at,
      thread_title,
      source_cwd,
      inbox_title,
      inbox_summary,
      created_at,
      updated_at,
      archived_user_message,
      archived_assistant_message,
      archived_reason
    FROM automation_runs
    WHERE thread_id = ?
  `).get(threadId)
  return row === undefined ? null : normalizeAutomationRunRow(row)
}

export function deleteDesktopAutomationRunRow(handle: DesktopAutomationSqliteHandle, threadId: string): boolean {
  const result = handle.database.prepare('DELETE FROM automation_runs WHERE thread_id = ?').run(threadId)
  return result.changes > 0
}

export function listDesktopAutomationRunRows(handle: DesktopAutomationSqliteHandle): DesktopAutomationRunRow[] {
  return handle.database.prepare(`
    SELECT
      thread_id,
      automation_id,
      status,
      read_at,
      thread_title,
      source_cwd,
      inbox_title,
      inbox_summary,
      created_at,
      updated_at,
      archived_user_message,
      archived_assistant_message,
      archived_reason
    FROM automation_runs
    ORDER BY created_at DESC, thread_id ASC
  `).all().map(normalizeAutomationRunRow)
}

export function updateDesktopAutomationRunRow(
  handle: DesktopAutomationSqliteHandle,
  threadId: string,
  update: DesktopAutomationRunUpdate,
): DesktopAutomationRunRow | null {
  const assignments: string[] = []
  const params: Record<string, SqliteBindValue> = { threadId }
  for (const [field, column] of AUTOMATION_RUN_UPDATE_COLUMNS) {
    if (!hasOwn(update, field)) continue
    if (update[field] === undefined) continue
    assignments.push(`${column} = @${field}`)
    params[field] = normalizeRunUpdateValue(update[field])
  }

  if (assignments.length === 0) return readDesktopAutomationRunRow(handle, threadId)

  handle.database.prepare(`
    UPDATE automation_runs
    SET ${assignments.join(', ')}
    WHERE thread_id = @threadId
  `).run(params)
  return readDesktopAutomationRunRow(handle, threadId)
}

function normalizeRunUpdateValue(value: DesktopAutomationRunUpdate[keyof DesktopAutomationRunUpdate]): SqliteBindValue {
  if (value === undefined) throw new Error('Unexpected undefined automation run update value')
  return value
}

function reconcileDesktopColumns(
  database: DesktopSqliteDatabase,
  tableName: 'automations' | 'automation_runs',
  columns: readonly (readonly [string, string])[],
): void {
  const existingColumns = readDesktopColumnNames(database, tableName)
  const missingColumns = columns.filter(([columnName]) => !existingColumns.has(columnName))
  if (missingColumns.some(([, definition]) => isNonAlterableColumnDefinition(definition))) {
    rebuildDesktopTable(database, tableName, columns, existingColumns)
    return
  }
  for (const [columnName, definition] of missingColumns) {
    database.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`)
  }
}

function readDesktopColumnNames(
  database: DesktopSqliteDatabase,
  tableName: 'automations' | 'automation_runs',
): Set<string> {
  return new Set(
    database.prepare(`PRAGMA table_info(${tableName})`).all()
      .map((row) => readRecord(row, `PRAGMA table_info(${tableName})`).name)
      .filter((name): name is string => typeof name === 'string'),
  )
}

function isNonAlterableColumnDefinition(definition: string): boolean {
  const normalized = definition.toUpperCase()
  return normalized.includes('PRIMARY KEY') || (normalized.includes('NOT NULL') && !normalized.includes('DEFAULT'))
}

function rebuildDesktopTable(
  database: DesktopSqliteDatabase,
  tableName: 'automations' | 'automation_runs',
  columns: readonly (readonly [string, string])[],
  existingColumns: Set<string>,
): void {
  const temporaryTableName = `_${tableName}_desktop_rebuild_${Date.now()}`
  const now = Date.now()
  database.exec('BEGIN')
  try {
    database.exec(`CREATE TABLE ${temporaryTableName} (${columns.map(([name, definition]) => `${name} ${definition}`).join(', ')})`)
    database.exec(`
      INSERT INTO ${temporaryTableName} (${columns.map(([name]) => name).join(', ')})
      SELECT ${columns.map(([name]) => migrationSelectExpression(tableName, name, existingColumns, now)).join(', ')}
      FROM ${tableName}
    `)
    database.exec(`DROP TABLE ${tableName}`)
    database.exec(`ALTER TABLE ${temporaryTableName} RENAME TO ${tableName}`)
    database.exec('COMMIT')
  } catch (error) {
    database.exec('ROLLBACK')
    throw error
  }
}

function migrationSelectExpression(
  tableName: 'automations' | 'automation_runs',
  columnName: string,
  existingColumns: Set<string>,
  now: number,
): string {
  if (existingColumns.has(columnName)) return columnName
  if (columnName === 'id' || columnName === 'thread_id') return 'CAST(rowid AS TEXT)'
  if (columnName === 'status') return tableName === 'automations' ? "'ACTIVE'" : "'IN_PROGRESS'"
  if (columnName === 'cwds') return "'[]'"
  if (columnName === 'rrule') return "'FREQ=HOURLY;INTERVAL=24;BYMINUTE=0'"
  if (columnName === 'created_at' || columnName === 'updated_at') return String(now)
  if (columnName === 'name' || columnName === 'prompt' || columnName === 'automation_id') return "''"
  return 'NULL'
}

function normalizeAutomationRuntimeRow(row: unknown): DesktopAutomationRuntimeRow {
  const record = readRecord(row, 'automation runtime row')
  return {
    id: readString(record.id, 'automations.id'),
    name: readString(record.name, 'automations.name'),
    prompt: readString(record.prompt, 'automations.prompt'),
    status: readAutomationStatus(record.status, 'automations.status'),
    nextRunAt: readNullableInteger(record.next_run_at, 'automations.next_run_at'),
    lastRunAt: readNullableInteger(record.last_run_at, 'automations.last_run_at'),
    cwds: readString(record.cwds, 'automations.cwds'),
    rrule: readString(record.rrule, 'automations.rrule'),
    model: readNullableString(record.model, 'automations.model'),
    reasoningEffort: readNullableString(record.reasoning_effort, 'automations.reasoning_effort'),
    createdAt: readInteger(record.created_at, 'automations.created_at'),
    updatedAt: readInteger(record.updated_at, 'automations.updated_at'),
  }
}

function normalizeAutomationRunRow(row: unknown): DesktopAutomationRunRow {
  const record = readRecord(row, 'automation run row')
  return {
    threadId: readString(record.thread_id, 'automation_runs.thread_id'),
    automationId: readString(record.automation_id, 'automation_runs.automation_id'),
    status: readAutomationRunStatus(record.status, 'automation_runs.status'),
    readAt: readNullableInteger(record.read_at, 'automation_runs.read_at'),
    threadTitle: readNullableString(record.thread_title, 'automation_runs.thread_title'),
    sourceCwd: readNullableString(record.source_cwd, 'automation_runs.source_cwd'),
    inboxTitle: readNullableString(record.inbox_title, 'automation_runs.inbox_title'),
    inboxSummary: readNullableString(record.inbox_summary, 'automation_runs.inbox_summary'),
    createdAt: readInteger(record.created_at, 'automation_runs.created_at'),
    updatedAt: readInteger(record.updated_at, 'automation_runs.updated_at'),
    archivedUserMessage: readNullableString(record.archived_user_message, 'automation_runs.archived_user_message'),
    archivedAssistantMessage: readNullableString(record.archived_assistant_message, 'automation_runs.archived_assistant_message'),
    archivedReason: readNullableString(record.archived_reason, 'automation_runs.archived_reason'),
  }
}

function readRecord(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`Invalid ${field}`)
  }
  return value as Record<string, unknown>
}

function readString(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new Error(`Invalid ${field}`)
  return value
}

function readNullableString(value: unknown, field: string): string | null {
  if (value === null) return null
  return readString(value, field)
}

function readInteger(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw new Error(`Invalid ${field}`)
  return value
}

function readNullableInteger(value: unknown, field: string): number | null {
  if (value === null) return null
  return readInteger(value, field)
}

function readAutomationStatus(value: unknown, field: string): DesktopAutomationStatus {
  if (value === 'ACTIVE' || value === 'PAUSED' || value === 'DELETED') return value
  throw new Error(`Invalid ${field}`)
}

function readAutomationRunStatus(value: unknown, field: string): DesktopAutomationRunStatus {
  if (value === 'IN_PROGRESS' || value === 'PENDING_REVIEW' || value === 'ACCEPTED' || value === 'ARCHIVED') {
    return value
  }
  throw new Error(`Invalid ${field}`)
}

function hasOwn<T extends object, K extends PropertyKey>(input: T, key: K): input is T & Record<K, unknown> {
  return Object.prototype.hasOwnProperty.call(input, key)
}
