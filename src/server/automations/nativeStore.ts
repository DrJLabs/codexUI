import { randomBytes } from 'node:crypto'
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { AutomationDiagnostic } from '../../types/automations'
import { resolveCodexHomeDir } from './paths'

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

function getCodexAutomationsDir(options?: NativeAutomationStoreOptions): string {
  return join(resolveCodexHomeDir(options), 'automations')
}

export function getNativeAutomationsRoot(options?: NativeAutomationStoreOptions): string {
  return getCodexAutomationsDir(options)
}

function readTomlString(value: string): string {
  const trimmed = value.trim()
  const multilineDelimiter = trimmed.startsWith('"""') ? '"""' : trimmed.startsWith("'''") ? "'''" : null
  if (multilineDelimiter && trimmed.endsWith(multilineDelimiter) && trimmed.length >= multilineDelimiter.length * 2) {
    let content = trimmed.slice(multilineDelimiter.length, -multilineDelimiter.length)
    if (content.startsWith('\n')) content = content.slice(1)
    if (content.endsWith('\n')) content = content.slice(0, -1)
    return multilineDelimiter === '"""' ? unescapeTomlBasicString(content) : content
  }
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith('\'') && trimmed.endsWith('\''))) {
    try {
      return JSON.parse(trimmed)
    } catch {
      const content = trimmed.slice(1, -1)
      return trimmed.startsWith('"') ? unescapeTomlBasicString(content) : content
    }
  }
  return trimmed
}

