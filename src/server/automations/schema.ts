import { isAbsolute } from 'node:path'
import type { AutomationRunMode } from '../../types/automations'
import { AutomationValidationError } from './errors.js'

export type AutomationCreateInput = {
  kind: 'heartbeat'
  name: string
  description: string | null
  prompt: string
  schedule: { type: 'rrule'; rrule: string }
  targetThreadId: string
  cwd: string | null
  runMode: AutomationRunMode | null
  runProfileId: string | null
  model: string | null
  reasoningEffort: string | null
  notes: string
}

export type AutomationPatchInput = Partial<{
  name: string
  description: string | null
  prompt: string
  schedule: { type: 'rrule'; rrule: string }
  targetThreadId: string | null
  cwd: string | null
  runMode: AutomationRunMode | null
  runProfileId: string | null
  model: string | null
  reasoningEffort: string | null
  notes: string
}>

export type AutomationDeleteOptions = {
  removeNative: boolean
}

export type AutomationSidecarRead = {
  description: string | null
  cwd: string | null
  runMode: AutomationRunMode | null
  runProfileId: string | null
  model: string | null
  reasoningEffort: string | null
  notes: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasOwn(input: Record<string, unknown>, field: string): boolean {
  return Object.prototype.hasOwnProperty.call(input, field)
}

function readTrimmedString(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new AutomationValidationError(`${field} is required`)
  const trimmed = value.trim()
  if (!trimmed) throw new AutomationValidationError(`${field} is required`)
  return trimmed
}

function readNullableString(value: unknown, field: string): string | null {
  if (value === null || value === undefined) return null
  if (typeof value !== 'string') throw new AutomationValidationError(`${field} must be null or a string`)
  const trimmed = value.trim()
  if (!trimmed) throw new AutomationValidationError(`${field} must be null or a non-empty string`)
  return trimmed
}

function readOptionalNullableString(input: Record<string, unknown>, field: string): string | null | undefined {
  if (!hasOwn(input, field)) return undefined
  return readNullableString(input[field], field)
}

function readOptionalRequiredString(input: Record<string, unknown>, field: string): string | undefined {
  if (!hasOwn(input, field)) return undefined
  return readTrimmedString(input[field], field)
}

function readSchedule(value: unknown): { type: 'rrule'; rrule: string } {
  if (!isRecord(value)) throw new AutomationValidationError('schedule is required')
  if (value.type !== 'rrule') throw new AutomationValidationError('schedule.type must be rrule')
  const rrule = readTrimmedString(value.rrule, 'schedule.rrule')
  validateRrule(rrule)
  return { type: 'rrule', rrule }
}

function readOptionalSchedule(input: Record<string, unknown>): { type: 'rrule'; rrule: string } | undefined {
  if (!hasOwn(input, 'schedule')) return undefined
  return readSchedule(input.schedule)
}

function readCwd(value: unknown): string | null {
  const cwd = readNullableString(value, 'cwd')
  if (cwd !== null && !isAbsolute(cwd)) throw new AutomationValidationError('cwd must be an absolute path')
  return cwd
}

function readRunMode(value: unknown): AutomationRunMode | null {
  if (value === null || value === undefined) return null
  if (value !== 'chat' && value !== 'local' && value !== 'worktree') {
    throw new AutomationValidationError('runMode must be chat, local, worktree, or null')
  }
  return value
}

function readNotes(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value !== 'string') throw new AutomationValidationError('notes must be a string')
  const notes = value.trim()
  if (notes.length > 4000) throw new AutomationValidationError('notes must be 4000 characters or fewer')
  return notes
}

export function parseAutomationSidecarRead(value: unknown): { sidecar: AutomationSidecarRead; invalidFields: string[] } {
  if (!isRecord(value)) throw new AutomationValidationError('sidecar must be an object')
  const sidecar: AutomationSidecarRead = {
    description: null,
    cwd: null,
    runMode: null,
    runProfileId: null,
    model: null,
    reasoningEffort: null,
    notes: '',
  }
  const invalidFields: string[] = []

  try {
    sidecar.description = readNullableString(value.description, 'description')
  } catch {
    invalidFields.push('description')
  }
  try {
    sidecar.cwd = readCwd(value.cwd)
  } catch {
    invalidFields.push('cwd')
  }
  try {
    sidecar.runMode = readRunMode(value.runMode)
  } catch {
    invalidFields.push('runMode')
  }
  try {
    sidecar.runProfileId = readNullableString(value.runProfileId, 'runProfileId')
  } catch {
    invalidFields.push('runProfileId')
  }
  try {
    sidecar.model = readNullableString(value.model, 'model')
  } catch {
    invalidFields.push('model')
  }
  try {
    sidecar.reasoningEffort = readNullableString(value.reasoningEffort, 'reasoningEffort')
  } catch {
    invalidFields.push('reasoningEffort')
  }
  try {
    sidecar.notes = readNotes(value.notes)
  } catch {
    invalidFields.push('notes')
  }

  return { sidecar, invalidFields }
}

function readOptionalNotes(input: Record<string, unknown>): string | undefined {
  if (!hasOwn(input, 'notes')) return undefined
  return readNotes(input.notes)
}

