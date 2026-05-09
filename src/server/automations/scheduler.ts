import { isActiveAutomationRunState } from './runStore'
import { AutomationDeferredRunError } from './errors'
import { evaluateRruleSchedule } from './scheduleCalculator'
import { createAutomationSchedulerLeaseStore } from './schedulerLease'
import type { AutomationSchedulerState } from './schedulerStore'
import { AutomationsService, type AutomationSchedulerEntry, type PersistedAutomationActiveRun } from './service'
import type { AutomationDefinition } from '../../types/automations'

const DEFAULT_MAX_RUNS_PER_TICK = 3

export class AutomationScheduler {
  private readonly service: AutomationsService
  private readonly intervalMs: number
  private readonly now: () => Date
  private readonly shouldRun: () => boolean
  private readonly leaseTtlMs: number | undefined
  private readonly maxRunsPerTick: number
  private interval: ReturnType<typeof setInterval> | null = null
  private startupRecoveryPromise: Promise<unknown> | null = null
  private startupRecoveryRequired = false
  private startupRecoveryComplete = false
  private activeTick: Promise<void> | null = null

  constructor(options: {
    service: AutomationsService
    intervalMs?: number
    now?: () => Date
    shouldRun?: () => boolean
    leaseTtlMs?: number
    maxRunsPerTick?: number
  }) {
    this.service = options.service
    this.intervalMs = options.intervalMs ?? 60_000
    this.now = options.now ?? (() => new Date())
    this.shouldRun = options.shouldRun ?? (() => true)
    this.leaseTtlMs = options.leaseTtlMs
    this.maxRunsPerTick = Number.isFinite(options.maxRunsPerTick) && Number(options.maxRunsPerTick) > 0
      ? Math.floor(Number(options.maxRunsPerTick))
      : DEFAULT_MAX_RUNS_PER_TICK
  }