function unescapeTomlBasicString(value: string): string {
  return value.replace(/\\(?:u([0-9a-fA-F]{4})|U([0-9a-fA-F]{8})|([btnfr"\\]))/gu, (match, shortHex: string | undefined, longHex: string | undefined, escaped: string | undefined) => {
    if (shortHex || longHex) {
      const codePoint = Number.parseInt(shortHex ?? longHex ?? '', 16)
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match
    }
    switch (escaped) {
      case 'b': return '\b'
      case 't': return '\t'
      case 'n': return '\n'
      case 'f': return '\f'
      case 'r': return '\r'
      case '"': return '"'
      case '\\': return '\\'
      default: return match
    }
  })
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

function readTopLevelTomlAssignment(line: string): { key: string, value: string } | null {
  const trimmed = line.trim()
  const separatorIndex = trimmed.indexOf('=')
  if (separatorIndex < 0) return null
  const key = trimmed.slice(0, separatorIndex).trim()
  if (!key) return null
  return { key, value: stripTomlLineComment(trimmed.slice(separatorIndex + 1)) }
}

function stripTomlLineComment(value: string): string {
  let quote: '"' | "'" | null = null
  let multilineDelimiter: '"""' | "'''" | null = null
  let escaped = false
  for (let index = 0; index < value.length; index += 1) {
    if (multilineDelimiter) {
      if (findTomlMultilineCloseIndex(value, multilineDelimiter, index) === index) {
        index += multilineDelimiter.length - 1
        multilineDelimiter = null
      }
      continue
    }
    const char = value[index]
    if (quote === '"') {
      if (escaped) {
        escaped = false
      } else if (char === '\\') {
        escaped = true
      } else if (char === '"') {
        quote = null
      }
      continue
    }
    if (quote === "'") {
      if (char === "'") quote = null
      continue
    }
    if (value.startsWith('"""', index) || value.startsWith("'''", index)) {
      multilineDelimiter = value.startsWith('"""', index) ? '"""' : "'''"
      index += multilineDelimiter.length - 1
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      continue
    }
    if (char === '#') return value.slice(0, index).trim()
  }
  return value.trim()
}

function stripCommentAfterMultilineClose(line: string, delimiter: '"""' | "'''"): string {
  const closingIndex = findTomlMultilineCloseIndex(line, delimiter)
  if (closingIndex < 0) return line
  const closingEnd = closingIndex + delimiter.length
  const suffix = stripTomlLineComment(line.slice(closingEnd))
  return `${line.slice(0, closingEnd)}${suffix ? ` ${suffix}` : ''}`
}

function getOpenMultilineTomlStringDelimiter(value: string): '"""' | "'''" | null {
  const delimiter = value.startsWith('"""') ? '"""' : value.startsWith("'''") ? "'''" : null
  if (!delimiter) return null
  return findTomlMultilineCloseIndex(value, delimiter, delimiter.length) < 0 ? delimiter : null
}

function findTomlMultilineCloseIndex(line: string, delimiter: '"""' | "'''", fromIndex = 0): number {
  let index = line.indexOf(delimiter, fromIndex)
  while (index >= 0) {
    if (delimiter === '"""' && isEscapedBasicStringQuote(line, index)) {
      index = line.indexOf(delimiter, index + 1)
      continue
    }
    return index
  }
  return -1
}

function isEscapedBasicStringQuote(line: string, quoteIndex: number): boolean {
  let backslashCount = 0
  for (let index = quoteIndex - 1; index >= 0 && line[index] === '\\'; index -= 1) {
    backslashCount += 1
  }
  return backslashCount % 2 === 1
}

export function parseAutomationToml(raw: string): ThreadAutomationRecord | null {
  const values: Record<string, string> = {}
  let multilineStringKey: string | null = null
  let multilineStringDelimiter: '"""' | "'''" | null = null
  let multilineStringLines: string[] = []
  for (const line of raw.split(/\r?\n/u)) {
    if (multilineStringDelimiter) {
      const closingIndex = findTomlMultilineCloseIndex(line, multilineStringDelimiter)
      const nextLine = closingIndex >= 0
        ? stripCommentAfterMultilineClose(line, multilineStringDelimiter)
        : line
      multilineStringLines.push(nextLine)
      if (closingIndex >= 0) {
        if (multilineStringKey) values[multilineStringKey] = multilineStringLines.join('\n')
        multilineStringKey = null
        multilineStringDelimiter = null
        multilineStringLines = []
      }
      continue
    }

    const assignment = readTopLevelTomlAssignment(line)
    if (!assignment) continue
    multilineStringDelimiter = getOpenMultilineTomlStringDelimiter(assignment.value)
    if (multilineStringDelimiter) {
      multilineStringKey = assignment.key
      multilineStringLines = [assignment.value]
      continue
    }
    values[assignment.key] = assignment.value
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
  const merged: string[] = []
  let multilineStringDelimiter: '"""' | "'''" | null = null
  let skipMultilineString = false

  for (const [index, line] of lines.entries()) {
    if (index === lines.length - 1 && line.length === 0) continue

    if (multilineStringDelimiter) {
      if (!skipMultilineString) merged.push(line)
      if (findTomlMultilineCloseIndex(line, multilineStringDelimiter) >= 0) {
        multilineStringDelimiter = null
        skipMultilineString = false
      }
      continue
    }

    const assignment = readTopLevelTomlAssignment(line)
    if (!assignment || !knownKeys.has(assignment.key)) {
      merged.push(line)
      if (assignment) multilineStringDelimiter = getOpenMultilineTomlStringDelimiter(assignment.value)
      continue
    }

    const nextDelimiter = getOpenMultilineTomlStringDelimiter(assignment.value)
    if (!seen.has(assignment.key)) {
      seen.add(assignment.key)
      merged.push(`${assignment.key} = ${fields[assignment.key]}`)
    }
    if (nextDelimiter) {
      multilineStringDelimiter = nextDelimiter
      skipMultilineString = true
    }
  }

  for (const key of orderedKeys) {
    if (!seen.has(key)) merged.push(`${key} = ${fields[key]}`)
  }

  return `${merged.join('\n')}\n`
}

function slugifyAutomationId(threadId: string, name: string): string {
  const preferred = name.trim().toLowerCase().replace(/[^a-z0-9]+/gu, '-').replace(/^-+|-+$/gu, '')
  const fallback = threadId.trim().toLowerCase().replace(/[^a-z0-9]+/gu, '-').replace(/^-+|-+$/gu, '')
  if (preferred && fallback) return `${preferred.slice(0, 36)}-${fallback.slice(0, 11)}`.replace(/-+$/u, '')
  if (preferred) return preferred.slice(0, 48)
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
  } catch (error) {
    if (!isMissingFileError(error)) throw error
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
  } catch (error) {
    if (!isMissingFileError(error)) throw error
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

function isMissingFileError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
}
