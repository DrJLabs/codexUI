import { createHash } from 'node:crypto'
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { hostname } from 'node:os'
import { isAbsolute, join } from 'node:path'
import type {
  AutomationDefinition,
  AutomationDiagnostic,
  AutomationRun,
  AutomationRunMode,
  AutomationsState,
  AutomationTemplate,
} from '../../types/automations'
import type { CodexRunProfile } from '../../types/execution'
import type { CodexBridgeRuntime } from '../codexAppServerBridge'
import {
  DEFAULT_CODEX_RUN_PROFILE_ID,
  mergeCodexRunProfiles,
  normalizeCodexConfigProfiles,
  readOptionalApprovalPolicy,
  readOptionalReasoningEffort,
  readOptionalSandboxMode,
  type CodexConfigProfileDefaults,
} from '../execution/runProfiles'
import { AutomationConflictError, AutomationDeferredRunError, AutomationNotFoundError, AutomationValidationError } from './errors.js'
import { isProjectlessCwd } from './projectless'
import {
  deleteNativeAutomationBySourceDir,
  getNativeAutomationsRoot,
  listNativeAutomationEntries,
  readNativeAutomationEntryFromDirectory,
  writeNativeHeartbeatAutomationBySourceDir,
  writeNativeAutomation,
  type NativeAutomationEntry,
  type NativeAutomationStoreOptions,
  type ThreadAutomationRecord,
} from './nativeStore.js'
import { classifyAutomationRunFailure } from './resultClassifier'
import { createAutomationRunStore, isActiveAutomationRunState } from './runStore'
import { AutomationRunner } from './runner'
import { evaluateRruleSchedule } from './scheduleCalculator'
import { createAutomationSchedulerStore, type AutomationSchedulerState } from './schedulerStore'
import { parseAutomationSidecarRead, type AutomationCreateInput, type AutomationPatchInput, type AutomationSidecarRead, type HeartbeatThreadStateInput } from './schema.js'
import { AUTOMATION_TEMPLATES } from './templates'
import {
  assertAutomationExecutionPolicy,
  DEFAULT_AUTOMATION_EXECUTION_POLICY,
  isAutomationExecutionPolicyEnabled,
  resolveAutomationRunProfile,
  type AutomationExecutionPolicy,
} from './policy'

const LOCAL_SIDECAR_FILENAME = 'codexui.local.json'
const LEGACY_SIDECAR_FILENAME = 'codexui.json'
const HEARTBEAT_THREAD_ENTRY_CACHE_MS = 5000
const RUN_START_LOCK_FILENAME = '.run-start.lock'
const RUN_START_LOCK_OWNER_FILENAME = 'owner.json'
const RUN_START_LOCK_HOSTNAME = hostname()
const RUN_START_LOCK_TIMEOUT_MS = 10_000
const RUN_START_LOCK_POLL_MS = 20
const RUN_START_STALE_LOCK_MS = 120_000
const INTERRUPTED_RUN_RECOVERY_GRACE_MS = 6 * 60 * 60 * 1000

type AutomationSidecar = AutomationSidecarRead
type MapDefinitionOptions = {
  includeRecentRuns?: boolean
}
type KanbanProjectionTaskValidator = {
  validateTask(taskId: string): Promise<void>
}

export type AutomationProjectionAdapter = {
  validateTask?: (taskId: string) => Promise<void>
  projectDefinition?: (input: { definition: AutomationDefinition }) => Promise<{ taskId: string | null }>
  projectRun?: (input: { definition: AutomationDefinition; run: AutomationRun }) => Promise<{ taskId: string | null }>
}

export type AutomationsServiceOptions = NativeAutomationStoreOptions & {
  bridge?: CodexBridgeRuntime
  policy?: AutomationExecutionPolicy
  enableScheduler?: boolean
  projectRoot?: string
  projectionAdapter?: AutomationProjectionAdapter | null
  kanbanProjectionTaskValidator?: KanbanProjectionTaskValidator | null
  artifactIndexing?: boolean
  projectlessHomeDir?: string
}

type CodexConfigReadResult = {
  config: Record<string, unknown> | null
  layers: Record<string, unknown>[]
}

export type AutomationSchedulerEntry = {
  definition: AutomationDefinition
  automationDirPath: string
  sourceDirName: string
  schedulerState: AutomationSchedulerState | null
}

export type PersistedAutomationActiveRun = {
  automationId: string
  run: AutomationRun
}

export class AutomationsService {
  private readonly policy: AutomationExecutionPolicy
  private readonly runner: AutomationRunner | null
  private readonly projectionAdapter: AutomationProjectionAdapter | null
  private readonly kanbanProjectionTaskValidator: KanbanProjectionTaskValidator | null
  private recoveryPromise: Promise<{ recovered: number }> | null = null
  private hasRecoveredInterruptedRuns = false
  private runStartLock: Promise<void> = Promise.resolve()
  private readonly heartbeatThreadEntryCache = new Map<string, { expiresAtMs: number; entries: NativeAutomationEntry[] }>()

  constructor(private readonly options: AutomationsServiceOptions = {}) {
    this.projectionAdapter = options.projectionAdapter ?? null
    this.policy = options.policy ?? DEFAULT_AUTOMATION_EXECUTION_POLICY
    this.kanbanProjectionTaskValidator = options.kanbanProjectionTaskValidator !== undefined
      ? options.kanbanProjectionTaskValidator
      : this.projectionAdapter?.validateTask
        ? { validateTask: async (taskId) => { await this.projectionAdapter?.validateTask?.(taskId) } }
        : null
    this.runner = options.bridge
      ? new AutomationRunner({
          codexHomeDir: options.codexHomeDir,
          bridge: options.bridge,
          policy: this.policy,
          projectionAdapter: this.projectionAdapter,
          projectlessHomeDir: options.projectlessHomeDir,
        })
      : null
  }

  dispose(): void {
    this.runner?.dispose()
  }

  isExecutionEnabled(): boolean {
    return isAutomationExecutionPolicyEnabled(this.policy)
  }

  isRunExecutionAvailable(): boolean {
    return this.runner !== null && this.isExecutionEnabled()
  }

  async recordHeartbeatThreadState(input: HeartbeatThreadStateInput): Promise<void> {
    if (!this.runner) throw createServiceError(503, 'Codex bridge is not available for heartbeat renderer state')
    this.runner.recordHeartbeatThreadState(input)
    for (const entry of await this.listActiveHeartbeatEntriesForThread(input.threadId)) {
      const sidecarResult = await readSidecar(entry)
      const current = await createAutomationSchedulerStore(entry.automationDirPath).readState().catch(() => null)
      if (current?.unsupportedReason === 'Heartbeat renderer state has not loaded for target thread') {
        await refreshSchedulerState(entry, sidecarResult.sidecar)
      }
    }
  }

  private async listActiveHeartbeatEntriesForThread(threadId: string): Promise<NativeAutomationEntry[]> {
    const cached = this.heartbeatThreadEntryCache.get(threadId)
    const now = Date.now()
    if (cached && cached.expiresAtMs > now) return cached.entries
    const entries = await listNativeAutomationEntries(this.options)
    const activeEntries = entries.records.filter((entry) => (
      entry.record.kind === 'heartbeat' &&
      entry.record.targetThreadId === threadId &&
      entry.record.status === 'ACTIVE'
    ))
    this.heartbeatThreadEntryCache.set(threadId, {
      expiresAtMs: now + HEARTBEAT_THREAD_ENTRY_CACHE_MS,
      entries: activeEntries,
    })
    return activeEntries
  }

  private invalidateHeartbeatThreadEntryCache(threadId?: string | null): void {
    if (threadId) {
      this.heartbeatThreadEntryCache.delete(threadId)
      return
    }
    this.heartbeatThreadEntryCache.clear()
  }

  async listDefinitions(): Promise<AutomationDefinition[]> {
    const { definitions } = await this.listDefinitionsWithDiagnostics()
    return definitions
  }

