import { describe, expect, it } from 'vitest'
import { useKanbanBoard, type KanbanBoardGateway } from './useKanbanBoard'
import type { KanbanExecutionPolicy, KanbanStateSnapshot, KanbanTask } from '../types/kanban'

const policy: KanbanExecutionPolicy = {
  enabled: true,
  executionEnabled: false,
  requireLoopbackForExecution: true,
  disableExecutionWhenRemote: true,
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

function createTask(overrides: Partial<KanbanTask>): KanbanTask {
  return {
    id: 'task_1',
    boardId: 'board_1',
    title: 'Task',
    description: '',
    status: 'backlog',
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
    currentRunId: '',
    runIds: [],
    reviewPacketId: '',
    proposalIds: [],
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
    policy,
    generatedAtIso: '2026-04-28T00:00:00.000Z',
  }
}

function createGateway(state: KanbanStateSnapshot): KanbanBoardGateway {
  let currentState = state
  return {
    loadKanbanState: async () => currentState,
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
    setKanbanTaskStatus: async (taskId, status) => {
      const task = currentState.tasks.find((item) => item.id === taskId)
      if (!task) throw new Error('missing')
      const updated = { ...task, status, version: task.version + 1 }
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
    subscribeKanbanEvents: () => () => {},
  }
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
    expect(board.selectedTask.value).toBeNull()
  })
})
