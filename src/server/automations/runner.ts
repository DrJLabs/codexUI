import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import type { AutomationDefinition, AutomationRun, AutomationRunMode } from '../../types/automations'
import type { CodexRunProfile } from '../../types/execution'
import type { CodexBridgeNotification, CodexBridgeRuntime } from '../codexAppServerBridge'
import { createRestrictedCodexBridgeAdapter, type RestrictedCodexBridgeAdapter } from '../execution/codexBridgeAdapter'
import { resolveCodexTurnStartRunSettings } from '../execution/runProfiles'
import { ManagedWorktreeService, ManagedWorktreeUnavailableError } from '../workspaces/managedWorktreeService'
import { AutomationConflictError, AutomationDeferredRunError, AutomationValidationError } from './errors'
import { classifyAutomationRunFailure, classifyAutomationRunResult, stripAutomationInboxDirectives } from './resultClassifier'
import {
  assertAutomationExecutionPolicy,
  assertAutomationRunProfileAllowed,
  resolveAutomationRunProfile,
  type AutomationExecutionPolicy,
  type AutomationRunProfileInput,
} from './policy'
import { buildCronPrompt, buildHeartbeatPrompt } from './prompts'
import {
  buildProjectlessAutomationInstructions,
  createProjectlessAutomationWorkspace,
  isProjectlessCwd,
  type ProjectlessAutomationWorkspace,
} from './projectless'
import { type NativeAutomationEntry, type NativeAutomationStoreOptions } from './nativeStore'
import {
  createAutomationRunPaths,
  createAutomationRunStore,
  isActiveAutomationRunState,
} from './runStore'
import { createAutomationSchedulerStore } from './schedulerStore'
import type { AutomationProjectionAdapter } from './service'
import { parseAutomationSidecarRead, type AutomationSidecarRead } from './schema'
import { resolveCodexHomeDir } from './paths'

export type AutomationRunnerOptions = NativeAutomationStoreOptions & {
  bridge: CodexBridgeRuntime
  policy: AutomationExecutionPolicy
  projectionAdapter?: AutomationProjectionAdapter | null
  projectlessHomeDir?: string
}

const AUTOMATION_BRIDGE_METHODS = ['thread/start', 'thread/resume', 'thread/read', 'turn/start'] as const
const MAX_COMPLETION_LOCK_DEPTH = 25
let automationRunSequence = 0

type IndexedActiveRun = {
  entry: NativeAutomationEntry
  runId: string
  runningRecordReady: Promise<boolean>
}

type HeartbeatRendererState = {
  eligible: boolean
  reason: string | null
  atIso: string
}

export class AutomationRunner {
  private readonly bridge: RestrictedCodexBridgeAdapter
  private readonly policy: AutomationExecutionPolicy
  private readonly options: NativeAutomationStoreOptions & { projectlessHomeDir?: string }
  private readonly projectionAdapter: AutomationProjectionAdapter | null
  private readonly locks = new Map<string, Promise<unknown>>()
  private readonly completionLocks = new Map<string, Promise<void>>()
  private readonly completionLockDepths = new Map<string, number>()
  private readonly ownedActiveRunIds = new Set<string>()
  private readonly activeRunsByTurn = new Map<string, IndexedActiveRun>()
  private readonly heartbeatRendererStatesByThread = new Map<string, HeartbeatRendererState>()
  private readonly unsubscribeNotifications: () => void

  constructor(options: AutomationRunnerOptions) {
    this.bridge = createRestrictedCodexBridgeAdapter(options.bridge, {
      label: 'Automation runner',
      allowedMethods: AUTOMATION_BRIDGE_METHODS,
    })
    this.policy = options.policy
    this.options = { codexHomeDir: options.codexHomeDir, projectlessHomeDir: options.projectlessHomeDir }
    this.projectionAdapter = options.projectionAdapter ?? null
    this.unsubscribeNotifications = this.bridge.subscribeNotifications((notification) => this.handleBridgeNotification(notification))
  }

