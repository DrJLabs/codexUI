import { readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type {
  AutomationDefinition,
  AutomationDiagnostic,
  AutomationsState,
  AutomationTemplate,
} from '../../types/automations'
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
import { parseAutomationSidecarRead, type AutomationCreateInput, type AutomationPatchInput, type AutomationSidecarRead } from './schema.js'

const SIDECAR_FILENAME = 'codexui.json'

type AutomationSidecar = AutomationSidecarRead

export type AutomationsServiceOptions = NativeAutomationStoreOptions

export class AutomationsService {
  constructor(private readonly options: AutomationsServiceOptions = {}) {}

  async listDefinitions(): Promise<AutomationDefinition[]> {
    const { definitions } = await this.listDefinitionsWithDiagnostics()
    return definitions
  }

  async listState(): Promise<AutomationsState> {
    const { definitions, diagnostics, storageRoot } = await this.listDefinitionsWithDiagnostics()
    return {
      storageRoot,
      featureFlags: {
        scheduler: false,
        manualRun: false,
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
    return mapDefinition(entry, sidecarResult.sidecar)
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
    await writeSidecar(entry, sidecarFromCreate(input))
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
    await writeSidecar(entry, {
      ...sidecarResult.sidecar,
      description: hasOwn(patch, 'description') ? patch.description ?? null : sidecarResult.sidecar.description,
      cwd: hasOwn(patch, 'cwd') ? patch.cwd ?? null : sidecarResult.sidecar.cwd,
      runMode: hasOwn(patch, 'runMode') ? patch.runMode ?? null : sidecarResult.sidecar.runMode,
      runProfileId: hasOwn(patch, 'runProfileId') ? patch.runProfileId ?? null : sidecarResult.sidecar.runProfileId,
      model: hasOwn(patch, 'model') ? patch.model ?? null : sidecarResult.sidecar.model,
      reasoningEffort: hasOwn(patch, 'reasoningEffort') ? patch.reasoningEffort ?? null : sidecarResult.sidecar.reasoningEffort,
      notes: hasOwn(patch, 'notes') ? patch.notes ?? '' : sidecarResult.sidecar.notes,
    })
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

  private async updateStatus(automationId: string, status: 'ACTIVE' | 'PAUSED'): Promise<AutomationDefinition> {
    const entry = await this.findEntry(automationId)
    if (!entry) throw new AutomationNotFoundError(automationId)
    await writeNativeHeartbeatAutomationBySourceDir(entry.sourceDirName, {
      ...entry.record,
      status,
      updatedAtMs: Date.now(),
    }, this.options)
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
      definitions.push(mapDefinition(entry, sidecarResult.sidecar))
    }
    definitions.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
    return {
      definitions,
      diagnostics,
      storageRoot: entries.storageRoot,
    }
  }
}

function mapDefinition(entry: NativeAutomationEntry, sidecar: AutomationSidecar): AutomationDefinition {
  const createdAtIso = dateIso(entry.record.createdAtMs)
  const updatedAtIso = dateIso(entry.record.updatedAtMs)
  return {
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
    kanbanProjection: { mode: 'off' },
    notes: sidecar.notes,
    storage: {
      nativeDirName: entry.sourceDirName,
      nativePath: entry.automationTomlPath,
      sidecarPath: sidecarPath(entry),
    },
    createdAtIso,
    updatedAtIso,
    lastRunAtIso: null,
    nextRunAtIso: null,
    version: 1,
  }
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

export function resolveAutomationsStorageRoot(options?: NativeAutomationStoreOptions): string {
  return getNativeAutomationsRoot(options)
}
