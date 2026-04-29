import { computed, ref, type Ref } from 'vue'
import {
  archiveKanbanTask,
  createKanbanTask,
  interruptKanbanRun,
  loadKanbanState,
  loadKanbanRunLogs,
  listKanbanProposals,
  listKanbanTasks,
  regenerateKanbanReviewPacket,
  replaceKanbanAcceptanceCriteria,
  reorderKanbanTask,
  setKanbanTaskStatus,
  startKanbanTaskRun,
  subscribeKanbanEvents,
  updateKanbanTask,
} from '../api/kanbanGateway'
import { KANBAN_STATUSES, type CreateKanbanTaskInput, type KanbanBoardConfig, type KanbanExecutionPolicy, type KanbanProposal, type KanbanStateSnapshot, type KanbanStatus, type KanbanTask, type KanbanTaskListResult, type ListKanbanTasksParams, type ReorderKanbanTaskInput, type ReplaceKanbanAcceptanceCriteriaInput, type UpdateKanbanTaskInput } from '../types/kanban'

const FILTER_STORAGE_KEY = 'codex-web-local.kanban.filters.v1'

export type KanbanBoardGateway = {
  loadKanbanState: typeof loadKanbanState
  listKanbanTasks: typeof listKanbanTasks
  createKanbanTask: typeof createKanbanTask
  updateKanbanTask: typeof updateKanbanTask
  setKanbanTaskStatus: typeof setKanbanTaskStatus
  archiveKanbanTask: typeof archiveKanbanTask
  reorderKanbanTask: typeof reorderKanbanTask
  replaceKanbanAcceptanceCriteria: typeof replaceKanbanAcceptanceCriteria
  startKanbanTaskRun: typeof startKanbanTaskRun
  interruptKanbanRun: typeof interruptKanbanRun
  loadKanbanRunLogs: typeof loadKanbanRunLogs
  regenerateKanbanReviewPacket: typeof regenerateKanbanReviewPacket
  listKanbanProposals: typeof listKanbanProposals
  subscribeKanbanEvents: typeof subscribeKanbanEvents
}

export type KanbanBoardStorage = Pick<Storage, 'getItem' | 'setItem'> | null

type KanbanFilters = {
  searchQuery: string
  labelNames: string[]
}

type UseKanbanBoardOptions = {
  gateway?: KanbanBoardGateway
  storage?: KanbanBoardStorage
}

const defaultGateway: KanbanBoardGateway = {
  loadKanbanState,
  listKanbanTasks,
  createKanbanTask,
  updateKanbanTask,
  setKanbanTaskStatus,
  archiveKanbanTask,
  reorderKanbanTask,
  replaceKanbanAcceptanceCriteria,
  startKanbanTaskRun,
  interruptKanbanRun,
  loadKanbanRunLogs,
  regenerateKanbanReviewPacket,
  listKanbanProposals,
  subscribeKanbanEvents,
}

type KanbanVersionConflictState = {
  taskId: string
  message: string
  serverVersion?: number
  latest?: KanbanTask
}

function createEmptyTasksByStatus(): Record<KanbanStatus, KanbanTask[]> {
  const grouped = {} as Record<KanbanStatus, KanbanTask[]>
  for (const status of KANBAN_STATUSES) {
    grouped[status.id] = []
  }
  return grouped
}

function readStoredFilters(storage: KanbanBoardStorage): KanbanFilters {
  if (!storage) return { searchQuery: '', labelNames: [] }
  try {
    const raw = storage.getItem(FILTER_STORAGE_KEY)
    if (!raw) return { searchQuery: '', labelNames: [] }
    const parsed = JSON.parse(raw) as Partial<KanbanFilters>
    return {
      searchQuery: typeof parsed.searchQuery === 'string' ? parsed.searchQuery : '',
      labelNames: Array.isArray(parsed.labelNames) ? parsed.labelNames.filter((label): label is string => typeof label === 'string') : [],
    }
  } catch {
    return { searchQuery: '', labelNames: [] }
  }
}