  async listState(): Promise<AutomationsState> {
    const { definitions, diagnostics, storageRoot } = await this.listDefinitionsWithDiagnostics()
    const executionOptions = await this.readExecutionOptions(definitions.flatMap(definitionTargetCwds))
    return {
      storageRoot,
      featureFlags: {
        scheduler: this.options.enableScheduler === true && this.isRunExecutionAvailable(),
        manualRun: this.isRunExecutionAvailable(),
        kanbanProjection: this.projectionAdapter !== null,
        artifactIndexing: this.options.artifactIndexing === true,
      },
      sourceCounts: {
        native: definitions.filter((definition) => definition.source === 'native').length,
        codexui: definitions.filter((definition) => definition.source === 'codexui').length,
      },
      diagnostics,
      definitions,
      executionOptions,
    }
  }

  async readExecutionOptions(
    cwds: Array<string | null | undefined> = [],
    options: { preferCwdDefault?: boolean } = {},
  ): Promise<AutomationsState['executionOptions']> {
    const configRead = await this.readCodexConfig()
    const configProfiles = normalizeCodexConfigProfiles(
      readCodexConfigProfileMap(configRead),
      readCodexConfigProfileDefaultsFromLayers(configRead),
    )
    const uniqueCwds = Array.from(new Set(
      cwds
        .map((value) => value?.trim())
        .filter((value): value is string => Boolean(value) && !isProjectlessCwd(value)),
    ))
    const cwdConfigReads = await Promise.all(uniqueCwds.map((cwd) => this.readCodexConfig(cwd)))
    let currentConfigProfileId = readCurrentConfigProfileId(configRead.config)
    if (options.preferCwdDefault && cwdConfigReads.length === 1) {
      currentConfigProfileId = readCurrentConfigProfileId(cwdConfigReads[0]?.config) ?? currentConfigProfileId
    }
    for (const cwdConfigRead of cwdConfigReads) {
      const cwdProfiles = normalizeCodexConfigProfiles(
        readCodexConfigProfileMap(cwdConfigRead),
        readCodexConfigProfileDefaultsFromLayers(cwdConfigRead),
      )
      configProfiles.push(...cwdProfiles)
    }
    return {
      defaultRunProfileId: currentConfigProfileId || DEFAULT_CODEX_RUN_PROFILE_ID,
      currentConfigProfileId,
      runProfiles: mergeCodexRunProfiles(configProfiles),
    }
  }

  listTemplates(): AutomationTemplate[] {
    return AUTOMATION_TEMPLATES
  }

  async getDefinition(automationId: string): Promise<AutomationDefinition> {
    const entry = await this.findEntry(automationId)
    if (!entry) throw new AutomationNotFoundError(automationId)
    const sidecarResult = await readSidecar(entry)
    return (await mapDefinition(entry, sidecarResult.sidecar)).definition
  }

  async createDefinition(input: AutomationCreateInput): Promise<AutomationDefinition> {
    const entries = await listNativeAutomationEntries(this.options)
    if (input.targetThreadId !== null) {
      const targetThreadId = input.targetThreadId
      const existing = entries.records.find((entry) => isActiveHeartbeatTarget(entry.record, targetThreadId))
      if (existing) throw new AutomationConflictError('Automation already exists for targetThreadId')
    }
    await this.assertKanbanProjectionTarget(input.kanbanProjection)
    assertAutomationRunTarget(input.runMode, input.cwd, input.targetThreadId)
    assertHeartbeatKindTarget(input.kind, input.runMode, input.targetThreadId)

    const record = await writeNativeAutomation({
      kind: input.kind,
      threadId: input.targetThreadId,
      name: input.name,
      prompt: input.prompt,
      rrule: input.schedule.rrule,
      rrulePrefix: scheduleRrulePrefix(input.schedule),
      status: 'ACTIVE',
      model: input.model,
      reasoningEffort: input.reasoningEffort,
      runMode: input.runMode,
      cwd: input.cwd,
      cwds: input.cwds,
      localEnvironmentConfigPath: input.localEnvironmentConfigPath,
    }, this.options)
    this.invalidateHeartbeatThreadEntryCache(input.targetThreadId)
    const entry = await this.findEntry(record.id)
    if (!entry) throw new AutomationNotFoundError(record.id)
    let sidecar = sidecarFromCreate(input)
    await writeSidecar(entry, sidecar)
    sidecar = await this.projectDefinitionSidecar(entry, sidecar)
    await writeSidecar(entry, sidecar)
    await refreshSchedulerState(entry, sidecar)
    return await this.getDefinition(record.id)
  }

  async patchDefinition(automationId: string, patch: AutomationPatchInput): Promise<AutomationDefinition> {
    const entry = await this.findEntry(automationId)
    if (!entry) throw new AutomationNotFoundError(automationId)
    if (entry.record.status === 'DELETED') {
      throw createServiceError(409, 'Deleted automations cannot be edited')
    }
    const sidecarResult = await readSidecar(entry)
    if (hasOwn(patch, 'targetThreadId') && typeof patch.targetThreadId === 'string') {
      const targetThreadId = patch.targetThreadId
      const entries = await listNativeAutomationEntries(this.options)
      const duplicate = entries.records.find((candidate) => (
        isActiveHeartbeatTarget(candidate.record, targetThreadId) &&
        candidate.record.id !== entry.record.id &&
        candidate.sourceDirName !== entry.sourceDirName
      ))
      if (duplicate) throw new AutomationConflictError('Automation already exists for targetThreadId')
    }
    if (hasOwn(patch, 'kanbanProjection') && patch.kanbanProjection) {
      await this.assertKanbanProjectionTarget(patch.kanbanProjection)
    }
    const now = Date.now()
    const preserveUnknownExecutionEnvironment = Boolean(entry.record.executionEnvironment && !entry.record.runMode)
    const patchHasTargetPaths = hasOwn(patch, 'cwds') || hasOwn(patch, 'cwd')
    const patchedCwds = hasOwn(patch, 'cwds')
      ? patch.cwds ?? []
      : hasOwn(patch, 'cwd')
        ? patch.cwd ? [patch.cwd] : []
        : entry.record.cwds
    const patchedCwd = patchHasTargetPaths ? patchedCwds[0] ?? null : entry.record.cwd
    const nextRecord: ThreadAutomationRecord = {
      ...entry.record,
      name: patch.name ?? entry.record.name,
      prompt: patch.prompt ?? entry.record.prompt,
      rrule: patch.schedule?.rrule ?? entry.record.rrule,
      rrulePrefix: patch.schedule ? scheduleRrulePrefix(patch.schedule) ?? entry.record.rrulePrefix : entry.record.rrulePrefix,
      targetThreadId: hasOwn(patch, 'targetThreadId') ? patch.targetThreadId ?? null : entry.record.targetThreadId,
      model: hasOwn(patch, 'model') ? patch.model ?? null : entry.record.model,
      reasoningEffort: hasOwn(patch, 'reasoningEffort') ? patch.reasoningEffort ?? null : entry.record.reasoningEffort,
      localEnvironmentConfigPath: hasOwn(patch, 'localEnvironmentConfigPath') ? patch.localEnvironmentConfigPath ?? null : entry.record.localEnvironmentConfigPath,
      runMode: preserveUnknownExecutionEnvironment ? entry.record.runMode : hasOwn(patch, 'runMode') ? patch.runMode ?? null : entry.record.runMode,
      executionEnvironment: canonicalAutomationExecutionEnvironment(
        preserveUnknownExecutionEnvironment
          ? entry.record.executionEnvironment
          : hasOwn(patch, 'runMode')
            ? patch.runMode === 'local' || patch.runMode === 'worktree' ? patch.runMode : null
            : entry.record.executionEnvironment,
      ),
      cwd: patchedCwd,
      cwds: patchedCwds,
      updatedAtMs: now,
    }
    let nextSidecar = {
      ...sidecarResult.sidecar,
      description: hasOwn(patch, 'description') ? patch.description ?? null : sidecarResult.sidecar.description,
      kanbanProjection: hasOwn(patch, 'kanbanProjection') ? patch.kanbanProjection ?? { mode: 'off' } : sidecarResult.sidecar.kanbanProjection,
      notes: hasOwn(patch, 'notes') ? patch.notes ?? '' : sidecarResult.sidecar.notes,
    }
    if (!preserveUnknownExecutionEnvironment) {
      assertAutomationRunTarget(nextRecord.runMode, nextRecord.cwd, nextRecord.targetThreadId)
      assertHeartbeatKindTarget(nextRecord.kind, nextRecord.runMode, nextRecord.targetThreadId)
    }
    await writeNativeHeartbeatAutomationBySourceDir(entry.sourceDirName, nextRecord, this.options)
    this.invalidateHeartbeatThreadEntryCache(entry.record.targetThreadId)
    this.invalidateHeartbeatThreadEntryCache(nextRecord.targetThreadId)
    await writeSidecar(entry, nextSidecar)
    nextSidecar = await this.projectDefinitionSidecar({ ...entry, record: nextRecord }, nextSidecar)
    await writeSidecar(entry, nextSidecar)
    if (isSchedulerAffectingPatch(patch)) {
      await refreshSchedulerState({ ...entry, record: nextRecord }, nextSidecar)
    }
    return await this.getDefinition(automationId)
  }

