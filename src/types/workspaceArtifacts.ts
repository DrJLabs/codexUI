export type WorkspaceArtifactKind =
  | 'plan'
  | 'run_metadata'
  | 'evidence'
  | 'review_packet'
  | 'proposal'
  | 'worktree'

export type WorkspaceArtifactSource = 'thread' | 'kanban'

type WorkspaceArtifactBase = {
  id: string
  kind: WorkspaceArtifactKind
  source: WorkspaceArtifactSource
  title: string
  taskId?: string
  threadId?: string
  runId?: string
  createdAtIso?: string
  updatedAtIso?: string
}

export type WorkspaceArtifact =
  | (WorkspaceArtifactBase & {
    kind: 'plan'
    taskId?: string
    threadId?: string
  })
  | (WorkspaceArtifactBase & {
    kind: 'run_metadata'
    runId: string
    taskId?: string
    threadId?: string
    state?: string
  })
  | (WorkspaceArtifactBase & {
    kind: 'evidence'
    runId?: string
    taskId?: string
    threadId?: string
    logPath?: string
    eventsPath?: string
  })
  | (WorkspaceArtifactBase & {
    kind: 'review_packet'
    packetId: string
    taskId?: string
    runId?: string
    threadId?: string
  })
  | (WorkspaceArtifactBase & {
    kind: 'proposal'
    proposalId: string
    taskId?: string
    runId?: string
    threadId?: string
    status?: string
  })
  | (WorkspaceArtifactBase & {
    kind: 'worktree'
    worktreePath: string
    runId?: string
    taskId?: string
    threadId?: string
    branchName?: string
  })

export type WorkspaceArtifactQuery = {
  source?: WorkspaceArtifactSource
  kind?: WorkspaceArtifactKind
  taskId?: string
  runId?: string
  threadId?: string
}
