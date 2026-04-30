import { createHash } from 'node:crypto'
import { readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type {
  AutomationDefinition,
  AutomationDiagnostic,
  AutomationRun,
  AutomationsState,
  AutomationTemplate,
} from '../../types/automations'
import type { CodexRunProfile } from '../../types/execution'
import type { KanbanExecutionPolicy } from '../../types/kanban'
import type { CodexBridgeRuntime } from '../codexAppServerBridge'
import { resolveKanbanConfig } from '../kanban/config'
import { AutomationConflictError, AutomationNotFoundError } from './errors.js'
import {
  deleteNativeAutomationBySourceDir,
  getNativeAutomationsRoot,
  listNativeAutomationEntries,
  writeNativeHeartbeatAutomationBySourceDir,
  writeThreadHeartbeatAutomation,
  type NativeAutomationEntry,
  type NativeAutomationStoreOptions,
  type ThreadAutomationRecord,
} from './nativeStore.js'
import { classifyAutomationRunFailure } from './resultClassifier'
import { createAutomationRunStore, isActiveAutomationRunState } from './runStore'
import { AutomationRunner } from './runner'
import { evaluateRruleSchedule } from './scheduleCalculator'
import { createAutomationSchedulerStore, type AutomationSchedulerState } from './schedulerStore'
import { parseAutomationSidecarRead, type AutomationCreateInput, type AutomationPatchInput, type AutomationSidecarRead } from './schema.js'

const SIDECAR_FILENAME = 'codexui.json'

type AutomationSidecar = AutomationSidecarRead

export type AutomationsServiceOptions = NativeAutomationStoreOptions & {
  bridge?: CodexBridgeRuntime
  policy?: KanbanExecutionPolicy
  enableScheduler?: boolean
}

export type AutomationSchedulerEntry = {
  definition: AutomationDefinition
  automationDirPath: string
  sourceDirName: string
  schedulerState: AutomationSchedulerState | null
  runs: AutomationRun[]
}

export type PersistedAutomationActiveRun = {
  automationId: string
  run: AutomationRun
}

export class AutomationsService {
  private readonly policy: KanbanExecutionPolicy
  private readonly runner: AutomationRunner | null

  constructor(private readonly options: AutomationsServiceOptions = {}) {
    this.policy = options.policy ?? resolveKanbanConfig().policy
    this.runner = options.bridge
      ? new AutomationRunner({
          codexHomeDir: options.codexHomeDir,
          bridge: options.bridge,
          policy: this.policy,
        })
      : null
  }

  async listDefinitions(): Promise<AutomationDefinition[]> {
    const { definitions } = await this.listDefinitionsWithDiagnostics()
    return definitions
  }

  async listState(): Promise<AutomationsState> {
    const { definitions, diagnostics, storageRoot } = await this.listDefinitionsWithDiagnostics()
    return {
      storageRoot,
      featureFlags: {
        scheduler: this.options.enableScheduler === true,
        manualRun: true,
        kanbanProjection: false,
        artifactIndexing: false,
      },
      sourceCounts: {
        native: definitions.filter((definition) => definition.source === 'native').length,
        codexui: definitions.filter((definition) => definition.source === 'codexui').length,
      },
      diagnostics,
      definitions,
    }
  }

  listTemplates(): AutomationTemplate[] {
    return [{
      id: 'heartbeat-thread-check',
      kind: 'heartbeat',
      name: 'Thread heartbeat',
      description: 'Periodically append a heartbeat prompt to a target thread.',
      schedule: { type: 'rrule', rrule: 'FREQ=DAILY;INTERVAL=1' },
    }]
  }

  async getDefinition(automationId: string): Promise<AutomationDefinition> {
    const entry = await this.findEntry(automationId)
    if (!entry) throw new AutomationNotFoundError(automationId)
    const sidecarResult = await readSidecar(entry)
    return (await mapDefinition(entry, sidecarResult.sidecar)).definition
  }

  async createDefinition(input: AutomationCreateInput): Promise<AutomationDefinition> {
    const entries = await listNativeAutomationEntries(this.options)
    const existing = entries.records.find((entry) => (
      entry.record.kind === 'heartbeat' &&
      entry.record.targetThreadId === input.targetThreadId
    ))
    if (existing) throw new AutomationConflictError('Automation already exists for targetThreadId')

    const record = await writeThreadHeartbeatAutomation({
      threadId: input.targetThreadId,
      name: input.name,
      prompt: input.prompt,
      rrule: input.schedule.rrule,
      status: 'ACTIVE',
    }, this.options)
    const entry = await this.findEntry(record.id)
    if (!entry) throw new AutomationNotFoundError(record.id)
    const sidecar = sidecarFromCreate(input)
    await writeSidecar(entry, sidecar)
    await refreshSchedulerState(entry, sidecar)
    return await this.getDefinition(record.id)
  }

  async patchDefinition(automationId: string, patch: AutomationPatchInput): Promise<AutomationDefinition> {
    const entry = await this.findEntry(automationId)
    if (!entry) throw new AutomationNotFoundError(automationId)
    const sidecarResult = await readSidecar(entry)
    if (hasOwn(patch, 'targetThreadId') && patch.targetThreadId !== null) {
      const entries = await listNativeAutomationEntries(this.options)
      const duplicate = entries.records.find((candidate) => (
        candidate.record.kind === 'heartbeat' &&
        candidate.record.targetThreadId === patch.targetThreadId &&
        candidate.record.id !== entry.record.id &&
        candidate.sourceDirName !== entry.sourceDirName
      ))
      if (duplicate) throw new AutomationConflictError('Automation already exists for targetThreadId')
    }
    const now = Date.now()
    const nextRecord: ThreadAutomationRecord = {
      ...entry.record,
      name: patch.name ?? entry.record.name,
      prompt: patch.prompt ?? entry.record.prompt,
      rrule: patch.schedule?.rrule ?? entry.record.rrule,
      targetThreadId: hasOwn(patch, 'targetThreadId') ? patch.targetThreadId ?? null : entry.record.targetThreadId,
      updatedAtMs: now,
    }
    await writeNativeHeartbeatAutomationBySourceDir(entry.sourceDirName, nextRecord, this.options)
    const nextSidecar = {
      ...sidecarResult.sidecar,
      description: hasOwn(patch, 'description') ? patch.description ?? null : sidecarResult.sidecar.description,
      cwd: hasOwn(patch, 'cwd') ? patch.cwd ?? null : sidecarResult.sidecar.cwd,
      runMode: hasOwn(patch, 'runMode') ? patch.runMode ?? null : sidecarResult.sidecar.runMode,
      runProfileId: hasOwn(patch, 'runProfileId') ? patch.runProfileId ?? null : sidecarResult.sidecar.runProfileId,
      model: hasOwn(patch, 'model') ? patch.model ?? null : sidecarResult.sidecar.model,
      reasoningEffort: hasOwn(patch, 'reasoningEffort') ? patch.reasoningEffort ?? null : sidecarResult.sidecar.reasoningEffort,
      kanbanProjection: hasOwn(patch, 'kanbanProjection') ? patch.kanbanProjection ?? { mode: 'off' } : sidecarResult.sidecar.kanbanProjection,
      notes: hasOwn(patch, 'notes') ? patch.notes ?? '' : sidecarResult.sidecar.notes,
    }
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
      return { removed: removedNative, removedNative }
    }
    const removed = await deleteSidecar(entry)
    return { removed, removedNative: false }
  }

  getExecutionPolicy(): KanbanExecutionPolicy {
    return this.policy
  }

  async listSchedulerEntries(): Promise<AutomationSchedulerEntry[]> {
    const entries = await listNativeAutomationEntries(this.options)
    const schedulerEntries: AutomationSchedulerEntry[] = []
    for (const entry of entries.records) {
      if (entry.record.kind !== 'heartbeat') continue
      const sidecarResult = await readSidecar(entry)
      const mapped = await mapDefinition(entry, sidecarResult.sidecar)
      schedulerEntries.push({
        definition: mapped.definition,
        automationDirPath: entry.automationDirPath,
        sourceDirName: entry.sourceDirName,
        schedulerState: await readSchedulerStateForTick(entry),
        runs: await createAutomationRunStore(entry.automationDirPath).listRuns(),
      })
    }
    schedulerEntries.sort((a, b) => a.definition.name.localeCompare(b.definition.name) || a.definition.id.localeCompare(b.definition.id))
    return schedulerEntries
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

  async listPersistedActiveRuns(): Promise<PersistedAutomationActiveRun[]> {
    const entries = await listNativeAutomationEntries(this.options)
    const activeRuns: PersistedAutomationActiveRun[] = []
    for (const entry of entries.records) {
      if (entry.record.kind !== 'heartbeat') continue
      for (const run of await createAutomationRunStore(entry.automationDirPath).listRuns()) {
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
    return await this.runner.runNow({
      definition: (await mapDefinition(entry, sidecarResult.sidecar)).definition,
      automationDirPath: entry.automationDirPath,
      runProfiles: options.runProfiles,
      runProfileId: options.runProfileId,
    })
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
    return await this.runner.runScheduled({
      definition: (await mapDefinition(entry, sidecarResult.sidecar)).definition,
      automationDirPath: entry.automationDirPath,
      sourceDirName: entry.sourceDirName,
      dueAtIso: input.dueAtIso,
      nextDueAtIso: input.nextDueAtIso,
      runProfiles: input.runProfiles,
      runProfileId: input.runProfileId,
    })
  }

  async recoverInterruptedRuns(): Promise<{ recovered: number }> {
    const entries = await listNativeAutomationEntries(this.options)
    let recovered = 0
    for (const entry of entries.records) {
      if (entry.record.kind !== 'heartbeat') continue
      const store = createAutomationRunStore(entry.automationDirPath)
      const activeRuns = (await store.listRuns()).filter((run) => isActiveAutomationRunState(run.state))
      for (const run of activeRuns) {
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
      }
    }
    return { recovered }
  }

  async listRuns(automationId: string): Promise<AutomationRun[]> {
    const entry = await this.findEntry(automationId)
    if (!entry) throw new AutomationNotFoundError(automationId)
    return await createAutomationRunStore(entry.automationDirPath).listRuns()
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
    await writeNativeHeartbeatAutomationBySourceDir(entry.sourceDirName, {
      ...entry.record,
      status,
      updatedAtMs: Date.now(),
    }, this.options)
    if (status === 'ACTIVE') {
      const updatedEntry = await this.findEntry(automationId)
      if (updatedEntry) {
        const sidecarResult = await readSidecar(updatedEntry)
        await refreshSchedulerState(updatedEntry, sidecarResult.sidecar)
      }
    }
    return await this.getDefinition(automationId)
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
      if (entry.record.kind !== 'heartbeat') continue
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

async function mapDefinition(entry: NativeAutomationEntry, sidecar: AutomationSidecar): Promise<{
  definition: AutomationDefinition
  diagnostic: AutomationDiagnostic | null
}> {
  const createdAtIso = dateIso(entry.record.createdAtMs)
  const updatedAtIso = dateIso(entry.record.updatedAtMs)
  const recentRuns = (await createAutomationRunStore(entry.automationDirPath).listRuns()).slice(0, 5)
  const nextRun = await readDefinitionNextRunAtIso(entry, createdAtIso, updatedAtIso)
  return {
    diagnostic: nextRun.diagnostic,
    definition: {
      id: entry.record.id,
      kind: 'heartbeat',
      source: 'native',
      nativeId: entry.record.id,
      name: entry.record.name,
      description: sidecar.description,
      prompt: entry.record.prompt,
      status: entry.record.status === 'PAUSED' ? 'paused' : 'active',
      legacyStatus: entry.record.status,
      schedule: { type: 'rrule', rrule: entry.record.rrule },
      targetThreadId: entry.record.targetThreadId,
      projectRoot: null,
      cwd: sidecar.cwd,
      runMode: sidecar.runMode,
      runProfileId: sidecar.runProfileId,
      model: sidecar.model,
      reasoningEffort: sidecar.reasoningEffort,
      autoArchiveNoFindings: false,
      notifyOnFindings: false,
      kanbanProjection: sidecar.kanbanProjection,
      notes: sidecar.notes,
      storage: {
        nativeDirName: entry.sourceDirName,
        nativePath: entry.automationTomlPath,
        sidecarPath: sidecarPath(entry),
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
  if (state) return { nextRunAtIso: state.nextDueAtIso, diagnostic: null }
  return { nextRunAtIso: computeTransientNextRunAtIso(entry, createdAtIso, updatedAtIso), diagnostic: null }
}

function computeTransientNextRunAtIso(
  entry: NativeAutomationEntry,
  createdAtIso: string,
  updatedAtIso: string,
): string | null {
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
  return hasOwn(patch, 'schedule') ||
    hasOwn(patch, 'targetThreadId') ||
    hasOwn(patch, 'cwd') ||
    hasOwn(patch, 'runMode') ||
    hasOwn(patch, 'runProfileId') ||
    hasOwn(patch, 'model') ||
    hasOwn(patch, 'reasoningEffort')
}

function buildScheduleHash(entry: NativeAutomationEntry, sidecar: AutomationSidecar): string {
  return createHash('sha256')
    .update(JSON.stringify({
      id: entry.record.id,
      sourceDirName: entry.sourceDirName,
      rrule: entry.record.rrule,
      status: entry.record.status,
      targetThreadId: entry.record.targetThreadId,
      cwd: sidecar.cwd,
      runMode: sidecar.runMode,
      runProfileId: sidecar.runProfileId,
      model: sidecar.model,
      reasoningEffort: sidecar.reasoningEffort,
    }))
    .digest('hex')
}

function dateIso(value: number | null): string {
  return new Date(value && Number.isFinite(value) ? value : 0).toISOString()
}

function defaultSidecar(): AutomationSidecar {
  return {
    description: null,
    cwd: null,
    runMode: null,
    runProfileId: null,
    model: null,
    reasoningEffort: null,
    kanbanProjection: { mode: 'off' },
    notes: '',
  }
}

function sidecarFromCreate(input: AutomationCreateInput): AutomationSidecar {
  return {
    description: input.description,
    cwd: input.cwd,
    runMode: input.runMode,
    runProfileId: input.runProfileId,
    model: input.model,
    reasoningEffort: input.reasoningEffort,
    kanbanProjection: input.kanbanProjection,
    notes: input.notes,
  }
}

async function readSidecar(entry: NativeAutomationEntry): Promise<{ sidecar: AutomationSidecar; diagnostic: AutomationDiagnostic | null }> {
  const path = sidecarPath(entry)
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8')) as unknown
    const parsedSidecar = parseAutomationSidecarRead(parsed)
    return {
      sidecar: parsedSidecar.sidecar,
      diagnostic: parsedSidecar.invalidFields.length > 0
        ? {
            automationId: entry.record.id,
            sourceDirName: entry.sourceDirName,
            path,
            severity: 'warning',
            message: `Invalid codexui.json sidecar fields: ${parsedSidecar.invalidFields.join(', ')}`,
          }
        : null,
    }
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return { sidecar: defaultSidecar(), diagnostic: null }
    }
    return {
      sidecar: defaultSidecar(),
      diagnostic: {
        automationId: entry.record.id,
        sourceDirName: entry.sourceDirName,
        path,
        severity: 'warning',
        message: 'Invalid codexui.json sidecar',
      },
    }
  }
}

async function writeSidecar(entry: NativeAutomationEntry, sidecar: AutomationSidecar): Promise<void> {
  await writeFile(sidecarPath(entry), `${JSON.stringify(sidecar, null, 2)}\n`, 'utf8')
}

async function deleteSidecar(entry: NativeAutomationEntry): Promise<boolean> {
  try {
    await rm(sidecarPath(entry), { force: false })
    return true
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return false
    throw error
  }
}

function sidecarPath(entry: NativeAutomationEntry): string {
  return join(entry.automationDirPath, SIDECAR_FILENAME)
}

function hasOwn(input: object, field: string): boolean {
  return Object.prototype.hasOwnProperty.call(input, field)
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
