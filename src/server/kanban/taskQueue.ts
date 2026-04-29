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

const DEFAULT_LIMITS: KanbanTaskQueueLimits = {
  maxGlobalActiveRuns: 1,
  maxActiveRunsPerRepo: 1,
  maxActiveRunsPerTask: 1,
}

export class KanbanTaskQueue {
  private readonly limits: KanbanTaskQueueLimits
  private readonly active = new Map<string, KanbanTaskQueueItem>()
  private readonly queued: KanbanTaskQueueItem[] = []

  constructor(limits: Partial<KanbanTaskQueueLimits> = {}) {
    this.limits = { ...DEFAULT_LIMITS, ...limits }
  }

  enqueue(item: KanbanTaskQueueItem): KanbanTaskQueueEnqueueResult {
    this.assertUniqueRun(item.runId)
    this.assertNoDuplicateQueuedTask(item.taskId)
    const blockReason = this.getBlockReason(item)
    if (!blockReason) {
      this.active.set(item.runId, item)
      return { state: 'active', item }
    }
    this.queued.push(item)
    return { state: 'queued', reason: blockReason, item }
  }

  complete(runId: string): KanbanTaskQueueItem[] {
    this.active.delete(runId)
    return this.promoteEligible()
  }

  cancel(runId: string): KanbanTaskQueueItem[] {
    this.active.delete(runId)
    const queuedIndex = this.queued.findIndex((item) => item.runId === runId)
    if (queuedIndex >= 0) {
      this.queued.splice(queuedIndex, 1)
    }
    return this.promoteEligible()
  }

  getActiveRunIds(): string[] {
    return Array.from(this.active.keys())
  }

  getQueuedRunIds(): string[] {
    return this.queued.map((item) => item.runId)
  }

  private promoteEligible(): KanbanTaskQueueItem[] {
    const promoted: KanbanTaskQueueItem[] = []
    let index = 0
    while (index < this.queued.length) {
      const item = this.queued[index]
      if (!item || this.getBlockReason(item)) {
        index += 1
        continue
      }
      this.queued.splice(index, 1)
      this.active.set(item.runId, item)
      promoted.push(item)
    }
    return promoted
  }

  private getBlockReason(item: KanbanTaskQueueItem): 'global_limit' | 'repo_limit' | 'task_limit' | null {
    const activeItems = Array.from(this.active.values())
    if (activeItems.length >= this.limits.maxGlobalActiveRuns) return 'global_limit'
    if (activeItems.filter((active) => active.repoRoot === item.repoRoot).length >= this.limits.maxActiveRunsPerRepo) return 'repo_limit'
    if (activeItems.filter((active) => active.taskId === item.taskId).length >= this.limits.maxActiveRunsPerTask) return 'task_limit'
    return null
  }

  private assertUniqueRun(runId: string): void {
    if (this.active.has(runId) || this.queued.some((item) => item.runId === runId)) {
      throw new Error(`Kanban run ${runId} is already queued`)
    }
  }

  private assertNoDuplicateQueuedTask(taskId: string): void {
    if (this.queued.some((item) => item.taskId === taskId)) {
      throw new Error(`Kanban task ${taskId} already has a queued run`)
    }
  }
}
