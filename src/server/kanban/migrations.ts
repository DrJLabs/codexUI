import {
  KANBAN_STATUSES,
  type KanbanActor,
  type KanbanBoard,
  type KanbanBoardConfig,
  type KanbanPriority,
  type KanbanTask,
  type KanbanTaskFeedback,
  type KanbanThinkingLevel,
} from '../../types/kanban'
import { createKanbanId } from './ids'

export type KanbanStateFileV1 = {
  schemaVersion: 1
  projectRoot: string
  createdAtIso: string
  updatedAtIso: string
  boards: Record<string, KanbanBoard>
  tasks: Record<string, KanbanTask>
  runs: Record<string, unknown>
  worktrees: Record<string, unknown>
  reviewPackets: Record<string, unknown>
  proposals: Record<string, unknown>
  approvals: Record<string, unknown>
  settings: Record<string, unknown> & { kanbanConfig: KanbanBoardConfig }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isKanbanPriority(value: unknown): value is KanbanPriority {
  return value === 'critical' || value === 'high' || value === 'normal' || value === 'low'
}

function isKanbanActor(value: unknown): value is KanbanActor {
  return value === 'operator'
    || value === 'codex:auto'
    || (typeof value === 'string' && value.startsWith('codex:thread:') && value.length > 'codex:thread:'.length)
}

function isKanbanThinkingLevel(value: unknown): value is KanbanThinkingLevel {
  return value === 'off' || value === 'low' || value === 'medium' || value === 'high'
}

function isKanbanTaskFeedback(value: unknown): value is KanbanTaskFeedback {
  return isRecord(value)
    && typeof value.id === 'string'
    && typeof value.atIso === 'string'
    && isKanbanActor(value.by)
    && typeof value.note === 'string'
}

function isKanbanBoardConfig(value: unknown): value is KanbanBoardConfig {
  if (!isRecord(value) || !Array.isArray(value.columns) || !isRecord(value.defaults)) {
    return false
  }
  const statusKeys = new Set<string>(KANBAN_STATUSES.map((status) => status.id))
  return value.columns.every((column) => (
    isRecord(column)
    && typeof column.key === 'string'
    && statusKeys.has(column.key)
    && typeof column.title === 'string'
    && typeof column.visible === 'boolean'
    && (column.wipLimit === null || typeof column.wipLimit === 'number')
  ))
    && typeof value.defaults.status === 'string'
    && statusKeys.has(value.defaults.status)
    && isKanbanPriority(value.defaults.priority)
    && typeof value.reviewRequired === 'boolean'
    && typeof value.allowDoneDragBypass === 'boolean'
    && typeof value.quickViewLimit === 'number'
    && (value.proposalPolicy === 'confirm' || value.proposalPolicy === 'auto')
    && typeof value.defaultModel === 'string'
    && isKanbanThinkingLevel(value.defaultThinking)
}

export function createDefaultKanbanBoardConfig(): KanbanBoardConfig {
  return {
    columns: KANBAN_STATUSES.map((status) => ({
      key: status.id,
      title: status.title,
      visible: true,
      wipLimit: null,
    })),
    defaults: {
      status: 'backlog',
      priority: 'normal',
    },
    reviewRequired: true,
    allowDoneDragBypass: false,
    quickViewLimit: 20,
    proposalPolicy: 'confirm',
    defaultModel: '',
    defaultThinking: 'medium',
  }
}

export function normalizeKanbanTask(task: KanbanTask, columnOrder: number): KanbanTask {
  const value = task as KanbanTask & Record<string, unknown>
  return {
    ...task,
    priority: isKanbanPriority(value.priority) ? value.priority : 'normal',
    createdBy: isKanbanActor(value.createdBy) ? value.createdBy : 'operator',
    sourceSessionKey: typeof value.sourceSessionKey === 'string' ? value.sourceSessionKey : '',
    assignee: isKanbanActor(value.assignee) ? value.assignee : 'codex:auto',
    columnOrder: typeof value.columnOrder === 'number' && Number.isFinite(value.columnOrder) ? value.columnOrder : columnOrder,
    result: typeof value.result === 'string' ? value.result : '',
    resultAtIso: typeof value.resultAtIso === 'string' ? value.resultAtIso : '',
    model: typeof value.model === 'string' ? value.model : '',
    thinking: isKanbanThinkingLevel(value.thinking) ? value.thinking : 'medium',
    dueAtIso: typeof value.dueAtIso === 'string' ? value.dueAtIso : '',
    estimateMinutes: typeof value.estimateMinutes === 'number' && Number.isFinite(value.estimateMinutes) ? value.estimateMinutes : null,
    actualMinutes: typeof value.actualMinutes === 'number' && Number.isFinite(value.actualMinutes) ? value.actualMinutes : null,
    feedback: Array.isArray(value.feedback) ? value.feedback.filter(isKanbanTaskFeedback) : [],
  }
}

function normalizeKanbanTasks(tasks: Record<string, KanbanTask>): Record<string, KanbanTask> {
  const nextColumnOrderByStatus = new Map<string, number>()
  const normalizedTasks: Record<string, KanbanTask> = {}
  for (const [taskId, task] of Object.entries(tasks)) {
    const currentColumnOrder = nextColumnOrderByStatus.get(task.status) ?? 0
    const normalizedTask = normalizeKanbanTask(task, currentColumnOrder)
    normalizedTasks[taskId] = normalizedTask
    nextColumnOrderByStatus.set(task.status, Math.max(currentColumnOrder, normalizedTask.columnOrder ?? currentColumnOrder) + 1)
  }
  return normalizedTasks
}

function normalizeSettings(settings: Record<string, unknown>): Record<string, unknown> & { kanbanConfig: KanbanBoardConfig } {
  return {
    ...settings,
    kanbanConfig: isKanbanBoardConfig(settings.kanbanConfig)
      ? settings.kanbanConfig
      : createDefaultKanbanBoardConfig(),
  }
}

export function createEmptyStateFile(projectRoot: string, nowIso: string): KanbanStateFileV1 {
  const boardId = createKanbanId('board')
  return {
    schemaVersion: 1,
    projectRoot,
    createdAtIso: nowIso,
    updatedAtIso: nowIso,
    boards: {
      [boardId]: {
        id: boardId,
        title: 'Kanban',
        projectRoot,
        createdAtIso: nowIso,
        updatedAtIso: nowIso,
      },
    },
    tasks: {},
    runs: {},
    worktrees: {},
    reviewPackets: {},
    proposals: {},
    approvals: {},
    settings: {
      kanbanConfig: createDefaultKanbanBoardConfig(),
    },
  }
}

export function migrateKanbanStateFile(value: unknown, projectRoot: string): KanbanStateFileV1 {
  if (!isRecord(value) || value.schemaVersion !== 1) {
    throw new Error('Unsupported Kanban state schema')
  }
  if (!isRecord(value.boards) || !isRecord(value.tasks)) {
    throw new Error('Invalid Kanban state file')
  }
  return {
    schemaVersion: 1,
    projectRoot: typeof value.projectRoot === 'string' && value.projectRoot ? value.projectRoot : projectRoot,
    createdAtIso: typeof value.createdAtIso === 'string' ? value.createdAtIso : new Date().toISOString(),
    updatedAtIso: typeof value.updatedAtIso === 'string' ? value.updatedAtIso : new Date().toISOString(),
    boards: value.boards as Record<string, KanbanBoard>,
    tasks: normalizeKanbanTasks(value.tasks as Record<string, KanbanTask>),
    runs: isRecord(value.runs) ? value.runs : {},
    worktrees: isRecord(value.worktrees) ? value.worktrees : {},
    reviewPackets: isRecord(value.reviewPackets) ? value.reviewPackets : {},
    proposals: isRecord(value.proposals) ? value.proposals : {},
    approvals: isRecord(value.approvals) ? value.approvals : {},
    settings: normalizeSettings(isRecord(value.settings) ? value.settings : {}),
  }
}
