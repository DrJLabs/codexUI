import { computed, ref, type Ref } from 'vue'
import {
  archiveKanbanTask,
  approveKanbanProposal,
  createKanbanProposal,
  createKanbanTask,
  interruptKanbanRun,
  loadKanbanState,
  loadKanbanRunLogs,
  listKanbanProposals,
  listKanbanTasks,
  regenerateKanbanReviewPacket,
  replaceKanbanAcceptanceCriteria,
  reorderKanbanTask,
  rejectKanbanProposal,
  setKanbanTaskStatus,
  startKanbanTaskRun,
  subscribeKanbanEvents,
  updateKanbanConfig,
  updateKanbanTask,
} from '../api/kanbanGateway'
import { KANBAN_STATUSES, type CreateKanbanProposalInput, type CreateKanbanTaskInput, type KanbanActor, type KanbanBoardColumn, type KanbanBoardConfig, type KanbanExecutionPolicy, type KanbanPriority, type KanbanProposal, type KanbanProposalStatus, type KanbanStateSnapshot, type KanbanStatus, type KanbanTask, type KanbanTaskListResult, type ListKanbanTasksParams, type ReorderKanbanTaskInput, type ReplaceKanbanAcceptanceCriteriaInput, type ResolveKanbanProposalInput, type UpdateKanbanBoardConfigInput, type UpdateKanbanTaskInput } from '../types/kanban'

const FILTER_STORAGE_KEY = 'codex-web-local.kanban.filters.v1'
const BOARD_REFRESH_EVENT_TYPES = new Set(['task.created', 'task.updated', 'task.status_changed'])
const PROPOSAL_REFRESH_EVENT_TYPES = new Set(['proposal.created', 'proposal.resolved'])

export type KanbanBoardGateway = {
  loadKanbanState: typeof loadKanbanState
  listKanbanTasks: typeof listKanbanTasks
  createKanbanTask: typeof createKanbanTask
  updateKanbanTask: typeof updateKanbanTask
  setKanbanTaskStatus: typeof setKanbanTaskStatus
  archiveKanbanTask: typeof archiveKanbanTask
  reorderKanbanTask: typeof reorderKanbanTask
  updateKanbanConfig: typeof updateKanbanConfig
  replaceKanbanAcceptanceCriteria: typeof replaceKanbanAcceptanceCriteria
  startKanbanTaskRun: typeof startKanbanTaskRun
  interruptKanbanRun: typeof interruptKanbanRun
  loadKanbanRunLogs: typeof loadKanbanRunLogs
  regenerateKanbanReviewPacket: typeof regenerateKanbanReviewPacket
  listKanbanProposals: typeof listKanbanProposals
  createKanbanProposal: typeof createKanbanProposal
  approveKanbanProposal: typeof approveKanbanProposal
  rejectKanbanProposal: typeof rejectKanbanProposal
  subscribeKanbanEvents: typeof subscribeKanbanEvents
}

export type KanbanBoardStorage = Pick<Storage, 'getItem' | 'setItem'> | null

