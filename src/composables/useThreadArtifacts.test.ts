import { ref } from 'vue'
import { describe, expect, it } from 'vitest'
import { useThreadArtifacts } from './useThreadArtifacts'
import type { WorkspaceArtifact } from '../types/workspaceArtifacts'

describe('useThreadArtifacts', () => {
  it('filters artifacts to the active thread and groups counts by sidebar tab', () => {
    const threadId = ref('thread_1')
    const artifacts = ref<WorkspaceArtifact[]>([
      { id: 'plan_1', kind: 'plan', source: 'thread', title: 'Plan', threadId: 'thread_1' },
      { id: 'run_1', kind: 'run_metadata', source: 'kanban', title: 'Run', threadId: 'thread_1', runId: 'run_1' },
      { id: 'proposal_1', kind: 'proposal', source: 'kanban', title: 'Proposal', threadId: 'thread_1', proposalId: 'proposal_1' },
      { id: 'other_1', kind: 'evidence', source: 'kanban', title: 'Other', threadId: 'thread_2' },
    ])

    const model = useThreadArtifacts({ threadId, artifacts })

    expect(model.allArtifacts.value.map((artifact) => artifact.id)).toEqual(['plan_1', 'run_1', 'proposal_1'])
    expect(model.tabs.value.map((tab) => [tab.id, tab.count])).toEqual([
      ['plan', 1],
      ['run', 1],
      ['evidence', 0],
      ['review', 1],
    ])
    expect(model.artifactsForTab('review').map((artifact) => artifact.id)).toEqual(['proposal_1'])
  })
})
