import type { WorkspaceArtifact, WorkspaceArtifactQuery } from '../../types/workspaceArtifacts'

const KIND_ORDER = new Map([
  ['plan', 0],
  ['run_metadata', 1],
  ['evidence', 2],
  ['worktree', 3],
  ['review_packet', 4],
  ['proposal', 5],
])

export type WorkspaceArtifactProvider = {
  source: string
  listArtifacts(): Promise<WorkspaceArtifact[]>
  resolveArtifactContent?: (artifact: WorkspaceArtifact, options?: { maxBytes?: number }) => Promise<WorkspaceArtifactContent | null>
}

export type WorkspaceArtifactContent = {
  contentType: string
  filename: string
  body: string | Buffer
  encoding: 'utf8' | 'binary'
}

export class WorkspaceArtifactIndex {
  constructor(private readonly providers: WorkspaceArtifactProvider[]) {}

  async listArtifacts(query: WorkspaceArtifactQuery = {}): Promise<WorkspaceArtifact[]> {
    const nestedArtifacts = await Promise.all(this.providers.map((provider) => provider.listArtifacts()))
    return nestedArtifacts
      .flat()
      .filter((artifact) => matchesQuery(artifact, query))
      .sort(compareArtifacts)
  }

  async getArtifact(artifactId: string): Promise<WorkspaceArtifact | null> {
    const artifacts = await this.listArtifacts()
    return artifacts.find((artifact) => artifact.id === artifactId) ?? null
  }

  async resolveArtifactContent(artifact: WorkspaceArtifact, options: { maxBytes?: number } = {}): Promise<WorkspaceArtifactContent | null> {
    const provider = this.providers.find((candidate) => candidate.source === artifact.source)
    return await provider?.resolveArtifactContent?.(artifact, options) ?? null
  }
}

function matchesQuery(artifact: WorkspaceArtifact, query: WorkspaceArtifactQuery): boolean {
  return (!query.source || artifact.source === query.source)
    && (!query.kind || artifact.kind === query.kind)
    && (!query.taskId || artifact.taskId === query.taskId)
    && (!query.automationId || artifact.automationId === query.automationId)
    && (!query.runId || artifact.runId === query.runId)
    && (!query.threadId || artifact.threadId === query.threadId)
}

function compareArtifacts(left: WorkspaceArtifact, right: WorkspaceArtifact): number {
  return (KIND_ORDER.get(left.kind) ?? 99) - (KIND_ORDER.get(right.kind) ?? 99)
    || (left.createdAtIso ?? '').localeCompare(right.createdAtIso ?? '')
    || left.id.localeCompare(right.id)
}