  async pauseDefinition(automationId: string): Promise<AutomationDefinition> {
    return await this.updateStatus(automationId, 'PAUSED')
  }

  async resumeDefinition(automationId: string): Promise<AutomationDefinition> {
    return await this.updateStatus(automationId, 'ACTIVE')
  }

  async deleteDefinition(automationId: string, options: { removeNative: boolean }): Promise<{ removed: boolean; removedNative: boolean }> {
    const entry = await this.findEntry(automationId)
    if (!entry) throw new AutomationNotFoundError(automationId)
    if (options.removeNative) {
      const removedNative = await deleteNativeAutomationBySourceDir(entry.sourceDirName, this.options)
      if (removedNative) this.invalidateHeartbeatThreadEntryCache(entry.record.targetThreadId)
      return { removed: removedNative, removedNative }
    }
    const removed = await deleteSidecar(entry)
    return { removed, removedNative: false }
  }

  getExecutionPolicy(): AutomationExecutionPolicy {
    return this.policy
  }

  private async assertRunStartCapacity(definition: AutomationDefinition): Promise<void> {
    const activeRuns = await this.listPersistedActiveRuns()
    const maxGlobalActiveRuns = Number(this.policy.maxGlobalActiveRuns)
    if (activeRuns.length >= maxGlobalActiveRuns) {
      throw createServiceError(409, 'Automation global active run limit reached')
    }
    const repoKey = automationRepoLimitKey(definition)
    if (!repoKey) return
    const activeRepoRuns = activeRuns.filter((activeRun) => {
      const runMode = activeRun.run.runMode
      return (runMode === 'local' || runMode === 'worktree') && activeRun.run.cwd === repoKey
    }).length
    if (activeRepoRuns >= Number(this.policy.maxActiveRunsPerRepo)) {
      throw createServiceError(409, `Automation repo active run limit reached for ${repoKey}`)
    }
  }

  private async assertRunStartCapacityForBatch(definitions: AutomationDefinition[]): Promise<void> {
    const activeRuns = await this.listPersistedActiveRuns()
    const maxGlobalActiveRuns = Number(this.policy.maxGlobalActiveRuns)
    if (activeRuns.length + definitions.length > maxGlobalActiveRuns) {
      throw createServiceError(409, 'Automation global active run limit reached')
    }
    const maxActiveRunsPerRepo = Number(this.policy.maxActiveRunsPerRepo)
    const neededByRepo = new Map<string, number>()
    for (const definition of definitions) {
      const repoKey = automationRepoLimitKey(definition)
      if (!repoKey) continue
      neededByRepo.set(repoKey, (neededByRepo.get(repoKey) ?? 0) + 1)
    }
    for (const [repoKey, needed] of neededByRepo) {
      const activeRepoRuns = activeRuns.filter((activeRun) => {
        const runMode = activeRun.run.runMode
        return (runMode === 'local' || runMode === 'worktree') && activeRun.run.cwd === repoKey
      }).length
      if (activeRepoRuns + needed > maxActiveRunsPerRepo) {
        throw createServiceError(409, `Automation repo active run limit reached for ${repoKey}`)
      }
    }
  }

  private async assertKanbanProjectionTarget(projection: AutomationSidecar['kanbanProjection']): Promise<void> {
    if (projection.mode !== 'attach_existing_task') return
    const validator = this.kanbanProjectionTaskValidator
    if (!validator) {
      throw new AutomationValidationError('Kanban projection task validation is unavailable')
    }
    await validator.validateTask(projection.taskId)
  }

  private async projectDefinitionSidecar(entry: NativeAutomationEntry, sidecar: AutomationSidecar): Promise<AutomationSidecar> {
    if (!this.projectionAdapter?.projectDefinition || sidecar.kanbanProjection.mode !== 'definition_card') return sidecar
    const definition = (await mapDefinition(entry, sidecar, { includeRecentRuns: false })).definition
    const result = await this.projectionAdapter.projectDefinition({ definition })
    if (!result.taskId || sidecar.kanbanProjection.taskId === result.taskId) return sidecar
    return {
      ...sidecar,
      kanbanProjection: {
        mode: 'definition_card',
        taskId: result.taskId,
      },
    }
  }

  async listSchedulerEntries(): Promise<AutomationSchedulerEntry[]> {
    const entries = await listNativeAutomationEntries(this.options)
    const schedulerEntries: AutomationSchedulerEntry[] = []
    for (const entry of entries.records) {
      if (entry.record.status === 'DELETED') continue
      const sidecarResult = await readSidecar(entry)
      const mapped = await mapDefinition(entry, sidecarResult.sidecar, { includeRecentRuns: false })
      if (entry.record.executionEnvironment && !entry.record.runMode) {
        await writeUnsupportedExecutionEnvironmentSchedulerState(entry, sidecarResult.sidecar)
        continue
      }
      const schedulerState = await readSchedulerStateForTick(entry)
      const currentScheduleHash = buildScheduleHash(entry, sidecarResult.sidecar)
      schedulerEntries.push({
        definition: mapped.definition,
        automationDirPath: entry.automationDirPath,
        sourceDirName: entry.sourceDirName,
        schedulerState: schedulerState && schedulerState.scheduleHash !== currentScheduleHash
          ? await refreshSchedulerState(entry, sidecarResult.sidecar)
          : schedulerState,
      })
    }
    schedulerEntries.sort((a, b) => a.definition.name.localeCompare(b.definition.name) || a.definition.id.localeCompare(b.definition.id))
    return schedulerEntries
  }

  async readSchedulerEntry(entry: Pick<AutomationSchedulerEntry, 'automationDirPath' | 'sourceDirName'>): Promise<AutomationSchedulerEntry | null> {
    const nativeEntry = await readNativeAutomationEntryFromDirectory(entry.sourceDirName, entry.automationDirPath)
    if (!nativeEntry || nativeEntry.record.status === 'DELETED') return null
    const sidecarResult = await readSidecar(nativeEntry)
    const mapped = await mapDefinition(nativeEntry, sidecarResult.sidecar, { includeRecentRuns: false })
    if (nativeEntry.record.executionEnvironment && !nativeEntry.record.runMode) {
      await writeUnsupportedExecutionEnvironmentSchedulerState(nativeEntry, sidecarResult.sidecar)
      return null
    }
    const schedulerState = await readSchedulerStateForTick(nativeEntry)
    const currentScheduleHash = buildScheduleHash(nativeEntry, sidecarResult.sidecar)
    return {
      definition: mapped.definition,
      automationDirPath: nativeEntry.automationDirPath,
      sourceDirName: nativeEntry.sourceDirName,
      schedulerState: schedulerState && schedulerState.scheduleHash !== currentScheduleHash
        ? await refreshSchedulerState(nativeEntry, sidecarResult.sidecar)
        : schedulerState,
    }
  }

  async refreshSchedulerState(automationId: string, nowIso = new Date().toISOString()): Promise<AutomationSchedulerState> {
    const entry = await this.findEntry(automationId)
    if (!entry) throw new AutomationNotFoundError(automationId)
    const sidecarResult = await readSidecar(entry)
    return await refreshSchedulerState(entry, sidecarResult.sidecar, nowIso)
  }

