import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import type { AutomationDefinition, AutomationRun, AutomationRunMode } from '../../types/automations'
import type { CodexRunProfile } from '../../types/execution'
import type { KanbanExecutionPolicy } from '../../types/kanban'
import type { CodexBridgeNotification, CodexBridgeRuntime } from '../codexAppServerBridge'
import { createRestrictedCodexBridgeAdapter, type RestrictedCodexBridgeAdapter } from '../execution/codexBridgeAdapter'
import { resolveCodexTurnStartRunSettings } from '../execution/runProfiles'
import { ManagedWorktreeService } from '../workspaces/managedWorktreeService'
import { AutomationConflictError, AutomationValidationError } from './errors'
import { classifyAutomationRunFailure, classifyAutomationRunResult } from './resultClassifier'
import {
  assertAutomationExecutionPolicy,
  assertAutomationRunProfileAllowed,
  resolveAutomationRunProfile,
  type AutomationRunProfileInput,
} from './policy'
import { listNativeAutomationEntries, type NativeAutomationStoreOptions } from './nativeStore'
import {
  createAutomationRunPaths,
  createAutomationRunStore,
  isActiveAutomationRunState,
} from './runStore'
import { createAutomationSchedulerStore } from './schedulerStore'

export type AutomationRunnerOptions = NativeAutomationStoreOptions & {
  bridge: CodexBridgeRuntime
  policy: KanbanExecutionPolicy
}

const AUTOMATION_BRIDGE_METHODS = ['thread/start', 'thread/resume', 'thread/read', 'turn/start'] as const
let automationRunSequence = 0

export class AutomationRunner {
  private readonly bridge: RestrictedCodexBridgeAdapter
  private readonly policy: KanbanExecutionPolicy
  private readonly options: NativeAutomationStoreOptions
  private readonly locks = new Map<string, Promise<unknown>>()
  private readonly completionLocks = new Map<string, Promise<void>>()
  private readonly ownedActiveRunIds = new Set<string>()

  constructor(options: AutomationRunnerOptions) {
    this.bridge = createRestrictedCodexBridgeAdapter(options.bridge, {
      label: 'Automation runner',
      allowedMethods: AUTOMATION_BRIDGE_METHODS,
    })
    this.policy = options.policy
    this.options = { codexHomeDir: options.codexHomeDir }
    this.bridge.subscribeNotifications((notification) => this.handleBridgeNotification(notification))
  }

  async runNow(input: {
    definition: AutomationDefinition
    automationDirPath: string
  } & AutomationRunProfileInput): Promise<AutomationRun> {
    return await this.withAutomationLock(input.definition.id, async () => {
      return await this.startRun({
        ...input,
        trigger: 'manual',
        dueAtIso: null,
        nextDueAtIso: null,
      })
    })
  }

  async runScheduled(input: {
    definition: AutomationDefinition
    automationDirPath: string
    sourceDirName: string
    dueAtIso: string
    nextDueAtIso: string | null
  } & AutomationRunProfileInput): Promise<AutomationRun> {
    return await this.withAutomationLock(input.definition.id, async () => {
      return await this.startRun({
        ...input,
        trigger: 'schedule',
      })
    })
  }

