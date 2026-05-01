import { readFile, stat } from 'node:fs/promises'
import type { AutomationRun } from '../../../types/automations'
import type { WorkspaceArtifact } from '../../../types/workspaceArtifacts'
import { listNativeAutomationEntries, type NativeAutomationStoreOptions } from '../../automations/nativeStore'
import { createAutomationRunStore } from '../../automations/runStore'
import type { WorkspaceArtifactContent, WorkspaceArtifactProvider } from '../artifactIndex'
import { ARTIFACT_RAW_MAX_BYTES, assertIndexedArtifactPath } from '../security'

export function createAutomationWorkspaceArtifactProvider(options?: NativeAutomationStoreOptions): WorkspaceArtifactProvider {
  return {
    source: 'automation',
    async listArtifacts() {
      return await listAutomationWorkspaceArtifacts(options)
    },
    async resolveArtifactContent(artifact, resolveOptions) {
      if (artifact.source !== 'automation') return null
      return await resolveAutomationArtifactContent(artifact, options, resolveOptions)
    },
  }
}

async function listAutomationWorkspaceArtifacts(options?: NativeAutomationStoreOptions): Promise<WorkspaceArtifact[]> {
  const entries = await listNativeAutomationEntries(options)
  const artifacts: WorkspaceArtifact[] = []
  for (const entry of entries.records) {
    const automationId = entry.record.id
    const runs = await createAutomationRunStore(entry.automationDirPath).listRuns()
    for (const run of runs) {
      artifacts.push(createRunArtifact(automationId, run))
      if (run.logPath || run.eventsPath) {
        artifacts.push(createEvidenceArtifact(automationId, run))
      }
      if (run.worktreePath) {
        artifacts.push(createWorktreeArtifact(automationId, run))
      }
      if (run.reviewPacketId) {
        artifacts.push(createReviewPacketArtifact(automationId, run, run.reviewPacketId))
      }
      for (const proposalId of run.proposalIds) {
        artifacts.push(createProposalArtifact(automationId, run, proposalId))
      }
    }
  }
  return artifacts
}

async function resolveAutomationArtifactContent(
  artifact: WorkspaceArtifact,
  options?: NativeAutomationStoreOptions,
  resolveOptions: { maxBytes?: number } = {},
): Promise<WorkspaceArtifactContent | null> {
  switch (artifact.kind) {
    case 'run_metadata':
      return createJsonContent(await readAutomationRun(artifact, options), `${artifact.id}.json`)
    case 'evidence':
      return await createEvidenceContent(artifact, resolveOptions.maxBytes ?? ARTIFACT_RAW_MAX_BYTES)
    case 'worktree':
      return createJsonContent({
        path: artifact.worktreePath,
        branchName: artifact.branchName,
        automationId: artifact.automationId,
        runId: artifact.runId,
      }, `${artifact.id}.json`)
    case 'review_packet':
      return createJsonContent({
        packetId: artifact.packetId,
        automationId: artifact.automationId,
        runId: artifact.runId,
      }, `${artifact.id}.json`)
    case 'proposal':
      return createJsonContent({
        proposalId: artifact.proposalId,
        automationId: artifact.automationId,
        runId: artifact.runId,
        status: artifact.status,
      }, `${artifact.id}.json`)
    default:
      return null
  }
}

async function readAutomationRun(artifact: Extract<WorkspaceArtifact, { kind: 'run_metadata' }>, options?: NativeAutomationStoreOptions): Promise<AutomationRun> {
  if (!artifact.automationId) throw createHttpError(404, 'Indexed automation run artifact is stale')
  const entries = await listNativeAutomationEntries(options)
  const entry = entries.records.find((candidate) => candidate.record.id === artifact.automationId)
  if (!entry) throw createHttpError(404, 'Indexed automation run artifact is stale')
  try {
    return await createAutomationRunStore(entry.automationDirPath).readRun(artifact.runId)
  } catch {
    throw createHttpError(404, 'Indexed automation run artifact is stale')
  }
}

function createRunArtifact(automationId: string, run: AutomationRun): WorkspaceArtifact {
  return {
    id: `automation:run:${automationId}:${run.id}`,
    kind: 'run_metadata',
    source: 'automation',
    title: `Automation run ${run.id}`,
    automationId,
    runId: run.id,
    threadId: run.threadId ?? run.targetThreadId ?? undefined,
    state: run.state,
    createdAtIso: run.createdAtIso,
    updatedAtIso: run.updatedAtIso,
  }
}