  async clearIncompleteSchedulerReservation(automationId: string, dueAtIso: string, nowIso = new Date().toISOString()): Promise<AutomationSchedulerState> {
    const entry = await this.findEntry(automationId)
    if (!entry) throw new AutomationNotFoundError(automationId)
    const store = createAutomationSchedulerStore(entry.automationDirPath)
    const current = await store.readOrDefault({
      automationId: entry.record.id,
      sourceDirName: entry.sourceDirName,
    })
    return await store.writeState({
      ...current,
      automationId: entry.record.id,
      sourceDirName: entry.sourceDirName,
      nextDueAtIso: dueAtIso,
      lastScheduledRunId: null,
      lastEvaluatedAtIso: nowIso,
      updatedAtIso: nowIso,
    })
  }

  private async deferScheduledRun(
    entry: NativeAutomationEntry,
    input: {
      dueAtIso: string
      nextDueAtIso: string | null
      unsupportedReason?: string | null
      nowIso?: string
    },
  ): Promise<AutomationSchedulerState> {
    const store = createAutomationSchedulerStore(entry.automationDirPath)
    const current = await store.readOrDefault({
      automationId: entry.record.id,
      sourceDirName: entry.sourceDirName,
    })
    const nowIso = input.nowIso ?? new Date().toISOString()
    return await store.writeState({
      ...current,
      automationId: entry.record.id,
      sourceDirName: entry.sourceDirName,
      lastDueAtIso: input.dueAtIso,
      nextDueAtIso: input.unsupportedReason ? null : input.nextDueAtIso,
      lastScheduledRunId: null,
      lastEvaluatedAtIso: nowIso,
      unsupportedReason: input.unsupportedReason ?? current.unsupportedReason,
      updatedAtIso: nowIso,
    })
  }

  async listPersistedActiveRuns(): Promise<PersistedAutomationActiveRun[]> {
    const entries = await listNativeAutomationEntries(this.options)
    const activeRuns: PersistedAutomationActiveRun[] = []
    for (const entry of entries.records) {
      for (const run of await createAutomationRunStore(entry.automationDirPath).listActiveRuns()) {
        if (isActiveAutomationRunState(run.state)) activeRuns.push({ automationId: entry.record.id, run })
      }
    }
    return activeRuns
  }

  async runNow(automationId: string, options: { runProfiles?: CodexRunProfile[]; runProfileId?: string | null } = {}): Promise<AutomationRun> {
    const entry = await this.findEntry(automationId)
    if (!entry) throw new AutomationNotFoundError(automationId)
    if (!this.runner) throw createServiceError(503, 'Codex bridge is not available for automation manual runs')
    const sidecarResult = await readSidecar(entry)
    const definition = (await mapDefinition(entry, sidecarResult.sidecar, { includeRecentRuns: false })).definition
    assertAutomationNotDeleted(definition)
    await this.ensureInterruptedRunRecoveryBeforeCapacity()
    assertAutomationExecutionPolicy(this.policy)
    const targetCwds = manualRunCwds(definition)
    let firstRun: AutomationRun | null = null
    let firstError: unknown = null
    for (const targetCwd of targetCwds) {
      try {
        const targetDefinition = definitionWithTargetCwd(definition, targetCwd)
        assertAutomationRunnerTarget(targetDefinition)
        const executionOptions = options.runProfiles
          ? null
          : await this.readExecutionOptions(targetConfigCwds(targetCwd, targetDefinition), { preferCwdDefault: true })
        const runProfiles = options.runProfiles ?? executionOptions?.runProfiles
        resolveAutomationRunProfile(targetDefinition, {
          ...options,
          defaultRunProfileId: executionOptions?.defaultRunProfileId,
          runProfiles,
        })
        const run = await this.runner.runNow({
          definition: targetDefinition,
          automationDirPath: entry.automationDirPath,
          runProfiles,
          defaultRunProfileId: executionOptions?.defaultRunProfileId,
          runProfileId: options.runProfileId,
          reserveRunStart: async ({ definition: runDefinition, createRun }) => {
            return await this.reserveRunStart(runDefinition, createRun)
          },
        })
        if (run.state === 'failed') {
          firstError ??= new Error(run.errorMessage ?? `Manual run failed for ${targetCwd ?? definition.id}`)
          continue
        }
        firstRun ??= run
      } catch (error) {
        firstError ??= error
      }
    }
    if (firstRun) return firstRun
    if (firstError) throw firstError
    throw new AutomationDeferredRunError('Manual run skipped: no folders configured', { deferMode: 'unsupported_target' })
  }

  private async readCodexConfig(cwd?: string): Promise<CodexConfigReadResult> {
    if (!this.options.bridge?.rpc) return { config: null, layers: [] }
    try {
      const params = cwd?.trim()
        ? { includeLayers: true, cwd: cwd.trim() }
        : { includeLayers: true }
      const payload = await this.options.bridge.rpc<unknown>('config/read', params)
      const root = asRecord(payload)
      const layers = Array.isArray(root?.layers)
        ? root.layers.map((layer) => asRecord(asRecord(layer)?.config)).filter((layer): layer is Record<string, unknown> => Boolean(layer))
        : []
      return { config: asRecord(root?.config) ?? root, layers }
    } catch {
      return { config: null, layers: [] }
    }
  }

  async runScheduled(
    automationId: string,
    input: {
      dueAtIso: string
      nextDueAtIso: string | null
      runProfiles?: CodexRunProfile[]
      runProfileId?: string | null
    },
  ): Promise<AutomationRun> {
    const entry = await this.findEntry(automationId)
    if (!entry) throw new AutomationNotFoundError(automationId)
    if (!this.runner) throw createServiceError(503, 'Codex bridge is not available for automation scheduled runs')
    const sidecarResult = await readSidecar(entry)
    const definition = (await mapDefinition(entry, sidecarResult.sidecar, { includeRecentRuns: false })).definition
    assertAutomationNotDeleted(definition)
    await this.ensureInterruptedRunRecoveryBeforeCapacity()
    assertAutomationExecutionPolicy(this.policy)
    const targetCwds = scheduledRunCwds(definition)
    if (targetCwds.length === 0) {
      throw new AutomationDeferredRunError('Scheduled run skipped: no folders configured', { deferMode: 'unsupported_target' })
    }
    const targetDefinitions = targetCwds.map((targetCwd) => definitionWithTargetCwd(definition, targetCwd))
    for (const targetDefinition of targetDefinitions) {
      assertAutomationRunnerTarget(targetDefinition)
    }
    await this.assertRunStartCapacityForBatch(targetDefinitions)
    let firstRun: AutomationRun | null = null
    let firstError: unknown = null
    try {
      for (const targetDefinition of targetDefinitions) {
        const targetCwd = targetDefinition.cwd
        try {
          const executionOptions = input.runProfiles
            ? null
            : await this.readExecutionOptions(targetConfigCwds(targetCwd, targetDefinition), { preferCwdDefault: true })
          const runProfiles = input.runProfiles ?? executionOptions?.runProfiles
          resolveAutomationRunProfile(targetDefinition, {
            ...input,
            defaultRunProfileId: executionOptions?.defaultRunProfileId,
            runProfiles,
          })
          const run = await this.runner.runScheduled({
            definition,
            automationDirPath: entry.automationDirPath,
            sourceDirName: entry.sourceDirName,
            cwd: targetCwd,
            dueAtIso: input.dueAtIso,
            nextDueAtIso: input.nextDueAtIso,
            runProfiles,
            defaultRunProfileId: executionOptions?.defaultRunProfileId,
            runProfileId: input.runProfileId,
            reserveRunStart: async ({ definition: runDefinition, createRun }) => {
              return await this.reserveRunStart(runDefinition, createRun)
            },
          })
          if (run.state === 'failed') {
            firstError ??= new Error(run.errorMessage ?? `Scheduled run failed for ${targetCwd}`)
            continue
          }
          firstRun ??= run
        } catch (error) {
          firstError ??= error
        }
      }
      if (firstRun) return firstRun
      if (firstError) throw firstError
      if (!firstRun) throw new AutomationDeferredRunError('Scheduled run skipped: no folders configured', { deferMode: 'unsupported_target' })
      return firstRun
    } catch (error) {
      if (error instanceof AutomationDeferredRunError) {
        await this.deferScheduledRun(entry, {
          dueAtIso: input.dueAtIso,
          nextDueAtIso: input.nextDueAtIso,
          unsupportedReason: error.deferMode === 'requires_renderer_state' || error.deferMode === 'unsupported_target'
            ? error.message
            : null,
        })
      }
      throw error
    }
  }

