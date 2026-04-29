import type {
  DeleteKanbanTaskInput,
  CreateKanbanTaskInput,
  KanbanActor,
  KanbanBoardColumn,
  KanbanPriority,
  KanbanStatus,
  KanbanTaskLabel,
  KanbanThinkingLevel,
  KanbanTaskListQuery,
  ReplaceKanbanAcceptanceCriteriaInput,
  ReorderKanbanTaskInput,
  SetKanbanTaskStatusInput,
  UpdateKanbanBoardConfigInput,
  UpdateKanbanTaskInput,
  VersionedSetKanbanTaskStatusInput,
  VersionedUpdateKanbanTaskInput,
} from '../../types/kanban'
import { KANBAN_STATUSES } from '../../types/kanban'

const STATUS_IDS = new Set(KANBAN_STATUSES.map((status) => status.id))
const PRIORITY_IDS = new Set(['critical', 'high', 'normal', 'low'])
const THINKING_IDS = new Set(['off', 'low', 'medium', 'high'])

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function readString(value: unknown): string {
  if (Array.isArray(value)) return readString(value[0])
  return typeof value === 'string' ? value.trim() : ''
}

function readOptionalString(value: unknown): string | undefined {
  const stringValue = readString(value)
  return stringValue ? stringValue : undefined
}

function readStringArray(value: unknown): string[] {
  const values = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : []
  return values
    .flatMap((item) => typeof item === 'string' ? item.split(',') : [])
    .map((item) => item.trim())
    .filter(Boolean)
}

function readInteger(value: unknown, name: string): number {
  const candidate = Array.isArray(value) ? value[0] : value
  const numberValue = typeof candidate === 'number'
    ? candidate
    : typeof candidate === 'string' && candidate.trim() ? Number(candidate) : NaN
  if (!Number.isInteger(numberValue)) {
    throw new Error(`${name} must be an integer`)
  }
  return numberValue
}

function readRequiredVersion(record: Record<string, unknown>): number {
  const version = readInteger(record.version, 'version')
  if (version < 1) throw new Error('version must be greater than or equal to 1')
  return version
}

function readKanbanActor(value: unknown): KanbanActor {
  const actor = readString(value)
  if (actor === 'operator' || actor === 'codex:auto') return actor
  if (actor.startsWith('codex:thread:') && actor.slice('codex:thread:'.length).trim()) {
    return actor as KanbanActor
  }
  throw new Error('Invalid Kanban actor')
}

function readNullableNonnegativeInteger(value: unknown, name: string): number | null {
  if (value === null || value === '') return null
  const numberValue = readInteger(value, name)
  if (numberValue < 0) throw new Error(`${name} must be null or a nonnegative integer`)
  return numberValue
}

function labelIdFromName(name: string): string {
  const normalized = name.toLowerCase().replace(/[^a-z0-9]+/gu, '_').replace(/^_+|_+$/gu, '')
  return `label_${normalized || 'custom'}`
}

function uniqueLabelId(baseId: string, usedIds: Set<string>): string {
  let id = baseId
  let suffix = 2
  while (usedIds.has(id)) {
    id = `${baseId}_${suffix}`
    suffix += 1
  }
  usedIds.add(id)
  return id
}

function readLabels(value: unknown): KanbanTaskLabel[] {
  if (!Array.isArray(value)) return []
  const usedIds = new Set<string>()
  const labels: KanbanTaskLabel[] = []
  for (const item of value) {
    const record = asRecord(item)
    const name = readString(record.name)
    if (!name) continue
    const baseId = readString(record.id) || labelIdFromName(name)
    labels.push({
      id: uniqueLabelId(baseId, usedIds),
      name,
      color: readString(record.color),
    })
  }
  return labels
}

