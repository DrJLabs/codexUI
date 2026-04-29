import { describe, expect, it, vi } from 'vitest'
import { useKanbanBoard, type KanbanBoardGateway } from './useKanbanBoard'
import type { KanbanBoardConfig, KanbanExecutionPolicy, KanbanProposal, KanbanStateSnapshot, KanbanTask, KanbanTaskListResult, ListKanbanTasksParams, UpdateKanbanBoardConfigInput } from '../types/kanban'

const policy: KanbanExecutionPolicy = {
  enabled: true,
  executionEnabled: false,
  requireTrustedAccessForExecution: true,
  allowTailscaleAccess: true,
  requireLoopbackForExecution: false,
  disableExecutionWhenRemote: false,
  sandboxMode: 'workspace-write',
  approvalPolicy: 'on-request',
  networkAccess: false,
  allowDangerFullAccess: false,
  allowApprovalNever: false,
  allowAcceptForSession: false,
  useThreadShellCommand: false,
  maxGlobalActiveRuns: 1,
  maxActiveRunsPerRepo: 1,
  maxActiveRunsPerTask: 1,
}

const boardConfig: KanbanBoardConfig = {
  columns: [
    { key: 'backlog', title: 'Backlog', visible: true, wipLimit: null },
    { key: 'ready', title: 'Ready', visible: true, wipLimit: null },
    { key: 'running', title: 'Running', visible: true, wipLimit: null },
    { key: 'review', title: 'Review', visible: true, wipLimit: null },
    { key: 'rework', title: 'Rework', visible: true, wipLimit: null },
    { key: 'done', title: 'Done', visible: true, wipLimit: null },
    { key: 'cancelled', title: 'Cancelled', visible: true, wipLimit: null },
  ],
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

function createTask(overrides: Partial<KanbanTask>): KanbanTask {
  return {
    id: 'task_1',
    boardId: 'board_1',
    title: 'Task',
    description: '',
    status: 'backlog',
    priority: 'normal',
    runState: 'idle',
    labels: [],
    acceptanceCriteria: [],
    projectRoot: '/repo',
    cwd: '/repo',
    baseBranch: '',
    branchName: '',
    worktreeId: '',
    worktreePath: '',
    codexThreadId: '',
    createdBy: 'operator',
    sourceSessionKey: '',
    assignee: 'codex:auto',
    columnOrder: 0,
    currentRunId: '',
    runIds: [],
    reviewPacketId: '',
    proposalIds: [],
    result: '',
    resultAtIso: '',
    model: '',
    thinking: 'medium',
    dueAtIso: '',
    estimateMinutes: null,
    actualMinutes: null,
    feedback: [],
    blockedReason: '',
    errorMessage: '',
    archived: false,
    createdAtIso: '2026-04-28T00:00:00.000Z',
    updatedAtIso: '2026-04-28T00:00:00.000Z',
    version: 1,
    ...overrides,
  }
}

function createState(tasks: KanbanTask[]): KanbanStateSnapshot {
  return {
    schemaVersion: 1,
    board: {
      id: 'board_1',
      title: 'Kanban',
      projectRoot: '/repo',
      createdAtIso: '2026-04-28T00:00:00.000Z',
      updatedAtIso: '2026-04-28T00:00:00.000Z',
    },
    tasks,
    config: boardConfig,
    policy,
    generatedAtIso: '2026-04-28T00:00:00.000Z',
  }
}

function createListResult(items: KanbanTask[], overrides: Partial<KanbanTaskListResult> = {}): KanbanTaskListResult {
  return {
    items,
    total: items.length,
    limit: 50,
    offset: 0,
    hasMore: false,
    ...overrides,
  }
}

function createProposal(overrides: Partial<KanbanProposal> = {}): KanbanProposal {
  return {
    id: 'proposal_1',
    title: 'Proposal',
    description: '',
    status: 'pending',
    createdAtIso: '2026-04-28T00:00:00.000Z',
    updatedAtIso: '2026-04-28T00:00:00.000Z',
    ...overrides,
  }
}

async function flushBoardRefresh(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

function createGateway(state: KanbanStateSnapshot): KanbanBoardGateway {
  let currentState = state
  return {
    loadKanbanState: async () => currentState,
    listKanbanTasks: async (params) => {
      const query = params.q?.trim().toLowerCase() ?? ''
      const matchingTasks = currentState.tasks.filter((task) => {
        if (task.archived) return false
        if (!query) return true
        return [task.title, task.description, ...task.labels.map((label) => label.name)]
          .join('\n')
          .toLowerCase()
          .includes(query)
      })
      const limit = params.limit ?? 50
      const offset = params.offset ?? 0
      return createListResult(matchingTasks.slice(offset, offset + limit), {
        total: matchingTasks.length,
        limit,
        offset,
        hasMore: offset + limit < matchingTasks.length,
      })
    },
    createKanbanTask: async (input) => {
      const task = createTask({ id: 'task_created', title: input.title, description: input.description ?? '' })
      currentState = createState([...currentState.tasks, task])
      return task
    },
    updateKanbanTask: async (taskId, patch) => {
      const task = currentState.tasks.find((item) => item.id === taskId)
      if (!task) throw new Error('missing')
      const updated = { ...task, ...patch, version: task.version + 1 }
      currentState = createState(currentState.tasks.map((item) => item.id === taskId ? updated : item))
      return updated
    },
    setKanbanTaskStatus: async (taskId, input) => {
      const task = currentState.tasks.find((item) => item.id === taskId)
      if (!task) throw new Error('missing')
      const updated = { ...task, status: input.status, version: task.version + 1 }
      currentState = createState(currentState.tasks.map((item) => item.id === taskId ? updated : item))
      return updated
    },
    archiveKanbanTask: async (taskId) => {
      const task = currentState.tasks.find((item) => item.id === taskId)
      if (!task) throw new Error('missing')
      const updated = { ...task, archived: true, version: task.version + 1 }
      currentState = createState(currentState.tasks.map((item) => item.id === taskId ? updated : item))
      return updated
    },
    reorderKanbanTask: async (taskId, input) => {
      const task = currentState.tasks.find((item) => item.id === taskId)
      if (!task) throw new Error('missing')
      const updated = { ...task, status: input.status, columnOrder: input.afterTaskId ? 1 : 0, version: task.version + 1 }
      currentState = createState(currentState.tasks.map((item) => item.id === taskId ? updated : item))
      return updated
    },
    updateKanbanConfig: async (input) => {
      const updated: KanbanBoardConfig = {
        ...currentState.config,
        ...input,
        defaults: {
          ...currentState.config.defaults,
          ...input.defaults,
        },
        columns: input.columns ?? currentState.config.columns,
      }
      currentState = { ...currentState, config: updated }
      return updated
    },
    replaceKanbanAcceptanceCriteria: async (taskId, criteria) => {
      const task = currentState.tasks.find((item) => item.id === taskId)
      if (!task) throw new Error('missing')
      const updated = {
        ...task,
        acceptanceCriteria: criteria.map((criterion, index) => ({
          id: criterion.id ?? `criterion_${index}`,
          text: criterion.text,
          checked: criterion.checked === true,
          createdAtIso: task.createdAtIso,
          updatedAtIso: task.updatedAtIso,
        })),
      }
      currentState = createState(currentState.tasks.map((item) => item.id === taskId ? updated : item))
      return updated
    },
    startKanbanTaskRun: async (taskId) => {
      const task = currentState.tasks.find((item) => item.id === taskId)
      if (!task) throw new Error('missing')
      const run = {
        id: 'run_1',
        taskId,
        state: 'running' as const,
        projectRoot: '/repo',
        worktreePath: '/repo-worktree',
        branchName: 'codexui/task/task-1-task',
        threadId: 'thread_1',
        turnId: 'turn_1',
        logPath: '/tmp/logs.txt',
        eventsPath: '/tmp/events.jsonl',
        errorMessage: '',
        createdAtIso: task.createdAtIso,
        updatedAtIso: task.updatedAtIso,
      }
      const updated = { ...task, status: 'running' as const, runState: 'running' as const, currentRunId: run.id, runIds: [run.id] }
      currentState = createState(currentState.tasks.map((item) => item.id === taskId ? updated : item))
      return { run, task: updated }
    },
    interruptKanbanRun: async (runId) => {
      const task = currentState.tasks.find((item) => item.currentRunId === runId)
      const run = {
        id: runId,
        taskId: task?.id ?? 'task_1',
        state: 'cancelled' as const,
        projectRoot: '/repo',
        worktreePath: '/repo-worktree',
        branchName: 'codexui/task/task-1-task',
        threadId: 'thread_1',
        turnId: 'turn_1',
        logPath: '/tmp/logs.txt',
        eventsPath: '/tmp/events.jsonl',
        errorMessage: '',
        createdAtIso: '2026-04-28T00:00:00.000Z',
        updatedAtIso: '2026-04-28T00:00:00.000Z',
      }
      if (!task) return { run, task: null }
      const updated = { ...task, status: 'cancelled' as const, runState: 'cancelled' as const }
      currentState = createState(currentState.tasks.map((item) => item.id === task.id ? updated : item))
      return { run, task: updated }
    },
    loadKanbanRunLogs: async () => 'log output',
    regenerateKanbanReviewPacket: async (taskId) => {
      const task = currentState.tasks.find((item) => item.id === taskId)
      if (!task) throw new Error('missing')
      const updated = { ...task, reviewPacketId: 'review_packet_1', status: 'review' as const }
      currentState = createState(currentState.tasks.map((item) => item.id === taskId ? updated : item))
      return {
        packet: {
          id: 'review_packet_1',
          taskId,
          runId: task.currentRunId,
          packetHash: 'a'.repeat(64),
          generatedAtIso: task.updatedAtIso,
          baseCommit: 'base',
          headCommit: 'head',
          rawDiffPatch: '',
          summary: { fileCount: 0, addedLineCount: 0, removedLineCount: 0 },
          testResults: [],
          unresolvedProposalIds: [],
        },
        task: updated,
      }
    },
    listKanbanProposals: async () => [],
    subscribeKanbanEvents: () => () => {},
  }
}

type TestKanbanBoardGateway = KanbanBoardGateway & {
  listKanbanTasks: ReturnType<typeof vi.fn<(params: ListKanbanTasksParams) => Promise<KanbanTaskListResult>>>
}

function withTaskListGateway(gateway: KanbanBoardGateway, handler: (params: ListKanbanTasksParams) => Promise<KanbanTaskListResult>): TestKanbanBoardGateway {
  return Object.assign(gateway, {
    listKanbanTasks: vi.fn(handler),
  }) as TestKanbanBoardGateway
}

describe('useKanbanBoard', () => {
  it('loads state and groups tasks by every visible status', async () => {
    const board = useKanbanBoard({
      gateway: createGateway(createState([
        createTask({ id: 'task_backlog', status: 'backlog' }),
        createTask({ id: 'task_ready', status: 'ready' }),
      ])),
      storage: null,
    })

    await board.loadBoard()

    expect(board.tasks.value).toHaveLength(2)
    expect(Object.keys(board.tasksByStatus.value)).toEqual([
      'backlog',
      'ready',
      'running',
      'review',
      'rework',
      'done',
      'cancelled',
    ])
    expect(board.countsByStatus.value.ready).toBe(1)
  })

  it('filters visible tasks by title, description, and label', async () => {
    const board = useKanbanBoard({
      gateway: createGateway(createState([
        createTask({ id: 'task_a', title: 'Backend API', description: 'Persist JSON', labels: [{ id: 'label_api', name: 'API', color: '#2563eb' }] }),
        createTask({ id: 'task_b', title: 'Mobile sheet', description: 'Touch layout', labels: [{ id: 'label_ui', name: 'UI', color: '#16a34a' }] }),
      ])),
      storage: null,
    })

    await board.loadBoard()
    board.setSearchQuery('touch')

    expect(board.visibleTasksByStatus.value.backlog.map((task) => task.id)).toEqual(['task_b'])

    board.setSearchQuery('')
    board.toggleLabelFilter('API')

    expect(board.visibleTasksByStatus.value.backlog.map((task) => task.id)).toEqual(['task_a'])
  })

  it('excludes archived tasks from board groups, filters, and counts', async () => {
    const board = useKanbanBoard({
      gateway: createGateway(createState([
        createTask({ id: 'task_active', status: 'backlog', labels: [{ id: 'label_ui', name: 'UI', color: '#16a34a' }] }),
        createTask({ id: 'task_archived', status: 'backlog', archived: true, labels: [{ id: 'label_ui', name: 'UI', color: '#16a34a' }] }),
      ])),
      storage: null,
    })

    await board.loadBoard()
    board.toggleLabelFilter('UI')

    expect(board.tasksByStatus.value.backlog.map((task) => task.id)).toEqual(['task_active'])
    expect(board.visibleTasksByStatus.value.backlog.map((task) => task.id)).toEqual(['task_active'])
    expect(board.countsByStatus.value.backlog).toBe(1)
  })

  it('selects tasks and patches local state after actions', async () => {
    const board = useKanbanBoard({
      gateway: createGateway(createState([createTask({ id: 'task_a', title: 'Original' })])),
      storage: null,
    })

    await board.loadBoard()
    board.selectTask('task_a')
    await board.updateTask('task_a', { title: 'Updated' })
    await board.setTaskStatus('task_a', 'ready')
    await board.archiveTask('task_a')

    expect(board.tasks.value.find((task) => task.id === 'task_a')).toMatchObject({
      title: 'Updated',
      status: 'ready',
      archived: true,
    })
    expect(board.selectedTaskId.value).toBe('')
    expect(board.selectedTask.value).toBeNull()
  })

  it('exposes board config from the loaded snapshot', async () => {
    const board = useKanbanBoard({
      gateway: createGateway(createState([createTask({ id: 'task_a' })])),
      storage: null,
    })

    await board.loadBoard()

    expect(board.config.value?.proposalPolicy).toBe('confirm')
  })

  it('derives visible statuses from board config and falls back to all statuses without config', async () => {
    const board = useKanbanBoard({
      gateway: createGateway(createState([
        createTask({ id: 'task_backlog', status: 'backlog' }),
        createTask({ id: 'task_ready', status: 'ready' }),
      ])),
      storage: null,
    })

    expect(board.visibleStatuses.value.map((status) => status.id)).toEqual([
      'backlog',
      'ready',
      'running',
      'review',
      'rework',
      'done',
      'cancelled',
    ])

    await board.loadBoard()

    board.config.value = {
      ...boardConfig,
      columns: boardConfig.columns.map((column) => ({
        ...column,
        visible: column.key === 'backlog' || column.key === 'running',
      })),
    }

    expect(board.visibleStatuses.value.map((status) => status.id)).toEqual(['backlog', 'running'])
  })

  it('updates board config through the gateway and patches local config state', async () => {
    const nextConfig: KanbanBoardConfig = {
      ...boardConfig,
      columns: boardConfig.columns.map((column) => column.key === 'running'
        ? { ...column, wipLimit: 2 }
        : column),
      defaults: {
        status: 'ready',
        priority: 'high',
      },
      proposalPolicy: 'auto',
    }
    const gateway = Object.assign(createGateway(createState([createTask({ id: 'task_a' })])), {
      updateKanbanConfig: vi.fn(async (_input: UpdateKanbanBoardConfigInput) => nextConfig),
    })
    const board = useKanbanBoard({ gateway, storage: null })

    await board.loadBoard()
    const updated = await board.updateConfig({
      columns: nextConfig.columns,
      defaults: nextConfig.defaults,
      proposalPolicy: nextConfig.proposalPolicy,
    })

    expect(updated).toEqual(nextConfig)
    expect(board.config.value).toEqual(nextConfig)
    expect(gateway.updateKanbanConfig).toHaveBeenCalledWith({
      columns: nextConfig.columns,
      defaults: nextConfig.defaults,
      proposalPolicy: 'auto',
    })
  })

  it('loads list state from the task list endpoint using the current server query', async () => {
    const snapshotTask = createTask({ id: 'task_snapshot', title: 'Snapshot only', archived: true })
    const listedTask = createTask({ id: 'task_listed', title: 'Listed deploy task' })
    const gateway = withTaskListGateway(createGateway(createState([snapshotTask])), async (params) => createListResult([listedTask], {
      total: 7,
      limit: params.limit ?? 50,
      offset: params.offset ?? 0,
      hasMore: true,
    }))
    const board = useKanbanBoard({ gateway, storage: null })

    board.serverQuery.value = { q: 'deploy', limit: 1, offset: 2 }
    await board.loadBoard()

    expect(gateway.listKanbanTasks).toHaveBeenCalledWith({ q: 'deploy', limit: 1, offset: 2 })
    expect(board.listState.value).toMatchObject({
      items: [listedTask],
      total: 7,
      limit: 1,
      offset: 2,
      hasMore: true,
    })
  })

  it('adds priority and assignee filters to task list loads', async () => {
    const task = createTask({ id: 'task_filtered', priority: 'high', assignee: 'codex:auto' })
    const gateway = withTaskListGateway(createGateway(createState([task])), async (params) => createListResult([task], {
      total: 1,
      limit: params.limit ?? 50,
      offset: params.offset ?? 0,
    }))
    const board = useKanbanBoard({ gateway, storage: null })

    board.setPriorityFilter(['high'])
    board.setAssigneeFilter('codex:auto')
    await board.loadBoard()

    expect(gateway.listKanbanTasks).toHaveBeenCalledWith(expect.objectContaining({
      priority: ['high'],
      assignee: 'codex:auto',
    }))
  })

  it('derives assignee filter options from active tasks with defaults first', async () => {
    const board = useKanbanBoard({
      gateway: createGateway(createState([
        createTask({ id: 'task_operator', assignee: 'operator' }),
        createTask({ id: 'task_thread', assignee: 'codex:thread:019e-active' }),
        createTask({ id: 'task_archived_thread', assignee: 'codex:thread:019e-archived', archived: true }),
      ])),
      storage: null,
    })

    await board.loadBoard()

    expect(board.assigneeFilterOptions.value).toEqual([
      'operator',
      'codex:auto',
      'codex:thread:019e-active',
    ])
  })

  it('refreshes the task list after task mutations', async () => {
    const activeTask = createTask({ id: 'task_a', title: 'Active' })
    let listItems = [activeTask]
    const gateway = withTaskListGateway(createGateway(createState([activeTask])), async () => createListResult(listItems.filter((task) => !task.archived)))
    const archiveKanbanTask = gateway.archiveKanbanTask
    gateway.archiveKanbanTask = async (taskId, version) => {
      const task = await archiveKanbanTask(taskId, version)
      listItems = listItems.map((item) => item.id === task.id ? task : item)
      return task
    }
    const board = useKanbanBoard({ gateway, storage: null })

    await board.loadBoard()
    await board.archiveTask('task_a')

    expect(gateway.listKanbanTasks).toHaveBeenCalledTimes(2)
    expect(board.listState.value?.items).toEqual([])
  })

  it('loads proposals with the board and event refreshes', async () => {
    let emitEvent: (event: unknown) => void = () => {}
    let proposals = [createProposal({ id: 'proposal_initial', title: 'Initial' })]
    const gateway = withTaskListGateway(createGateway(createState([createTask({ id: 'task_a' })])), async () => createListResult([]))
    gateway.listKanbanProposals = vi.fn(async () => proposals)
    gateway.subscribeKanbanEvents = (nextHandler) => {
      emitEvent = nextHandler
      return () => {}
    }
    const board = useKanbanBoard({ gateway, storage: null })

    await board.loadBoard()
    expect(board.proposals.value.map((proposal) => proposal.id)).toEqual(['proposal_initial'])

    const stop = board.subscribeToEvents()
    proposals = [createProposal({ id: 'proposal_refreshed', title: 'Refreshed' })]
    emitEvent({ type: 'task.updated' })
    await flushBoardRefresh()

    expect(board.proposals.value.map((proposal) => proposal.id)).toEqual(['proposal_refreshed'])
    stop()
  })

  it('submits the current task version when updating a task', async () => {
    const task = createTask({ id: 'task_a', title: 'Original', version: 7 })
    const gateway = createGateway(createState([task]))
    gateway.updateKanbanTask = vi.fn(gateway.updateKanbanTask)
    const board = useKanbanBoard({ gateway, storage: null })

    await board.loadBoard()
    await board.updateTask(task.id, { title: 'Renamed' })

    expect(gateway.updateKanbanTask).toHaveBeenCalledWith(task.id, { version: task.version, title: 'Renamed' })
  })

  it('submits the current task version when setting status and archiving', async () => {
    const task = createTask({ id: 'task_a', status: 'backlog', version: 3 })
    const gateway = createGateway(createState([task]))
    gateway.setKanbanTaskStatus = vi.fn(gateway.setKanbanTaskStatus)
    gateway.archiveKanbanTask = vi.fn(gateway.archiveKanbanTask)
    const board = useKanbanBoard({ gateway, storage: null })

    await board.loadBoard()
    const ready = await board.setTaskStatus(task.id, 'ready', 'Queued')
    await board.archiveTask(task.id)

    expect(gateway.setKanbanTaskStatus).toHaveBeenCalledWith(task.id, { version: task.version, status: 'ready', reason: 'Queued' })
    expect(gateway.archiveKanbanTask).toHaveBeenCalledWith(task.id, ready.version)
  })

  it('reorders a task with its current version and patches local state', async () => {
    const task = createTask({ id: 'task_a', status: 'backlog', version: 5 })
    const other = createTask({ id: 'task_b', status: 'ready', version: 2 })
    const gateway = createGateway(createState([task, other]))
    gateway.reorderKanbanTask = vi.fn(gateway.reorderKanbanTask)
    const board = useKanbanBoard({ gateway, storage: null })

    await board.loadBoard()
    const moved = await board.reorderTask(task.id, { status: 'ready', afterTaskId: other.id })

    expect(moved.status).toBe('ready')
    expect(board.tasks.value.find((item) => item.id === task.id)?.status).toBe('ready')
    expect(gateway.reorderKanbanTask).toHaveBeenCalledWith(task.id, { version: task.version, status: 'ready', afterTaskId: other.id })
  })

  it('captures version conflict errors from mutations for inspection', async () => {
    const task = createTask({ id: 'task_a', title: 'Original', version: 4 })
    const conflict = Object.assign(new Error('version_conflict'), {
      serverVersion: 5,
      latest: { ...task, title: 'Server title', version: 5 },
    })
    const board = useKanbanBoard({
      gateway: {
        ...createGateway(createState([task])),
        updateKanbanTask: async () => {
          throw conflict
        },
      },
      storage: null,
    })

    await board.loadBoard()
    await expect(board.updateTask(task.id, { title: 'Renamed' })).rejects.toThrow('version_conflict')

    expect(board.versionConflict.value).toMatchObject({
      taskId: task.id,
      serverVersion: 5,
      latest: { title: 'Server title', version: 5 },
    })
  })

  it('clears stale version conflicts after a successful board refresh', async () => {
    const task = createTask({ id: 'task_a', title: 'Original', version: 4 })
    const conflict = Object.assign(new Error('version_conflict'), {
      serverVersion: 5,
      latest: { ...task, title: 'Server title', version: 5 },
    })
    let shouldConflict = true
    const gateway = withTaskListGateway(createGateway(createState([task])), async () => createListResult([task]))
    gateway.updateKanbanTask = async (taskId, patch) => {
      if (shouldConflict) throw conflict
      return createTask({ id: taskId, title: patch.title ?? task.title, version: 6 })
    }
    const board = useKanbanBoard({ gateway, storage: null })

    await board.loadBoard()
    await expect(board.updateTask(task.id, { title: 'Renamed' })).rejects.toThrow('version_conflict')
    shouldConflict = false
    await board.loadBoard()

    expect(board.versionConflict.value).toBeNull()
  })

  it('starts and interrupts task runs while caching run logs', async () => {
    const board = useKanbanBoard({
      gateway: createGateway(createState([createTask({ id: 'task_a', title: 'Runnable' })])),
      storage: null,
    })

    await board.loadBoard()
    await board.startTaskRun('task_a')
    await board.interruptTaskRun('run_1')

    expect(board.tasks.value.find((task) => task.id === 'task_a')).toMatchObject({
      currentRunId: 'run_1',
      runState: 'cancelled',
      status: 'cancelled',
    })
    expect(board.runLogsByRunId.value.run_1).toBe('log output')
  })

  it('clears stale board state, proposals, and conflicts when loading fails after a prior success', async () => {
    let shouldFail = false
    const task = createTask({ id: 'task_a', version: 3 })
    const conflict = Object.assign(new Error('version_conflict'), {
      serverVersion: 4,
      latest: { ...task, version: 4 },
    })
    const gateway = createGateway(createState([task]))
    const board = useKanbanBoard({
      gateway: {
        ...gateway,
        listKanbanProposals: async () => [createProposal({ id: 'proposal_a' })],
        loadKanbanState: async () => {
          if (shouldFail) throw new Error('offline')
          return await gateway.loadKanbanState()
        },
        updateKanbanTask: async () => {
          throw conflict
        },
      },
      storage: null,
    })

    await board.loadBoard()
    expect(board.proposals.value).toHaveLength(1)
    await expect(board.updateTask(task.id, { title: 'Renamed' })).rejects.toThrow('version_conflict')
    expect(board.versionConflict.value).not.toBeNull()
    board.selectTask(task.id)
    shouldFail = true
    await board.loadBoard()

    expect(board.tasks.value).toEqual([])
    expect(board.executionPolicy.value).toBeNull()
    expect(board.proposals.value).toEqual([])
    expect(board.versionConflict.value).toBeNull()
    expect(board.selectedTaskId.value).toBe('')
    expect(board.errorMessage.value).toBe('offline')
  })

  it('reloads the board when subscribed kanban events arrive', async () => {
    let emitEvent: (event: unknown) => void = () => {}
    let stopCalled = false
    let currentState = createState([createTask({ id: 'task_a', title: 'Original' })])
    const gateway = createGateway(currentState)
    const board = useKanbanBoard({
      gateway: {
        ...gateway,
        loadKanbanState: async () => currentState,
        subscribeKanbanEvents: (nextHandler) => {
          emitEvent = nextHandler
          return () => {
            stopCalled = true
          }
        },
      },
      storage: null,
    })

    await board.loadBoard()
    const stop = board.subscribeToEvents()
    currentState = createState([createTask({ id: 'task_a', title: 'Updated' })])
    emitEvent({ type: 'task.updated' })
    await flushBoardRefresh()

    expect(board.tasks.value[0]?.title).toBe('Updated')
    stop()
    expect(stopCalled).toBe(true)
  })
})