  async recoverInterruptedRuns(): Promise<{ recovered: number }> {
    if (this.recoveryPromise) return await this.recoveryPromise
    const recoveryPromise = this.recoverInterruptedRunsNow()
    this.recoveryPromise = recoveryPromise
    try {
      const result = await recoveryPromise
      this.hasRecoveredInterruptedRuns = true
      return result
    } finally {
      if (this.recoveryPromise === recoveryPromise) this.recoveryPromise = null
    }
  }

  private async recoverInterruptedRunsNow(): Promise<{ recovered: number }> {
    const entries = await listNativeAutomationEntries(this.options)
    let recovered = 0
    for (const entry of entries.records) {
      const store = createAutomationRunStore(entry.automationDirPath)
      const activeRuns = await store.listActiveRuns()
      const sidecarResult = activeRuns.length > 0 ? await readSidecar(entry) : null
      const definition = sidecarResult
        ? (await mapDefinition(entry, sidecarResult.sidecar, { includeRecentRuns: false })).definition
        : null
      for (const run of activeRuns) {
        if (this.runner?.ownsActiveRun(run.id)) continue
        if (!isInterruptedRunRecoveryCandidate(run)) continue
        if (run.trigger === 'schedule') {
          await reconcileSchedulerFromScheduledRun(entry, run)
        }
        const message = 'Automation run was interrupted by a previous server session'
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
        recovered += 1
        await store.appendEvent(failed, { type: 'scheduler.recovered_failed', errorMessage: message })
        await store.appendLog(failed, message)
        if (definition) await this.projectRecoveredRun({ definition, store, run: failed })
      }
    }
    return { recovered }
  }

  private async waitForRecovery(): Promise<void> {
    const recoveryPromise = this.recoveryPromise
    if (recoveryPromise) await recoveryPromise
  }

  private async ensureInterruptedRunRecoveryBeforeCapacity(): Promise<void> {
    if (this.hasRecoveredInterruptedRuns) {
      await this.waitForRecovery()
      return
    }
    const activeRuns = await this.listPersistedActiveRuns()
    const needsRecovery = activeRuns.some((activeRun) => (
      !this.runner?.ownsActiveRun(activeRun.run.id) &&
      isInterruptedRunRecoveryCandidate(activeRun.run)
    ))
    if (!needsRecovery) {
      await this.waitForRecovery()
      return
    }
    await this.recoverInterruptedRuns()
  }

  private async reserveRunStart(definition: AutomationDefinition, createRun: () => Promise<AutomationRun>): Promise<AutomationRun> {
    return await this.withRunStartLock(async () => {
      await this.ensureInterruptedRunRecoveryBeforeCapacity()
      assertAutomationExecutionPolicy(this.policy)
      await this.assertRunStartCapacity(definition)
      return await createRun()
    })
  }

  private async withRunStartLock<T>(fn: () => Promise<T>): Promise<T> {
    const previous = this.runStartLock
    let release!: () => void
    const current = new Promise<void>((resolve) => {
      release = resolve
    })
    const chained = previous.then(() => current, () => current)
    this.runStartLock = chained
    await previous.catch(() => {})
    try {
      return await withNativeRunStartLock(getNativeAutomationsRoot(this.options), fn)
    } finally {
      release()
      if (this.runStartLock === chained) this.runStartLock = Promise.resolve()
    }
  }

  async listRuns(automationId: string): Promise<AutomationRun[]> {
    const entry = await this.findEntry(automationId)
    if (!entry) throw new AutomationNotFoundError(automationId)
    return await createAutomationRunStore(entry.automationDirPath).listRuns()
  }

  async hasRun(automationId: string, runId: string): Promise<boolean> {
    const entry = await this.findEntry(automationId)
    if (!entry) throw new AutomationNotFoundError(automationId)
    return await createAutomationRunStore(entry.automationDirPath).hasRun(runId)
  }

  async markRunRead(automationId: string, runId: string): Promise<AutomationRun> {
    const entry = await this.findEntry(automationId)
    if (!entry) throw new AutomationNotFoundError(automationId)
    return await updateRunTriage(createAutomationRunStore(entry.automationDirPath), runId, {
      readAtIso: new Date().toISOString(),
    })
  }

  async archiveRun(automationId: string, runId: string): Promise<AutomationRun> {
    const entry = await this.findEntry(automationId)
    if (!entry) throw new AutomationNotFoundError(automationId)
    return await updateRunTriage(createAutomationRunStore(entry.automationDirPath), runId, {
      archivedAtIso: new Date().toISOString(),
    })
  }

  async unarchiveRun(automationId: string, runId: string): Promise<AutomationRun> {
    const entry = await this.findEntry(automationId)
    if (!entry) throw new AutomationNotFoundError(automationId)
    return await updateRunTriage(createAutomationRunStore(entry.automationDirPath), runId, {
      archivedAtIso: null,
    })
  }

  private async updateStatus(automationId: string, status: 'ACTIVE' | 'PAUSED'): Promise<AutomationDefinition> {
    const entry = await this.findEntry(automationId)
    if (!entry) throw new AutomationNotFoundError(automationId)
    if (entry.record.status === 'DELETED') {
      throw createServiceError(409, 'Deleted automations cannot be paused or resumed')
    }
    if (status === 'ACTIVE') {
      await this.assertNoDuplicateActiveHeartbeatTarget(entry.record, entry.sourceDirName)
    }
    await writeNativeHeartbeatAutomationBySourceDir(entry.sourceDirName, {
      ...entry.record,
      status,
      updatedAtMs: Date.now(),
    }, this.options)
    this.invalidateHeartbeatThreadEntryCache(entry.record.targetThreadId)
    if (status === 'ACTIVE') {
      const updatedEntry = await this.findEntry(automationId)
      if (updatedEntry) {
        const sidecarResult = await readSidecar(updatedEntry)
        await refreshSchedulerState(updatedEntry, sidecarResult.sidecar)
      }
    }
    return await this.getDefinition(automationId)
  }

  private async assertNoDuplicateActiveHeartbeatTarget(record: ThreadAutomationRecord, sourceDirName: string): Promise<void> {
    if (record.kind !== 'heartbeat' || !record.targetThreadId) return
    const entries = await listNativeAutomationEntries(this.options)
    const duplicate = entries.records.find((candidate) => (
      isActiveHeartbeatTarget(candidate.record, record.targetThreadId as string) &&
      !(candidate.record.id === record.id && candidate.sourceDirName === sourceDirName)
    ))
    if (duplicate) throw new AutomationConflictError('Automation already exists for targetThreadId')
  }