  dispose(): void {
    this.unsubscribeNotifications()
    this.activeRunsByTurn.clear()
    this.heartbeatRendererStatesByThread.clear()
    this.completionLocks.clear()
    this.completionLockDepths.clear()
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
    cwd?: string | null
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

  ownsActiveRun(runId: string): boolean {
    return this.ownedActiveRunIds.has(runId)
  }

  recordHeartbeatThreadState(input: {
    threadId: string
    eligible: boolean
    reason?: string | null
    atIso?: string | null
  }): void {
    this.heartbeatRendererStatesByThread.set(input.threadId, {
      eligible: input.eligible,
      reason: input.reason ?? null,
      atIso: input.atIso ?? new Date().toISOString(),
    })
  }

  private async startRun(input: {
    definition: AutomationDefinition
    automationDirPath: string
    sourceDirName?: string
    cwd?: string | null
    trigger: AutomationRun['trigger']
    dueAtIso: string | null
    nextDueAtIso: string | null
  } & AutomationRunProfileInput): Promise<AutomationRun> {
    assertAutomationExecutionPolicy(this.policy)
    const baseDefinition = input.definition
    const baseRunMode = baseDefinition.runMode ?? 'chat'
    const requestedCwd = resolveTargetCwd(baseDefinition, baseRunMode, input.cwd)
    const projectlessWorkspace = isProjectlessCwd(requestedCwd)
      ? await createProjectlessAutomationWorkspace({
          prompt: baseDefinition.prompt,
          homeDir: this.options.projectlessHomeDir,
        })
      : null
    const runMode = projectlessWorkspace ? 'local' : baseRunMode
    const targetCwd = projectlessWorkspace?.cwd ?? requestedCwd
    const definition = targetCwd !== baseDefinition.cwd || runMode !== baseRunMode
      ? { ...baseDefinition, cwd: targetCwd, runMode }
      : baseDefinition
    this.validateRunTarget(definition, runMode)
    const runProfileSnapshot = resolveAutomationRunProfile(definition, input)
    assertAutomationRunProfileAllowed(runProfileSnapshot, this.policy)
    if (definition.kind === 'heartbeat') {
      await this.assertHeartbeatEligible(definition)
    }

    const store = createAutomationRunStore(input.automationDirPath)
    await this.failOrphanedActiveRuns(store, definition)
    const activeRun = (await store.listActiveRuns()).find((candidate) => conflictsWithNewRun(candidate, {
      trigger: input.trigger,
      runMode,
      cwd: targetCwd,
    }))
    if (activeRun) {
      const activeTrigger = activeRun.trigger === 'schedule' ? 'scheduled' : 'manual'
      throw new AutomationConflictError(`Automation ${definition.id} already has an active ${activeTrigger} run`)
    }
    const previousRun = (await store.listRuns({ limit: 1 }))[0] ?? null
    const previousRunAtIso = previousRun?.startedAtIso ?? previousRun?.createdAtIso ?? null

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
      cwd: runMode === 'local' || runMode === 'worktree' ? targetCwd : null,
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
    let activeTurnKeyForRun: string | null = null
    let markRunningRecordReady: (ready: boolean) => void = () => {}
    let runtimeDefinition = definition
    try {
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
      if (runMode === 'worktree') {
        const worktree = await this.createAutomationWorktree(definition, run, store)
        if (worktree) {
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
          if (worktree.localEnvironmentSetup) {
            await store.appendEvent(run, {
              type: `${eventPrefix}.local_environment_setup_completed`,
              configPath: worktree.localEnvironmentConfigPath,
              cwd: worktree.localEnvironmentSetup.cwd,
            })
            await store.appendLog(run, `Local environment setup completed: ${worktree.localEnvironmentConfigPath}`)
          }
        } else {
          runtimeDefinition = { ...definition, runMode: 'local' }
          run = await store.updateRun(run.id, {
            runMode: 'local',
            worktreePath: null,
            branchName: null,
          })
          await store.appendEvent(run, { type: `${eventPrefix}.worktree_unavailable_fell_back_to_local` })
          await store.appendLog(run, 'Target is not a git repository; running locally without a managed worktree.')
        }
      }
      const threadId = await this.startThread(runtimeDefinition, run, projectlessWorkspace, runProfileSnapshot)
      const turnId = await this.startTurn(
        runtimeDefinition,
        run,
        threadId,
        runProfileSnapshot,
        previousRunAtIso,
        input.automationDirPath,
      )
      const runningRecordReady = new Promise<boolean>((resolve) => {
        markRunningRecordReady = resolve
      })
      activeTurnKeyForRun = activeRunTurnKey(threadId, turnId)
      this.activeRunsByTurn.set(activeTurnKeyForRun, {
        entry: createNativeEntryForRun(runtimeDefinition, input.automationDirPath, input.sourceDirName),
        runId: run.id,
        runningRecordReady,
      })
      run = await store.updateRun(run.id, {
        state: 'running',
        threadId,
        turnId,
      })
      await store.appendEvent(run, { type: `${eventPrefix}.turn_started`, threadId, turnId })
      await store.appendLog(run, `Turn started: ${turnId}`)
      markRunningRecordReady(true)
      return run
    } catch (error) {
      markRunningRecordReady(false)
      if (activeTurnKeyForRun) this.activeRunsByTurn.delete(activeTurnKeyForRun)
      const message = error instanceof Error ? error.message : `Automation ${input.trigger} run failed`
      const classification = classifyAutomationRunFailure(message)
      try {
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
        await store.appendEvent(failedRun, { type: `${eventPrefix}.failed`, errorMessage: message })
        await store.appendLog(failedRun, `Run failed: ${message}`)
        await this.projectTerminalRun({ definition: runtimeDefinition, store, run: failedRun })
      } catch {
        // Preserve the original startup failure while still releasing in-memory ownership.
      } finally {
        this.ownedActiveRunIds.delete(run.id)
        this.forgetActiveRunTurn(run)
      }
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

  private async assertHeartbeatEligible(definition: AutomationDefinition): Promise<void> {
    const targetThreadId = definition.targetThreadId
    if (!targetThreadId) {
      throw new AutomationValidationError('heartbeat automations require a targetThreadId')
    }
    const rendererState = this.heartbeatRendererStatesByThread.get(targetThreadId)
    if (!rendererState) {
      throw new AutomationDeferredRunError('Heartbeat renderer state has not loaded for target thread', {
        deferMode: 'requires_renderer_state',
      })
    }
    if (rendererState && !rendererState.eligible && isAuthoritativeHeartbeatRendererBlock(rendererState.reason)) {
      throw new AutomationDeferredRunError(rendererState.reason || 'Heartbeat target thread is not eligible in the current renderer state')
    }
    let response: unknown
    try {
      response = await this.bridge.rpc('thread/read', {
        threadId: targetThreadId,
        includeTurns: true,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'thread/read failed'
      throw new AutomationDeferredRunError(`Heartbeat target thread is unavailable: ${message}`)
    }
    const decision = evaluateHeartbeatThreadEligibility(response)
    if (!decision.eligible) {
      throw new AutomationDeferredRunError(decision.reason)
    }
  }

  private async createAutomationWorktree(
    definition: AutomationDefinition,
    run: AutomationRun,
    store: ReturnType<typeof createAutomationRunStore>,
  ): Promise<{
    worktreePath: string
    branchName: string
    localEnvironmentConfigPath: string | null
    localEnvironmentSetup: { cwd: string } | null
  } | null> {
    if (!definition.cwd) throw new AutomationValidationError('worktree automation runs require an absolute cwd')
    const service = new ManagedWorktreeService({
      dataDir: resolveCodexHomeDir(this.options),
      projectRoot: definition.cwd,
      isOwnerRunActive: async (lock) => {
        if (lock.owner.source !== 'automation' || lock.owner.id !== definition.id) return true
        try {
          const storedRun = await store.readRun(lock.runId)
          return isActiveAutomationRunState(storedRun.state)
        } catch (error) {
          if (isMissingFileError(error)) return false
          return true
        }
      },
    })
    try {
      return await service.createManagedWorktree({
        owner: { source: 'automation', id: definition.id },
        taskId: definition.id,
        runId: run.id,
        name: definition.name,
        localEnvironmentConfigPath: definition.localEnvironmentConfigPath,
      })
    } catch (error) {
      if (error instanceof ManagedWorktreeUnavailableError) return null
      throw error
    }
  }

  private async startThread(
    definition: AutomationDefinition,
    run: AutomationRun,
    projectlessWorkspace: ProjectlessAutomationWorkspace | null,
    profile: CodexRunProfile,
  ): Promise<string> {
    if (run.runMode === 'chat') {
      const resumed = await this.bridge.rpc<Record<string, unknown>>('thread/resume', { threadId: definition.targetThreadId })
      return extractThreadId(resumed) || definition.targetThreadId || ''
    }
    const cwd = resolveRunCwd(definition, run)
    const started = await this.bridge.rpc<Record<string, unknown>>('thread/start', {
      cwd,
      title: definition.name,
      ...(definition.kind === 'cron' && profile.model.trim() ? { model: profile.model.trim() } : {}),
      ...(projectlessWorkspace
        ? { developerInstructions: buildProjectlessAutomationInstructions(projectlessWorkspace.outputDirectory) }
        : {}),
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
    previousRunAtIso: string | null,
    automationDirPath: string,
  ): Promise<string> {
    const cwd = resolveRunCwd(definition, run)
    const automationMemoryPath = join(automationDirPath, 'memory.md')
    const runSettings = resolveCodexTurnStartRunSettings(
      profile,
      cwd,
      definition.kind === 'cron' ? [automationDirPath] : [],
    )
    const turnRunSettings = definition.kind === 'heartbeat'
      ? withDesktopDefaultModelAndEffort(runSettings)
      : runSettings
    const promptText = definition.kind === 'heartbeat'
      ? buildHeartbeatPrompt({
          automationId: definition.id,
          nowIso: new Date().toISOString(),
          prompt: definition.prompt,
        })
      : buildCronPrompt({
          automationId: definition.id,
          automationName: definition.name,
          automationMemoryPath,
          lastRunAtIso: previousRunAtIso,
          prompt: definition.prompt,
        })
    const started = await this.bridge.rpc<Record<string, unknown>>('turn/start', {
      threadId,
      ...(cwd ? { cwd } : {}),
      input: [{ type: 'text', text: promptText }],
      ...turnRunSettings,
    })
    const turnId = extractTurnId(started)
    if (!turnId) throw new Error('turn/start did not return turn id')
    return turnId
  }

  private async handleBridgeNotification(notification: CodexBridgeNotification): Promise<void> {
    if (notification.method === 'heartbeat-automation-thread-state-changed') {
      this.recordHeartbeatRendererState(notification)
      return
    }
    if (notification.method !== 'turn/completed') return
    const threadId = extractThreadId(notification.params)
    const turnId = extractTurnId(notification.params)
    if (!threadId || !turnId) return
    const lockKey = `${threadId}:${turnId}`
    const depth = (this.completionLockDepths.get(lockKey) ?? 0) + 1
    if (depth > MAX_COMPLETION_LOCK_DEPTH) {
      console.warn(`Automation turn completion notification queue exceeded ${MAX_COMPLETION_LOCK_DEPTH} for ${lockKey}; dropping duplicate notification`)
      return
    }
    this.completionLockDepths.set(lockKey, depth)
    const previous = this.completionLocks.get(lockKey) ?? Promise.resolve()
    const next = previous.then(async () => {
      await this.completeMatchingRun(threadId, turnId)
    }).catch((error) => {
      console.warn('Automation turn completion notification failed:', error)
    })
    this.completionLocks.set(lockKey, next)
    try {
      await next
    } finally {
      const remainingDepth = (this.completionLockDepths.get(lockKey) ?? 1) - 1
      if (remainingDepth > 0) this.completionLockDepths.set(lockKey, remainingDepth)
      else this.completionLockDepths.delete(lockKey)
      if (this.completionLocks.get(lockKey) === next) this.completionLocks.delete(lockKey)
    }
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
      try {
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
        const eventPrefix = match.run.trigger === 'schedule' ? 'scheduled_run' : 'manual_run'
        await match.store.appendEvent(failed, { type: `${eventPrefix}.failed`, threadId, turnId, errorMessage: message })
        await match.store.appendLog(failed, `Run failed during completion: ${message}`)
        const definition = await this.createProjectionDefinition(match.entry, failed)
        await this.projectTerminalRun({ definition, store: match.store, run: failed })
      } finally {
        this.ownedActiveRunIds.delete(match.run.id)
        this.activeRunsByTurn.delete(activeRunTurnKey(threadId, turnId))
      }
      return
    }
    const extracted = extractAssistantText(response, turnId)
    const resultSummary = stripAutomationInboxDirectives(extracted.text)
    const now = new Date().toISOString()
    const classification = classifyAutomationRunResult(extracted.text)
    try {
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
      const eventPrefix = match.run.trigger === 'schedule' ? 'scheduled_run' : 'manual_run'
      if (extracted.warning) {
        await match.store.appendEvent(completed, {
          type: `${eventPrefix}.completion_warning`,
          threadId,
          turnId,
          message: extracted.warning,
        })
        await match.store.appendLog(completed, `Completion warning: ${extracted.warning}`)
      }
      await match.store.appendEvent(completed, { type: `${eventPrefix}.completed`, threadId, turnId })
      await match.store.appendLog(completed, `${match.run.trigger === 'schedule' ? 'Scheduled' : 'Manual'} run completed ${classification.findings ? 'with findings' : 'with no findings'}`)
      const definition = await this.createProjectionDefinition(match.entry, completed)
      await this.projectTerminalRun({ definition, store: match.store, run: completed })
    } finally {
      this.ownedActiveRunIds.delete(match.run.id)
      this.activeRunsByTurn.delete(activeRunTurnKey(threadId, turnId))
    }
  }

  private async findActiveRunForTurn(threadId: string, turnId: string): Promise<{
    entry: NativeAutomationEntry
    run: AutomationRun
    store: ReturnType<typeof createAutomationRunStore>
  } | null> {
    const key = activeRunTurnKey(threadId, turnId)
    const indexed = this.activeRunsByTurn.get(key)
    if (!indexed) return null
    if (!await indexed.runningRecordReady || this.activeRunsByTurn.get(key) !== indexed) {
      this.activeRunsByTurn.delete(key)
      return null
    }
    const store = createAutomationRunStore(indexed.entry.automationDirPath)
    try {
      const run = await store.readRun(indexed.runId)
      if (
        run.threadId === threadId &&
        run.turnId === turnId &&
        isActiveAutomationRunState(run.state)
      ) {
        return { entry: indexed.entry, run, store }
      }
    } catch {
      // Stale in-memory entries are discarded below.
    }
    this.activeRunsByTurn.delete(key)
    return null
  }

  private forgetActiveRunTurn(run: AutomationRun): void {
    if (!run.threadId || !run.turnId) return
    this.activeRunsByTurn.delete(activeRunTurnKey(run.threadId, run.turnId))
  }

  private async projectTerminalRun(input: {
    definition: AutomationDefinition
    store: ReturnType<typeof createAutomationRunStore>
    run: AutomationRun
  }): Promise<AutomationRun> {
    if (!this.projectionAdapter?.projectRun || input.run.kanbanTaskId) return input.run
    try {
      const result = await this.projectionAdapter.projectRun({
        definition: input.definition,
        run: input.run,
      })
      if (!result.taskId) return input.run
      return await input.store.updateRun(input.run.id, {
        kanbanTaskId: result.taskId,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Kanban projection failed'
      await input.store.appendEvent(input.run, {
        type: 'automation_projection.failed',
        errorMessage: message,
      })
      await input.store.appendLog(input.run, `Kanban projection failed: ${message}`)
      return input.run
    }
  }

  private async createProjectionDefinition(entry: NativeAutomationEntry, run: AutomationRun): Promise<AutomationDefinition> {
    const sidecar = await readProjectionSidecar(entry)
    const createdAtIso = dateIso(entry.record.createdAtMs)
    const updatedAtIso = dateIso(entry.record.updatedAtMs)
    return {
      id: entry.record.id,
      kind: entry.record.kind,
      source: 'native',
      nativeId: entry.record.id,
      name: entry.record.name,
      description: sidecar.description,
      prompt: entry.record.prompt,
      status: automationStatusForView(entry.record.status),
      legacyStatus: entry.record.status,
      schedule: { type: 'rrule', rrule: entry.record.rrule, rawRrule: `${entry.record.rrulePrefix ?? ''}${entry.record.rrule}` },
      targetThreadId: entry.record.targetThreadId,
      projectRoot: null,
      cwd: entry.record.cwd,
      cwds: entry.record.cwds,
      runMode: entry.record.runMode,
      model: entry.record.model,
      reasoningEffort: entry.record.reasoningEffort,
      localEnvironmentConfigPath: entry.record.localEnvironmentConfigPath,
      autoArchiveNoFindings: false,
      notifyOnFindings: false,
      kanbanProjection: sidecar.kanbanProjection,
      notes: sidecar.notes,
      storage: {
        nativeDirName: entry.sourceDirName,
        nativePath: entry.automationTomlPath,
        sidecarPath: join(entry.automationDirPath, 'codexui.local.json'),
        memoryPath: join(entry.automationDirPath, 'memory.md'),
      },
      createdAtIso,
      updatedAtIso,
      lastRunAtIso: run.startedAtIso ?? run.createdAtIso,
      nextRunAtIso: null,
      recentRuns: [run],
      version: 1,
    }
  }

  private async failOrphanedActiveRuns(
    store: ReturnType<typeof createAutomationRunStore>,
    definition: AutomationDefinition,
  ): Promise<void> {
    const activeRuns = await store.listActiveRuns()
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
      await this.projectTerminalRun({ definition, store, run: failed })
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

  private recordHeartbeatRendererState(notification: CodexBridgeNotification): void {
    const record = asRecord(notification.params)
    const threadId = extractThreadId(notification.params)
    if (!record || !threadId) return
    const eligible = readBoolean(record.eligible)
      ?? readBoolean(record.isEligible)
      ?? readBoolean(record.canRun)
      ?? (readHeartbeatStatus(record) === 'eligible' ? true : readHeartbeatStatus(record) === 'ineligible' ? false : null)
    if (eligible === null) return
    const reason = readString(record.reason)
      || readString(record.blockedReason)
      || readString(record.ineligibleReason)
      || null
    this.recordHeartbeatThreadState({
      threadId,
      eligible,
      reason,
      atIso: notification.atIso,
    })
  }
}

function extractThreadId(params: unknown): string {
  const record = asRecord(params)
  if (!record) return ''
  const direct = readString(record.threadId) || readString(record.thread_id)
  if (direct) return direct
  const thread = asRecord(record.thread)
  if (thread) {
    const threadId = readString(thread.id) || readString(thread.threadId) || readString(thread.thread_id)
    if (threadId) return threadId
  }
  const turn = asRecord(record.turn)
  return turn ? readString(turn.threadId) || readString(turn.thread_id) : ''
}

function evaluateHeartbeatThreadEligibility(response: unknown): { eligible: true } | { eligible: false; reason: string } {
  const record = asRecord(response)
  if (!record) return { eligible: false, reason: 'Heartbeat target thread is unavailable' }
  const thread = asRecord(record.thread)
  if (!thread) return { eligible: false, reason: 'Heartbeat target thread is unavailable' }

  const pendingState = readHeartbeatPendingState(thread) || readHeartbeatPendingState(record)
  if (pendingState === 'approval') {
    return { eligible: false, reason: 'Heartbeat target thread is waiting for approval' }
  }
  if (pendingState === 'response') {
    return { eligible: false, reason: 'Heartbeat target thread is waiting for user input' }
  }

  const threadStatus = readHeartbeatThreadStatus(thread) || readHeartbeatThreadStatus(record)
  if (isHeartbeatBusyStatus(threadStatus)) {
    return { eligible: false, reason: 'Heartbeat target thread is busy' }
  }

  const turns = Array.isArray(thread.turns)
    ? thread.turns
    : Array.isArray(record.turns) ? record.turns : []
  for (const turn of turns) {
    const turnStatus = readString(asRecord(turn)?.status)
    if (isHeartbeatBusyStatus(turnStatus)) {
      return { eligible: false, reason: 'Heartbeat target thread has an active turn' }
    }
  }

  return { eligible: true }
}

function readHeartbeatPendingState(record: Record<string, unknown>): 'approval' | 'response' | '' {
  const direct = normalizeHeartbeatStatus(
    readString(record.pendingRequestState)
    || readString(record.pending_request_state)
    || readString(record.pendingState)
    || readString(record.pending_state),
  )
  if (direct.includes('approval')) return 'approval'
  if (direct.includes('response') || direct.includes('input') || direct.includes('user')) return 'response'

  const pending = asRecord(record.pendingRequest) ?? asRecord(record.pending_request) ?? asRecord(record.pending)
  if (!pending) return ''
  const nested = normalizeHeartbeatStatus(
    readString(pending.type)
    || readString(pending.kind)
    || readString(pending.state)
    || readString(pending.status),
  )
  if (nested.includes('approval')) return 'approval'
  if (nested.includes('response') || nested.includes('input') || nested.includes('user')) return 'response'
  return ''
}

function readHeartbeatThreadStatus(record: Record<string, unknown>): string {
  const direct = typeof record.status === 'string'
    ? readString(record.status)
    : readString(record.state)
  if (direct) return direct
  const status = asRecord(record.status)
  return status
    ? readString(status.type) || readString(status.kind) || readString(status.state) || readString(status.status)
    : ''
}

function readHeartbeatStatus(record: Record<string, unknown>): string {
  return normalizeHeartbeatStatus(
    readString(record.status)
    || readString(record.state)
    || readString(record.eligibility)
    || readString(record.heartbeatStatus),
  )
}

function isAuthoritativeHeartbeatRendererBlock(reason: string | null): boolean {
  const normalized = normalizeHeartbeatStatus(reason ?? '')
  if (!normalized) return true
  if (
    normalized.includes('collaboration') ||
    normalized.includes('mode') ||
    normalized.includes('renderer')
  ) {
    return true
  }
  if (
    normalized.includes('busy') ||
    normalized.includes('approval') ||
    normalized.includes('input') ||
    normalized.includes('response') ||
    normalized.includes('waitingforuser') ||
    normalized.includes('readfailed') ||
    normalized.includes('threadreadfailed') ||
    normalized.includes('threadunavailable') ||
    normalized.includes('threadnotfound') ||
    normalized.includes('threadmissing') ||
    normalized.includes('transcriptmissing')
  ) {
    return false
  }
  return true
}

function isHeartbeatBusyStatus(status: string): boolean {
  const normalized = normalizeHeartbeatStatus(status)
  if (!normalized || normalized === 'idle' || normalized === 'ready') return false
  const terminalStatuses = new Set(['completed', 'complete', 'failed', 'declined', 'interrupted', 'cancelled', 'canceled', 'done', 'succeeded', 'success'])
  return !terminalStatuses.has(normalized)
}

function normalizeHeartbeatStatus(status: string): string {
  return status.trim().toLowerCase().replace(/[\s_-]+/gu, '')
}

async function readProjectionSidecar(entry: NativeAutomationEntry): Promise<AutomationSidecarRead> {
  let raw: string
  try {
    raw = await readFile(join(entry.automationDirPath, 'codexui.local.json'), 'utf8')
  } catch (error) {
    if (!isMissingFileError(error)) throw error
    try {
      raw = await readFile(join(entry.automationDirPath, 'codexui.json'), 'utf8')
    } catch (legacyError) {
      if (isMissingFileError(legacyError)) return defaultProjectionSidecar()
      throw legacyError
    }
  }
  try {
    const parsed = JSON.parse(raw) as unknown
    return parseAutomationSidecarRead(parsed).sidecar
  } catch {
    return defaultProjectionSidecar()
  }
}

function defaultProjectionSidecar(): AutomationSidecarRead {
  return {
    description: null,
    kanbanProjection: { mode: 'off' },
    notes: '',
  }
}

function dateIso(value: number | null): string {
  return new Date(value && Number.isFinite(value) ? value : 0).toISOString()
}

function activeRunTurnKey(threadId: string, turnId: string): string {
  return JSON.stringify([threadId, turnId])
}

function automationStatusForView(status: NativeAutomationEntry['record']['status']): AutomationDefinition['status'] {
  if (status === 'PAUSED') return 'paused'
  if (status === 'DELETED') return 'deleted'
  return 'active'
}

function createNativeEntryForRun(
  definition: AutomationDefinition,
  automationDirPath: string,
  sourceDirName?: string,
): NativeAutomationEntry {
  return {
    record: {
      version: definition.version,
      id: definition.id,
      kind: definition.kind,
      name: definition.name,
      prompt: definition.prompt,
      rrule: definition.schedule.rrule,
      rrulePrefix: definition.kind === 'cron' ? 'RRULE:' : null,
      status: definition.legacyStatus === 'DELETED'
        ? 'DELETED'
        : definition.legacyStatus === 'PAUSED' ? 'PAUSED' : 'ACTIVE',
      targetThreadId: definition.targetThreadId,
      model: definition.model,
      reasoningEffort: definition.reasoningEffort,
      executionEnvironment: definition.runMode,
      localEnvironmentConfigPath: definition.localEnvironmentConfigPath,
      runMode: definition.runMode,
      cwd: definition.cwd,
      cwds: definition.cwds,
      createdAtMs: dateMs(definition.createdAtIso),
      updatedAtMs: dateMs(definition.updatedAtIso),
      nextRunAtMs: null,
    },
    sourceDirName: sourceDirName ?? definition.storage.nativeDirName ?? definition.id,
    automationDirPath,
    automationTomlPath: definition.storage.nativePath ?? join(automationDirPath, 'automation.toml'),
  }
}

function dateMs(value: string): number {
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function extractStartedThreadId(params: unknown): string {
  const record = asRecord(params)
  if (!record) return ''
  return readString(record.threadId)
    || readString(record.thread_id)
    || readString(record.id)
    || readString(asRecord(record.thread)?.id)
    || readString(asRecord(record.thread)?.threadId)
    || readString(asRecord(record.thread)?.thread_id)
}

function extractTurnId(params: unknown): string {
  const record = asRecord(params)
  if (!record) return ''
  const direct = readString(record.turnId) || readString(record.turn_id) || readString(record.id)
  if (direct) return direct
  const turn = asRecord(record.turn)
  return turn ? readString(turn.id) || readString(turn.turnId) || readString(turn.turn_id) : ''
}

function extractAssistantText(response: unknown, turnId: string): { text: string; warning: string | null } {
  const record = asRecord(response)
  if (!record) return { text: '', warning: 'thread/read response was not an object' }
  const thread = asRecord(record?.thread)
  const turnsValue = Array.isArray(thread?.turns)
    ? thread.turns
    : Array.isArray(record?.turns) ? record.turns : null
  if (!turnsValue) return { text: '', warning: 'thread/read response did not include turns' }
  const matchingTurn = turnsValue.find((turn) => {
    const item = asRecord(turn)
    return readString(item?.id) === turnId || readString(item?.turnId) === turnId || readString(item?.turn_id) === turnId
  })
  const turn = asRecord(matchingTurn)
  if (!turn) return { text: '', warning: `thread/read response did not include completed turn ${turnId}` }
  const items = [...readArray(turn.items), ...readArray(turn.messages)]
  if (items.length === 0) return { text: '', warning: `thread/read completed turn ${turnId} did not include items` }
  const texts = items.map((item) => {
    const recordItem = asRecord(item)
    if (!isAssistantMessageItem(recordItem)) return ''
    return readAssistantMessageText(recordItem)
  }).filter(Boolean)
  const text = texts.join('\n\n').trim()
  return {
    text,
    warning: text ? null : `thread/read completed turn ${turnId} did not include assistant text`,
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function isAssistantMessageItem(item: Record<string, unknown> | null): item is Record<string, unknown> {
  if (!item) return false
  const type = readString(item.type)
  const role = readString(item.role)
  const author = asRecord(item.author)
  const authorRole = readString(author?.role)
  return type === 'agentMessage' || type === 'assistantMessage' || role === 'assistant' || authorRole === 'assistant'
}

function readAssistantMessageText(item: Record<string, unknown>): string {
  const directText = readString(item.text) || readString(item.message) || readString(item.content)
  if (directText) return directText
  const message = asRecord(item.message)
  const messageText = readString(message?.text) || readString(message?.content)
  if (messageText) return messageText
  const blocks = [...readArray(item.content), ...readArray(message?.content)]
  const parts: string[] = []
  for (const block of blocks) {
    const record = asRecord(block)
    const text = readString(record?.text) || readString(record?.content)
    if (text.trim()) parts.push(text.trim())
  }
  return parts.join('\n')
}

function readArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function readBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: unknown }).code === 'ENOENT'
}

function resolveRunCwd(definition: AutomationDefinition, run: AutomationRun): string | undefined {
  if (run.runMode === 'worktree') return run.worktreePath ?? undefined
  if (run.runMode === 'local') return run.cwd ?? definition.cwd ?? undefined
  return undefined
}

function withDesktopDefaultModelAndEffort<T extends { model?: string; effort?: string }>(
  settings: T,
): Omit<T, 'model' | 'effort'> & { model: null; effort: null } {
  const { model: _model, effort: _effort, ...rest } = settings
  return { ...rest, model: null, effort: null }
}

function resolveTargetCwd(
  definition: AutomationDefinition,
  runMode: AutomationRunMode,
  cwdOverride: string | null | undefined,
): string | null {
  if (runMode !== 'local' && runMode !== 'worktree') return null
  return cwdOverride?.trim() || definition.cwd
}

function conflictsWithNewRun(
  activeRun: AutomationRun,
  nextRun: { trigger: AutomationRun['trigger']; runMode: AutomationRunMode; cwd: string | null },
): boolean {
  if (nextRun.trigger !== 'schedule') return true
  if (activeRun.trigger !== 'schedule') return true
  if (nextRun.runMode !== 'local' && nextRun.runMode !== 'worktree') return true
  if (!nextRun.cwd || !activeRun.cwd) return true
  return activeRun.cwd === nextRun.cwd
}
