import type { KanbanBoard, KanbanTask } from '../../types/kanban'
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
  settings: Record<string, unknown>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
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
    settings: {},
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
    tasks: value.tasks as Record<string, KanbanTask>,
    runs: isRecord(value.runs) ? value.runs : {},
    worktrees: isRecord(value.worktrees) ? value.worktrees : {},
    reviewPackets: isRecord(value.reviewPackets) ? value.reviewPackets : {},
    proposals: isRecord(value.proposals) ? value.proposals : {},
    approvals: isRecord(value.approvals) ? value.approvals : {},
    settings: isRecord(value.settings) ? value.settings : {},
  }
}
