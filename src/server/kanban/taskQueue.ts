import {
  ExecutionRunQueue,
  type ExecutionRunQueueItem,
  type ExecutionRunQueueLimitReason,
  type ExecutionRunQueueLimits,
} from '../execution/runQueue'

export type KanbanTaskQueueItem = {
  runId: string
  taskId: string
  repoRoot: string
}

export type KanbanTaskQueueLimits = {
  maxGlobalActiveRuns: number
  maxActiveRunsPerRepo: number
  maxActiveRunsPerTask: number
}

export type KanbanTaskQueueEnqueueResult =
  | { state: 'active'; item: KanbanTaskQueueItem }
  | { state: 'queued'; reason: 'global_limit' | 'repo_limit' | 'task_limit'; item: KanbanTaskQueueItem }

const KANBAN_TASK_OWNER_PREFIX = 'kanban:task:'

export class KanbanTaskQueue {
  private readonly queue: ExecutionRunQueue

  constructor(limits: Partial<KanbanTaskQueueLimits> = {}) {
    this.queue = new ExecutionRunQueue(toExecutionLimits(limits))
  }

  enqueue(item: KanbanTaskQueueItem): KanbanTaskQueueEnqueueResult {
    try {
      const result = this.queue.enqueue(toExecutionItem(item))
      if (result.state === 'active') {
        return { state: 'active', item: toKanbanItem(result.item) }
      }
      return { state: 'queued', reason: toKanbanReason(result.reason), item: toKanbanItem(result.item) }
    } catch (error) {
      throw toKanbanQueueError(error, item)
    }
  }

  complete(runId: string): KanbanTaskQueueItem[] {
    return this.queue.complete(runId).map(toKanbanItem)
  }

  cancel(runId: string): KanbanTaskQueueItem[] {
    return this.queue.cancel(runId).map(toKanbanItem)
  }

  getActiveRunIds(): string[] {
    return this.queue.getActiveRunIds()
  }

  getQueuedRunIds(): string[] {
    return this.queue.getQueuedRunIds()
  }
}

function toExecutionLimits(limits: Partial<KanbanTaskQueueLimits>): Partial<ExecutionRunQueueLimits> {
  return {
    maxGlobalActiveRuns: limits.maxGlobalActiveRuns,
    maxActiveRunsPerRepo: limits.maxActiveRunsPerRepo,
    maxActiveRunsPerOwner: limits.maxActiveRunsPerTask,
  }
}

function toExecutionItem(item: KanbanTaskQueueItem): ExecutionRunQueueItem {
  return {
    runId: item.runId,
    ownerKey: toKanbanOwnerKey(item.taskId),
    repoRoot: item.repoRoot,
  }
}

function toKanbanItem(item: ExecutionRunQueueItem): KanbanTaskQueueItem {
  return {
    runId: item.runId,
    taskId: fromKanbanOwnerKey(item.ownerKey),
    repoRoot: item.repoRoot,
  }
}

function toKanbanReason(reason: ExecutionRunQueueLimitReason): 'global_limit' | 'repo_limit' | 'task_limit' {
  if (reason === 'owner_limit') return 'task_limit'
  return reason
}

function toKanbanOwnerKey(taskId: string): string {
  return `${KANBAN_TASK_OWNER_PREFIX}${taskId}`
}

function fromKanbanOwnerKey(ownerKey: string): string {
  if (ownerKey.startsWith(KANBAN_TASK_OWNER_PREFIX)) {
    return ownerKey.slice(KANBAN_TASK_OWNER_PREFIX.length)
  }
  return ownerKey
}

function toKanbanQueueError(error: unknown, item: KanbanTaskQueueItem): Error {
  const message = error instanceof Error ? error.message : String(error)
  if (message === `Execution run ${item.runId} is already queued`) {
    return new Error(`Kanban run ${item.runId} is already queued`)
  }
  if (message === `Execution owner ${toKanbanOwnerKey(item.taskId)} already has a queued run`) {
    return new Error(`Kanban task ${item.taskId} already has a queued run`)
  }
  return error instanceof Error ? error : new Error(message)
}
