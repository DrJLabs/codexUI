import { computed, type Ref } from 'vue'
import type { WorkspaceArtifact, WorkspaceArtifactKind } from '../types/workspaceArtifacts'

export type ThreadArtifactTabId = 'plan' | 'run' | 'evidence' | 'review'

export type ThreadArtifactTab = {
  id: ThreadArtifactTabId
  label: string
  count: number
}

const TAB_KIND_MAP: Record<ThreadArtifactTabId, WorkspaceArtifactKind[]> = {
  plan: ['plan'],
  run: ['run_metadata', 'worktree'],
  evidence: ['evidence'],
  review: ['review_packet', 'proposal'],
}

export function useThreadArtifacts(input: {
  threadId: Ref<string>
  artifacts?: Ref<WorkspaceArtifact[]>
}) {
  const allArtifacts = computed(() => {
    const threadId = input.threadId.value.trim()
    if (!threadId) return []
    return (input.artifacts?.value ?? []).filter((artifact) => artifact.threadId === threadId)
  })

  const tabs = computed<ThreadArtifactTab[]>(() => [
    { id: 'plan', label: 'Plan', count: countArtifacts(allArtifacts.value, TAB_KIND_MAP.plan) },
    { id: 'run', label: 'Run', count: countArtifacts(allArtifacts.value, TAB_KIND_MAP.run) },
    { id: 'evidence', label: 'Evidence', count: countArtifacts(allArtifacts.value, TAB_KIND_MAP.evidence) },
    { id: 'review', label: 'Review', count: countArtifacts(allArtifacts.value, TAB_KIND_MAP.review) },
  ])

  function artifactsForTab(tabId: ThreadArtifactTabId): WorkspaceArtifact[] {
    const kinds = TAB_KIND_MAP[tabId]
    return allArtifacts.value.filter((artifact) => kinds.includes(artifact.kind))
  }

  return {
    allArtifacts,
    tabs,
    artifactsForTab,
  }
}

function countArtifacts(artifacts: WorkspaceArtifact[], kinds: WorkspaceArtifactKind[]): number {
  return artifacts.filter((artifact) => kinds.includes(artifact.kind)).length
}
