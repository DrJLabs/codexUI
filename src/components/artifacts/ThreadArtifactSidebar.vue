<template>
  <aside class="thread-artifact-sidebar" aria-label="Thread artifacts">
    <header class="thread-artifact-sidebar-header">
      <div>
        <p>Artifacts</p>
        <strong>{{ threadId ? 'Thread workspace' : 'No thread selected' }}</strong>
      </div>
      <span>{{ allArtifacts.length }}</span>
    </header>
    <ArtifactTabs v-model="activeTab" :tabs="tabs" />
    <section class="thread-artifact-sidebar-body">
      <ArtifactEmptyState
        v-if="visibleArtifacts.length === 0"
        :title="emptyTitle"
        :copy="emptyCopy"
      />
      <article
        v-for="artifact in visibleArtifacts"
        v-else
        :key="artifact.id"
        class="thread-artifact-item"
      >
        <p>{{ artifact.kind.replace(/_/g, ' ') }}</p>
        <strong>{{ artifact.title }}</strong>
      </article>
    </section>
    <ArtifactReviewPacketPanel
      v-if="activeTab === 'review' && reviewPacket"
      :packet="reviewPacket"
      title="Thread review packet"
    />
    <ArtifactProposalsPanel
      v-if="activeTab === 'review' && proposals.length > 0"
      :proposals="proposals"
      title="Thread proposals"
      status-label="pending"
    />
    <RunProfileSummaryCard
      name="Default"
      summary="Run details will appear when a thread or Kanban task records execution artifacts."
    />
  </aside>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import type { KanbanReviewPacket } from '../../types/kanban'
import type { WorkspaceProposal } from '../../types/proposal'
import type { WorkspaceArtifact } from '../../types/workspaceArtifacts'
import { useThreadArtifacts, type ThreadArtifactTabId } from '../../composables/useThreadArtifacts'
import ArtifactEmptyState from './ArtifactEmptyState.vue'
import ArtifactProposalsPanel from './proposals/ArtifactProposalsPanel.vue'
import ArtifactReviewPacketPanel from './review/ArtifactReviewPacketPanel.vue'
import ArtifactTabs from './ArtifactTabs.vue'
import RunProfileSummaryCard from './RunProfileSummaryCard.vue'

const props = withDefaults(defineProps<{
  threadId: string
  artifacts?: WorkspaceArtifact[]
  reviewPacket?: KanbanReviewPacket | null
  proposals?: WorkspaceProposal[]
}>(), {
  artifacts: () => [],
  reviewPacket: null,
  proposals: () => [],
})

const activeTab = ref<ThreadArtifactTabId>('plan')
const threadIdRef = computed(() => props.threadId)
const artifactRef = computed(() => props.artifacts)
const { allArtifacts, tabs, artifactsForTab } = useThreadArtifacts({
  threadId: threadIdRef,
  artifacts: artifactRef,
})
const visibleArtifacts = computed(() => artifactsForTab(activeTab.value))
const emptyTitle = computed(() => `${tabs.value.find((tab) => tab.id === activeTab.value)?.label ?? 'Artifact'} artifacts`)
const emptyCopy = computed(() => props.threadId
  ? 'No artifacts have been recorded for this thread yet.'
  : 'Select a thread to inspect workspace artifacts.')
</script>

<style scoped>
.thread-artifact-sidebar {
  display: grid;
  align-content: start;
  gap: 10px;
  min-width: 0;
  border: 1px solid #e4e4e7;
  border-radius: 8px;
  padding: 10px;
  background: #fff;
}

.thread-artifact-sidebar-header {
  display: flex;
  align-items: start;
  justify-content: space-between;
  gap: 8px;
}

.thread-artifact-sidebar-header p,
.thread-artifact-item p {
  margin: 0;
  color: #71717a;
  font-size: 10px;
  font-weight: 900;
  text-transform: uppercase;
}

.thread-artifact-sidebar-header strong {
  color: #18181b;
  font-size: 14px;
  font-weight: 900;
}

.thread-artifact-sidebar-header span {
  display: grid;
  min-width: 24px;
  height: 24px;
  place-items: center;
  border-radius: 999px;
  background: #f4f4f5;
  color: #52525b;
  font-size: 11px;
  font-weight: 900;
}

.thread-artifact-sidebar-body {
  display: grid;
  gap: 8px;
}

.thread-artifact-item {
  display: grid;
  gap: 3px;
  border: 1px solid #e4e4e7;
  border-radius: 8px;
  padding: 10px;
}

.thread-artifact-item strong {
  color: #18181b;
  font-size: 12px;
  font-weight: 900;
}

:global(:root.dark) .thread-artifact-sidebar {
  border-color: #3f3f46;
  background: #09090b;
}

:global(:root.dark) .thread-artifact-sidebar-header strong,
:global(:root.dark) .thread-artifact-item strong {
  color: #f4f4f5;
}

:global(:root.dark) .thread-artifact-sidebar-header p,
:global(:root.dark) .thread-artifact-item p {
  color: #a1a1aa;
}

:global(:root.dark) .thread-artifact-sidebar-header span {
  background: #27272a;
  color: #d4d4d8;
}

:global(:root.dark) .thread-artifact-item {
  border-color: #3f3f46;
}
</style>
