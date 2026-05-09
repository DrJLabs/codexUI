import { randomBytes } from 'node:crypto'
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import type { AutomationDiagnostic, AutomationRunMode } from '../../types/automations'
import { resolveCodexHomeDir } from './paths'
import { writeFileAtomic } from './fileWrites'

const { parse: parseTomlDocument } = createRequire(import.meta.url)('smol-toml') as {
  parse: (input: string) => unknown
}

export type DesktopAutomationKind = 'heartbeat' | 'cron'

export type DesktopAutomationStatus = 'ACTIVE' | 'PAUSED' | 'DELETED'

export type ThreadAutomationStatus = DesktopAutomationStatus

export type DesktopAutomationRecord = {
  version: number
  id: string
  kind: DesktopAutomationKind
  name: string
  prompt: string
  rrule: string
  rrulePrefix: 'RRULE:' | null
  status: DesktopAutomationStatus
  targetThreadId: string | null
  model: string | null
  reasoningEffort: string | null
  executionEnvironment: string | null
  cwds: string[]
  localEnvironmentConfigPath: string | null
  createdAtMs: number | null
  updatedAtMs: number | null
}

export type ThreadAutomationRecord = DesktopAutomationRecord & {
  runMode: AutomationRunMode | null
  cwd: string | null
  nextRunAtMs: number | null
}

export type NativeAutomationStoreOptions = {
  codexHomeDir?: string
}

