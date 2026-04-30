import { randomBytes } from 'node:crypto'
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { AutomationDiagnostic } from '../../types/automations'

export type ThreadAutomationStatus = 'ACTIVE' | 'PAUSED'

export type ThreadAutomationRecord = {
  id: string
  kind: 'heartbeat' | 'cron'
  name: string
  prompt: string
  rrule: string
  status: ThreadAutomationStatus
  targetThreadId: string | null
  createdAtMs: number | null
  updatedAtMs: number | null
  nextRunAtMs: number | null
}

export type NativeAutomationStoreOptions = {
  codexHomeDir?: string
}

type ThreadAutomationStoreEntry = {
  record: ThreadAutomationRecord
  sourceDirName: string
}

export type NativeAutomationEntry = {
  record: ThreadAutomationRecord
  sourceDirName: string
  automationTomlPath: string
  automationDirPath: string
}

export type NativeAutomationEntryList = {
  records: NativeAutomationEntry[]
  diagnostics: AutomationDiagnostic[]
  storageRoot: string
}

function getCodexHomeDir(options?: NativeAutomationStoreOptions): string {
  const injected = options?.codexHomeDir?.trim()
  if (injected) return injected
  const codexHome = process.env.CODEX_HOME?.trim()
  return codexHome && codexHome.length > 0 ? codexHome : join(homedir(), '.codex')
}

function getCodexAutomationsDir(options?: NativeAutomationStoreOptions): string {
  return join(getCodexHomeDir(options), 'automations')
}

export function getNativeAutomationsRoot(options?: NativeAutomationStoreOptions): string {
  return getCodexAutomationsDir(options)
}

function readTomlString(value: string): string {
  const trimmed = value.trim()
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith('\'') && trimmed.endsWith('\''))) {
    try {
      return JSON.parse(trimmed)
    } catch {
      return trimmed.slice(1, -1)
    }
  }
  return trimmed
}

function serializeTomlString(value: string): string {
  return JSON.stringify(value)
}

function buildAutomationTomlFields(record: ThreadAutomationRecord): Record<string, string> {
  return {
    version: '1',
    id: serializeTomlString(record.id),
    kind: serializeTomlString(record.kind),
    name: serializeTomlString(record.name),
    prompt: serializeTomlString(record.prompt),
    status: serializeTomlString(record.status),
    rrule: serializeTomlString(record.rrule),
    target_thread_id: serializeTomlString(record.targetThreadId ?? ''),
    created_at: String(record.createdAtMs ?? Date.now()),
    updated_at: String(record.updatedAtMs ?? Date.now()),
  }
}

export function parseAutomationToml(raw: string): ThreadAutomationRecord | null {
  const values: Record<string, string> = {}
  for (const line of raw.split(/\r?\n/u)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue
    const separatorIndex = trimmed.indexOf('=')
    const key = trimmed.slice(0, separatorIndex).trim()
    const value = trimmed.slice(separatorIndex + 1).trim()
    if (key) values[key] = value
  }

  const id = readTomlString(values.id ?? '')
  const kindValue = readTomlString(values.kind ?? 'heartbeat')
  const name = readTomlString(values.name ?? '')
  const prompt = readTomlString(values.prompt ?? '')
  const rrule = readTomlString(values.rrule ?? '')
  const statusValue = readTomlString(values.status ?? 'ACTIVE')
  const targetThreadId = readTomlString(values.target_thread_id ?? '') || null
  const createdAtMs = Number.parseInt(values.created_at ?? '', 10)
  const updatedAtMs = Number.parseInt(values.updated_at ?? '', 10)

  if (!id || !name || !prompt || !rrule) return null
  if (kindValue !== 'heartbeat' && kindValue !== 'cron') return null
  if (statusValue !== 'ACTIVE' && statusValue !== 'PAUSED') return null

  return {
    id,
    kind: kindValue,
    name,
    prompt,
    rrule,
    status: statusValue,
    targetThreadId,
    createdAtMs: Number.isFinite(createdAtMs) ? createdAtMs : null,
    updatedAtMs: Number.isFinite(updatedAtMs) ? updatedAtMs : null,
    nextRunAtMs: null,
  }
}

