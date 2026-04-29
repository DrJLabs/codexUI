import type { KanbanProposal } from '../../../types/kanban'
import { toWorkspaceProposal, type WorkspaceProposal } from '../../../types/proposal'

export function listKanbanWorkspaceProposals(proposals: KanbanProposal[]): WorkspaceProposal[] {
  return proposals.map(toWorkspaceProposal)
}

export function listPendingKanbanWorkspaceProposals(proposals: KanbanProposal[]): WorkspaceProposal[] {
  return proposals
    .filter((proposal) => proposal.status === 'pending')
    .map(toWorkspaceProposal)
}