  private async projectRecoveredRun(input: {
    definition: AutomationDefinition
    store: ReturnType<typeof createAutomationRunStore>
    run: AutomationRun
  }): Promise<void> {
    if (!this.projectionAdapter?.projectRun || input.run.kanbanTaskId) return
    try {
      const result = await this.projectionAdapter.projectRun({
        definition: input.definition,
        run: input.run,
      })
      if (!result.taskId) return
      await input.store.updateRun(input.run.id, {
        kanbanTaskId: result.taskId,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Kanban projection failed'
      await input.store.appendEvent(input.run, {
        type: 'automation_projection.failed',
        errorMessage: message,
      })
      await input.store.appendLog(input.run, `Kanban projection failed: ${message}`)
    }
  }

  private async findEntry(automationId: string): Promise<NativeAutomationEntry | null> {
    const entries = await listNativeAutomationEntries(this.options)
    return entries.records.find((entry) => entry.record.id === automationId)
      ?? entries.records.find((entry) => entry.sourceDirName === automationId)
      ?? null
  }

  private async listDefinitionsWithDiagnostics(): Promise<{
    definitions: AutomationDefinition[]
    diagnostics: AutomationDiagnostic[]
    storageRoot: string
  }> {
    const entries = await listNativeAutomationEntries(this.options)
    const definitions: AutomationDefinition[] = []
    const diagnostics = [...entries.diagnostics]
    for (const entry of entries.records) {
      const sidecarResult = await readSidecar(entry)
      if (sidecarResult.diagnostic) diagnostics.push(sidecarResult.diagnostic)
      const mapped = await mapDefinition(entry, sidecarResult.sidecar)
      if (mapped.diagnostic) diagnostics.push(mapped.diagnostic)
      definitions.push(mapped.definition)
    }
    definitions.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
    return {
      definitions,
      diagnostics,
      storageRoot: entries.storageRoot,
    }
  }
}

async function readSchedulerStateForTick(entry: NativeAutomationEntry): Promise<AutomationSchedulerState | null> {
  try {
    return await createAutomationSchedulerStore(entry.automationDirPath).readState()
  } catch {
    return null
  }
}

async function writeUnsupportedExecutionEnvironmentSchedulerState(
  entry: NativeAutomationEntry,
  sidecar: AutomationSidecar,
  nowIso = new Date().toISOString(),
): Promise<AutomationSchedulerState> {
  return await writeUnsupportedSchedulerState(
    entry,
    sidecar,
    `Unsupported automation execution_environment: ${entry.record.executionEnvironment}`,
    nowIso,
  )
}

async function writeUnsupportedSchedulerState(
  entry: NativeAutomationEntry,
  sidecar: AutomationSidecar,
  unsupportedReason: string,
  nowIso = new Date().toISOString(),
): Promise<AutomationSchedulerState> {
  const store = createAutomationSchedulerStore(entry.automationDirPath)
  const current = await store.readOrDefault({
    automationId: entry.record.id,
    sourceDirName: entry.sourceDirName,
  })
  return await store.writeState({
    ...current,
    automationId: entry.record.id,
    sourceDirName: entry.sourceDirName,
    scheduleHash: buildScheduleHash(entry, sidecar),
    nextDueAtIso: null,
    lastEvaluatedAtIso: nowIso,
    unsupportedReason,
    updatedAtIso: nowIso,
  })
}

async function reconcileSchedulerFromScheduledRun(entry: NativeAutomationEntry, run: AutomationRun): Promise<void> {
  if (!run.dueAtIso) return
  const store = createAutomationSchedulerStore(entry.automationDirPath)
  const current = await store.readOrDefault({
    automationId: entry.record.id,
    sourceDirName: entry.sourceDirName,
  })
  if (current.nextDueAtIso && run.nextDueAtIso && Date.parse(current.nextDueAtIso) > Date.parse(run.nextDueAtIso)) return
  const nowIso = new Date().toISOString()
  await store.writeState({
    ...current,
    automationId: entry.record.id,
    sourceDirName: entry.sourceDirName,
    lastDueAtIso: run.dueAtIso,
    nextDueAtIso: run.nextDueAtIso,
    lastScheduledRunId: run.id,
    lastEvaluatedAtIso: nowIso,
    updatedAtIso: nowIso,
  })
}

async function updateRunTriage(
  store: ReturnType<typeof createAutomationRunStore>,
  runId: string,
  update: Pick<Partial<AutomationRun>, 'readAtIso' | 'archivedAtIso'>,
): Promise<AutomationRun> {
  try {
    return await store.updateRun(runId, update)
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      throw createServiceError(404, 'Automation run not found')
    }
    throw error
  }
}

async function mapDefinition(
  entry: NativeAutomationEntry,
  sidecar: AutomationSidecar,
  options: MapDefinitionOptions = {},
): Promise<{
  definition: AutomationDefinition
  diagnostic: AutomationDiagnostic | null
}> {
  const createdAtIso = dateIso(entry.record.createdAtMs)
  const updatedAtIso = dateIso(entry.record.updatedAtMs)
  const includeRecentRuns = options.includeRecentRuns !== false
  const recentRuns = includeRecentRuns
    ? await createAutomationRunStore(entry.automationDirPath).listRuns({ limit: 5 })
    : []
  const nextRun = await readDefinitionNextRunAtIso(entry, sidecar, createdAtIso, updatedAtIso)
  const executionEnvironmentDiagnostic: AutomationDiagnostic | null = entry.record.executionEnvironment && !entry.record.runMode
    ? {
        automationId: entry.record.id,
        sourceDirName: entry.sourceDirName,
        path: entry.automationTomlPath,
        severity: 'warning',
        message: `Unsupported automation execution_environment: ${entry.record.executionEnvironment}`,
      }
    : null
  const unsupportedTargetReason = unsupportedSchedulerTargetReason(entry.record)
  const targetDiagnostic: AutomationDiagnostic | null = unsupportedTargetReason
    ? {
        automationId: entry.record.id,
        sourceDirName: entry.sourceDirName,
        path: entry.automationTomlPath,
        severity: 'warning',
        message: unsupportedTargetReason,
      }
    : null
  return {
    diagnostic: nextRun.diagnostic ?? executionEnvironmentDiagnostic ?? targetDiagnostic,
    definition: {
      id: entry.record.id,
      kind: entry.record.kind,
      source: 'native',
      nativeId: entry.record.id,
      name: entry.record.name,
      description: sidecar.description,
      prompt: entry.record.prompt,
      status: automationStatusForView(entry.record.status),
      legacyStatus: entry.record.status,
      schedule: { type: 'rrule', rrule: entry.record.rrule, rawRrule: rawAutomationRrule(entry) },
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
        sidecarPath: sidecarPath(entry),
        memoryPath: join(entry.automationDirPath, 'memory.md'),
      },
      createdAtIso,
      updatedAtIso,
      lastRunAtIso: recentRuns[0]?.startedAtIso ?? recentRuns[0]?.createdAtIso ?? null,
      nextRunAtIso: nextRun.nextRunAtIso,
      recentRuns,
      version: 1,
    },
  }
}

async function refreshSchedulerState(
  entry: NativeAutomationEntry,
  sidecar: AutomationSidecar,
  nowIso = new Date().toISOString(),
): Promise<AutomationSchedulerState> {
  if (entry.record.executionEnvironment && !entry.record.runMode) {
    return await writeUnsupportedExecutionEnvironmentSchedulerState(entry, sidecar, nowIso)
  }
  const unsupportedTargetReason = unsupportedSchedulerTargetReason(entry.record)
  if (unsupportedTargetReason) {
    return await writeUnsupportedSchedulerState(entry, sidecar, unsupportedTargetReason, nowIso)
  }
  const decision = evaluateRruleSchedule({
    rrule: entry.record.rrule,
    nowIso,
    nextDueAtIso: null,
    anchorIso: dateIso(entry.record.updatedAtMs ?? entry.record.createdAtMs),
  })
  return await createAutomationSchedulerStore(entry.automationDirPath).writeState({
    automationId: entry.record.id,
    sourceDirName: entry.sourceDirName,
    scheduleHash: buildScheduleHash(entry, sidecar),
    nextDueAtIso: decision.due ? decision.dueAtIso : decision.nextDueAtIso,
    lastDueAtIso: null,
    lastScheduledRunId: null,
    lastEvaluatedAtIso: nowIso,
    missedRunPolicy: 'one_catch_up',
    unsupportedReason: decision.unsupportedReason,
    updatedAtIso: nowIso,
  })
}

async function readDefinitionNextRunAtIso(
  entry: NativeAutomationEntry,
  sidecar: AutomationSidecar,
  createdAtIso: string,
  updatedAtIso: string,
): Promise<{ nextRunAtIso: string | null; diagnostic: AutomationDiagnostic | null }> {
  const store = createAutomationSchedulerStore(entry.automationDirPath)
  let state
  try {
    state = await store.readState()
  } catch {
    state = null
    const recomputed = computeTransientNextRunAtIso(entry, createdAtIso, updatedAtIso)
    return {
      nextRunAtIso: recomputed,
      diagnostic: {
        automationId: entry.record.id,
        sourceDirName: entry.sourceDirName,
        path: store.path,
        severity: 'warning',
        message: 'Invalid scheduler.json state',
      },
    }
  }
  if (state && state.scheduleHash === buildScheduleHash(entry, sidecar)) return { nextRunAtIso: state.nextDueAtIso, diagnostic: null }
  return { nextRunAtIso: computeTransientNextRunAtIso(entry, createdAtIso, updatedAtIso), diagnostic: null }
}