  private async startRun(input: {
    definition: AutomationDefinition
    automationDirPath: string
    sourceDirName?: string
    trigger: AutomationRun['trigger']
    dueAtIso: string | null
    nextDueAtIso: string | null
  } & AutomationRunProfileInput): Promise<AutomationRun> {
    assertAutomationExecutionPolicy(this.policy)
    const definition = input.definition
    const runMode = definition.runMode ?? 'chat'
    this.validateRunTarget(definition, runMode)
    const runProfileSnapshot = resolveAutomationRunProfile(definition, input)
    assertAutomationRunProfileAllowed(runProfileSnapshot, this.policy)

    const store = createAutomationRunStore(input.automationDirPath)
    await this.failOrphanedActiveRuns(store)
    const activeRun = (await store.listRuns()).find((run) => isActiveAutomationRunState(run.state))
    if (activeRun) {
      const activeTrigger = activeRun.trigger === 'schedule' ? 'scheduled' : 'manual'
      throw new AutomationConflictError(`Automation ${definition.id} already has an active ${activeTrigger} run`)
    }

    const now = new Date().toISOString()
    const eventPrefix = input.trigger === 'schedule' ? 'scheduled_run' : 'manual_run'
    const runId = `automation_run_${Date.now()}_${String(++automationRunSequence).padStart(6, '0')}_${randomUUID()}`
    let run: AutomationRun = {
      id: runId,
      automationId: definition.id,
      automationName: definition.name,
      trigger: input.trigger,
      runMode,
      state: input.trigger === 'schedule' ? 'queued' : 'starting',
      promptSnapshot: definition.prompt,
      scheduleSnapshot: definition.schedule,
      dueAtIso: input.dueAtIso,
      nextDueAtIso: input.nextDueAtIso,
      runProfileId: runProfileSnapshot.id,
      runProfileSnapshot,
      targetThreadId: definition.targetThreadId,
      cwd: runMode === 'local' || runMode === 'worktree' ? definition.cwd : null,
      worktreePath: null,
      branchName: null,
      threadId: null,
      turnId: null,
      resultSummary: null,
      errorMessage: null,
      findings: null,
      inboxTitle: '',
      inboxSummary: '',
      readAtIso: null,
      archivedAtIso: null,
      kanbanTaskId: null,
      reviewPacketId: null,
      proposalIds: [],
      ...createAutomationRunPaths(input.automationDirPath, runId),
      createdAtIso: now,
      startedAtIso: input.trigger === 'schedule' ? null : now,
      completedAtIso: null,
      updatedAtIso: now,
    }
    await store.createRun(run)
    this.ownedActiveRunIds.add(run.id)
    if (input.trigger === 'schedule') {
      await store.appendEvent(run, {
        type: 'scheduled_run.queued',
        automationId: definition.id,
        runMode,
        dueAtIso: input.dueAtIso,
        nextDueAtIso: input.nextDueAtIso,
      })
      await store.appendLog(run, `Scheduled run queued for ${definition.name}`)
      await this.advanceSchedulerForQueuedRun({
        automationDirPath: input.automationDirPath,
        automationId: definition.id,
        sourceDirName: input.sourceDirName ?? definition.storage.nativeDirName ?? definition.id,
        run,
        dueAtIso: input.dueAtIso,
        nextDueAtIso: input.nextDueAtIso,
      })
      const startedAtIso = new Date().toISOString()
      run = await store.updateRun(run.id, {
        state: 'starting',
        startedAtIso,
      })
      await store.appendEvent(run, { type: 'scheduled_run.started', automationId: definition.id, runMode })
      await store.appendLog(run, `Scheduled run started for ${definition.name}`)
    } else {
      await store.appendEvent(run, { type: 'manual_run.started', automationId: definition.id, runMode })
      await store.appendLog(run, `Manual run started for ${definition.name}`)
    }

    try {
      if (runMode === 'worktree') {
        const worktree = await this.createAutomationWorktree(definition, run, store)
        run = await store.updateRun(run.id, {
          worktreePath: worktree.worktreePath,
          branchName: worktree.branchName,
        })
        await store.appendEvent(run, {
          type: `${eventPrefix}.worktree_created`,
          worktreePath: worktree.worktreePath,
          branchName: worktree.branchName,
        })
        await store.appendLog(run, `Managed worktree created: ${worktree.worktreePath}`)
      }
      const threadId = await this.startThread(definition, run)
      const turnId = await this.startTurn(definition, run, threadId, runProfileSnapshot)
      run = await store.updateRun(run.id, {
        state: 'running',
        threadId,
        turnId,
      })
      await store.appendEvent(run, { type: `${eventPrefix}.turn_started`, threadId, turnId })
      await store.appendLog(run, `Turn started: ${turnId}`)
      return run
    } catch (error) {
      const message = error instanceof Error ? error.message : `Automation ${input.trigger} run failed`
      const classification = classifyAutomationRunFailure(message)
      const failedRun = await store.updateRun(run.id, {
        state: classification.state,
        errorMessage: message,
        findings: classification.findings,
        inboxTitle: classification.inboxTitle,
        inboxSummary: classification.inboxSummary,
        readAtIso: null,
        archivedAtIso: null,
        completedAtIso: new Date().toISOString(),
      })
      this.ownedActiveRunIds.delete(run.id)
      await store.appendEvent(failedRun, { type: `${eventPrefix}.failed`, errorMessage: message })
      await store.appendLog(failedRun, `Run failed: ${message}`)
      throw error
    }
  }

