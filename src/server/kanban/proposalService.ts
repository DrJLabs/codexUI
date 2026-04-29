import type { KanbanProposal } from '../../types/kanban'
import { createKanbanId } from './ids'
import type { KanbanStateFileV1 } from './migrations'
import { KanbanStorage } from './storage'
import { KanbanTaskService } from './taskService'

export class KanbanProposalService {
  constructor(private readonly options: { storage: KanbanStorage; taskService: KanbanTaskService }) {}

  async listProposals(): Promise<KanbanProposal[]> {
    const state = await this.options.storage.load()
    return Object.values(state.proposals).filter(isProposal)
  }

  async createProposal(input: { title: string; description?: string }): Promise<KanbanProposal> {
    const now = new Date().toISOString()
    const proposal: KanbanProposal = {
      id: createKanbanId('proposal'),
      title: input.title.trim(),
      description: input.description?.trim() ?? '',
      status: 'pending',
      createdAtIso: now,
      updatedAtIso: now,
    }
    await this.options.storage.mutate((state: KanbanStateFileV1) => {
      state.proposals[proposal.id] = proposal
    })
    return proposal
  }

  async acceptProposal(proposalId: string): Promise<KanbanProposal> {
    const proposal = await this.updateProposalStatus(proposalId, 'accepted')
    await this.options.taskService.createTask({
      title: proposal.title,
      description: proposal.description,
    })
    return proposal
  }

  async rejectProposal(proposalId: string): Promise<KanbanProposal> {
    return await this.updateProposalStatus(proposalId, 'rejected')
  }

  private async updateProposalStatus(proposalId: string, status: KanbanProposal['status']): Promise<KanbanProposal> {
    let updated: KanbanProposal | null = null
    await this.options.storage.mutate((state: KanbanStateFileV1) => {
      const current = state.proposals[proposalId]
      if (!isProposal(current)) throw new Error(`Kanban proposal not found: ${proposalId}`)
      updated = {
        ...current,
        status,
        updatedAtIso: new Date().toISOString(),
      }
      state.proposals[proposalId] = updated
    })
    if (!updated) throw new Error(`Kanban proposal not found: ${proposalId}`)
    return updated
  }
}

function isProposal(value: unknown): value is KanbanProposal {
  return value !== null && typeof value === 'object' && typeof (value as { id?: unknown }).id === 'string'
}