export function parseAutomationCreateInput(value: unknown): AutomationCreateInput {
  if (!isRecord(value)) throw new AutomationValidationError('Automation create payload is required')
  if (value.kind !== 'heartbeat') throw new AutomationValidationError('kind must be heartbeat')
  return {
    kind: 'heartbeat',
    name: readTrimmedString(value.name, 'name'),
    description: readNullableString(value.description, 'description'),
    prompt: readTrimmedString(value.prompt, 'prompt'),
    schedule: readSchedule(value.schedule),
    targetThreadId: readTrimmedString(value.targetThreadId, 'targetThreadId'),
    cwd: readCwd(value.cwd),
    runMode: readRunMode(value.runMode),
    runProfileId: readNullableString(value.runProfileId, 'runProfileId'),
    model: readNullableString(value.model, 'model'),
    reasoningEffort: readNullableString(value.reasoningEffort, 'reasoningEffort'),
    notes: readNotes(value.notes),
  }
}

export function parseAutomationPatchInput(value: unknown): AutomationPatchInput {
  if (!isRecord(value)) throw new AutomationValidationError('Automation patch payload is required')
  const patch: AutomationPatchInput = {}
  const name = readOptionalRequiredString(value, 'name')
  if (name !== undefined) patch.name = name
  const description = readOptionalNullableString(value, 'description')
  if (description !== undefined) patch.description = description
  const prompt = readOptionalRequiredString(value, 'prompt')
  if (prompt !== undefined) patch.prompt = prompt
  const schedule = readOptionalSchedule(value)
  if (schedule !== undefined) patch.schedule = schedule
  if (hasOwn(value, 'targetThreadId')) patch.targetThreadId = readNullableString(value.targetThreadId, 'targetThreadId')
  if (hasOwn(value, 'cwd')) patch.cwd = readCwd(value.cwd)
  if (hasOwn(value, 'runMode')) patch.runMode = readRunMode(value.runMode)
  const runProfileId = readOptionalNullableString(value, 'runProfileId')
  if (runProfileId !== undefined) patch.runProfileId = runProfileId
  const model = readOptionalNullableString(value, 'model')
  if (model !== undefined) patch.model = model
  const reasoningEffort = readOptionalNullableString(value, 'reasoningEffort')
  if (reasoningEffort !== undefined) patch.reasoningEffort = reasoningEffort
  const notes = readOptionalNotes(value)
  if (notes !== undefined) patch.notes = notes
  return patch
}

export function parseAutomationDeleteOptions(query: unknown, body: unknown): AutomationDeleteOptions {
  return { removeNative: readBooleanOption(query, body, 'removeNative') }
}

export function parseAutomationRouteParams(params: unknown): { automationId: string } {
  if (!isRecord(params)) throw new AutomationValidationError('automationId is required')
  return { automationId: readTrimmedString(params.automationId, 'automationId') }
}

function readBooleanOption(query: unknown, body: unknown, field: string): boolean {
  const bodyValue = isRecord(body) && hasOwn(body, field) ? body[field] : undefined
  const queryValue = isRecord(query) && hasOwn(query, field) ? query[field] : undefined
  const value = bodyValue ?? queryValue
  if (value === undefined || value === null || value === '') return false
  if (value === true || value === 'true') return true
  if (value === false || value === 'false') return false
  throw new AutomationValidationError(`${field} must be true or false`)
}

function validateRrule(rrule: string): void {
  const values = new Map<string, string>()
  for (const part of rrule.split(';')) {
    const separator = part.indexOf('=')
    if (separator <= 0 || separator === part.length - 1) throw new AutomationValidationError('Invalid RRULE part')
    const key = part.slice(0, separator).trim()
    const value = part.slice(separator + 1).trim()
    if (!key || !value) throw new AutomationValidationError('Invalid RRULE part')
    if (values.has(key)) throw new AutomationValidationError('Invalid RRULE duplicate key')
    values.set(key, value)
  }

  const freq = values.get('FREQ')
  if (!freq) throw new AutomationValidationError('Invalid RRULE missing FREQ')
  if (!['MINUTELY', 'HOURLY', 'DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'].includes(freq)) {
    throw new AutomationValidationError('Invalid RRULE FREQ')
  }
  for (const key of values.keys()) {
    if (!['FREQ', 'INTERVAL', 'BYHOUR', 'BYMINUTE', 'BYDAY'].includes(key)) {
      throw new AutomationValidationError('Invalid RRULE key')
    }
  }
  const interval = values.get('INTERVAL')
  if (interval && !/^[1-9]\d*$/u.test(interval)) throw new AutomationValidationError('Invalid RRULE INTERVAL')
  validateNumberList(values.get('BYHOUR'), 0, 23, 'BYHOUR')
  validateNumberList(values.get('BYMINUTE'), 0, 59, 'BYMINUTE')
  const byday = values.get('BYDAY')
  if (byday && !byday.split(',').every((day) => ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'].includes(day))) {
    throw new AutomationValidationError('Invalid RRULE BYDAY')
  }
}

function validateNumberList(value: string | undefined, min: number, max: number, field: string): void {
  if (!value) return
  const parts = value.split(',')
  if (!parts.every((part) => /^\d+$/u.test(part) && Number(part) >= min && Number(part) <= max)) {
    throw new AutomationValidationError(`Invalid RRULE ${field}`)
  }
}
