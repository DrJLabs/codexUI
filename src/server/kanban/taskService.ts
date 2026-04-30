import type {
  CreateKanbanTaskInput,
  DeleteKanbanTaskInput,
  KanbanBoardConfig,
  KanbanExecutionPolicy,
  KanbanStateSnapshot,
  KanbanStatus,
  KanbanTask,
  KanbanTaskListQuery,
  KanbanTaskListResult,
  ReplaceKanbanAcceptanceCriteriaInput,
  ReorderKanbanTaskInput,
  UpdateKanbanBoardConfigInput,
  VersionedSetKanbanTaskStatusInput,
  VersionedUpdateKanbanTaskInput,
} from '../../types/kanban'
import { FULL_ACCESS_KANBAN_RUN_PROFILE_ID, KANBAN_STATUSES } from '../../types/kanban'
import { KanbanInvalidTransitionError, KanbanNotFoundError, KanbanVersionConflictError } from './errors'
import { createKanbanId } from './ids'
import type { KanbanStateFileV1 } from './migrations'
import { assertKnownKanbanRunProfile, normalizeKanbanRunProfileId, normalizeKanbanRunProfiles } from './runProfiles'
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
      config: state.settings.kanbanConfig,
      policy: resolveEffectiveKanbanExecutionPolicy(this.policy, state.settings.kanbanConfig),
      generatedAtIso: new Date().toISOString(),
    }
  }

  async getExecutionPolicy(): Promise<KanbanExecutionPolicy> {
    const state = await this.storage.load()
    return resolveEffectiveKanbanExecutionPolicy(this.policy, state.settings.kanbanConfig)
  }

  async createTask(input: CreateKanbanTaskInput): Promise<KanbanTask> {
    let createdTask: KanbanTask | null = null
    await this.storage.mutate((state) => {
      createdTask = createTaskInState(state, input, this.projectRoot, new Date().toISOString())
    })
    if (!createdTask) throw new Error('Failed to create Kanban task')
    return createdTask
  }

  async createTaskIfNoActiveLabel(labelName: string, input: CreateKanbanTaskInput): Promise<KanbanTask> {
    let task: KanbanTask | null = null
    await this.storage.mutate((state) => {
      const existing = Object.values(state.tasks).find((candidate) => (
        !candidate.archived && candidate.labels.some((label) => label.name === labelName)
      ))
      task = existing ?? createTaskInState(state, input, this.projectRoot, new Date().toISOString())
    })
    if (!task) throw new Error('Failed to create or find Kanban task')
    return task
  }

  async listTasks(query: KanbanTaskListQuery): Promise<KanbanTaskListResult> {
    const state = await this.storage.load()
    const config = state.settings.kanbanConfig
    const normalizedQuery = query.q?.trim().toLowerCase() ?? ''
    const matchingTasks = Object.values(state.tasks)
      .filter((task) => !task.archived)
      .filter((task) => !normalizedQuery || taskMatchesQuery(task, normalizedQuery))
      .filter((task) => !query.priority || query.priority.includes(task.priority))
      .filter((task) => !query.assignee || task.assignee === query.assignee)
      .filter((task) => !query.label || task.labels.some((label) => label.name.toLowerCase() === query.label?.trim().toLowerCase()))
      .sort((left, right) => compareTasks(left, right, config))
    const items = matchingTasks.slice(query.offset, query.offset + query.limit)
    return {
      items,
      total: matchingTasks.length,
      limit: query.limit,
      offset: query.offset,
      hasMore: query.offset + items.length < matchingTasks.length,
    }
  }

  async getTask(taskId: string): Promise<KanbanTask> {
    const state = await this.storage.load()
    return readExistingTask(state.tasks, taskId)
  }

  async updateTask(taskId: string, input: VersionedUpdateKanbanTaskInput): Promise<KanbanTask> {
    const version = readRequiredVersion(input)
    if (input.runProfileId !== undefined) {
      const state = await this.storage.load()
      const runProfileId = input.runProfileId.trim()
      if (runProfileId) assertKnownKanbanRunProfile(runProfileId, state.settings.kanbanConfig.runProfiles)
    }
    return await this.updateExistingTaskWithVersion(taskId, version, (task, nowIso, state) => {
      const runProfileId = input.runProfileId !== undefined ? input.runProfileId.trim() : task.runProfileId
      if (runProfileId) assertKnownKanbanRunProfile(runProfileId, state.settings.kanbanConfig.runProfiles)
      return {
        ...task,
        title: input.title !== undefined ? input.title.trim() : task.title,
        description: input.description !== undefined ? input.description.trim() : task.description,
        labels: input.labels ?? task.labels,
        blockedReason: input.blockedReason !== undefined ? input.blockedReason.trim() : task.blockedReason,
        priority: input.priority ?? task.priority,
        assignee: input.assignee ?? task.assignee,
        model: input.model !== undefined ? input.model.trim() : task.model,
        thinking: input.thinking ?? task.thinking,
        runProfileId,
        dueAtIso: input.dueAtIso !== undefined ? input.dueAtIso : task.dueAtIso,
        estimateMinutes: input.estimateMinutes !== undefined ? input.estimateMinutes : task.estimateMinutes,
        actualMinutes: input.actualMinutes !== undefined ? input.actualMinutes : task.actualMinutes,
        updatedAtIso: nowIso,
        version: task.version + 1,
      }
    })
  }

  async setTaskStatus(taskId: string, input: VersionedSetKanbanTaskStatusInput): Promise<KanbanTask> {
    const version = readRequiredVersion(input)
    return await this.updateExistingTaskWithVersion(taskId, version, (task, nowIso) => {
      assertAllowedStatusTransition(task.status, input.status)
      return {
        ...task,
        status: input.status,
        blockedReason: input.reason?.trim() ?? task.blockedReason,
        updatedAtIso: nowIso,
        version: task.version + 1,
      }
    })
  }

  async archiveTask(taskId: string, input: DeleteKanbanTaskInput): Promise<KanbanTask> {
    return await this.deleteTask(taskId, input)
  }

  async deleteTask(taskId: string, input: DeleteKanbanTaskInput): Promise<KanbanTask> {
    const version = readRequiredVersion(input)
    return await this.updateExistingTaskWithVersion(taskId, version, (task, nowIso) => ({
      ...task,
      archived: true,
      updatedAtIso: nowIso,
      version: task.version + 1,
    }))
  }

  async reorderTask(taskId: string, input: ReorderKanbanTaskInput): Promise<KanbanTask> {
    let reorderedTask: KanbanTask | null = null
    await this.storage.mutate((state) => {
      const task = readExistingTask(state.tasks, taskId)
      assertVersion(task, input.version)
      if (input.status !== task.status) {
        assertAllowedStatusTransition(task.status, input.status, {
          allowDoneDragBypass: state.settings.kanbanConfig.allowDoneDragBypass,
        })
      }
      if (input.beforeTaskId && input.beforeTaskId === taskId) throw new Error('beforeTaskId cannot match taskId')
      if (input.afterTaskId && input.afterTaskId === taskId) throw new Error('afterTaskId cannot match taskId')
      const siblingTasks = Object.values(state.tasks)
        .filter((candidate) => candidate.id !== taskId && !candidate.archived && candidate.status === input.status)
        .sort((left, right) => left.columnOrder - right.columnOrder || right.updatedAtIso.localeCompare(left.updatedAtIso))
      const anchorId = input.afterTaskId ?? input.beforeTaskId
      if (anchorId) {
        const anchor = state.tasks[anchorId]
        if (!anchor || anchor.archived || anchor.status !== input.status) {
          throw new KanbanNotFoundError('Kanban reorder anchor not found')
        }
      }
      const anchorIndex = anchorId ? siblingTasks.findIndex((candidate) => candidate.id === anchorId) : -1
      const insertIndex = input.afterTaskId
        ? anchorIndex + 1
        : input.beforeTaskId ? anchorIndex : siblingTasks.length
      siblingTasks.splice(Math.max(0, insertIndex), 0, task)
      const nowIso = new Date().toISOString()
      siblingTasks.forEach((candidate, index) => {
        const nextTask = candidate.id === taskId
          ? {
              ...candidate,
              status: input.status,
              columnOrder: index,
              updatedAtIso: nowIso,
              version: candidate.version + 1,
            }
          : candidate.columnOrder === index
            ? candidate
            : {
                ...candidate,
                columnOrder: index,
                updatedAtIso: nowIso,
                version: candidate.version + 1,
              }
        state.tasks[candidate.id] = nextTask
        if (candidate.id === taskId) reorderedTask = nextTask
      })
    })
    if (!reorderedTask) throw new Error('Failed to reorder Kanban task')
    return reorderedTask
  }

  async getConfig(): Promise<KanbanBoardConfig> {
    const state = await this.storage.load()
    return state.settings.kanbanConfig
  }

  async updateConfig(input: UpdateKanbanBoardConfigInput): Promise<KanbanBoardConfig> {
    const currentState = await this.storage.load()
    createValidatedKanbanConfig(currentState.settings.kanbanConfig, input)
    let nextConfig: KanbanBoardConfig | null = null
    await this.storage.mutate((state) => {
      nextConfig = createValidatedKanbanConfig(state.settings.kanbanConfig, input)
      state.settings.kanbanConfig = nextConfig
    })
    if (!nextConfig) throw new Error('Failed to update Kanban config')
    return nextConfig
  }

  async replaceAcceptanceCriteria(taskId: string, input: ReplaceKanbanAcceptanceCriteriaInput): Promise<KanbanTask> {
    const version = readRequiredVersion(input)
    return await this.updateExistingTaskWithVersion(taskId, version, (task, nowIso) => ({
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

  private async updateExistingTaskWithVersion(taskId: string, version: number, updater: (task: KanbanTask, nowIso: string, state: KanbanStateFileV1) => KanbanTask): Promise<KanbanTask> {
    return await this.updateExistingTask(taskId, (task, nowIso, state) => {
      assertVersion(task, version)
      return updater(task, nowIso, state)
    })
  }

  // Internal server-owned mutations only. Public user/task mutations must use updateExistingTaskWithVersion.
  private async updateExistingTaskInternal(taskId: string, updater: (task: KanbanTask, nowIso: string, state: KanbanStateFileV1) => KanbanTask): Promise<KanbanTask> {
    return await this.updateExistingTask(taskId, updater)
  }

  private async updateExistingTask(taskId: string, updater: (task: KanbanTask, nowIso: string, state: KanbanStateFileV1) => KanbanTask): Promise<KanbanTask> {
    let nextTask: KanbanTask | null = null
    await this.storage.mutate((state) => {
      const task = readExistingTask(state.tasks, taskId)
      const nowIso = new Date().toISOString()
      nextTask = updater(task, nowIso, state)
      state.tasks[taskId] = nextTask
    })
    if (!nextTask) throw new Error('Failed to update Kanban task')
    return nextTask
  }
}

function readExistingTask(tasks: Record<string, KanbanTask>, taskId: string): KanbanTask {
  const task = tasks[taskId]
  if (!task) throw new KanbanNotFoundError('Kanban task not found')
  return task
}

function createTaskInState(
  state: KanbanStateFileV1,
  input: CreateKanbanTaskInput,
  projectRoot: string,
  nowIso: string,
): KanbanTask {
  const board = Object.values(state.boards)[0]
  if (!board) throw new Error('Kanban board is missing')
  const defaultStatus = state.settings.kanbanConfig.defaults.status
  const defaultPriority = state.settings.kanbanConfig.defaults.priority
  const runProfiles = state.settings.kanbanConfig.runProfiles
  const runProfileId = input.runProfileId?.trim() || state.settings.kanbanConfig.defaultRunProfileId
  assertKnownKanbanRunProfile(runProfileId, runProfiles)
  const taskId = createKanbanId('task')
  const nextColumnOrder = Object.values(state.tasks)
    .filter((task) => task.status === defaultStatus && !task.archived)
    .reduce((nextOrder, task) => Math.max(nextOrder, task.columnOrder + 1), 0)
  const task: KanbanTask = {
    id: taskId,
    boardId: board.id,
    title: input.title.trim(),
    description: input.description?.trim() ?? '',
    status: defaultStatus,
    priority: input.priority ?? defaultPriority,
    runState: 'idle',
    labels: input.labels ?? [],
    acceptanceCriteria: (input.acceptanceCriteria ?? []).map((criterion) => ({
      id: createKanbanId('criterion'),
      text: criterion.text.trim(),
      checked: criterion.checked === true,
      createdAtIso: nowIso,
      updatedAtIso: nowIso,
    })),
    projectRoot,
    cwd: projectRoot,
    baseBranch: '',
    branchName: '',
    worktreeId: '',
    worktreePath: '',
    codexThreadId: '',
    createdBy: 'operator',
    sourceSessionKey: '',
    assignee: input.assignee ?? 'codex:auto',
    columnOrder: nextColumnOrder,
    currentRunId: '',
    runIds: [],
    reviewPacketId: '',
    proposalIds: [],
    result: '',
    resultAtIso: '',
    model: input.model?.trim() ?? '',
    thinking: input.thinking ?? 'medium',
    runProfileId,
    dueAtIso: input.dueAtIso ?? '',
    estimateMinutes: input.estimateMinutes ?? null,
    actualMinutes: input.actualMinutes ?? null,
    feedback: [],
    blockedReason: input.blockedReason?.trim() ?? '',
    errorMessage: '',
    archived: false,
    createdAtIso: nowIso,
    updatedAtIso: nowIso,
    version: 1,
  }
  state.tasks[taskId] = task
  return task
}

function createValidatedKanbanConfig(currentConfig: KanbanBoardConfig, input: UpdateKanbanBoardConfigInput): KanbanBoardConfig {
  const nextConfig = {
    ...currentConfig,
    ...input,
    defaults: {
      ...currentConfig.defaults,
      ...input.defaults,
    },
    columns: input.columns ?? currentConfig.columns,
  }
  nextConfig.runProfiles = normalizeKanbanRunProfiles(nextConfig.runProfiles)
  nextConfig.defaultRunProfileId = input.defaultRunProfileId !== undefined
    ? input.defaultRunProfileId.trim()
    : normalizeKanbanRunProfileId(nextConfig.defaultRunProfileId, nextConfig.runProfiles)
  assertKnownKanbanRunProfile(nextConfig.defaultRunProfileId, nextConfig.runProfiles)
  if (nextConfig.defaultRunProfileId === FULL_ACCESS_KANBAN_RUN_PROFILE_ID) {
    throw new Error('Full-access run profile cannot be the board default')
  }
  return nextConfig
}

function assertVersion(task: KanbanTask, version: number): void {
  if (task.version !== version) throw new KanbanVersionConflictError(task)
}

function assertAllowedStatusTransition(fromStatus: KanbanStatus, toStatus: KanbanStatus, options: { allowDoneDragBypass?: boolean } = {}): void {
  if (fromStatus === toStatus) return
  if (toStatus === 'done' && fromStatus !== 'review' && options.allowDoneDragBypass === true) return
  const allowed = ALLOWED_STATUS_TRANSITIONS[fromStatus]
  if (!allowed.includes(toStatus)) {
    throw new KanbanInvalidTransitionError(`Invalid status transition from ${fromStatus} to ${toStatus}`)
  }
}

function readRequiredVersion(input: { version?: unknown } | undefined): number {
  const version = input?.version
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    throw new Error('version is required')
  }
  return version
}

function taskMatchesQuery(task: KanbanTask, query: string): boolean {
  return [
    task.title,
    task.description,
    task.blockedReason,
    ...task.labels.map((label) => label.name),
  ].some((value) => value.toLowerCase().includes(query))
}

function compareTasks(left: KanbanTask, right: KanbanTask, config: KanbanBoardConfig): number {
  const defaultOrder = new Map<KanbanStatus, number>(KANBAN_STATUSES.map((status, index) => [status.id, index]))
  const configOrder = new Map<KanbanStatus, number>()
  config.columns.filter((column) => column.visible).forEach((column, index) => {
    configOrder.set(column.key, index)
  })
  const fallbackStatusOrder = KANBAN_STATUSES.length
  const leftStatusOrder = configOrder.get(left.status) ?? defaultOrder.get(left.status) ?? fallbackStatusOrder
  const rightStatusOrder = configOrder.get(right.status) ?? defaultOrder.get(right.status) ?? fallbackStatusOrder
  return leftStatusOrder - rightStatusOrder
    || left.columnOrder - right.columnOrder
    || right.updatedAtIso.localeCompare(left.updatedAtIso)
}

export function resolveEffectiveKanbanExecutionPolicy(policy: KanbanExecutionPolicy, config: KanbanBoardConfig): KanbanExecutionPolicy {
  const executionMode = config.executionMode
  return {
    ...policy,
    executionMode,
    executionEnabled: policy.enabled && executionMode !== 'disabled',
  }
}
