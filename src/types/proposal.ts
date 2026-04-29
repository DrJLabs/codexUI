import type { KanbanProposal } from './kanban'

export type WorkspaceProposalStatus = 'pending' | 'approved' | 'rejected'

export type WorkspaceProposal = {
  id: string
  type: 'create' | 'update'
  status: WorkspaceProposalStatus
  title: string
  summary: string
  taskId: string
  sourceRunId: string
  sourceThreadId: string
  proposedBy: string
  createdAtIso: string
  resolvedAtIso: string
  resolvedBy: string
  reason: string
  resultTaskId: string
}

export function toWorkspaceProposal(proposal: KanbanProposal): WorkspaceProposal {
  return {
    id: proposal.id,
    type: proposal.type,
    status: proposal.status,
    title: proposalTitle(proposal),
    summary: proposalSummary(proposal),
    taskId: proposalTaskId(proposal),
    sourceRunId: proposal.sourceRunId,
    sourceThreadId: proposal.sourceThreadId,
    proposedBy: proposal.proposedBy,
    createdAtIso: proposal.createdAtIso,
    resolvedAtIso: proposal.resolvedAtIso,
    resolvedBy: proposal.resolvedBy,
    reason: proposal.reason,
    resultTaskId: proposal.resultTaskId,
  }
}

function proposalTitle(proposal: KanbanProposal): string {
  if (proposal.type === 'create') {
    const payload = asRecord(proposal.payload)
    const title = payload && typeof payload.title === 'string' ? payload.title.trim() : ''
    return title || 'Create task proposal'
  }
  const patch = updatePatch(proposal)
  const title = patch && typeof patch.title === 'string' ? patch.title.trim() : ''
  const taskId = proposalTaskId(proposal)
  if (title) return title
  return taskId ? `Update ${taskId}` : 'Update task proposal'
}

function proposalSummary(proposal: KanbanProposal): string {
  if (proposal.type === 'create') {
    const payload = asRecord(proposal.payload)
    if (!payload) return 'Proposal payload is unavailable.'
    const parts = [
      typeof payload.description === 'string' ? payload.description : '',
      typeof payload.priority === 'string' ? `priority: ${payload.priority}` : '',
      typeof payload.assignee === 'string' ? `assignee: ${payload.assignee}` : '',
    ].filter(Boolean)
    return parts.length > 0 ? parts.join(' | ') : 'Create a task with the proposed fields.'
  }
  const patch = updatePatch(proposal)
  if (!patch) return 'Proposal payload is unavailable.'
  const keys = Object.keys(patch)
  if (keys.length === 0) return 'No recognized update fields.'
  return keys.map((key) => `${key}: ${formatPatchValue(patch[key])}`).join(' | ')
}

function proposalTaskId(proposal: KanbanProposal): string {
  if (proposal.type !== 'update') return ''
  const payload = asRecord(proposal.payload)
  return payload && typeof payload.taskId === 'string' ? payload.taskId : ''
}

function updatePatch(proposal: KanbanProposal): Record<string, unknown> | null {
  if (proposal.type !== 'update') return null
  const payload = asRecord(proposal.payload)
  return asRecord(payload?.patch)
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function formatPatchValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return 'empty'
  if (Array.isArray(value)) return `${value.length} item${value.length === 1 ? '' : 's'}`
  if (typeof value === 'object') return 'object'
  return String(value)
}
