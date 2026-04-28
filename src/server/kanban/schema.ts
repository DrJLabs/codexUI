import type {
  CreateKanbanTaskInput,
  KanbanTaskLabel,
  ReplaceKanbanAcceptanceCriteriaInput,
  SetKanbanTaskStatusInput,
  UpdateKanbanTaskInput,
} from '../../types/kanban'
import { KANBAN_STATUSES } from '../../types/kanban'

const STATUS_IDS = new Set(KANBAN_STATUSES.map((status) => status.id))

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function readLabels(value: unknown): KanbanTaskLabel[] {
  if (!Array.isArray(value)) return []
  return value.map((item) => {
    const record = asRecord(item)
    return {
      id: readString(record.id),
      name: readString(record.name),
      color: readString(record.color),
    }
  }).filter((label) => label.id && label.name)
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
  if ('title' in record) patch.title = readString(record.title)
  if ('description' in record) patch.description = readString(record.description)
  if ('blockedReason' in record) patch.blockedReason = readString(record.blockedReason)
  if ('labels' in record) patch.labels = readLabels(record.labels)
  return patch
}

export function parseStatusInput(value: unknown): SetKanbanTaskStatusInput {
  const record = asRecord(value)
  const status = readString(record.status)
  if (!STATUS_IDS.has(status as never)) {
    throw new Error('Invalid Kanban status')
  }
  return {
    status: status as SetKanbanTaskStatusInput['status'],
    reason: readString(record.reason),
  }
}

export function parseReplaceAcceptanceCriteriaInput(value: unknown): ReplaceKanbanAcceptanceCriteriaInput {
  const record = asRecord(value)
  const criteria = Array.isArray(record.criteria)
    ? record.criteria.map((item) => {
      const itemRecord = asRecord(item)
      return {
        id: readString(itemRecord.id),
        text: readString(itemRecord.text),
        checked: itemRecord.checked === true,
      }
    }).filter((item) => item.text)
    : []
  return { criteria }
}