export function parseCreateTaskInput(value: unknown): CreateKanbanTaskInput {
  const record = asRecord(value)
  const title = readString(record.title)
  if (!title) throw new Error('Task title is required')
  const criteria = Array.isArray(record.acceptanceCriteria)
    ? record.acceptanceCriteria.map((item) => {
      const itemRecord = asRecord(item)
      return {
        text: readString(itemRecord.text),
        checked: itemRecord.checked === true,
      }
    }).filter((item) => item.text)
    : []
  return {
    title,
    description: readString(record.description),
    labels: readLabels(record.labels),
    acceptanceCriteria: criteria,
  }
}

export function parseUpdateTaskInput(value: unknown): UpdateKanbanTaskInput {
  const record = asRecord(value)
  const patch: UpdateKanbanTaskInput = {}
  if ('title' in record) {
    const title = readString(record.title)
    if (!title) throw new Error('Task title is required')
    patch.title = title
  }
  if ('description' in record) patch.description = readString(record.description)
  if ('blockedReason' in record) patch.blockedReason = readString(record.blockedReason)
  if ('labels' in record) patch.labels = readLabels(record.labels)
  if ('priority' in record) {
    const priority = readString(record.priority)
    if (!PRIORITY_IDS.has(priority)) throw new Error('Invalid Kanban priority')
    patch.priority = priority as KanbanPriority
  }
  if ('assignee' in record) patch.assignee = readKanbanActor(record.assignee)
  if ('model' in record) patch.model = readString(record.model)
  if ('thinking' in record) {
    const thinking = readString(record.thinking)
    if (!THINKING_IDS.has(thinking)) throw new Error('Invalid Kanban thinking')
    patch.thinking = thinking as KanbanThinkingLevel
  }
  if ('dueAtIso' in record) patch.dueAtIso = readString(record.dueAtIso)
  if ('estimateMinutes' in record) patch.estimateMinutes = readNullableNonnegativeInteger(record.estimateMinutes, 'estimateMinutes')
  if ('actualMinutes' in record) patch.actualMinutes = readNullableNonnegativeInteger(record.actualMinutes, 'actualMinutes')
  return patch
}

export function parseVersionedUpdateTaskInput(value: unknown): VersionedUpdateKanbanTaskInput {
  const record = asRecord(value)
  return {
    ...parseUpdateTaskInput(record),
    version: readRequiredVersion(record),
  }
}

export function parseStatusInput(value: unknown): VersionedSetKanbanTaskStatusInput {
  const record = asRecord(value)
  const status = readString(record.status)
  if (!STATUS_IDS.has(status as never)) {
    throw new Error('Invalid Kanban status')
  }
  return {
    version: readRequiredVersion(record),
    status: status as SetKanbanTaskStatusInput['status'],
    reason: 'reason' in record ? readString(record.reason) : undefined,
  }
}

export function parseDeleteTaskInput(value: unknown): DeleteKanbanTaskInput {
  const record = asRecord(value)
  return { version: readRequiredVersion(record) }
}

export function parseListTasksQuery(value: unknown): KanbanTaskListQuery {
  const record = asRecord(value)
  const requestedLimit = 'limit' in record ? readInteger(record.limit, 'limit') : 50
  const requestedOffset = 'offset' in record ? readInteger(record.offset, 'offset') : 0
  if (requestedLimit < 1) throw new Error('limit must be greater than or equal to 1')
  if (requestedOffset < 0) throw new Error('offset must be greater than or equal to 0')
  const priorities = readStringArray(record.priority)
  for (const priority of priorities) {
    if (!PRIORITY_IDS.has(priority)) throw new Error('Invalid Kanban priority')
  }
  return {
    q: readOptionalString(record.q),
    priority: priorities.length > 0 ? priorities as KanbanPriority[] : undefined,
    assignee: 'assignee' in record ? readKanbanActor(record.assignee) : undefined,
    label: readOptionalString(record.label),
    limit: Math.min(requestedLimit, 200),
    offset: requestedOffset,
  }
}