function createEvidenceArtifact(automationId: string, run: AutomationRun): WorkspaceArtifact {
  return {
    id: `automation:evidence:${automationId}:${run.id}`,
    kind: 'evidence',
    source: 'automation',
    title: `Automation evidence ${run.id}`,
    automationId,
    runId: run.id,
    threadId: run.threadId ?? run.targetThreadId ?? undefined,
    logPath: run.logPath,
    eventsPath: run.eventsPath,
    createdAtIso: run.createdAtIso,
    updatedAtIso: run.updatedAtIso,
  }
}

function createWorktreeArtifact(automationId: string, run: AutomationRun): WorkspaceArtifact {
  return {
    id: `automation:worktree:${automationId}:${run.id}`,
    kind: 'worktree',
    source: 'automation',
    title: run.branchName || run.worktreePath || `Automation worktree ${run.id}`,
    automationId,
    runId: run.id,
    threadId: run.threadId ?? run.targetThreadId ?? undefined,
    worktreePath: run.worktreePath ?? '',
    branchName: run.branchName ?? undefined,
    createdAtIso: run.createdAtIso,
    updatedAtIso: run.updatedAtIso,
  }
}

function createReviewPacketArtifact(automationId: string, run: AutomationRun, packetId: string): WorkspaceArtifact {
  return {
    id: `automation:review_packet:${automationId}:${run.id}`,
    kind: 'review_packet',
    source: 'automation',
    title: `Automation review packet ${packetId}`,
    automationId,
    runId: run.id,
    threadId: run.threadId ?? run.targetThreadId ?? undefined,
    packetId,
    createdAtIso: run.createdAtIso,
    updatedAtIso: run.updatedAtIso,
  }
}

function createProposalArtifact(automationId: string, run: AutomationRun, proposalId: string): WorkspaceArtifact {
  return {
    id: `automation:proposal:${automationId}:${run.id}:${proposalId}`,
    kind: 'proposal',
    source: 'automation',
    title: `Automation proposal ${proposalId}`,
    automationId,
    runId: run.id,
    threadId: run.threadId ?? run.targetThreadId ?? undefined,
    proposalId,
    createdAtIso: run.createdAtIso,
    updatedAtIso: run.updatedAtIso,
  }
}

async function createEvidenceContent(artifact: Extract<WorkspaceArtifact, { kind: 'evidence' }>, maxBytes: number): Promise<WorkspaceArtifactContent> {
  const filePaths = Array.from(new Set([artifact.logPath, artifact.eventsPath].filter((value): value is string => Boolean(value?.trim()))))
  if (filePaths.length === 0) throw createHttpError(404, 'Artifact has no indexed evidence file')
  let blockedReason = ''
  for (const filePath of filePaths) {
    const access = assertIndexedArtifactPath(artifact, filePath)
    if (!access.allowed) {
      blockedReason ||= access.reason ?? 'Artifact access blocked'
      continue
    }
    try {
      const fileStat = await stat(filePath)
      if (!fileStat.isFile()) continue
      if (fileStat.size > maxBytes) {
        throw createHttpError(413, `Artifact content exceeds ${maxBytes} bytes`)
      }
      return createTextContent(await readFile(filePath, 'utf8'), `${artifact.id}.log`, 'text/plain; charset=utf-8')
    } catch (error) {
      if (isHttpStatusError(error)) throw error
    }
  }
  if (blockedReason && filePaths.length === 1) throw createHttpError(403, blockedReason)
  throw createHttpError(404, 'Artifact evidence file is not readable')
}

function createTextContent(body: string, filename: string, contentType: string): WorkspaceArtifactContent {
  return { body, filename, contentType, encoding: 'utf8' }
}

function createJsonContent(body: unknown, filename: string): WorkspaceArtifactContent {
  return createTextContent(`${JSON.stringify(body, null, 2)}\n`, filename, 'application/json; charset=utf-8')
}

function createHttpError(status: number, message: string): Error & { status: number } {
  const error = new Error(message) as Error & { status: number }
  error.status = status
  return error
}

function isHttpStatusError(error: unknown): error is { status: number } {
  return error !== null
    && typeof error === 'object'
    && 'status' in error
    && typeof (error as { status?: unknown }).status === 'number'
}