function computeTransientNextRunAtIso(
  entry: NativeAutomationEntry,
  createdAtIso: string,
  updatedAtIso: string,
): string | null {
  if (unsupportedSchedulerTargetReason(entry.record)) return null
  try {
    const decision = evaluateRruleSchedule({
      rrule: entry.record.rrule,
      nowIso: new Date().toISOString(),
      nextDueAtIso: null,
      anchorIso: updatedAtIso || createdAtIso,
    })
    return decision.nextDueAtIso
  } catch {
    return null
  }
}

function isSchedulerAffectingPatch(patch: AutomationPatchInput): boolean {
  return hasOwn(patch, 'schedule') || hasOwn(patch, 'cwd') || hasOwn(patch, 'cwds') || hasOwn(patch, 'runMode')
}

function buildScheduleHash(entry: NativeAutomationEntry, _sidecar: AutomationSidecar): string {
  return createHash('sha256')
    .update(JSON.stringify({
      id: entry.record.id,
      sourceDirName: entry.sourceDirName,
      rrule: entry.record.rrule,
      cwd: entry.record.cwd,
      cwds: entry.record.cwds,
      executionEnvironment: entry.record.executionEnvironment,
      runMode: entry.record.runMode,
    }))
    .digest('hex')
}

function canonicalAutomationExecutionEnvironment(value: string | null): string | null {
  return value === 'chat' ? null : value
}

function automationRepoLimitKey(definition: AutomationDefinition): string | null {
  const runMode = definition.runMode ?? 'chat'
  if (runMode !== 'local' && runMode !== 'worktree') return null
  return definition.cwd
}

function definitionTargetCwds(definition: AutomationDefinition): Array<string | null> {
  const runMode = definition.runMode ?? 'chat'
  if (runMode !== 'local' && runMode !== 'worktree') return [definition.cwd]
  return definition.cwds.length > 0 ? definition.cwds : [definition.cwd]
}

function definitionTargetConfigCwds(definition: AutomationDefinition): Array<string | null> {
  return definitionTargetCwds(definition).filter((cwd) => !isProjectlessCwd(cwd))
}

function targetConfigCwds(targetCwd: string | null, definition: AutomationDefinition): Array<string | null> {
  if (isProjectlessCwd(targetCwd)) return []
  return targetCwd ? [targetCwd] : definitionTargetConfigCwds(definition)
}

function scheduledRunCwds(definition: AutomationDefinition): Array<string | null> {
  const runMode = definition.runMode ?? 'chat'
  if (definition.kind !== 'cron' || (runMode !== 'local' && runMode !== 'worktree')) return [null]
  return definition.cwds.map((cwd) => cwd.trim()).filter(Boolean)
}

function manualRunCwds(definition: AutomationDefinition): Array<string | null> {
  const runMode = definition.runMode ?? 'chat'
  if (definition.kind !== 'cron' || (runMode !== 'local' && runMode !== 'worktree')) return [null]
  const cwds = definition.cwds.map((cwd) => cwd.trim()).filter(Boolean)
  return cwds.length > 0 ? cwds : [definition.cwd]
}

function definitionWithTargetCwd(definition: AutomationDefinition, cwd: string | null): AutomationDefinition {
  if (cwd === definition.cwd) return definition
  return { ...definition, cwd }
}

function unsupportedSchedulerTargetReason(record: ThreadAutomationRecord): string | null {
  const runMode = record.runMode ?? 'chat'
  if (record.kind === 'cron' && (runMode === 'local' || runMode === 'worktree') && record.cwds.length === 0) {
    return 'Scheduled run skipped: no folders configured'
  }
  return null
}

function automationStatusForView(status: ThreadAutomationRecord['status']): AutomationDefinition['status'] {
  if (status === 'PAUSED') return 'paused'
  if (status === 'DELETED') return 'deleted'
  return 'active'
}

function rawAutomationRrule(entry: NativeAutomationEntry): string {
  return `${entry.record.rrulePrefix ?? ''}${entry.record.rrule}`
}

function scheduleRrulePrefix(schedule: { rawRrule?: string }): 'RRULE:' | undefined {
  return schedule.rawRrule?.trim().startsWith('RRULE:') ? 'RRULE:' : undefined
}

function assertAutomationNotDeleted(definition: AutomationDefinition): void {
  if (definition.legacyStatus === 'DELETED' || definition.status === 'deleted') {
    throw createServiceError(409, 'Deleted automations cannot be run')
  }
}

function isActiveHeartbeatTarget(record: ThreadAutomationRecord, targetThreadId: string): boolean {
  return record.kind === 'heartbeat' && record.status === 'ACTIVE' && record.targetThreadId === targetThreadId
}

function assertAutomationRunTarget(runMode: AutomationRunMode | null, cwd: string | null, targetThreadId: string | null): void {
  const effectiveRunMode = runMode ?? 'chat'
  if ((effectiveRunMode === 'local' || effectiveRunMode === 'worktree') && !cwd) {
    throw createServiceError(400, 'cwd is required for local and worktree automations')
  }
  if ((effectiveRunMode === 'local' || effectiveRunMode === 'worktree') && cwd && !isProjectlessCwd(cwd) && !isAbsolute(cwd)) {
    throw createServiceError(400, 'cwd must be an absolute path or ~ for projectless automations')
  }
  if (effectiveRunMode === 'chat' && !targetThreadId) {
    throw createServiceError(400, 'targetThreadId is required for chat automations')
  }
}

function assertHeartbeatKindTarget(kind: AutomationDefinition['kind'], runMode: AutomationRunMode | null, targetThreadId: string | null): void {
  const effectiveRunMode = runMode ?? 'chat'
  if (kind !== 'heartbeat') return
  if (effectiveRunMode !== 'chat' || !targetThreadId) {
    throw createServiceError(400, 'Heartbeat automations must stay attached to a chat thread')
  }
}

function assertAutomationRunnerTarget(definition: AutomationDefinition): void {
  const runMode = definition.runMode ?? 'chat'
  if (runMode === 'chat' && !definition.targetThreadId) {
    throw new AutomationValidationError('chat automation runs require a targetThreadId')
  }
  if ((runMode === 'local' || runMode === 'worktree') && (!definition.cwd || (!isProjectlessCwd(definition.cwd) && !isAbsolute(definition.cwd)))) {
    throw new AutomationValidationError(`${runMode} automation runs require an absolute cwd or ~ for projectless automations`)
  }
}

function dateIso(value: number | null): string {
  return new Date(value && Number.isFinite(value) ? value : 0).toISOString()
}

function defaultSidecar(): AutomationSidecar {
  return {
    description: null,
    kanbanProjection: { mode: 'off' },
    notes: '',
  }
}

function sidecarFromCreate(input: AutomationCreateInput): AutomationSidecar {
  return {
    description: input.description,
    kanbanProjection: input.kanbanProjection,
    notes: input.notes,
  }
}

async function readSidecar(entry: NativeAutomationEntry): Promise<{ sidecar: AutomationSidecar; diagnostic: AutomationDiagnostic | null }> {
  const path = await findReadableSidecarPath(entry)
  let raw: string
  if (!path) return { sidecar: defaultSidecar(), diagnostic: null }
  try {
    raw = await readFile(path, 'utf8')
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return { sidecar: defaultSidecar(), diagnostic: null }
    }
    throw error
  }
  try {
    const parsed = JSON.parse(raw) as unknown
    const parsedSidecar = parseAutomationSidecarRead(parsed)
    return {
      sidecar: parsedSidecar.sidecar,
      diagnostic: parsedSidecar.invalidFields.length > 0
        ? {
            automationId: entry.record.id,
            sourceDirName: entry.sourceDirName,
            path,
            severity: 'warning',
            message: `Invalid CodexUI local sidecar fields: ${parsedSidecar.invalidFields.join(', ')}`,
          }
        : null,
    }
  } catch {
    return {
      sidecar: defaultSidecar(),
      diagnostic: {
        automationId: entry.record.id,
        sourceDirName: entry.sourceDirName,
        path,
        severity: 'warning',
        message: 'Invalid CodexUI local sidecar',
      },
    }
  }
}

async function writeSidecar(entry: NativeAutomationEntry, sidecar: AutomationSidecar): Promise<void> {
  await writeFile(sidecarPath(entry), `${JSON.stringify(sidecar, null, 2)}\n`, 'utf8')
}