function writeStoredFilters(storage: KanbanBoardStorage, filters: KanbanFilters): void {
  if (!storage) return
  try {
    storage.setItem(FILTER_STORAGE_KEY, JSON.stringify(filters))
  } catch {
    // Filter persistence is best-effort UI state only.
  }
}

function resolveStorage(explicitStorage: KanbanBoardStorage | undefined): KanbanBoardStorage {
  if (explicitStorage !== undefined) return explicitStorage
  return typeof window !== 'undefined' ? window.localStorage : null
}

function isKanbanTask(value: unknown): value is KanbanTask {
  return typeof value === 'object'
    && value !== null
    && 'id' in value
    && typeof value.id === 'string'
    && 'version' in value
    && typeof value.version === 'number'
}

export function useKanbanBoard(options: UseKanbanBoardOptions = {}) {
  const gateway = options.gateway ?? defaultGateway
  const storage = resolveStorage(options.storage)
  const tasks: Ref<KanbanTask[]> = ref([])
  const config: Ref<KanbanBoardConfig | null> = ref(null)
  const listState: Ref<KanbanTaskListResult | null> = ref(null)
  const serverQuery: Ref<ListKanbanTasksParams> = ref({ limit: 50, offset: 0 })
  const versionConflict: Ref<KanbanVersionConflictState | null> = ref(null)
  const proposals: Ref<KanbanProposal[]> = ref([])
  const executionPolicy = ref<KanbanExecutionPolicy | null>(null)
  const runLogsByRunId = ref<Record<string, string>>({})
  const isLoading = ref(false)
  const errorMessage = ref('')
  const selectedTaskId = ref('')
  const filters = ref<KanbanFilters>(readStoredFilters(storage))

  const tasksByStatus = computed(() => {
    const grouped = createEmptyTasksByStatus()
    for (const task of tasks.value) {
      if (task.archived) continue
      grouped[task.status].push(task)
    }
    return grouped
  })

  const visibleTasksByStatus = computed(() => {
    const grouped = createEmptyTasksByStatus()
    const query = filters.value.searchQuery.trim().toLowerCase()
    const labelNames = new Set(filters.value.labelNames.map((label) => label.toLowerCase()))
    for (const task of tasks.value) {
      if (task.archived) continue
      if (query) {
        const haystack = [
          task.title,
          task.description,
          ...task.labels.map((label) => label.name),
        ].join('\n').toLowerCase()
        if (!haystack.includes(query)) continue
      }
      if (labelNames.size > 0 && !task.labels.some((label) => labelNames.has(label.name.toLowerCase()))) {
        continue
      }
      grouped[task.status].push(task)
    }
    return grouped
  })

  const countsByStatus = computed(() => Object.fromEntries(
    KANBAN_STATUSES.map((status) => [status.id, tasksByStatus.value[status.id].length]),
  ) as Record<KanbanStatus, number>)

  const selectedTask = computed(() => tasks.value.find((task) => task.id === selectedTaskId.value && !task.archived) ?? null)

  function applySnapshot(snapshot: KanbanStateSnapshot): void {
    tasks.value = snapshot.tasks
    config.value = snapshot.config
    executionPolicy.value = snapshot.policy
    reconcileSelection()
  }

  function patchTask(task: KanbanTask): void {
    const index = tasks.value.findIndex((item) => item.id === task.id)
    if (index >= 0) {
      tasks.value.splice(index, 1, task)
    } else {
      tasks.value.push(task)
    }
    reconcileSelection()
  }

  function reconcileSelection(): void {
    if (selectedTaskId.value && !tasks.value.some((task) => task.id === selectedTaskId.value && !task.archived)) {
      selectedTaskId.value = ''
    }
  }

  async function loadBoard(): Promise<void> {
    isLoading.value = true
    errorMessage.value = ''
    try {
      const [snapshot, taskList, nextProposals] = await Promise.all([
        gateway.loadKanbanState(),
        gateway.listKanbanTasks(serverQuery.value),
        gateway.listKanbanProposals(),
      ])
      applySnapshot(snapshot)
      listState.value = taskList
      proposals.value = nextProposals
      versionConflict.value = null
    } catch (error) {
      tasks.value = []
      config.value = null
      listState.value = null
      proposals.value = []
      versionConflict.value = null
      executionPolicy.value = null
      selectedTaskId.value = ''
      errorMessage.value = error instanceof Error ? error.message : 'Failed to load Kanban board'
    } finally {
      isLoading.value = false
    }
  }

  async function refreshTaskList(): Promise<KanbanTaskListResult> {
    const taskList = await gateway.listKanbanTasks(serverQuery.value)
    listState.value = taskList
    return taskList
  }

  async function refreshProposals(): Promise<KanbanProposal[]> {
    const nextProposals = await gateway.listKanbanProposals()
    proposals.value = nextProposals
    return nextProposals
  }

  async function createTask(input: CreateKanbanTaskInput): Promise<KanbanTask> {
    const task = await gateway.createKanbanTask(input)
    patchTask(task)
    await refreshTaskList()
    selectedTaskId.value = task.id
    return task
  }

  function findCurrentTask(taskId: string): KanbanTask {
    const task = tasks.value.find((item) => item.id === taskId)
    if (!task) throw new Error(`Kanban task not found: ${taskId}`)
    return task
  }

  function captureVersionConflict(taskId: string, error: unknown): void {
    if (!(error instanceof Error)) return
    const details = error as Error & { serverVersion?: unknown; latest?: unknown; error?: unknown; code?: unknown }
    const isConflict = details.message === 'version_conflict'
      || details.error === 'version_conflict'
      || details.code === 'version_conflict'
      || typeof details.serverVersion === 'number'
    if (!isConflict) return
    versionConflict.value = {
      taskId,
      message: details.message,
      serverVersion: typeof details.serverVersion === 'number' ? details.serverVersion : undefined,
      latest: isKanbanTask(details.latest) ? details.latest : undefined,
    }
  }

  async function mutateCurrentTask(taskId: string, mutation: (task: KanbanTask) => Promise<KanbanTask>): Promise<KanbanTask> {
    const current = findCurrentTask(taskId)
    versionConflict.value = null
    try {
      const task = await mutation(current)
      patchTask(task)
      await refreshTaskList()
      return task
    } catch (error) {
      captureVersionConflict(taskId, error)
      throw error
    }
  }

  async function updateTask(taskId: string, patch: UpdateKanbanTaskInput): Promise<KanbanTask> {
    return await mutateCurrentTask(taskId, async (task) => await gateway.updateKanbanTask(taskId, { version: task.version, ...patch }))
  }

  async function archiveTask(taskId: string): Promise<KanbanTask> {
    return await mutateCurrentTask(taskId, async (task) => await gateway.archiveKanbanTask(taskId, task.version))
  }

  async function setTaskStatus(taskId: string, status: KanbanStatus, reason?: string): Promise<KanbanTask> {
    return await mutateCurrentTask(taskId, async (task) => await gateway.setKanbanTaskStatus(taskId, {
      version: task.version,
      status,
      ...(reason === undefined ? {} : { reason }),
    }))
  }

  async function reorderTask(taskId: string, input: Omit<ReorderKanbanTaskInput, 'version'>): Promise<KanbanTask> {
    return await mutateCurrentTask(taskId, async (task) => await gateway.reorderKanbanTask(taskId, { version: task.version, ...input }))
  }

  async function replaceCriteria(taskId: string, criteria: ReplaceKanbanAcceptanceCriteriaInput['criteria']): Promise<KanbanTask> {
    const task = await gateway.replaceKanbanAcceptanceCriteria(taskId, criteria)
    patchTask(task)
    await refreshTaskList()
    return task
  }

  async function addAcceptanceCriterion(taskId: string, text: string): Promise<KanbanTask | null> {
    const task = tasks.value.find((item) => item.id === taskId)
    if (!task) return null
    return await replaceCriteria(taskId, [...task.acceptanceCriteria, { text, checked: false }])
  }

  async function updateAcceptanceCriterion(taskId: string, criterionId: string, patch: { text?: string; checked?: boolean }): Promise<KanbanTask | null> {
    const task = tasks.value.find((item) => item.id === taskId)
    if (!task) return null
    return await replaceCriteria(taskId, task.acceptanceCriteria.map((criterion) => criterion.id === criterionId
      ? { id: criterion.id, text: patch.text ?? criterion.text, checked: patch.checked ?? criterion.checked }
      : { id: criterion.id, text: criterion.text, checked: criterion.checked }))
  }

  async function removeAcceptanceCriterion(taskId: string, criterionId: string): Promise<KanbanTask | null> {
    const task = tasks.value.find((item) => item.id === taskId)
    if (!task) return null
    return await replaceCriteria(taskId, task.acceptanceCriteria
      .filter((criterion) => criterion.id !== criterionId)
      .map((criterion) => ({ id: criterion.id, text: criterion.text, checked: criterion.checked })))
  }

  async function setCriterionChecked(taskId: string, criterionId: string, checked: boolean): Promise<KanbanTask | null> {
    return await updateAcceptanceCriterion(taskId, criterionId, { checked })
  }

  async function startTaskRun(taskId: string): Promise<KanbanTask> {
    const result = await gateway.startKanbanTaskRun(taskId)
    patchTask(result.task)
    await refreshTaskList()
    await refreshRunLog(result.run.id)
    return result.task
  }

  async function interruptTaskRun(runId: string): Promise<KanbanTask | null> {
    const result = await gateway.interruptKanbanRun(runId)
    if (result.task) {
      patchTask(result.task)
      await refreshTaskList()
    }
    await refreshRunLog(result.run.id)
    return result.task
  }

  async function refreshRunLog(runId: string): Promise<string> {
    if (!runId) return ''
    const log = await gateway.loadKanbanRunLogs(runId)
    runLogsByRunId.value = { ...runLogsByRunId.value, [runId]: log }
    return log
  }

  async function regenerateReviewPacket(taskId: string): Promise<KanbanTask> {
    const result = await gateway.regenerateKanbanReviewPacket(taskId)
    patchTask(result.task)
    await refreshTaskList()
    return result.task
  }

  function selectTask(taskId: string): void {
    selectedTaskId.value = taskId
  }

  function clearSelection(): void {
    selectedTaskId.value = ''
  }

  function subscribeToEvents(): () => void {
    return gateway.subscribeKanbanEvents(() => {
      void loadBoard()
    }, {
      onError: () => {
        // Browser EventSource handles reconnects; keep this hook for observability.
      },
    })
  }

  function persistFilters(): void {
    writeStoredFilters(storage, filters.value)
  }

  function setSearchQuery(searchQuery: string): void {
    filters.value = { ...filters.value, searchQuery }
    persistFilters()
  }

  function toggleLabelFilter(labelName: string): void {
    const next = new Set(filters.value.labelNames)
    if (next.has(labelName)) {
      next.delete(labelName)
    } else {
      next.add(labelName)
    }
    filters.value = { ...filters.value, labelNames: Array.from(next) }
    persistFilters()
  }

  function clearFilters(): void {
    filters.value = { searchQuery: '', labelNames: [] }
    persistFilters()
  }

  return {
    tasks,
    tasksByStatus,
    visibleTasksByStatus,
    countsByStatus,
    selectedTaskId,
    selectedTask,
    filters,
    config,
    listState,
    serverQuery,
    versionConflict,
    proposals,
    executionPolicy,
    runLogsByRunId,
    isLoading,
    errorMessage,
    loadBoard,
    refreshTaskList,
    refreshProposals,
    createTask,
    updateTask,
    archiveTask,
    setTaskStatus,
    reorderTask,
    selectTask,
    clearSelection,
    subscribeToEvents,
    addAcceptanceCriterion,
    updateAcceptanceCriterion,
    removeAcceptanceCriterion,
    setCriterionChecked,
    startTaskRun,
    interruptTaskRun,
    refreshRunLog,
    regenerateReviewPacket,
    setSearchQuery,
    toggleLabelFilter,
    clearFilters,
  }
}
