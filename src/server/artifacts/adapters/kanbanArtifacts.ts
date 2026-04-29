import type { KanbanProposal, KanbanReviewPacket, KanbanRun, KanbanTask } from '../../../types/kanban'
import type { WorkspaceArtifact } from '../../../types/workspaceArtifacts'
import type { KanbanStateFileV1 } from '../../kanban/migrations'
import type { KanbanStorage } from '../../kanban/storage'

export function createKanbanWorkspaceArtifactProvider(storage: KanbanStorage): {
  source: 'kanban'
  listArtifacts(): Promise<WorkspaceArtifact[]>
} {
  return {
    source: 'kanban',
    async listArtifacts() {
      return listKanbanWorkspaceArtifacts(await storage.load())
    },
  }
}

export function listKanbanWorkspaceArtifacts(state: KanbanStateFileV1): WorkspaceArtifact[] {
  const artifacts: WorkspaceArtifact[] = []
  const tasks = Object.values(state.tasks)
  const taskById = new Map(tasks.map((task) => [task.id, task]))
  const runById = new Map<string, KanbanRun>()
  for (const value of Object.values(state.runs)) {
    if (isKanbanRun(value)) runById.set(value.id, value)
  }

  for (const task of tasks) {
    artifacts.push(createPlanArtifact(task))
  }
  for (const run of runById.values()) {
    const task = taskById.get(run.taskId)
    artifacts.push(createRunMetadataArtifact(run, task))
    artifacts.push(createEvidenceArtifact(run, task))
    if (run.worktreePath) {
      artifacts.push(createWorktreeArtifact(run, task))
    }
  }
  for (const value of Object.values(state.reviewPackets)) {
    if (!isReviewPacket(value)) continue
    const task = taskById.get(value.taskId)
    const run = runById.get(value.runId)
    artifacts.push({
      id: `kanban:review_packet:${value.id}`,
      kind: 'review_packet',
      source: 'kanban',
      title: `Review packet ${value.id}`,
      packetId: value.id,
      taskId: value.taskId,
      runId: value.runId,
      threadId: run?.threadId ?? task?.codexThreadId,
      createdAtIso: value.generatedAtIso,
      updatedAtIso: value.generatedAtIso,
    })
  }
  for (const value of Object.values(state.proposals)) {
    if (!isProposal(value)) continue
    const taskId = value.type === 'update' ? value.payload.taskId : value.resultTaskId || undefined
    artifacts.push({
      id: `kanban:proposal:${value.id}`,
      kind: 'proposal',
      source: 'kanban',
      title: `${value.status} ${value.type} proposal`,
      proposalId: value.id,
      taskId,
      runId: value.sourceRunId,
      threadId: value.sourceThreadId,
      status: value.status,
      createdAtIso: value.createdAtIso,
      updatedAtIso: value.updatedAtIso,
    })
  }
  return artifacts
}

function createPlanArtifact(task: KanbanTask): WorkspaceArtifact {
  return {
    id: `kanban:plan:${task.id}`,
    kind: 'plan',
    source: 'kanban',
    title: task.title,
    taskId: task.id,
    threadId: task.codexThreadId || undefined,
    createdAtIso: task.createdAtIso,
    updatedAtIso: task.updatedAtIso,
  }
}

function createRunMetadataArtifact(run: KanbanRun, task?: KanbanTask): WorkspaceArtifact {
  return {
    id: `kanban:run:${run.id}`,
    kind: 'run_metadata',
    source: 'kanban',
    title: `Run ${run.id}`,
    runId: run.id,
    taskId: run.taskId,
    threadId: run.threadId || task?.codexThreadId,
    state: run.state,
    createdAtIso: run.createdAtIso,
    updatedAtIso: run.updatedAtIso,
  }
}

function createEvidenceArtifact(run: KanbanRun, task?: KanbanTask): WorkspaceArtifact {
  return {
    id: `kanban:evidence:${run.id}`,
    kind: 'evidence',
    source: 'kanban',
    title: `Run evidence ${run.id}`,
    runId: run.id,
    taskId: run.taskId,
    threadId: run.threadId || task?.codexThreadId,
    logPath: run.logPath,
    eventsPath: run.eventsPath,
    createdAtIso: run.createdAtIso,
    updatedAtIso: run.updatedAtIso,
  }
}

function createWorktreeArtifact(run: KanbanRun, task?: KanbanTask): WorkspaceArtifact {
  return {
    id: `kanban:worktree:${run.id}`,
    kind: 'worktree',
    source: 'kanban',
    title: run.branchName || run.worktreePath,
    worktreePath: run.worktreePath,
    branchName: run.branchName,
    runId: run.id,
    taskId: run.taskId,
    threadId: run.threadId || task?.codexThreadId,
    createdAtIso: run.createdAtIso,
    updatedAtIso: run.updatedAtIso,
  }
}

function isKanbanRun(value: unknown): value is KanbanRun {
  return isRecord(value) && typeof value.id === 'string' && typeof value.taskId === 'string'
}

function isReviewPacket(value: unknown): value is KanbanReviewPacket {
  return isRecord(value) && typeof value.id === 'string' && typeof value.packetHash === 'string'
}

function isProposal(value: unknown): value is KanbanProposal {
  return isRecord(value)
    && typeof value.id === 'string'
    && (value.type === 'create' || value.type === 'update')
    && (value.status === 'pending' || value.status === 'approved' || value.status === 'rejected')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