  private async advanceSchedulerForQueuedRun(input: {
    automationDirPath: string
    automationId: string
    sourceDirName: string
    run: AutomationRun
    dueAtIso: string | null
    nextDueAtIso: string | null
  }): Promise<void> {
    const store = createAutomationSchedulerStore(input.automationDirPath)
    const current = await store.readOrDefault({
      automationId: input.automationId,
      sourceDirName: input.sourceDirName,
    })
    const nowIso = new Date().toISOString()
    await store.writeState({
      ...current,
      automationId: input.automationId,
      sourceDirName: input.sourceDirName,
      lastDueAtIso: input.dueAtIso,
      nextDueAtIso: input.nextDueAtIso,
      lastScheduledRunId: input.run.id,
      lastEvaluatedAtIso: nowIso,
      updatedAtIso: nowIso,
    })
  }

  private validateRunTarget(definition: AutomationDefinition, runMode: AutomationRunMode): void {
    if (runMode === 'chat' && !definition.targetThreadId) {
      throw new AutomationValidationError('chat automation runs require a targetThreadId')
    }
    if (runMode === 'local' && (!definition.cwd || !isAbsolute(definition.cwd))) {
      throw new AutomationValidationError('local automation runs require an absolute cwd')
    }
    if (runMode === 'worktree' && (!definition.cwd || !isAbsolute(definition.cwd))) {
      throw new AutomationValidationError('worktree automation runs require an absolute cwd')
    }
  }

  private async createAutomationWorktree(
    definition: AutomationDefinition,
    run: AutomationRun,
    store: ReturnType<typeof createAutomationRunStore>,
  ): Promise<{ worktreePath: string; branchName: string }> {
    if (!definition.cwd) throw new AutomationValidationError('worktree automation runs require an absolute cwd')
    const service = new ManagedWorktreeService({
      dataDir: resolveAutomationWorktreeDataDir(this.options),
      projectRoot: definition.cwd,
      isOwnerRunActive: async (lock) => {
        if (lock.owner.source !== 'automation' || lock.owner.id !== definition.id) return true
        try {
          const storedRun = await store.readRun(lock.runId)
          return isActiveAutomationRunState(storedRun.state)
        } catch {
          return true
        }
      },
    })
    return await service.createManagedWorktree({
      owner: { source: 'automation', id: definition.id },
      taskId: definition.id,
      runId: run.id,
      name: definition.name,
    })
  }

  private async startThread(definition: AutomationDefinition, run: AutomationRun): Promise<string> {
    if (run.runMode === 'chat') {
      const resumed = await this.bridge.rpc<Record<string, unknown>>('thread/resume', { threadId: definition.targetThreadId })
      return extractThreadId(resumed) || definition.targetThreadId || ''
    }
    const cwd = resolveRunCwd(definition, run)
    const started = await this.bridge.rpc<Record<string, unknown>>('thread/start', {
      cwd,
      title: definition.name,
    })
    const threadId = extractStartedThreadId(started)
    if (!threadId) throw new Error('thread/start did not return thread id')
    return threadId
  }

