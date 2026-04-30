import { isActiveAutomationRunState } from './runStore'
import { evaluateRruleSchedule } from './scheduleCalculator'
import type { AutomationSchedulerState } from './schedulerStore'
import { AutomationsService, type AutomationSchedulerEntry, type PersistedAutomationActiveRun } from './service'

export class AutomationScheduler {
  private readonly service: AutomationsService
  private readonly intervalMs: number
  private readonly now: () => Date
  private interval: ReturnType<typeof setInterval> | null = null
  private startupRecoveryPromise: Promise<unknown> | null = null
  private activeTick: Promise<void> | null = null

  constructor(options: {
    service: AutomationsService
    intervalMs?: number
    now?: () => Date
  }) {
    this.service = options.service
    this.intervalMs = options.intervalMs ?? 60_000
    this.now = options.now ?? (() => new Date())
  }

  start(): void {
    if (!this.startupRecoveryPromise) {
      this.startupRecoveryPromise = this.service.recoverInterruptedRuns().catch((error) => {
        console.warn('Automation scheduler startup recovery failed:', error)
        throw error
      })
    }
    if (this.interval) return
    this.interval = setInterval(() => {
      void this.tick().catch((error) => {
        console.warn('Automation scheduler tick failed:', error)
      })
    }, this.intervalMs)
  }

  stop(): void {
    if (!this.interval) return
    clearInterval(this.interval)
    this.interval = null
  }

  async tick(): Promise<void> {
    if (this.activeTick) return await this.activeTick
    const activeTick = this.runTick()
      .finally(() => {
        if (this.activeTick === activeTick) this.activeTick = null
      })
    this.activeTick = activeTick
    return await activeTick
  }

  private async runTick(): Promise<void> {
    if (this.startupRecoveryPromise) await this.startupRecoveryPromise
    const nowIso = this.now().toISOString()
    const activeRunIndex = buildActiveRunIndex(await this.service.listPersistedActiveRuns())
    const policy = this.service.getExecutionPolicy()
    const maxGlobalActiveRuns = Number(policy.maxGlobalActiveRuns)
    const maxActiveRunsPerRepo = Number(policy.maxActiveRunsPerRepo)

    for (const entry of await this.service.listSchedulerEntries()) {
      if (entry.definition.status !== 'active') continue

      let schedulerState = entry.schedulerState
      if (!schedulerState) {
        schedulerState = await this.service.refreshSchedulerState(entry.definition.id, nowIso)
      }
      schedulerState = await this.repairIncompleteReservation(entry, schedulerState, nowIso)
      if (schedulerState.unsupportedReason || !schedulerState.nextDueAtIso) continue

      const decision = evaluateRruleSchedule({
        rrule: entry.definition.schedule.rrule,
        nowIso,
        nextDueAtIso: schedulerState.nextDueAtIso,
        anchorIso: entry.definition.updatedAtIso || entry.definition.createdAtIso,
      })
      if (!decision.due || !decision.dueAtIso) continue
      if (activeRunIndex.activeAutomationIds.has(entry.definition.id)) continue
      if (activeRunIndex.globalActiveRuns >= maxGlobalActiveRuns) continue
      const repoKey = repoLimitKey(entry)
      if (repoKey && (activeRunIndex.repoActiveRuns.get(repoKey) ?? 0) >= maxActiveRunsPerRepo) continue

      await this.service.runScheduled(entry.definition.id, {
        dueAtIso: decision.dueAtIso,
        nextDueAtIso: decision.nextDueAtIso,
      })
      activeRunIndex.globalActiveRuns += 1
      activeRunIndex.activeAutomationIds.add(entry.definition.id)
      if (repoKey) {
        activeRunIndex.repoActiveRuns.set(repoKey, (activeRunIndex.repoActiveRuns.get(repoKey) ?? 0) + 1)
      }
    }
  }

  private async repairIncompleteReservation(
    entry: AutomationSchedulerEntry,
    schedulerState: AutomationSchedulerState,
    nowIso: string,
  ): Promise<AutomationSchedulerState> {
    if (!schedulerState.lastScheduledRunId || !schedulerState.lastDueAtIso) return schedulerState
    if (entry.runs.some((run) => run.id === schedulerState.lastScheduledRunId)) return schedulerState
    return await this.service.clearIncompleteSchedulerReservation(
      entry.definition.id,
      schedulerState.lastDueAtIso,
      nowIso,
    )
  }
}

function buildActiveRunIndex(activeRuns: PersistedAutomationActiveRun[]): {
  activeAutomationIds: Set<string>
  repoActiveRuns: Map<string, number>
  globalActiveRuns: number
} {
  const activeAutomationIds = new Set<string>()
  const repoActiveRuns = new Map<string, number>()
  let globalActiveRuns = 0
  for (const activeRun of activeRuns) {
    if (!isActiveAutomationRunState(activeRun.run.state)) continue
    globalActiveRuns += 1
    activeAutomationIds.add(activeRun.automationId)
    if ((activeRun.run.runMode === 'local' || activeRun.run.runMode === 'worktree') && activeRun.run.cwd) {
      repoActiveRuns.set(activeRun.run.cwd, (repoActiveRuns.get(activeRun.run.cwd) ?? 0) + 1)
    }
  }
  return { activeAutomationIds, repoActiveRuns, globalActiveRuns }
}

function repoLimitKey(entry: AutomationSchedulerEntry): string | null {
  const runMode = entry.definition.runMode ?? 'chat'
  if (runMode !== 'local' && runMode !== 'worktree') return null
  return entry.definition.cwd
}