  start(): void {
    this.startupRecoveryRequired = true
    if (this.shouldRun()) {
      void this.ensureStartupRecovery().catch(() => {})
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
    if (!this.shouldRun()) return
    await this.ensureStartupRecovery()
    const nowIso = this.now().toISOString()
    const activeRunIndex = buildActiveRunIndex(await this.service.listPersistedActiveRuns())
    const policy = this.service.getExecutionPolicy()
    const maxGlobalActiveRuns = Number(policy.maxGlobalActiveRuns)
    const maxActiveRunsPerRepo = Number(policy.maxActiveRunsPerRepo)
    let startedRuns = 0

    for (const entry of await this.service.listSchedulerEntries()) {
      if (startedRuns >= this.maxRunsPerTick) break
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
      const targetCwds = scheduledTargetCwds(entry.definition)
      if (targetCwds.length === 0) continue
      if (activeRunIndex.globalActiveRuns + targetCwds.length > maxGlobalActiveRuns) continue
      if (!hasRepoCapacity(activeRunIndex.repoActiveRuns, targetCwds, maxActiveRunsPerRepo)) continue

      const leaseStore = createAutomationSchedulerLeaseStore(entry.automationDirPath, { ttlMs: this.leaseTtlMs })
      const leaseHandle = await leaseStore.acquire({
        automationId: entry.definition.id,
        sourceDirName: entry.sourceDirName,
        dueAtIso: decision.dueAtIso,
        nowIso,
      })
      if (!leaseHandle) continue

      let current = await this.resolveDueEntry(entry, nowIso)
      if (!current) {
        await leaseHandle.release()
        continue
      }
      const currentTargetCwds = scheduledTargetCwds(current.entry.definition)
      if (
        currentTargetCwds.length === 0 ||
        activeRunIndex.globalActiveRuns + currentTargetCwds.length > maxGlobalActiveRuns ||
        !hasRepoCapacity(activeRunIndex.repoActiveRuns, currentTargetCwds, maxActiveRunsPerRepo)
      ) {
        await leaseHandle.release()
        continue
      }

      try {
        await this.service.runScheduled(current.entry.definition.id, {
          dueAtIso: current.decision.dueAtIso,
          nextDueAtIso: current.decision.nextDueAtIso,
        })
      } catch (error) {
        if (error instanceof AutomationDeferredRunError) continue
        console.warn(`Automation scheduler failed to start ${entry.definition.id}:`, error)
        continue
      } finally {
        await leaseHandle.release()
      }
      activeRunIndex.globalActiveRuns += currentTargetCwds.length
      activeRunIndex.activeAutomationIds.add(current.entry.definition.id)
      for (const currentRepoKey of currentTargetCwds.filter((cwd): cwd is string => Boolean(cwd))) {
        activeRunIndex.repoActiveRuns.set(currentRepoKey, (activeRunIndex.repoActiveRuns.get(currentRepoKey) ?? 0) + 1)
      }
      startedRuns += 1
    }
  }

  private async ensureStartupRecovery(): Promise<void> {
    if (!this.startupRecoveryRequired || this.startupRecoveryComplete) return
    if (!this.startupRecoveryPromise) {
      const startupRecoveryPromise = this.service.recoverInterruptedRuns()
        .then((result) => {
          this.startupRecoveryComplete = true
          return result
        })
        .catch((error) => {
          if (this.startupRecoveryPromise === startupRecoveryPromise) {
            this.startupRecoveryPromise = null
          }
          console.warn('Automation scheduler startup recovery failed:', error)
          throw error
        })
      this.startupRecoveryPromise = startupRecoveryPromise
    }
    await this.startupRecoveryPromise
  }

  private async repairIncompleteReservation(
    entry: AutomationSchedulerEntry,
    schedulerState: AutomationSchedulerState,
    nowIso: string,
  ): Promise<AutomationSchedulerState> {
    if (!schedulerState.lastDueAtIso) return schedulerState
    if (schedulerState.lastScheduledRunId && await this.service.hasRun(entry.definition.id, schedulerState.lastScheduledRunId)) return schedulerState
    if (!schedulerState.lastScheduledRunId && await this.service.hasRunForDue(entry.definition.id, schedulerState.lastDueAtIso)) return schedulerState
    return await this.service.clearIncompleteSchedulerReservation(
      entry.definition.id,
      schedulerState.lastDueAtIso,
      nowIso,
    )
  }

  private async resolveDueEntry(
    entrySnapshot: AutomationSchedulerEntry,
    nowIso: string,
  ): Promise<{
    entry: AutomationSchedulerEntry
    decision: { dueAtIso: string; nextDueAtIso: string | null }
  } | null> {
    const entry = await this.service.readSchedulerEntry(entrySnapshot)
    if (!entry || entry.definition.status !== 'active') return null
    let schedulerState = entry.schedulerState
    if (!schedulerState) {
      schedulerState = await this.service.refreshSchedulerState(entry.definition.id, nowIso)
    }
    schedulerState = await this.repairIncompleteReservation(entry, schedulerState, nowIso)
    if (schedulerState.unsupportedReason || !schedulerState.nextDueAtIso) return null
    const decision = evaluateRruleSchedule({
      rrule: entry.definition.schedule.rrule,
      nowIso,
      nextDueAtIso: schedulerState.nextDueAtIso,
      anchorIso: entry.definition.updatedAtIso || entry.definition.createdAtIso,
    })
    if (!decision.due || !decision.dueAtIso) return null
    return {
      entry,
      decision: {
        dueAtIso: decision.dueAtIso,
        nextDueAtIso: decision.nextDueAtIso,
      },
    }
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

function scheduledTargetCwds(definition: AutomationDefinition): Array<string | null> {
  const runMode = definition.runMode ?? 'chat'
  if (definition.kind !== 'cron' || (runMode !== 'local' && runMode !== 'worktree')) return [null]
  return definition.cwds.map((cwd) => cwd.trim()).filter(Boolean)
}

function hasRepoCapacity(repoActiveRuns: Map<string, number>, targetCwds: Array<string | null>, maxActiveRunsPerRepo: number): boolean {
  const neededByRepo = new Map<string, number>()
  for (const cwd of targetCwds) {
    if (!cwd) continue
    neededByRepo.set(cwd, (neededByRepo.get(cwd) ?? 0) + 1)
  }
  for (const [cwd, needed] of neededByRepo) {
    if ((repoActiveRuns.get(cwd) ?? 0) + needed > maxActiveRunsPerRepo) return false
  }
  return true
}
