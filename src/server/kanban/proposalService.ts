import type {
  CreateKanbanProposalInput,
  KanbanActor,
  KanbanProposal,
  KanbanProposalListQuery,
  KanbanProposalStatus,
  KanbanUpdateProposalPayload,
  ResolveKanbanProposalInput,
  UpdateKanbanTaskInput,
} from '../../types/kanban'
import { KanbanInvalidProposalError, KanbanNotFoundError } from './errors'
import { createKanbanId } from './ids'
import { parseCreateProposalInput } from './schema'
import { parseKanbanMarkers } from './markerParser'
import type { KanbanEventBus } from './eventBus'
import type { KanbanStateFileV1 } from './migrations'
import { KanbanStorage } from './storage'
import { KanbanTaskService } from './taskService'

export type CreateProposalsFromMarkersInput = {
  text: string
  sourceRunId: string
  sourceThreadId: string
  proposedBy: KanbanActor
}

export class KanbanProposalService {
  private readonly proposalLocks = new Map<string, Promise<void>>()

  constructor(private readonly options: { storage: KanbanStorage; taskService: KanbanTaskService; eventBus?: KanbanEventBus }) {}

  async listProposals(query: KanbanProposalListQuery = {}): Promise<KanbanProposal[]> {
    const state = await this.options.storage.load()
    return Object.values(state.proposals)
      .map(normalizeProposal)
      .filter((proposal): proposal is KanbanProposal => proposal !== null)
      .filter((proposal) => !query.status || proposal.status === query.status)
  }

  async createProposal(
    input: CreateKanbanProposalInput,
    options: { approveIfPolicyAuto?: boolean } = {},
  ): Promise<KanbanProposal> {
    const proposalInput = parseCreateProposalInput(input)
    const now = new Date().toISOString()
    const proposal: KanbanProposal = {
      id: createKanbanId('proposal'),
      type: proposalInput.type,
      payload: proposalInput.payload,
      sourceRunId: proposalInput.sourceRunId.trim(),
      sourceThreadId: proposalInput.sourceThreadId.trim(),
      proposedBy: proposalInput.proposedBy,
      status: 'pending',
      version: 2,
      createdAtIso: now,
      updatedAtIso: now,
      resolvedAtIso: '',
      resolvedBy: '',
      reason: '',
      resultTaskId: '',
    } as KanbanProposal

    const state = await this.options.storage.mutate((current: KanbanStateFileV1) => {
      current.proposals[proposal.id] = proposal
    })
    this.options.eventBus?.emit({ type: 'proposal.created', payload: { proposalId: proposal.id, status: proposal.status } })
    if (options.approveIfPolicyAuto && state.settings.kanbanConfig.proposalPolicy === 'auto') {
      return await this.approveProposal(proposal.id, { resolvedBy: proposal.proposedBy, reason: 'Auto-approved by proposal policy' })
    }
    return proposal
  }

  async createProposalsFromMarkers(input: CreateProposalsFromMarkersInput): Promise<{
    cleanText: string
    proposals: KanbanProposal[]
  }> {
    const parsed = parseKanbanMarkers(input.text)
    const proposals: KanbanProposal[] = []
    for (const marker of parsed.markers) {
      proposals.push(await this.createProposal({
        type: marker.type,
        payload: marker.payload,
        sourceRunId: input.sourceRunId,
        sourceThreadId: input.sourceThreadId,
        proposedBy: input.proposedBy,
      } as CreateKanbanProposalInput, { approveIfPolicyAuto: true }))
    }
    return { cleanText: parsed.cleanText, proposals }
  }

  async approveProposal(proposalId: string, resolution: ResolveKanbanProposalInput = {}): Promise<KanbanProposal> {
    return await this.withProposalLock(proposalId, async () => {
      const proposal = await this.getProposal(proposalId)
      assertPendingProposal(proposal)
      const resultTaskId = proposal.type === 'create'
        ? (await this.options.taskService.createTask(proposal.payload)).id
        : await this.applyUpdateProposal(proposal.payload)
      return await this.resolveProposal(proposalId, 'approved', resultTaskId, resolution)
    })
  }

  async acceptProposal(proposalId: string, resolution: ResolveKanbanProposalInput = {}): Promise<KanbanProposal> {
    return await this.approveProposal(proposalId, resolution)
  }

  async rejectProposal(proposalId: string, resolution: ResolveKanbanProposalInput = {}): Promise<KanbanProposal> {
    return await this.withProposalLock(proposalId, async () => {
      const proposal = await this.getProposal(proposalId)
      assertPendingProposal(proposal)
      return await this.resolveProposal(proposalId, 'rejected', proposal.resultTaskId, resolution)
    })
  }

  private async withProposalLock<T>(proposalId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.proposalLocks.get(proposalId) ?? Promise.resolve()
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const next = previous.catch(() => {}).then(() => gate)
    this.proposalLocks.set(proposalId, next)
    await previous.catch(() => {})
    try {
      return await operation()
    } finally {
      release()
      if (this.proposalLocks.get(proposalId) === next) {
        this.proposalLocks.delete(proposalId)
      }
    }
  }

  private async getProposal(proposalId: string): Promise<KanbanProposal> {
    const state = await this.options.storage.load()
    const proposal = normalizeProposal(state.proposals[proposalId])
    if (!proposal) throw new KanbanNotFoundError(`Kanban proposal not found: ${proposalId}`)
    return proposal
  }