export type NativeAutomationWriteInput = {
  id?: string | null
  kind: DesktopAutomationKind
  threadId: string | null
  name: string
  prompt: string
  rrule: string
  rrulePrefix?: 'RRULE:' | null
  status: ThreadAutomationStatus
  model?: string | null
  reasoningEffort?: string | null
  executionEnvironment?: string | null
  runMode?: AutomationRunMode | null
  cwd?: string | null
  cwds?: string[]
  localEnvironmentConfigPath?: string | null
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

function serializeTomlString(value: string): string {
  if (value.includes('\n') || value.includes('\r')) {
    return `"""${escapeTomlMultilineBasicString(value)}"""`
  }
  return JSON.stringify(value)
}

function escapeTomlMultilineBasicString(value: string): string {
  return value
    .replace(/\\/gu, '\\\\')
    .replace(/"""/gu, '\\"\\"\\"')
    .replace(/\r/gu, '\\r')
}

function findTomlArrayStringEndIndex(value: string, startIndex: number): number {
  const delimiter = value.startsWith('"""', startIndex) ? '"""' : value.startsWith("'''", startIndex) ? "'''" : null
  if (delimiter) {
    const closingIndex = findTomlMultilineCloseIndex(value, delimiter, startIndex + delimiter.length)
    return closingIndex >= 0 ? closingIndex + delimiter.length - 1 : -1
  }

  const quote = value[startIndex]
  if (quote !== '"' && quote !== "'") return -1
  let end = startIndex + 1
  if (quote === "'") {
    while (end < value.length && value[end] !== quote) {
      end += 1
    }
    return end < value.length ? end : -1
  }
  let escaped = false
  while (end < value.length) {
    const char = value[end]
    if (!escaped && char === '\\') {
      escaped = true
      end += 1
      continue
    }
    if (!escaped && char === quote) break
    escaped = false
    end += 1
  }
  return end < value.length ? end : -1
}

function serializeTomlStringArray(values: string[]): string {
  return `[${values.map((value) => serializeTomlString(value)).join(', ')}]`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function parseTomlRecord(raw: string): Record<string, unknown> | null {
  try {
    const parsed = parseTomlDocument(raw) as unknown
    return isRecord(parsed) ? parsed : null
  } catch {
    return null
  }
}

function readTomlStringValue(parsedValue: unknown, options?: { preserveFinalNewline?: boolean }): string {
  if (typeof parsedValue === 'string') {
    return options?.preserveFinalNewline ? parsedValue : normalizeParsedTomlString(parsedValue)
  }
  if (typeof parsedValue === 'number' || typeof parsedValue === 'boolean') return String(parsedValue)
  return ''
}

function normalizeParsedTomlString(value: string): string {
  return value.replace(/\n$/u, '')
}

function readTomlNumberValue(parsedValue: unknown, fallback: number): number {
  if (typeof parsedValue === 'number' && Number.isFinite(parsedValue)) return parsedValue
  if (parsedValue instanceof Date) return parsedValue.getTime()
  return fallback
}

function readTomlStringArrayValue(parsedValue: unknown): string[] {
  if (Array.isArray(parsedValue) && parsedValue.every((entry) => typeof entry === 'string')) {
    return parsedValue.map((entry) => normalizeParsedTomlString(entry))
  }
  return []
}

function hasOwn(input: object, field: string): boolean {
  return Object.prototype.hasOwnProperty.call(input, field)
}

function normalizeAutomationRruleForRead(value: string): { rrule: string; rrulePrefix: 'RRULE:' | null } {
  const trimmed = value.trim()
  if (trimmed.startsWith('RRULE:')) return { rrule: trimmed.slice('RRULE:'.length), rrulePrefix: 'RRULE:' }
  return { rrule: trimmed, rrulePrefix: null }
}

function runModeFromExecutionEnvironment(value: string | null): AutomationRunMode | null {
  if (value === 'local' || value === 'worktree') return value
  return null
}

function canonicalExecutionEnvironment(value: string | null | undefined): string | null {
  if (value === 'chat') return null
  if (value === 'local' || value === 'worktree') return value
  return value?.trim() || null
}

function deriveRunModeForRecord(input: {
  kind: DesktopAutomationKind
  executionEnvironment: string | null
  targetThreadId: string | null
}): AutomationRunMode | null {
  const runMode = runModeFromExecutionEnvironment(input.executionEnvironment)
  if (runMode) return runMode
  if (input.kind === 'heartbeat' || input.targetThreadId) return 'chat'
  return null
}

function previousRawHasTopLevelKey(previousRaw: string | undefined, key: string): boolean {
  if (typeof previousRaw !== 'string') return false
  let multilineStringDelimiter: '"""' | "'''" | null = null
  let multilineArrayValue: string | null = null
  let inTopLevel = true
  for (const line of previousRaw.split(/\r?\n/u)) {
    if (multilineArrayValue !== null) {
      multilineArrayValue += `\n${line}`
      if (findTomlArrayCloseIndex(multilineArrayValue) >= 0) multilineArrayValue = null
      continue
    }

    if (multilineStringDelimiter) {
      if (findTomlMultilineCloseIndex(line, multilineStringDelimiter) >= 0) multilineStringDelimiter = null
      continue
    }
    if (isTomlTableHeader(line)) {
      inTopLevel = false
      continue
    }
    if (!inTopLevel) continue
    const assignment = readTopLevelTomlAssignment(line)
    if (!assignment) continue
    if (assignment.key === key) return true
    const trimmedValue = assignment.value.trim()
    if (trimmedValue.startsWith('[') && findTomlArrayCloseIndex(trimmedValue) < 0) {
      multilineArrayValue = trimmedValue
      continue
    }
    multilineStringDelimiter = getOpenMultilineTomlStringDelimiter(assignment.value)
  }
  return false
}

function buildAutomationTomlFields(record: ThreadAutomationRecord, previousRaw?: string): Record<string, string> {
  const previousHasCwd = previousRawHasTopLevelKey(previousRaw, 'cwd')
  const fields: Record<string, string> = {
    version: String(record.version || 1),
    id: serializeTomlString(record.id),
    kind: serializeTomlString(record.kind),
    name: serializeTomlString(record.name),
    prompt: serializeTomlString(record.prompt),
    status: serializeTomlString(record.status),
    rrule: serializeTomlString(`${record.rrulePrefix ?? (record.kind === 'cron' ? 'RRULE:' : '')}${record.rrule}`),
  }
  if (record.cwd && previousHasCwd) fields.cwd = serializeTomlString(record.cwd)
  if (record.model) fields.model = serializeTomlString(record.model)
  if (record.reasoningEffort) fields.reasoning_effort = serializeTomlString(record.reasoningEffort)
  if (record.executionEnvironment) fields.execution_environment = serializeTomlString(record.executionEnvironment)
  if (record.cwds.length > 0) {
    fields.cwds = serializeTomlStringArray(record.cwds)
  }
  if (record.localEnvironmentConfigPath) {
    fields.local_environment_config_path = serializeTomlString(record.localEnvironmentConfigPath)
  }
  if (record.targetThreadId || previousRawHasTopLevelKey(previousRaw, 'target_thread_id')) {
    fields.target_thread_id = serializeTomlString(record.targetThreadId ?? '')
  }
  fields.created_at = String(record.createdAtMs ?? Date.now())
  fields.updated_at = String(record.updatedAtMs ?? Date.now())
  return fields
}

function readTopLevelTomlAssignment(line: string): { key: string, value: string } | null {
  const trimmed = line.trim()
  const separatorIndex = trimmed.indexOf('=')
  if (separatorIndex < 0) return null
  const key = trimmed.slice(0, separatorIndex).trim()
  if (!key) return null
  return { key, value: stripTomlLineComment(trimmed.slice(separatorIndex + 1)) }
}

function isTomlTableHeader(line: string): boolean {
  const trimmed = stripTomlLineComment(line).trim()
  return trimmed.startsWith('[') && trimmed.endsWith(']')
}

function stripTomlLineComment(value: string): string {
  const commentIndex = findTomlLineCommentIndex(value)
  return (commentIndex >= 0 ? value.slice(0, commentIndex) : value).trim()
}

function readTomlTrailingComment(line: string): string {
  const commentIndex = findTomlLineCommentIndex(line)
  return commentIndex >= 0 ? ` ${line.slice(commentIndex).trimEnd()}` : ''
}

function findTomlLineCommentIndex(value: string): number {
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
    if (char === '#') return index
  }
  return -1
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

function findTomlArrayCloseIndex(value: string): number {
  let index = 0
  let depth = 0
  while (index < value.length) {
    const char = value[index]
    if (char === '#') {
      const lineEnd = value.indexOf('\n', index + 1)
      index = lineEnd >= 0 ? lineEnd + 1 : value.length
      continue
    }
    if (char === '"' || char === "'") {
      const stringEnd = findTomlArrayStringEndIndex(value, index)
      if (stringEnd < 0) return -1
      index = stringEnd + 1
      continue
    }
    if (char === '[') {
      depth += 1
      index += 1
      continue
    }
    if (char === ']') {
      if (depth <= 1) return index
      depth -= 1
      index += 1
      continue
    }
    index += 1
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
  const parsed = parseTomlRecord(raw)
  if (!parsed) return null
  const version = readTomlNumberValue(parsed.version, 1)
  const id = readTomlStringValue(parsed.id)
  const kindValue = readTomlStringValue(parsed.kind) || 'heartbeat'
  const name = readTomlStringValue(parsed.name)
  const prompt = readTomlStringValue(parsed.prompt, { preserveFinalNewline: true })
  const normalizedRrule = normalizeAutomationRruleForRead(readTomlStringValue(parsed.rrule))
  const statusValue = readTomlStringValue(parsed.status) || 'ACTIVE'
  const targetThreadId = readTomlStringValue(parsed.target_thread_id) || null
  const model = readTomlStringValue(parsed.model) || null
  const reasoningEffort = readTomlStringValue(parsed.reasoning_effort) || null
  const executionEnvironment = readTomlStringValue(parsed.execution_environment) || null
  const localEnvironmentConfigPath = readTomlStringValue(parsed.local_environment_config_path) || null
  const cwdValue = readTomlStringValue(parsed.cwd) || null
  const parsedCwds = readTomlStringArrayValue(parsed.cwds)
  const cwd = cwdValue ?? parsedCwds[0] ?? null
  const cwds = parsedCwds.length > 0 ? parsedCwds : (cwdValue ? [cwdValue] : [])
  const createdAtMs = readTomlNumberValue(parsed.created_at, Number.NaN)
  const updatedAtMs = readTomlNumberValue(parsed.updated_at, Number.NaN)

  if (!id || !name || !prompt || !normalizedRrule.rrule) return null
  if (kindValue !== 'heartbeat' && kindValue !== 'cron') return null
  if (statusValue !== 'ACTIVE' && statusValue !== 'PAUSED' && statusValue !== 'DELETED') return null

  const kind = kindValue
  const runMode = deriveRunModeForRecord({ kind, executionEnvironment, targetThreadId })

  return {
    version: Number.isFinite(version) ? version : 1,
    id,
    kind,
    name,
    prompt,
    rrule: normalizedRrule.rrule,
    rrulePrefix: normalizedRrule.rrulePrefix,
    status: statusValue,
    targetThreadId,
    model,
    reasoningEffort,
    executionEnvironment,
    localEnvironmentConfigPath,
    runMode,
    cwd,
    cwds,
    createdAtMs: Number.isFinite(createdAtMs) ? createdAtMs : null,
    updatedAtMs: Number.isFinite(updatedAtMs) ? updatedAtMs : null,
    nextRunAtMs: null,
  }
}

export function serializeAutomationToml(record: ThreadAutomationRecord, previousRaw?: string): string {
  const fields = buildAutomationTomlFields(record, previousRaw)
  const orderedKeys = Object.keys(fields)
  const canonicalRaw = serializeAutomationTomlFields(orderedKeys, fields)
  const knownKeys = new Set([
    ...orderedKeys,
    'cwd',
    'model',
    'reasoning_effort',
    'execution_environment',
    'cwds',
    'local_environment_config_path',
    'target_thread_id',
  ])

  if (typeof previousRaw !== 'string') {
    return canonicalRaw
  }

  const seen = new Set<string>()
  const lines = previousRaw.split(/\r?\n/u)
  const merged: string[] = []
  let multilineStringDelimiter: '"""' | "'''" | null = null
  let skipMultilineString = false
  let skippedArrayValue: string | null = null
  let inTopLevel = true
  let appendedMissingBeforeTable = false

  for (const [index, line] of lines.entries()) {
    if (index === lines.length - 1 && line.length === 0) continue

    if (skippedArrayValue !== null) {
      skippedArrayValue += `\n${line}`
      if (findTomlArrayCloseIndex(skippedArrayValue) >= 0) skippedArrayValue = null
      continue
    }

    if (multilineStringDelimiter) {
      if (!skipMultilineString) merged.push(line)
      if (findTomlMultilineCloseIndex(line, multilineStringDelimiter) >= 0) {
        multilineStringDelimiter = null
        skipMultilineString = false
      }
      continue
    }

    if (isTomlTableHeader(line)) {
      if (!appendedMissingBeforeTable) {
        for (const key of orderedKeys) {
          if (!seen.has(key)) merged.push(`${key} = ${fields[key]}`)
        }
        appendedMissingBeforeTable = true
      }
      inTopLevel = false
      merged.push(line)
      continue
    }
    if (!inTopLevel) {
      merged.push(line)
      continue
    }
    const assignment = readTopLevelTomlAssignment(line)
    if (!assignment || !knownKeys.has(assignment.key)) {
      merged.push(line)
      if (assignment) multilineStringDelimiter = getOpenMultilineTomlStringDelimiter(assignment.value)
      continue
    }

    const nextDelimiter = getOpenMultilineTomlStringDelimiter(assignment.value)
    const skipFollowingArrayLines = assignment.value.trim().startsWith('[') && findTomlArrayCloseIndex(assignment.value) < 0
    if (!seen.has(assignment.key)) {
      seen.add(assignment.key)
      if (Object.prototype.hasOwnProperty.call(fields, assignment.key)) {
        merged.push(`${assignment.key} = ${fields[assignment.key]}${readTomlTrailingComment(line)}`)
      }
    }
    if (skipFollowingArrayLines) skippedArrayValue = assignment.value
    if (nextDelimiter) {
      multilineStringDelimiter = nextDelimiter
      skipMultilineString = true
    }
  }

  if (!appendedMissingBeforeTable) {
    for (const key of orderedKeys) {
      if (!seen.has(key)) merged.push(`${key} = ${fields[key]}`)
    }
  }

  const mergedRaw = `${merged.join('\n')}\n`
  return parseTomlRecord(mergedRaw) ? mergedRaw : canonicalRaw
}

function serializeAutomationTomlFields(orderedKeys: string[], fields: Record<string, string>): string {
  return `${orderedKeys.map((key) => `${key} = ${fields[key]}`).join('\n')}\n`
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

async function chooseAvailableAutomationBasename(automationRoot: string, basename: string): Promise<string> {
  const safeBase = isSafeAutomationBasename(basename) ? basename : randomBytes(8).toString('hex')
  let candidate = safeBase
  const maxAttempts = 1000
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      await mkdir(join(automationRoot, candidate))
      return candidate
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'EEXIST') {
        candidate = `${safeBase}-${randomBytes(4).toString('hex')}`
        continue
      }
      throw error
    }
  }
  throw new Error(`Unable to allocate automation directory for ${safeBase} under ${automationRoot} after ${maxAttempts} attempts`)
}

async function readAutomationRecordFromFile(filePath: string): Promise<ThreadAutomationRecord | null> {
  try {
    return parseAutomationToml(await readFile(filePath, 'utf8'))
  } catch (error) {
    if (!isMissingFileError(error)) throw error
    return null
  }
}

export async function readNativeAutomationEntryFromDirectory(
  sourceDirName: string,
  automationDirPath: string,
): Promise<NativeAutomationEntry | null> {
  const automationTomlPath = join(automationDirPath, 'automation.toml')
  const record = await readAutomationRecordFromFile(automationTomlPath)
  if (!record) return null
  return {
    record,
    sourceDirName,
    automationDirPath,
    automationTomlPath,
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
    const nativeEntry = await readNativeAutomationEntryFromDirectory(entry.name, automationDirPath)
    if (!nativeEntry) {
      diagnostics.push({
        automationId: entry.name,
        sourceDirName: entry.name,
        path: join(automationDirPath, 'automation.toml'),
        severity: 'error',
        message: 'Invalid automation.toml',
      })
      continue
    }
    records.push(nativeEntry)
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
    if (automation.status === 'DELETED') continue
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

async function readNativeAutomationEntryById(
  automationId: string,
  options?: NativeAutomationStoreOptions,
): Promise<ThreadAutomationStoreEntry | null> {
  const entries = await listNativeAutomationEntries(options)
  const match = entries.records.find((entry) => entry.record.id === automationId)
  return match ? { record: match.record, sourceDirName: match.sourceDirName } : null
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
  return await writeNativeAutomation({
    kind: 'heartbeat',
    threadId: input.threadId,
    name: input.name,
    prompt: input.prompt,
    rrule: input.rrule,
    status: input.status,
  }, options)
}

export async function writeNativeAutomation(
  input: NativeAutomationWriteInput,
  options?: NativeAutomationStoreOptions,
): Promise<ThreadAutomationRecord> {
  const threadId = input.threadId?.trim() || null
  const explicitId = input.id?.trim() || null
  const name = input.name.trim()
  const prompt = input.prompt
  const rrule = input.rrule.trim()
  if (!name || !prompt.trim() || !rrule) {
    throw new Error('name, prompt, and rrule are required')
  }

  const automationRoot = getCodexAutomationsDir(options)
  await mkdir(automationRoot, { recursive: true })
  const safeExplicitId = explicitId && isSafeAutomationBasename(explicitId) ? explicitId : null
  const existing = threadId
    ? await readThreadHeartbeatAutomationEntry(threadId, options)
    : safeExplicitId
      ? await readNativeAutomationEntryById(safeExplicitId, options)
      : null
  const generatedIdBase = explicitId && isSafeAutomationBasename(explicitId)
    ? explicitId
    : threadId
      ? slugifyAutomationId(threadId, name)
      : input.kind === 'cron'
        ? slugifyAutomationId('', name)
        : `${slugifyAutomationId('', name)}-${randomBytes(4).toString('hex')}`
  const generatedId = existing ? generatedIdBase : await chooseAvailableAutomationBasename(automationRoot, generatedIdBase)
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
  const hasModel = hasOwn(input, 'model')
  const hasReasoningEffort = hasOwn(input, 'reasoningEffort')
  const hasExecutionEnvironment = hasOwn(input, 'executionEnvironment')
  const hasLocalEnvironmentConfigPath = hasOwn(input, 'localEnvironmentConfigPath')
  const hasRunMode = hasOwn(input, 'runMode')
  const hasCwd = hasOwn(input, 'cwd')
  const hasCwds = hasOwn(input, 'cwds')
  const executionEnvironment = canonicalExecutionEnvironment(
    hasExecutionEnvironment
      ? input.executionEnvironment ?? input.runMode ?? null
      : input.runMode ?? existing?.record.executionEnvironment,
  )
  const runMode = hasRunMode
    ? input.runMode ?? null
    : deriveRunModeForRecord({
      kind: input.kind,
      executionEnvironment,
      targetThreadId: threadId,
    })
  const cwd = hasCwd || hasCwds
    ? input.cwd ?? input.cwds?.[0] ?? null
    : existing?.record.cwd ?? null
  const cwds = hasCwds
    ? input.cwds ?? []
    : hasCwd
      ? input.cwd ? [input.cwd] : []
      : existing?.record.cwds ?? []
  const now = Date.now()
  const record: ThreadAutomationRecord = {
    version: existing?.record.version ?? 1,
    id,
    kind: input.kind,
    name,
    prompt,
    rrule,
    rrulePrefix: input.rrulePrefix ?? existing?.record.rrulePrefix ?? (input.kind === 'cron' ? 'RRULE:' : null),
    status: input.status,
    targetThreadId: threadId,
    model: hasModel ? input.model ?? null : existing?.record.model ?? null,
    reasoningEffort: hasReasoningEffort ? input.reasoningEffort ?? null : existing?.record.reasoningEffort ?? null,
    executionEnvironment,
    localEnvironmentConfigPath: hasLocalEnvironmentConfigPath ? input.localEnvironmentConfigPath ?? null : existing?.record.localEnvironmentConfigPath ?? null,
    runMode,
    cwd,
    cwds,
    createdAtMs: existing?.record.createdAtMs ?? now,
    updatedAtMs: now,
    nextRunAtMs: null,
  }

  await mkdir(automationDir, { recursive: true })
  await writeFileAtomic(join(automationDir, 'automation.toml'), serializeAutomationToml(record, previousRaw))
  const memoryPath = join(automationDir, 'memory.md')
  try {
    await stat(memoryPath)
  } catch {
    await writeFile(memoryPath, '', 'utf8')
  }
  return record
}

export async function writeNativeAutomationBySourceDir(
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
  await writeFileAtomic(automationTomlPath, serializeAutomationToml(record, previousRaw))
  const memoryPath = join(automationDir, 'memory.md')
  try {
    await stat(memoryPath)
  } catch {
    await writeFile(memoryPath, '', 'utf8')
  }
  return record
}

export const writeNativeHeartbeatAutomationBySourceDir = writeNativeAutomationBySourceDir

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