export function serializeAutomationToml(record: ThreadAutomationRecord, previousRaw?: string): string {
  const fields = buildAutomationTomlFields(record)
  const orderedKeys = Object.keys(fields)
  const knownKeys = new Set(orderedKeys)

  if (typeof previousRaw !== 'string') {
    return `${orderedKeys.map((key) => `${key} = ${fields[key]}`).join('\n')}\n`
  }

  const seen = new Set<string>()
  const lines = previousRaw.split(/\r?\n/u)
  const merged = lines
    .filter((line, index) => index < lines.length - 1 || line.length > 0)
    .flatMap((line) => {
      const trimmed = line.trim()
      const separatorIndex = trimmed.indexOf('=')
      const key = separatorIndex >= 0 ? trimmed.slice(0, separatorIndex).trim() : ''
      if (!knownKeys.has(key)) return [line]
      if (seen.has(key)) return []
      seen.add(key)
      return [`${key} = ${fields[key]}`]
    })

  for (const key of orderedKeys) {
    if (!seen.has(key)) merged.push(`${key} = ${fields[key]}`)
  }

  return `${merged.join('\n')}\n`
}

function slugifyAutomationId(threadId: string, name: string): string {
  const preferred = name.trim().toLowerCase().replace(/[^a-z0-9]+/gu, '-').replace(/^-+|-+$/gu, '')
  if (preferred) return preferred.slice(0, 48)
  const fallback = threadId.trim().toLowerCase().replace(/[^a-z0-9]+/gu, '-').replace(/^-+|-+$/gu, '')
  return `heartbeat-${fallback.slice(0, 24) || randomBytes(4).toString('hex')}`
}

function isSafeAutomationBasename(value: string | null | undefined): value is string {
  if (!value || value.trim() !== value) return false
  return value !== '.' && value !== '..' && !value.includes('/') && !value.includes('\\')
}

function safeAutomationId(recordId: string | null | undefined, sourceDirName: string | null | undefined, fallback: string): string {
  if (isSafeAutomationBasename(recordId)) return recordId
  if (isSafeAutomationBasename(sourceDirName)) return sourceDirName
  return isSafeAutomationBasename(fallback) ? fallback : randomBytes(8).toString('hex')
}

async function readAutomationRecordFromFile(filePath: string): Promise<ThreadAutomationRecord | null> {
  try {
    return parseAutomationToml(await readFile(filePath, 'utf8'))
  } catch {
    return null
  }
}

export async function listNativeAutomationEntries(
  options?: NativeAutomationStoreOptions,
): Promise<NativeAutomationEntryList> {
  const automationRoot = getCodexAutomationsDir(options)
  const records: NativeAutomationEntry[] = []
  const diagnostics: AutomationDiagnostic[] = []
  let entries
  try {
    entries = await readdir(automationRoot, { withFileTypes: true })
  } catch {
    return { records, diagnostics, storageRoot: automationRoot }
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const automationDirPath = join(automationRoot, entry.name)
    const automationTomlPath = join(automationDirPath, 'automation.toml')
    const record = await readAutomationRecordFromFile(automationTomlPath)
    if (!record) {
      diagnostics.push({
        automationId: entry.name,
        sourceDirName: entry.name,
        path: automationTomlPath,
        severity: 'error',
        message: 'Invalid automation.toml',
      })
      continue
    }
    records.push({
      record,
      sourceDirName: entry.name,
      automationDirPath,
      automationTomlPath,
    })
  }

  return { records, diagnostics, storageRoot: automationRoot }
}

async function listThreadHeartbeatAutomationEntries(
  options?: NativeAutomationStoreOptions,
): Promise<Record<string, ThreadAutomationStoreEntry>> {
  const automationRoot = getCodexAutomationsDir(options)
  const next: Record<string, ThreadAutomationStoreEntry> = {}
  let entries
  try {
    entries = await readdir(automationRoot, { withFileTypes: true })
  } catch {
    return next
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const automation = await readAutomationRecordFromFile(join(automationRoot, entry.name, 'automation.toml'))
    if (!automation || automation.kind !== 'heartbeat' || !automation.targetThreadId) continue
    next[automation.targetThreadId] = {
      record: automation,
      sourceDirName: entry.name,
    }
  }

  return next
}

export async function listThreadHeartbeatAutomations(
  options?: NativeAutomationStoreOptions,
): Promise<Record<string, ThreadAutomationRecord>> {
  const entries = await listThreadHeartbeatAutomationEntries(options)
  const next: Record<string, ThreadAutomationRecord> = {}
  for (const [threadId, entry] of Object.entries(entries)) {
    next[threadId] = entry.record
  }
  return next
}