  private async resolveProposal(
    proposalId: string,
    status: Exclude<KanbanProposalStatus, 'pending'>,
    resultTaskId: string,
    resolution: ResolveKanbanProposalInput,
  ): Promise<KanbanProposal> {
    let updated: KanbanProposal | null = null
    await this.options.storage.mutate((state: KanbanStateFileV1) => {
      const current = normalizeProposal(state.proposals[proposalId])
      if (!current) throw new KanbanNotFoundError(`Kanban proposal not found: ${proposalId}`)
      const now = new Date().toISOString()
      updated = {
        ...current,
        status,
        updatedAtIso: now,
        resolvedAtIso: now,
        resolvedBy: resolution.resolvedBy ?? 'operator',
        reason: resolution.reason?.trim() ?? '',
        resultTaskId,
      } as KanbanProposal
      state.proposals[proposalId] = updated
    })
    if (!updated) throw new KanbanNotFoundError(`Kanban proposal not found: ${proposalId}`)
    const resolvedProposal = updated as KanbanProposal
    this.options.eventBus?.emit({
      type: 'proposal.resolved',
      payload: {
        proposalId: resolvedProposal.id,
        status: resolvedProposal.status,
        resultTaskId: resolvedProposal.resultTaskId,
      },
    })
    return resolvedProposal
  }

  private async applyUpdateProposal(payload: KanbanUpdateProposalPayload): Promise<string> {
    let updatedTaskId = ''
    await this.options.storage.mutate((state: KanbanStateFileV1) => {
      const task = state.tasks[payload.taskId]
      if (!task) throw new KanbanNotFoundError(`Kanban task not found: ${payload.taskId}`)
      const patch = payload.patch
      state.tasks[payload.taskId] = {
        ...task,
        title: patch.title !== undefined ? patch.title.trim() : task.title,
        description: patch.description !== undefined ? patch.description.trim() : task.description,
        labels: patch.labels ?? task.labels,
        blockedReason: patch.blockedReason !== undefined ? patch.blockedReason.trim() : task.blockedReason,
        priority: patch.priority ?? task.priority,
        assignee: patch.assignee ?? task.assignee,
        model: patch.model !== undefined ? patch.model.trim() : task.model,
        thinking: patch.thinking ?? task.thinking,
        dueAtIso: patch.dueAtIso !== undefined ? patch.dueAtIso : task.dueAtIso,
        estimateMinutes: patch.estimateMinutes !== undefined ? patch.estimateMinutes : task.estimateMinutes,
        actualMinutes: patch.actualMinutes !== undefined ? patch.actualMinutes : task.actualMinutes,
        updatedAtIso: new Date().toISOString(),
        version: task.version + 1,
      }
      updatedTaskId = payload.taskId
    })
    return updatedTaskId
  }
}

function assertPendingProposal(proposal: KanbanProposal): void {
  if (proposal.status !== 'pending') {
    throw new KanbanInvalidProposalError(`Kanban proposal is already ${proposal.status}`)
  }
}

function normalizeProposal(value: unknown): KanbanProposal | null {
  if (!isRecord(value) || typeof value.id !== 'string') return null
  if (value.version === 2 && (value.type === 'create' || value.type === 'update')) {
    const status = normalizeStatus(value.status)
    if (!status) return null
    const parsed = safeParseCreateProposalInput({
      type: value.type,
      payload: value.payload,
      sourceRunId: value.sourceRunId,
      sourceThreadId: value.sourceThreadId,
      proposedBy: value.proposedBy,
    })
    if (!parsed) return null
    return {
      id: value.id,
      type: parsed.type,
      payload: parsed.payload,
      sourceRunId: parsed.sourceRunId,
      sourceThreadId: parsed.sourceThreadId,
      proposedBy: parsed.proposedBy,
      status,
      version: 2,
      createdAtIso: readString(value.createdAtIso),
      updatedAtIso: readString(value.updatedAtIso),
      resolvedAtIso: readString(value.resolvedAtIso),
      resolvedBy: readActorOrEmpty(value.resolvedBy),
      reason: readString(value.reason),
      resultTaskId: readString(value.resultTaskId),
    } as KanbanProposal
  }
  if (typeof value.title === 'string') {
    const status = normalizeStatus(value.status)
    const updatedAtIso = readString(value.updatedAtIso)
    return {
      id: value.id,
      type: 'create',
      payload: {
        title: value.title.trim(),
        description: readString(value.description),
      },
      sourceRunId: '',
      sourceThreadId: '',
      proposedBy: 'operator',
      status: status ?? 'pending',
      version: 2,
      createdAtIso: readString(value.createdAtIso),
      updatedAtIso,
      resolvedAtIso: status && status !== 'pending' ? updatedAtIso : '',
      resolvedBy: '',
      reason: '',
      resultTaskId: '',
    }
  }
  return null
}

function safeParseCreateProposalInput(value: unknown): CreateKanbanProposalInput | null {
  try {
    return parseCreateProposalInput(value)
  } catch {
    return null
  }
}

function normalizeStatus(value: unknown): KanbanProposalStatus | null {
  if (value === 'pending' || value === 'approved' || value === 'rejected') return value
  if (value === 'accepted') return 'approved'
  return null
}

function readActorOrEmpty(value: unknown): KanbanActor | '' {
  if (value === '') return ''
  if (value === 'operator' || value === 'codex:auto') return value
  if (typeof value === 'string' && value.startsWith('codex:thread:') && value.length > 'codex:thread:'.length) {
    return value as KanbanActor
  }
  return ''
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