  private async startTurn(
    definition: AutomationDefinition,
    run: AutomationRun,
    threadId: string,
    profile: CodexRunProfile,
  ): Promise<string> {
    const cwd = resolveRunCwd(definition, run)
    const runSettings = resolveCodexTurnStartRunSettings(profile, cwd)
    const started = await this.bridge.rpc<Record<string, unknown>>('turn/start', {
      threadId,
      ...(cwd ? { cwd } : {}),
      input: [{ type: 'text', text: definition.prompt }],
      ...runSettings,
    })
    const turnId = extractTurnId(started)
    if (!turnId) throw new Error('turn/start did not return turn id')
    return turnId
  }

  private async handleBridgeNotification(notification: CodexBridgeNotification): Promise<void> {
    if (notification.method !== 'turn/completed') return
    const threadId = extractThreadId(notification.params)
    const turnId = extractTurnId(notification.params)
    if (!threadId || !turnId) return
    const lockKey = `${threadId}:${turnId}`
    const previous = this.completionLocks.get(lockKey) ?? Promise.resolve()
    const next = previous.then(async () => {
      await this.completeMatchingRun(threadId, turnId)
    }).catch((error) => {
      console.warn('Automation turn completion notification failed:', error)
    })
    this.completionLocks.set(lockKey, next)
    await next
    if (this.completionLocks.get(lockKey) === next) this.completionLocks.delete(lockKey)
  }

  private async completeMatchingRun(threadId: string, turnId: string): Promise<void> {
    const match = await this.findActiveRunForTurn(threadId, turnId)
    if (!match) return
    let response: unknown
    try {
      response = await this.bridge.rpc('thread/read', { threadId, includeTurns: true })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Automation completion read failed'
      const classification = classifyAutomationRunFailure(message)
      const failed = await match.store.updateRun(match.run.id, {
        state: classification.state,
        errorMessage: message,
        findings: classification.findings,
        inboxTitle: classification.inboxTitle,
        inboxSummary: classification.inboxSummary,
        readAtIso: null,
        archivedAtIso: null,
        completedAtIso: new Date().toISOString(),
      })
      this.ownedActiveRunIds.delete(match.run.id)
      const eventPrefix = match.run.trigger === 'schedule' ? 'scheduled_run' : 'manual_run'
      await match.store.appendEvent(failed, { type: `${eventPrefix}.failed`, threadId, turnId, errorMessage: message })
      await match.store.appendLog(failed, `Run failed during completion: ${message}`)
      return
    }
    const resultSummary = extractAssistantText(response, turnId)
    const now = new Date().toISOString()
    const classification = classifyAutomationRunResult(resultSummary)
    const completed = await match.store.updateRun(match.run.id, {
      state: classification.state,
      resultSummary,
      findings: classification.findings,
      inboxTitle: classification.inboxTitle,
      inboxSummary: classification.inboxSummary,
      readAtIso: classification.findings ? null : now,
      archivedAtIso: null,
      completedAtIso: now,
      updatedAtIso: now,
    })
    this.ownedActiveRunIds.delete(match.run.id)
    const eventPrefix = match.run.trigger === 'schedule' ? 'scheduled_run' : 'manual_run'
    await match.store.appendEvent(completed, { type: `${eventPrefix}.completed`, threadId, turnId })
    await match.store.appendLog(completed, `${match.run.trigger === 'schedule' ? 'Scheduled' : 'Manual'} run completed ${classification.findings ? 'with findings' : 'with no findings'}`)
  }

  private async findActiveRunForTurn(threadId: string, turnId: string): Promise<{
    run: AutomationRun
    store: ReturnType<typeof createAutomationRunStore>
  } | null> {
    const entries = await listNativeAutomationEntries(this.options)
    for (const entry of entries.records) {
      const store = createAutomationRunStore(entry.automationDirPath)
      const run = (await store.listRuns()).find((candidate) => (
        candidate.threadId === threadId &&
        candidate.turnId === turnId &&
        isActiveAutomationRunState(candidate.state)
      ))
      if (run) return { run, store }
    }
    return null
  }