async function deleteSidecar(entry: NativeAutomationEntry): Promise<boolean> {
  let removed = false
  try {
    await rm(sidecarPath(entry), { force: false })
    removed = true
  } catch (error) {
    if (!isNodeError(error) || error.code !== 'ENOENT') throw error
  }
  try {
    await rm(join(entry.automationDirPath, LEGACY_SIDECAR_FILENAME), { force: false })
    removed = true
  } catch (error) {
    if (!isNodeError(error) || error.code !== 'ENOENT') throw error
  }
  return removed
}

function sidecarPath(entry: NativeAutomationEntry): string {
  return join(entry.automationDirPath, LOCAL_SIDECAR_FILENAME)
}

async function findReadableSidecarPath(entry: NativeAutomationEntry): Promise<string | null> {
  const localPath = sidecarPath(entry)
  try {
    await readFile(localPath, 'utf8')
    return localPath
  } catch (error) {
    if (!isNodeError(error) || error.code !== 'ENOENT') throw error
  }
  const legacyPath = join(entry.automationDirPath, LEGACY_SIDECAR_FILENAME)
  try {
    await readFile(legacyPath, 'utf8')
    return legacyPath
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return null
    throw error
  }
}

function hasOwn(input: object, field: string): boolean {
  return Object.prototype.hasOwnProperty.call(input, field)
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

export function readCodexConfigProfileDefaults(config: Record<string, unknown> | null): CodexConfigProfileDefaults {
  const sandboxWorkspaceWrite = asRecord(config?.sandbox_workspace_write)
    ?? asRecord(config?.sandboxWorkspaceWrite)
  return {
    model: readNonEmptyString(config?.model),
    reasoningEffort: readOptionalReasoningEffort(config?.model_reasoning_effort ?? config?.modelReasoningEffort),
    sandboxMode: readOptionalSandboxMode(config?.sandbox_mode ?? config?.sandboxMode),
    approvalPolicy: readOptionalApprovalPolicy(config?.approval_policy ?? config?.approvalPolicy),
    networkAccess: readOptionalBoolean(config?.network_access ?? config?.networkAccess)
      ?? readOptionalBoolean(sandboxWorkspaceWrite?.network_access ?? sandboxWorkspaceWrite?.networkAccess),
  }
}

function readCodexConfigProfileDefaultsFromLayers(configRead: CodexConfigReadResult): CodexConfigProfileDefaults {
  if (configRead.layers.length > 0) {
    return readCodexConfigProfileDefaults(mergeCodexConfigLayers(configRead.layers))
  }
  if (!readCurrentConfigProfileId(configRead.config)) {
    return readCodexConfigProfileDefaults(configRead.config)
  }
  return {}
}

function readCodexConfigProfileMap(configRead: CodexConfigReadResult): unknown {
  const configProfiles = asRecord(configRead.config?.profiles)
  if (configRead.layers.length === 0) return configProfiles
  const layerProfiles = asRecord(mergeCodexConfigLayers(configRead.layers).profiles)
  if (!layerProfiles) return configProfiles
  if (!configProfiles) return layerProfiles
  return mergeConfigValue(layerProfiles, configProfiles)
}

function mergeCodexConfigLayers(layers: Record<string, unknown>[]): Record<string, unknown> {
  const merged: Record<string, unknown> = {}
  for (const layer of layers) {
    mergeConfigLayerInto(merged, layer)
  }
  return merged
}

function mergeConfigLayerInto(target: Record<string, unknown>, layer: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(layer)) {
    target[key] = mergeConfigValue(target[key], value)
  }
}

function mergeConfigValue(existingValue: unknown, nextValue: unknown): unknown {
  const existing = asRecord(existingValue)
  const next = asRecord(nextValue)
  if (!existing || !next) return nextValue
  const merged: Record<string, unknown> = { ...existing }
  mergeConfigLayerInto(merged, next)
  return merged
}

function readCurrentConfigProfileId(config: Record<string, unknown> | null): string | null {
  return readNonEmptyString(config?.current_profile ?? config?.currentProfile ?? config?.profile)
}

function readOptionalBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null
}

function readNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed || null
}

function isInterruptedRunRecoveryCandidate(run: AutomationRun): boolean {
  const latestActivityIso = run.updatedAtIso || run.startedAtIso || run.createdAtIso
  const latestActivityMs = Date.parse(latestActivityIso)
  return !Number.isFinite(latestActivityMs) || Date.now() - latestActivityMs >= INTERRUPTED_RUN_RECOVERY_GRACE_MS
}

async function withNativeRunStartLock<T>(automationsRoot: string, fn: () => Promise<T>): Promise<T> {
  const lockPath = join(automationsRoot, RUN_START_LOCK_FILENAME)
  const startedAt = Date.now()
  await mkdir(automationsRoot, { recursive: true })
  for (;;) {
    try {
      await mkdir(lockPath)
      await writeRunStartLockOwner(lockPath)
      break
    } catch (error) {
      if (!isErrorCode(error, 'EEXIST')) throw error
      if (await reclaimStaleRunStartLock(lockPath)) continue
      if (Date.now() - startedAt >= RUN_START_LOCK_TIMEOUT_MS) {
        throw new Error(`Timed out waiting for automation run-start lock at ${lockPath}`)
      }
      await sleep(RUN_START_LOCK_POLL_MS)
    }
  }
  try {
    return await fn()
  } finally {
    await rm(lockPath, { recursive: true, force: true })
  }
}

async function writeRunStartLockOwner(lockPath: string): Promise<void> {
  try {
    await writeFile(join(lockPath, RUN_START_LOCK_OWNER_FILENAME), `${JSON.stringify({
      pid: process.pid,
      hostname: RUN_START_LOCK_HOSTNAME,
      startedAtMs: Date.now(),
    }, null, 2)}\n`, 'utf8')
  } catch (error) {
    await rm(lockPath, { recursive: true, force: true }).catch(() => {})
    throw error
  }
}

async function reclaimStaleRunStartLock(lockPath: string): Promise<boolean> {
  const owner = await readRunStartLockOwner(lockPath)
  if (
    owner?.hostname === RUN_START_LOCK_HOSTNAME &&
    (!isProcessAlive(owner.pid) || Date.now() - owner.startedAtMs >= RUN_START_STALE_LOCK_MS)
  ) {
    await rm(lockPath, { recursive: true, force: true })
    return true
  }
  if (!owner || owner.hostname !== RUN_START_LOCK_HOSTNAME) {
    try {
      const lockStat = await stat(lockPath)
      if (Date.now() - lockStat.mtimeMs >= RUN_START_STALE_LOCK_MS) {
        await rm(lockPath, { recursive: true, force: true })
        return true
      }
    } catch (error) {
      return isErrorCode(error, 'ENOENT')
    }
  }
  return false
}

async function readRunStartLockOwner(lockPath: string): Promise<{ pid: number; hostname: string | null; startedAtMs: number } | null> {
  try {
    const parsed = JSON.parse(await readFile(join(lockPath, RUN_START_LOCK_OWNER_FILENAME), 'utf8')) as unknown
    if (!parsed || typeof parsed !== 'object') return null
    const pid = (parsed as { pid?: unknown }).pid
    const parsedHostname = (parsed as { hostname?: unknown }).hostname
    const startedAtMs = (parsed as { startedAtMs?: unknown }).startedAtMs
    if (!Number.isInteger(pid) || Number(pid) <= 0 || typeof startedAtMs !== 'number') return null
    return {
      pid: Number(pid),
      hostname: typeof parsedHostname === 'string' && parsedHostname.trim() ? parsedHostname : null,
      startedAtMs,
    }
  } catch {
    return null
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    if (isErrorCode(error, 'ESRCH')) return false
    return true
  }
}

function isErrorCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: unknown }).code === code
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error
}

function createServiceError(statusCode: number, message: string): Error & { statusCode: number } {
  const error = new Error(message) as Error & { statusCode: number }
  error.statusCode = statusCode
  return error
}

export function resolveAutomationsStorageRoot(options?: NativeAutomationStoreOptions): string {
  return getNativeAutomationsRoot(options)
}