export function parseReorderTaskInput(value: unknown): ReorderKanbanTaskInput {
  const record = asRecord(value)
  const status = readString(record.status)
  if (!STATUS_IDS.has(status as never)) {
    throw new Error('Invalid Kanban status')
  }
  return {
    version: readRequiredVersion(record),
    status: status as ReorderKanbanTaskInput['status'],
    beforeTaskId: readOptionalString(record.beforeTaskId),
    afterTaskId: readOptionalString(record.afterTaskId),
  }
}

export function parseBoardConfigInput(value: unknown): UpdateKanbanBoardConfigInput {
  const record = asRecord(value)
  const input: UpdateKanbanBoardConfigInput = {}
  if (Array.isArray(record.columns)) {
    input.columns = record.columns.map((item) => {
      const column = asRecord(item)
      const key = readString(column.key)
      if (!STATUS_IDS.has(key as never)) throw new Error('Invalid Kanban status')
      const wipLimit = column.wipLimit === null ? null : readInteger(column.wipLimit, 'wipLimit')
      if (wipLimit !== null && wipLimit < 1) throw new Error('wipLimit must be greater than or equal to 1')
      return {
        key: key as KanbanBoardColumn['key'],
        title: readString(column.title) || KANBAN_STATUSES.find((status) => status.id === key)?.title || key,
        visible: column.visible === undefined ? true : column.visible === true,
        wipLimit,
      }
    })
  }
  if (asRecord(record.defaults) !== record.defaults && 'defaults' in record) {
    throw new Error('defaults must be an object')
  }
  const defaults = asRecord(record.defaults)
  if ('status' in defaults || 'priority' in defaults) {
    input.defaults = {}
    if ('status' in defaults) {
      const status = readString(defaults.status)
      if (!STATUS_IDS.has(status as never)) throw new Error('Invalid Kanban status')
      input.defaults.status = status as KanbanStatus
    }
    if ('priority' in defaults) {
      const priority = readString(defaults.priority)
      if (!PRIORITY_IDS.has(priority)) throw new Error('Invalid Kanban priority')
      input.defaults.priority = priority as KanbanPriority
    }
  }
  if ('reviewRequired' in record) input.reviewRequired = record.reviewRequired === true
  if ('allowDoneDragBypass' in record) input.allowDoneDragBypass = record.allowDoneDragBypass === true
  if ('quickViewLimit' in record) {
    const quickViewLimit = readInteger(record.quickViewLimit, 'quickViewLimit')
    if (quickViewLimit < 1) throw new Error('quickViewLimit must be greater than or equal to 1')
    input.quickViewLimit = quickViewLimit
  }
  if ('proposalPolicy' in record) {
    const proposalPolicy = readString(record.proposalPolicy)
    if (proposalPolicy !== 'confirm' && proposalPolicy !== 'auto') throw new Error('Invalid proposal policy')
    input.proposalPolicy = proposalPolicy
  }
  if ('defaultModel' in record) input.defaultModel = readString(record.defaultModel)
  if ('defaultThinking' in record) {
    const defaultThinking = readString(record.defaultThinking)
    if (!THINKING_IDS.has(defaultThinking)) throw new Error('Invalid default thinking')
    input.defaultThinking = defaultThinking as UpdateKanbanBoardConfigInput['defaultThinking']
  }
  return input
}

export function parseReplaceAcceptanceCriteriaInput(value: unknown): ReplaceKanbanAcceptanceCriteriaInput {
  const record = asRecord(value)
  if (!Array.isArray(record.criteria)) {
    throw new Error('Acceptance criteria must be an array')
  }
  const criteria = record.criteria.map((item) => {
    const itemRecord = asRecord(item)
    return {
      id: readString(itemRecord.id),
      text: readString(itemRecord.text),
      checked: itemRecord.checked === true,
    }
  }).filter((item) => item.text)
  return { criteria }
}
