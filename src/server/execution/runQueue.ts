export type ExecutionRunQueueItem = {
  runId: string
  ownerKey: string
  repoRoot: string
}

export type ExecutionRunQueueLimits = {
  maxGlobalActiveRuns: number
  maxActiveRunsPerRepo: number
  maxActiveRunsPerOwner: number
}

export type ExecutionRunQueueLimitReason = 'global_limit' | 'repo_limit' | 'owner_limit'
export type ExecutionRunQueueReason = ExecutionRunQueueLimitReason

export type ExecutionRunQueueEnqueueResult =
  | { state: 'active'; item: ExecutionRunQueueItem }
  | { state: 'queued'; reason: ExecutionRunQueueLimitReason; item: ExecutionRunQueueItem }

export type ExecutionRunQueueResult = ExecutionRunQueueEnqueueResult

export const DEFAULT_EXECUTION_RUN_QUEUE_LIMITS: ExecutionRunQueueLimits = {
  maxGlobalActiveRuns: 1,
  maxActiveRunsPerRepo: 1,
  maxActiveRunsPerOwner: 1,
}

export class ExecutionRunQueue {
  private readonly limits: ExecutionRunQueueLimits
  private readonly active = new Map<string, ExecutionRunQueueItem>()
  private readonly queued: ExecutionRunQueueItem[] = []

  constructor(limits: Partial<ExecutionRunQueueLimits> = {}) {
    this.limits = {
      maxGlobalActiveRuns: limits.maxGlobalActiveRuns ?? DEFAULT_EXECUTION_RUN_QUEUE_LIMITS.maxGlobalActiveRuns,
      maxActiveRunsPerRepo: limits.maxActiveRunsPerRepo ?? DEFAULT_EXECUTION_RUN_QUEUE_LIMITS.maxActiveRunsPerRepo,
      maxActiveRunsPerOwner: limits.maxActiveRunsPerOwner ?? DEFAULT_EXECUTION_RUN_QUEUE_LIMITS.maxActiveRunsPerOwner,
    }
  }

  enqueue(item: ExecutionRunQueueItem): ExecutionRunQueueEnqueueResult {
    this.assertUniqueRun(item.runId)
    this.assertNoDuplicateQueuedOwner(item.ownerKey)
    const blockReason = this.getBlockReason(item)
    if (!blockReason) {
      this.active.set(item.runId, item)
      return { state: 'active', item }
    }
    this.queued.push(item)
    return { state: 'queued', reason: blockReason, item }
  }

  complete(runId: string): ExecutionRunQueueItem[] {
    this.active.delete(runId)
    return this.promoteEligible()
  }

  cancel(runId: string): ExecutionRunQueueItem[] {
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

  private promoteEligible(): ExecutionRunQueueItem[] {
    const promoted: ExecutionRunQueueItem[] = []
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

  private getBlockReason(item: ExecutionRunQueueItem): ExecutionRunQueueLimitReason | null {
    const activeItems = Array.from(this.active.values())
    if (activeItems.length >= this.limits.maxGlobalActiveRuns) return 'global_limit'
    if (activeItems.filter((active) => active.repoRoot === item.repoRoot).length >= this.limits.maxActiveRunsPerRepo) {
      return 'repo_limit'
    }
    if (activeItems.filter((active) => active.ownerKey === item.ownerKey).length >= this.limits.maxActiveRunsPerOwner) {
      return 'owner_limit'
    }
    return null
  }

  private assertUniqueRun(runId: string): void {
    if (this.active.has(runId) || this.queued.some((item) => item.runId === runId)) {
      throw new Error(`Execution run ${runId} is already queued`)
    }
  }

  private assertNoDuplicateQueuedOwner(ownerKey: string): void {
    if (this.queued.some((item) => item.ownerKey === ownerKey)) {
      throw new Error(`Execution owner ${ownerKey} already has a queued run`)
    }
  }
}