type KanbanFilters = {
  searchQuery: string
  labelNames: string[]
  priorities: KanbanPriority[]
  assignee: KanbanActor | ''
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
  updateKanbanConfig,
  replaceKanbanAcceptanceCriteria,
  startKanbanTaskRun,
  interruptKanbanRun,
  loadKanbanRunLogs,
  regenerateKanbanReviewPacket,
  listKanbanProposals,
  createKanbanProposal,
  approveKanbanProposal,
  rejectKanbanProposal,
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

function sortTaskGroup(tasks: KanbanTask[]): KanbanTask[] {
  return tasks.sort((left, right) => left.columnOrder - right.columnOrder)
}

function sortTasksByStatus(grouped: Record<KanbanStatus, KanbanTask[]>): Record<KanbanStatus, KanbanTask[]> {
  for (const status of KANBAN_STATUSES) {
    sortTaskGroup(grouped[status.id])
  }
  return grouped
}

function readStoredFilters(storage: KanbanBoardStorage): KanbanFilters {
  if (!storage) return { searchQuery: '', labelNames: [], priorities: [], assignee: '' }
  try {
    const raw = storage.getItem(FILTER_STORAGE_KEY)
    if (!raw) return { searchQuery: '', labelNames: [], priorities: [], assignee: '' }
    const parsed = JSON.parse(raw) as Partial<KanbanFilters>
    return {
      searchQuery: typeof parsed.searchQuery === 'string' ? parsed.searchQuery : '',
      labelNames: Array.isArray(parsed.labelNames) ? parsed.labelNames.filter((label): label is string => typeof label === 'string') : [],
      priorities: Array.isArray(parsed.priorities) ? parsed.priorities.filter(isKanbanPriority) : [],
      assignee: typeof parsed.assignee === 'string' && isKanbanActor(parsed.assignee) ? parsed.assignee : '',
    }
  } catch {
    return { searchQuery: '', labelNames: [], priorities: [], assignee: '' }
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

function isKanbanPriority(value: unknown): value is KanbanPriority {
  return value === 'critical' || value === 'high' || value === 'normal' || value === 'low'
}

function isKanbanActor(value: unknown): value is KanbanActor {
  return value === 'operator'
    || value === 'codex:auto'
    || (typeof value === 'string' && value.startsWith('codex:thread:') && value.slice('codex:thread:'.length).trim().length > 0)
}

export function useKanbanBoard(options: UseKanbanBoardOptions = {}) {
  const gateway = options.gateway ?? defaultGateway
  const storage = resolveStorage(options.storage)
  const tasks: Ref<KanbanTask[]> = ref([])
  const config: Ref<KanbanBoardConfig | null> = ref(null)
  const listState: Ref<KanbanTaskListResult | null> = ref(null)
  const storedFilters = readStoredFilters(storage)
  const serverQuery: Ref<ListKanbanTasksParams> = ref({
    q: storedFilters.searchQuery.trim() || undefined,
    label: storedFilters.labelNames.length === 1 ? storedFilters.labelNames[0] : undefined,
    priority: storedFilters.priorities.length > 0 ? storedFilters.priorities : undefined,
    assignee: storedFilters.assignee || undefined,
    limit: 50,
    offset: 0,
  })
  const versionConflict: Ref<KanbanVersionConflictState | null> = ref(null)
  const proposals: Ref<KanbanProposal[]> = ref([])
  const proposalStatus: Ref<KanbanProposalStatus> = ref('pending')
  const proposalErrorMessage = ref('')
  const executionPolicy = ref<KanbanExecutionPolicy | null>(null)
  const runLogsByRunId = ref<Record<string, string>>({})
  const isLoading = ref(false)
  const errorMessage = ref('')
  const selectedTaskId = ref('')
  const filters = ref<KanbanFilters>(storedFilters)
  let proposalLoadSequence = 0
  let boardRefreshSequence = 0
  let boardEventRefreshPending = false
  let proposalEventRefreshPending = false

  const tasksByStatus = computed(() => {
    const grouped = createEmptyTasksByStatus()
    for (const task of tasks.value) {
      if (task.archived) continue
      grouped[task.status].push(task)
    }
    return sortTasksByStatus(grouped)
  })

  const visibleTasksByStatus = computed(() => {
    const grouped = createEmptyTasksByStatus()
    const query = filters.value.searchQuery.trim().toLowerCase()
    const labelNames = new Set(filters.value.labelNames.map((label) => label.toLowerCase()))
    const priorities = new Set(filters.value.priorities)
    const assignee = filters.value.assignee
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
      if (priorities.size > 0 && !priorities.has(task.priority)) continue
      if (assignee && task.assignee !== assignee) continue
      grouped[task.status].push(task)
    }
    return sortTasksByStatus(grouped)
  })

  const countsByStatus = computed(() => Object.fromEntries(
    KANBAN_STATUSES.map((status) => [status.id, tasksByStatus.value[status.id].length]),
  ) as Record<KanbanStatus, number>)

  const columnConfigByStatus = computed(() => {
    const grouped = {} as Record<KanbanStatus, KanbanBoardColumn | null>
    for (const status of KANBAN_STATUSES) {
      grouped[status.id] = config.value?.columns.find((column) => column.key === status.id) ?? null
    }
    return grouped
  })

  const visibleStatuses = computed(() => {
    const currentConfig = config.value
    if (!currentConfig) return [...KANBAN_STATUSES]
    const visibleColumns = currentConfig.columns
      .filter((column) => column.visible)
      .map((column) => ({ id: column.key, title: column.title }))
    return visibleColumns.length > 0 ? visibleColumns : [...KANBAN_STATUSES]
  })

  const assigneeFilterOptions = computed<KanbanActor[]>(() => {
    const options = new Set<KanbanActor>(['operator', 'codex:auto'])
    for (const task of tasks.value) {
      if (task.archived) continue
      if (isKanbanActor(task.assignee)) options.add(task.assignee)
    }
    return Array.from(options)
  })

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

  async function refreshBoardAndTaskList(refreshId = ++boardRefreshSequence): Promise<boolean> {
    const [snapshot, taskList] = await Promise.all([
      gateway.loadKanbanState(),
      gateway.listKanbanTasks(serverQuery.value),
    ])
    if (refreshId !== boardRefreshSequence) return false
    applySnapshot(snapshot)
    listState.value = taskList
    versionConflict.value = null
    return true
  }

  async function loadBoard(): Promise<void> {
    const refreshId = ++boardRefreshSequence
    proposalLoadSequence += 1
    isLoading.value = true
    errorMessage.value = ''
    try {
      const applied = await refreshBoardAndTaskList(refreshId)
      if (!applied) return
      void loadProposalsSafely(proposalStatus.value)
    } catch (error) {
      if (refreshId !== boardRefreshSequence) return
      tasks.value = []
      config.value = null
      listState.value = null
      proposals.value = []
      versionConflict.value = null
      executionPolicy.value = null
      selectedTaskId.value = ''
      errorMessage.value = error instanceof Error ? error.message : 'Failed to load Kanban board'
    } finally {
      if (refreshId === boardRefreshSequence) {
        isLoading.value = false
      }
    }
  }

  async function refreshTaskList(): Promise<KanbanTaskListResult> {
    const taskList = await gateway.listKanbanTasks(serverQuery.value)
    listState.value = taskList
    return taskList
  }

  async function loadProposals(status: KanbanProposalStatus = proposalStatus.value): Promise<KanbanProposal[]> {
    const requestId = ++proposalLoadSequence
    proposalStatus.value = status
    proposalErrorMessage.value = ''
    try {
      const nextProposals = await gateway.listKanbanProposals(status)
      if (requestId !== proposalLoadSequence || proposalStatus.value !== status) {
        return nextProposals
      }
      proposals.value = nextProposals
      return nextProposals
    } catch (error) {
      if (requestId !== proposalLoadSequence || proposalStatus.value !== status) {
        throw error
      }
      proposals.value = []
      proposalErrorMessage.value = error instanceof Error ? error.message : 'Failed to load proposals'
      throw error
    }
  }

  async function loadProposalsSafely(status: KanbanProposalStatus = proposalStatus.value): Promise<KanbanProposal[]> {
    try {
      return await loadProposals(status)
    } catch (error) {
      return []
    }
  }

  async function refreshProposals(): Promise<KanbanProposal[]> {
    return await loadProposals(proposalStatus.value)
  }

  async function createProposal(input: CreateKanbanProposalInput): Promise<KanbanProposal> {
    const proposal = await gateway.createKanbanProposal(input)
    await loadProposalsSafely(proposalStatus.value)
    return proposal
  }

  async function approveProposal(proposalId: string, input?: ResolveKanbanProposalInput): Promise<KanbanProposal> {
    const proposal = input === undefined
      ? await gateway.approveKanbanProposal(proposalId)
      : await gateway.approveKanbanProposal(proposalId, input)
    await Promise.all([
      refreshBoardAndTaskList(),
      loadProposalsSafely(proposalStatus.value),
    ])
    return proposal
  }

  async function rejectProposal(proposalId: string, input?: ResolveKanbanProposalInput): Promise<KanbanProposal> {
    const proposal = input === undefined
      ? await gateway.rejectKanbanProposal(proposalId)
      : await gateway.rejectKanbanProposal(proposalId, input)
    await Promise.all([
      refreshBoardAndTaskList(),
      loadProposalsSafely(proposalStatus.value),
    ])
    return proposal
  }

  function refreshBoardInBackground(): void {
    const refreshId = ++boardRefreshSequence
    void refreshBoardAndTaskList(refreshId).catch((error: unknown) => {
      if (refreshId !== boardRefreshSequence) return
      errorMessage.value = error instanceof Error ? error.message : 'Failed to refresh Kanban board'
    })
  }

  function scheduleBoardEventRefresh(): void {
    if (boardEventRefreshPending) return
    boardEventRefreshPending = true
    queueMicrotask(() => {
      boardEventRefreshPending = false
      refreshBoardInBackground()
    })
  }

  function scheduleProposalEventRefresh(): void {
    if (proposalEventRefreshPending) return
    proposalEventRefreshPending = true
    queueMicrotask(() => {
      proposalEventRefreshPending = false
      void loadProposalsSafely(proposalStatus.value)
    })
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
    const current = findCurrentTask(taskId)
    versionConflict.value = null
    try {
      const task = await gateway.reorderKanbanTask(taskId, { version: current.version, ...input })
      patchTask(task)
      const [snapshot, taskList] = await Promise.all([
        gateway.loadKanbanState(),
        gateway.listKanbanTasks(serverQuery.value),
      ])
      applySnapshot(snapshot)
      listState.value = taskList
      return snapshot.tasks.find((item) => item.id === taskId) ?? task
    } catch (error) {
      captureVersionConflict(taskId, error)
      throw error
    }
  }

  async function updateConfig(input: UpdateKanbanBoardConfigInput): Promise<KanbanBoardConfig> {
    const nextConfig = await gateway.updateKanbanConfig(input)
    config.value = nextConfig
    return nextConfig
  }

  async function replaceCriteria(taskId: string, criteria: ReplaceKanbanAcceptanceCriteriaInput['criteria']): Promise<KanbanTask> {
    return await mutateCurrentTask(taskId, async (task) => await gateway.replaceKanbanAcceptanceCriteria(taskId, {
      version: task.version,
      criteria,
    }))
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
    return gateway.subscribeKanbanEvents((event) => {
      const eventType = typeof event === 'object' && event !== null && 'type' in event && typeof event.type === 'string'
        ? event.type
        : ''
      if (PROPOSAL_REFRESH_EVENT_TYPES.has(eventType)) {
        scheduleProposalEventRefresh()
      }
      if (BOARD_REFRESH_EVENT_TYPES.has(eventType)) {
        scheduleBoardEventRefresh()
      }
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
    serverQuery.value = { ...serverQuery.value, q: searchQuery.trim() || undefined }
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
    serverQuery.value = {
      ...serverQuery.value,
      label: next.size === 1 ? Array.from(next)[0] : undefined,
    }
    persistFilters()
  }

  function setPriorityFilter(priorities: KanbanPriority[]): void {
    const nextPriorities = priorities.filter(isKanbanPriority)
    filters.value = { ...filters.value, priorities: nextPriorities }
    serverQuery.value = { ...serverQuery.value, priority: nextPriorities.length > 0 ? nextPriorities : undefined }
    persistFilters()
  }

  function setAssigneeFilter(assignee: KanbanActor | ''): void {
    const nextAssignee = assignee && isKanbanActor(assignee) ? assignee : ''
    filters.value = { ...filters.value, assignee: nextAssignee }
    serverQuery.value = { ...serverQuery.value, assignee: nextAssignee || undefined }
    persistFilters()
  }

  function clearFilters(): void {
    filters.value = { searchQuery: '', labelNames: [], priorities: [], assignee: '' }
    serverQuery.value = {
      ...serverQuery.value,
      q: undefined,
      label: undefined,
      priority: undefined,
      assignee: undefined,
    }
    persistFilters()
  }

  return {
    tasks,
    tasksByStatus,
    visibleTasksByStatus,
    countsByStatus,
    columnConfigByStatus,
    visibleStatuses,
    assigneeFilterOptions,
    selectedTaskId,
    selectedTask,
    filters,
    config,
    listState,
    serverQuery,
    versionConflict,
    proposals,
    proposalStatus,
    proposalErrorMessage,
    executionPolicy,
    runLogsByRunId,
    isLoading,
    errorMessage,
    loadBoard,
    refreshTaskList,
    loadProposals,
    refreshProposals,
    createProposal,
    approveProposal,
    rejectProposal,
    createTask,
    updateTask,
    archiveTask,
    setTaskStatus,
    reorderTask,
    updateConfig,
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
    setPriorityFilter,
    setAssigneeFilter,
    clearFilters,
  }
}