  private async failOrphanedActiveRuns(store: ReturnType<typeof createAutomationRunStore>): Promise<void> {
    const activeRuns = (await store.listRuns()).filter((run) => isActiveAutomationRunState(run.state))
    for (const run of activeRuns) {
      if (this.ownedActiveRunIds.has(run.id)) continue
      if (run.trigger === 'schedule') continue
      const message = 'Automation manual run was left active by a previous server session'
      const classification = classifyAutomationRunFailure(message)
      const failed = await store.updateRun(run.id, {
        state: classification.state,
        errorMessage: message,
        findings: classification.findings,
        inboxTitle: classification.inboxTitle,
        inboxSummary: classification.inboxSummary,
        readAtIso: null,
        archivedAtIso: null,
        completedAtIso: new Date().toISOString(),
      })
      await store.appendEvent(failed, { type: 'manual_run.recovered_failed', errorMessage: message })
      await store.appendLog(failed, message)
    }
  }

  private async withAutomationLock<T>(automationId: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(automationId) ?? Promise.resolve()
    let release!: () => void
    const current = new Promise<void>((resolve) => {
      release = resolve
    })
    const chained = previous.then(() => current, () => current)
    this.locks.set(automationId, chained)
    await previous.catch(() => {})
    try {
      return await fn()
    } finally {
      release()
      if (this.locks.get(automationId) === chained) this.locks.delete(automationId)
    }
  }
}

function extractThreadId(params: unknown): string {
  const record = asRecord(params)
  if (!record) return ''
  const direct = readString(record.threadId) || readString(record.thread_id)
  if (direct) return direct
  const thread = asRecord(record.thread)
  if (thread) {
    const threadId = readString(thread.id)
    if (threadId) return threadId
  }
  const turn = asRecord(record.turn)
  return turn ? readString(turn.threadId) || readString(turn.thread_id) : ''
}

function extractStartedThreadId(params: unknown): string {
  const record = asRecord(params)
  if (!record) return ''
  return readString(record.threadId)
    || readString(record.thread_id)
    || readString(record.id)
    || readString(asRecord(record.thread)?.id)
}

function extractTurnId(params: unknown): string {
  const record = asRecord(params)
  if (!record) return ''
  const direct = readString(record.turnId) || readString(record.turn_id) || readString(record.id)
  if (direct) return direct
  const turn = asRecord(record.turn)
  return turn ? readString(turn.id) || readString(turn.turnId) || readString(turn.turn_id) : ''
}

function extractAssistantText(response: unknown, turnId: string): string {
  const record = asRecord(response)
  const thread = asRecord(record?.thread)
  const turns = Array.isArray(thread?.turns)
    ? thread.turns
    : Array.isArray(record?.turns) ? record.turns : []
  const matchingTurn = turns.find((turn) => {
    const item = asRecord(turn)
    return readString(item?.id) === turnId || readString(item?.turnId) === turnId
  }) ?? turns.at(-1)
  const turn = asRecord(matchingTurn)
  const items = Array.isArray(turn?.items) ? turn.items : []
  const texts = items.map((item) => {
    const recordItem = asRecord(item)
    if (!recordItem) return ''
    const type = readString(recordItem.type)
    if (type && !['agentMessage', 'assistantMessage', 'message'].includes(type)) return ''
    return readString(recordItem.text) || readString(recordItem.content)
  }).filter(Boolean)
  return texts.join('\n\n').trim()
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function resolveRunCwd(definition: AutomationDefinition, run: AutomationRun): string | undefined {
  if (run.runMode === 'worktree') return run.worktreePath ?? undefined
  if (run.runMode === 'local') return definition.cwd ?? undefined
  return undefined
}

function resolveAutomationWorktreeDataDir(options: NativeAutomationStoreOptions): string {
  const injected = options.codexHomeDir?.trim()
  if (injected) return injected
  const codexHome = process.env.CODEX_HOME?.trim()
  return codexHome && codexHome.length > 0 ? codexHome : join(homedir(), '.codex')
}
