import type {
  CreateKanbanTaskInput,
  KanbanExecutionPolicy,
  KanbanStateSnapshot,
  KanbanStatus,
  KanbanTask,
  ReplaceKanbanAcceptanceCriteriaInput,
  SetKanbanTaskStatusInput,
  UpdateKanbanTaskInput,
} from '../../types/kanban'
import { createKanbanId } from './ids'
import type { KanbanStorage } from './storage'

const ALLOWED_STATUS_TRANSITIONS: Record<KanbanStatus, KanbanStatus[]> = {
  backlog: ['ready', 'cancelled'],
  ready: ['backlog', 'running', 'cancelled'],
  running: ['review', 'rework', 'cancelled'],
  review: ['done', 'rework', 'cancelled'],
  rework: ['ready', 'running', 'cancelled'],
  done: ['review', 'rework'],
  cancelled: ['backlog'],
}

export class KanbanTaskService {
  readonly policy: KanbanExecutionPolicy
  private readonly storage: KanbanStorage
  private readonly projectRoot: string

  constructor(options: { storage: KanbanStorage; projectRoot: string; policy: KanbanExecutionPolicy }) {
    this.storage = options.storage
    this.projectRoot = options.projectRoot
    this.policy = options.policy
  }

  async listState(): Promise<KanbanStateSnapshot> {
    const state = await this.storage.load()
    const board = Object.values(state.boards)[0]
    if (!board) {
      throw new Error('Kanban board is missing')
    }
    return {
      schemaVersion: 1,
      board,
      tasks: Object.values(state.tasks),
      policy: this.policy,
      generatedAtIso: new Date().toISOString(),
    }
  }

  async createTask(input: CreateKanbanTaskInput): Promise<KanbanTask> {
    const nowIso = new Date().toISOString()
    let createdTask: KanbanTask | null = null
    await this.storage.mutate((state) => {
      const board = Object.values(state.boards)[0]
      if (!board) throw new Error('Kanban board is missing')
      const taskId = createKanbanId('task')
      createdTask = {
        id: taskId,
        boardId: board.id,
        title: input.title.trim(),
        description: input.description?.trim() ?? '',
        status: 'backlog',
        runState: 'idle',
        labels: input.labels ?? [],
        acceptanceCriteria: (input.acceptanceCriteria ?? []).map((criterion) => {
          const criterionNowIso = new Date().toISOString()
          return {
            id: createKanbanId('criterion'),
            text: criterion.text.trim(),
            checked: criterion.checked === true,
            createdAtIso: criterionNowIso,
            updatedAtIso: criterionNowIso,
          }
        }),
        projectRoot: this.projectRoot,
        cwd: this.projectRoot,
        baseBranch: '',
        branchName: '',
        worktreeId: '',
        worktreePath: '',
        codexThreadId: '',
        currentRunId: '',
        runIds: [],
        reviewPacketId: '',
        proposalIds: [],
        blockedReason: '',
        errorMessage: '',
        archived: false,
        createdAtIso: nowIso,
        updatedAtIso: nowIso,
        version: 1,
      }
      state.tasks[taskId] = createdTask
    })
    if (!createdTask) throw new Error('Failed to create Kanban task')
    return createdTask
  }

  async updateTask(taskId: string, input: UpdateKanbanTaskInput): Promise<KanbanTask> {
    return await this.updateExistingTask(taskId, (task, nowIso) => ({
      ...task,
      title: input.title !== undefined ? input.title.trim() : task.title,
      description: input.description !== undefined ? input.description.trim() : task.description,
      labels: input.labels ?? task.labels,
      blockedReason: input.blockedReason !== undefined ? input.blockedReason.trim() : task.blockedReason,
      updatedAtIso: nowIso,
      version: task.version + 1,
    }))
  }

  async setTaskStatus(taskId: string, input: SetKanbanTaskStatusInput): Promise<KanbanTask> {
    return await this.updateExistingTask(taskId, (task, nowIso) => {
      const allowed = ALLOWED_STATUS_TRANSITIONS[task.status]
      if (!allowed.includes(input.status)) {
        throw new Error(`Invalid status transition from ${task.status} to ${input.status}`)
      }
      return {
        ...task,
        status: input.status,
        blockedReason: input.reason?.trim() ?? task.blockedReason,
        updatedAtIso: nowIso,
        version: task.version + 1,
      }
    })
  }

  async archiveTask(taskId: string): Promise<KanbanTask> {
    return await this.updateExistingTask(taskId, (task, nowIso) => ({
      ...task,
      archived: true,
      updatedAtIso: nowIso,
      version: task.version + 1,
    }))
  }

  async replaceAcceptanceCriteria(taskId: string, input: ReplaceKanbanAcceptanceCriteriaInput): Promise<KanbanTask> {
    return await this.updateExistingTask(taskId, (task, nowIso) => ({
      ...task,
      acceptanceCriteria: input.criteria.map((criterion) => {
        const trimmedId = criterion.id?.trim() ?? ''
        return {
          id: trimmedId || createKanbanId('criterion'),
          text: criterion.text.trim(),
          checked: criterion.checked === true,
          createdAtIso: task.acceptanceCriteria.find((existing) => existing.id === trimmedId)?.createdAtIso ?? nowIso,
          updatedAtIso: nowIso,
        }
      }),
      updatedAtIso: nowIso,
      version: task.version + 1,
    }))
  }

  private async updateExistingTask(taskId: string, updater: (task: KanbanTask, nowIso: string) => KanbanTask): Promise<KanbanTask> {
    let nextTask: KanbanTask | null = null
    await this.storage.mutate((state) => {
      const task = state.tasks[taskId]
      if (!task) {
        throw new Error('Kanban task not found')
      }
      nextTask = updater(task, new Date().toISOString())
      state.tasks[taskId] = nextTask
    })
    if (!nextTask) throw new Error('Failed to update Kanban task')
    return nextTask
  }
}
