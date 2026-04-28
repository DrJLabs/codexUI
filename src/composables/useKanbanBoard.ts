import { computed, ref, type Ref } from 'vue'
import {
  archiveKanbanTask,
  createKanbanTask,
  loadKanbanState,
  replaceKanbanAcceptanceCriteria,
  setKanbanTaskStatus,
  subscribeKanbanEvents,
  updateKanbanTask,
} from '../api/kanbanGateway'
import { KANBAN_STATUSES, type CreateKanbanTaskInput, type KanbanExecutionPolicy, type KanbanStateSnapshot, type KanbanStatus, type KanbanTask, type ReplaceKanbanAcceptanceCriteriaInput, type UpdateKanbanTaskInput } from '../types/kanban'

const FILTER_STORAGE_KEY = 'codex-web-local.kanban.filters.v1'

export type KanbanBoardGateway = {
  loadKanbanState: typeof loadKanbanState
  createKanbanTask: typeof createKanbanTask
  updateKanbanTask: typeof updateKanbanTask
  setKanbanTaskStatus: typeof setKanbanTaskStatus
  archiveKanbanTask: typeof archiveKanbanTask
  replaceKanbanAcceptanceCriteria: typeof replaceKanbanAcceptanceCriteria
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
  createKanbanTask,
  updateKanbanTask,
  setKanbanTaskStatus,
  archiveKanbanTask,
  replaceKanbanAcceptanceCriteria,
  subscribeKanbanEvents,
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

export function useKanbanBoard(options: UseKanbanBoardOptions = {}) {
  const gateway = options.gateway ?? defaultGateway
  const storage = resolveStorage(options.storage)
  const tasks: Ref<KanbanTask[]> = ref([])
  const executionPolicy = ref<KanbanExecutionPolicy | null>(null)
  const isLoading = ref(false)
  const errorMessage = ref('')
  const selectedTaskId = ref('')
  const filters = ref<KanbanFilters>(readStoredFilters(storage))

  const tasksByStatus = computed(() => {
    const grouped = createEmptyTasksByStatus()
    for (const task of tasks.value) {
      grouped[task.status].push(task)
    }
    return grouped
  })

  const visibleTasksByStatus = computed(() => {
    const grouped = createEmptyTasksByStatus()
    const query = filters.value.searchQuery.trim().toLowerCase()
    const labelNames = new Set(filters.value.labelNames.map((label) => label.toLowerCase()))
    for (const task of tasks.value) {
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

  const selectedTask = computed(() => tasks.value.find((task) => task.id === selectedTaskId.value) ?? null)

  function applySnapshot(snapshot: KanbanStateSnapshot): void {
    tasks.value = snapshot.tasks
    executionPolicy.value = snapshot.policy
    if (selectedTaskId.value && !tasks.value.some((task) => task.id === selectedTaskId.value)) {
      selectedTaskId.value = ''
    }
  }

  function patchTask(task: KanbanTask): void {
    const index = tasks.value.findIndex((item) => item.id === task.id)
    if (index >= 0) {
      tasks.value.splice(index, 1, task)
      return
    }
    tasks.value.push(task)
  }

  async function loadBoard(): Promise<void> {
    isLoading.value = true
    errorMessage.value = ''
    try {
      applySnapshot(await gateway.loadKanbanState())
    } catch (error) {
      errorMessage.value = error instanceof Error ? error.message : 'Failed to load Kanban board'
    } finally {
      isLoading.value = false
    }
  }

  async function createTask(input: CreateKanbanTaskInput): Promise<KanbanTask> {
    const task = await gateway.createKanbanTask(input)
    patchTask(task)
    selectedTaskId.value = task.id
    return task
  }

  async function updateTask(taskId: string, patch: UpdateKanbanTaskInput): Promise<KanbanTask> {
    const task = await gateway.updateKanbanTask(taskId, patch)
    patchTask(task)
    return task
  }

  async function archiveTask(taskId: string): Promise<KanbanTask> {
    const task = await gateway.archiveKanbanTask(taskId)
    patchTask(task)
    return task
  }

  async function setTaskStatus(taskId: string, status: KanbanStatus, reason?: string): Promise<KanbanTask> {
    const task = await gateway.setKanbanTaskStatus(taskId, status, reason)
    patchTask(task)
    return task
  }

  async function replaceCriteria(taskId: string, criteria: ReplaceKanbanAcceptanceCriteriaInput['criteria']): Promise<KanbanTask> {
    const task = await gateway.replaceKanbanAcceptanceCriteria(taskId, criteria)
    patchTask(task)
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

  function selectTask(taskId: string): void {
    selectedTaskId.value = taskId
  }

  function clearSelection(): void {
    selectedTaskId.value = ''
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
    executionPolicy,
    isLoading,
    errorMessage,
    loadBoard,
    createTask,
    updateTask,
    archiveTask,
    setTaskStatus,
    selectTask,
    clearSelection,
    addAcceptanceCriterion,
    updateAcceptanceCriterion,
    removeAcceptanceCriterion,
    setCriterionChecked,
    setSearchQuery,
    toggleLabelFilter,
    clearFilters,
  }
}