export async function readThreadHeartbeatAutomation(
  threadId: string,
  options?: NativeAutomationStoreOptions,
): Promise<ThreadAutomationRecord | null> {
  const all = await listThreadHeartbeatAutomations(options)
  return all[threadId] ?? null
}

async function readThreadHeartbeatAutomationEntry(
  threadId: string,
  options?: NativeAutomationStoreOptions,
): Promise<ThreadAutomationStoreEntry | null> {
  const all = await listThreadHeartbeatAutomationEntries(options)
  return all[threadId] ?? null
}

export async function writeThreadHeartbeatAutomation(
  input: {
    threadId: string | null
    name: string
    prompt: string
    rrule: string
    status: ThreadAutomationStatus
  },
  options?: NativeAutomationStoreOptions,
): Promise<ThreadAutomationRecord> {
  const threadId = input.threadId?.trim() || null
  const name = input.name.trim()
  const prompt = input.prompt.trim()
  const rrule = input.rrule.trim()
  if (!name || !prompt || !rrule) {
    throw new Error('name, prompt, and rrule are required')
  }

  const automationRoot = getCodexAutomationsDir(options)
  await mkdir(automationRoot, { recursive: true })
  const existing = threadId ? await readThreadHeartbeatAutomationEntry(threadId, options) : null
  const generatedId = threadId
    ? slugifyAutomationId(threadId, name)
    : `${slugifyAutomationId('', name)}-${randomBytes(4).toString('hex')}`
  const id = safeAutomationId(existing?.record.id, existing?.sourceDirName, generatedId)
  const sourceDirName = existing?.sourceDirName && isSafeAutomationBasename(existing.sourceDirName)
    ? existing.sourceDirName
    : id
  const automationDir = join(automationRoot, sourceDirName)
  let previousRaw: string | undefined
  if (existing) {
    try {
      previousRaw = await readFile(join(automationDir, 'automation.toml'), 'utf8')
    } catch {
      previousRaw = undefined
    }
  }
  const now = Date.now()
  const record: ThreadAutomationRecord = {
    id,
    kind: 'heartbeat',
    name,
    prompt,
    rrule,
    status: input.status,
    targetThreadId: threadId,
    createdAtMs: existing?.record.createdAtMs ?? now,
    updatedAtMs: now,
    nextRunAtMs: null,
  }

  await mkdir(automationDir, { recursive: true })
  await writeFile(join(automationDir, 'automation.toml'), serializeAutomationToml(record, previousRaw), 'utf8')
  const memoryPath = join(automationDir, 'memory.md')
  try {
    await stat(memoryPath)
  } catch {
    await writeFile(memoryPath, '', 'utf8')
  }
  return record
}

export async function writeNativeHeartbeatAutomationBySourceDir(
  sourceDirName: string,
  record: ThreadAutomationRecord,
  options?: NativeAutomationStoreOptions,
): Promise<ThreadAutomationRecord> {
  if (!isSafeAutomationBasename(sourceDirName)) {
    throw new Error('sourceDirName must be a safe automation directory name')
  }
  const automationRoot = getCodexAutomationsDir(options)
  const automationDir = join(automationRoot, sourceDirName)
  const automationTomlPath = join(automationDir, 'automation.toml')
  let previousRaw: string | undefined
  try {
    previousRaw = await readFile(automationTomlPath, 'utf8')
  } catch {
    previousRaw = undefined
  }
  await mkdir(automationDir, { recursive: true })
  await writeFile(automationTomlPath, serializeAutomationToml(record, previousRaw), 'utf8')
  const memoryPath = join(automationDir, 'memory.md')
  try {
    await stat(memoryPath)
  } catch {
    await writeFile(memoryPath, '', 'utf8')
  }
  return record
}

export async function deleteThreadHeartbeatAutomation(
  threadId: string,
  options?: NativeAutomationStoreOptions,
): Promise<boolean> {
  const automation = await readThreadHeartbeatAutomationEntry(threadId.trim(), options)
  if (!automation || !isSafeAutomationBasename(automation.sourceDirName)) return false
  await rm(join(getCodexAutomationsDir(options), automation.sourceDirName), { recursive: true, force: true })
  return true
}

export async function deleteNativeAutomationBySourceDir(
  sourceDirName: string,
  options?: NativeAutomationStoreOptions,
): Promise<boolean> {
  if (!isSafeAutomationBasename(sourceDirName)) return false
  await rm(join(getCodexAutomationsDir(options), sourceDirName), { recursive: true, force: true })
  return true
}
