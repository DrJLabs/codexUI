<template>
  <aside class="thread-artifact-sidebar" aria-label="Thread artifacts">
    <header class="thread-artifact-sidebar-header">
      <div>
        <p>Workspace inspector</p>
        <strong>{{ threadId ? 'Thread workspace' : 'No thread selected' }}</strong>
      </div>
      <span>{{ allArtifacts.length }}</span>
    </header>

    <nav
      v-if="workspaceModel"
      class="thread-artifact-section-menu"
      aria-label="Workspace sections"
    >
      <button
        v-for="section in workspaceModel.sections"
        :key="section.id"
        type="button"
        class="thread-artifact-section-button"
        :class="{ 'is-active': isSectionActive(section.id) }"
        :disabled="!section.enabled"
        :title="section.reason"
        :aria-current="isSectionActive(section.id) ? 'page' : undefined"
        :aria-describedby="section.reason ? `thread-artifact-section-reason-${section.id}` : undefined"
        @click="selectWorkspaceSection(section)"
      >
        <span class="thread-artifact-section-label">
          <span>{{ section.label }}</span>
          <span
            v-if="section.reason"
            :id="`thread-artifact-section-reason-${section.id}`"
            class="thread-artifact-section-reason"
          >
            {{ section.reason }}
          </span>
        </span>
        <small>{{ section.deferred ? 'Later' : section.count }}</small>
      </button>
    </nav>

    <section
      v-if="isSectionActive('thread')"
      class="thread-artifact-panel"
      aria-label="Thread artifact panel"
    >
      <div class="thread-artifact-panel-heading">
        <strong>{{ panelTitle('thread') }}</strong>
        <span>{{ panelCopy('thread') }}</span>
      </div>
      <ArtifactTabs v-model="activeTab" :tabs="tabs" />
      <p
        v-if="threadProposalSection"
        class="thread-artifact-subsection-note"
      >
        <strong>{{ threadProposalSection.label }}</strong>
        <span>{{ threadProposalSection.count }} tracked with Review</span>
      </p>
      <section class="thread-artifact-sidebar-body">
        <ArtifactEmptyState
          v-if="visibleThreadArtifacts.length === 0"
          :title="threadEmptyTitle"
          :copy="emptyCopy('thread')"
        />
        <article
          v-for="artifact in visibleThreadArtifacts"
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
        v-if="activeTab === 'run'"
        name="Default"
        summary="Run details will appear when a thread or Kanban task records execution artifacts."
      />
    </section>

    <section
      v-else-if="isSectionActive('worktrees')"
      class="thread-artifact-panel"
      aria-label="Thread worktrees panel"
    >
      <div class="thread-artifact-panel-heading">
        <strong>{{ panelTitle('worktrees') }}</strong>
        <span>{{ panelCopy('worktrees') }}</span>
      </div>
      <section class="thread-artifact-sidebar-body">
        <ArtifactEmptyState
          v-if="worktreeArtifacts.length === 0"
          :title="panelTitle('worktrees')"
          :copy="emptyCopy('worktrees')"
        />
        <article
          v-for="artifact in worktreeArtifacts"
          v-else
          :key="artifact.id"
          class="thread-artifact-item"
        >
          <p>{{ artifact.kind.replace(/_/g, ' ') }}</p>
          <strong>{{ artifact.title }}</strong>
        </article>
      </section>
    </section>

    <section
      v-else-if="isSectionActive('artifacts')"
      class="thread-artifact-panel"
      aria-label="All thread artifacts panel"
    >
      <div class="thread-artifact-panel-heading">
        <strong>{{ panelTitle('artifacts') }}</strong>
        <span>{{ panelCopy('artifacts') }}</span>
      </div>
      <section class="thread-artifact-sidebar-body">
        <ArtifactEmptyState
          v-if="allArtifacts.length === 0"
          :title="panelTitle('artifacts')"
          :copy="emptyCopy('artifacts')"
        />
        <article
          v-for="artifact in allArtifacts"
          v-else
          :key="artifact.id"
          class="thread-artifact-item"
        >
          <p>{{ artifact.kind.replace(/_/g, ' ') }}</p>
          <strong>{{ artifact.title }}</strong>
        </article>
      </section>
    </section>

    <section
      v-else
      class="thread-artifact-panel thread-artifact-deferred-panel"
      :aria-label="`${panelTitle(activeSectionId)} panel`"
    >
      <div class="thread-artifact-panel-heading">
        <strong>{{ panelTitle(activeSectionId) }}</strong>
        <span>{{ panelCopy(activeSectionId) }}</span>
      </div>
      <p class="thread-artifact-deferred-note">
        {{ deferredPanelReason }}
      </p>
      <p
        v-if="activeSectionId === 'kanban'"
        class="thread-artifact-inert-action"
      >
        Open board
      </p>
    </section>
  </aside>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { KanbanReviewPacket } from '../../types/kanban'
import type { WorkspaceProposal } from '../../types/proposal'
import type { ThreadWorkspaceDrawerSection, ThreadWorkspaceModel, ThreadWorkspaceSectionId } from '../../types/threadWorkspace'
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
  workspaceModel?: ThreadWorkspaceModel | null
}>(), {
  artifacts: () => [],
  reviewPacket: null,
  proposals: () => [],
  workspaceModel: null,
})

const activeTab = ref<ThreadArtifactTabId>('plan')
const activeSectionId = ref<ThreadWorkspaceSectionId>(props.workspaceModel?.activeSectionId ?? 'artifacts')
const threadIdRef = computed(() => props.threadId)
const artifactRef = computed(() => props.artifacts)
const { allArtifacts, tabs, artifactsForTab } = useThreadArtifacts({
  threadId: threadIdRef,
  artifacts: artifactRef,
})
const visibleThreadArtifacts = computed(() => artifactsForTab(activeTab.value))
const worktreeArtifacts = computed(() => artifactsForKinds(['run_metadata', 'worktree']))
const threadEmptyTitle = computed(() => `${tabs.value.find((tab) => tab.id === activeTab.value)?.label ?? 'Artifact'} artifacts`)
const threadProposalSection = computed(() => props.workspaceModel?.threadArtifactSections.find((section) => section.id === 'proposals') ?? null)
const deferredPanelReason = computed(() => {
  const section = props.workspaceModel?.sections.find((item) => item.id === activeSectionId.value)
  return section?.reason || panelCopy(activeSectionId.value)
})

watch(
  () => props.workspaceModel?.activeSectionId,
  (sectionId) => {
    activeSectionId.value = sectionId ?? 'artifacts'
  },
)

function selectWorkspaceSection(section: ThreadWorkspaceDrawerSection): void {
  if (!section.enabled) return
  activeSectionId.value = section.id
}

function isSectionActive(sectionId: ThreadWorkspaceSectionId): boolean {
  return activeSectionId.value === sectionId
}

function artifactsForKinds(kinds: WorkspaceArtifact['kind'][]): WorkspaceArtifact[] {
  return allArtifacts.value.filter((artifact) => kinds.includes(artifact.kind))
}

function panelTitle(sectionId: ThreadWorkspaceSectionId): string {
  const section = props.workspaceModel?.sections.find((item) => item.id === sectionId)
  if (section) return section.label
  if (sectionId === 'worktrees') return 'Worktrees'
  if (sectionId === 'automations') return 'Automations'
  return sectionId.charAt(0).toUpperCase() + sectionId.slice(1)
}

function panelCopy(sectionId: ThreadWorkspaceSectionId): string {
  if (sectionId === 'thread') return 'Plan, run, evidence, review, and proposal artifacts for the selected thread.'
  if (sectionId === 'kanban') return 'Kanban context is available here after the sidebar wiring phase.'
  if (sectionId === 'automations') return 'Automation controls are deferred to the later automations feature plan.'
  if (sectionId === 'worktrees') return 'Run and worktree artifacts recorded for this thread.'
  if (sectionId === 'artifacts') return 'All indexed artifacts recorded for this thread.'
  if (sectionId === 'actions') return 'Local action wiring is deferred until the action contract is connected.'
  return 'Permission controls are deferred to a later phase.'
}

function emptyCopy(sectionId: ThreadWorkspaceSectionId): string {
  if (!props.threadId && sectionId !== 'artifacts') return 'Select a thread to inspect workspace context.'
  if (!props.threadId) return 'Select a thread to inspect workspace artifacts.'
  if (sectionId === 'worktrees') return 'No run or worktree artifacts have been recorded for this thread yet.'
  if (sectionId === 'artifacts') return 'No artifacts have been recorded for this thread yet.'
  return 'No artifacts have been recorded for this thread section yet.'
}
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

.thread-artifact-section-menu {
  display: grid;
  gap: 6px;
}

.thread-artifact-section-button {
  display: flex;
  min-height: 38px;
  align-items: start;
  justify-content: space-between;
  gap: 8px;
  border: 1px solid #e4e4e7;
  border-radius: 8px;
  background: #fff;
  padding: 7px 9px;
  color: #27272a;
  font-size: 12px;
  font-weight: 800;
  cursor: pointer;
}

.thread-artifact-section-button.is-active {
  border-color: #18181b;
  background: #18181b;
  color: #fafafa;
}

.thread-artifact-section-button.is-active small,
.thread-artifact-section-button.is-active .thread-artifact-section-reason {
  color: #d4d4d8;
}

.thread-artifact-section-label {
  display: grid;
  gap: 3px;
  text-align: left;
}

.thread-artifact-section-reason {
  color: #71717a;
  font-size: 11px;
  font-weight: 700;
  line-height: 1.25;
}

.thread-artifact-section-button:disabled {
  cursor: default;
  opacity: 0.55;
}

.thread-artifact-section-button small {
  color: #71717a;
  font-size: 11px;
  font-weight: 800;
}

.thread-artifact-panel {
  display: grid;
  gap: 10px;
  min-width: 0;
}

.thread-artifact-panel-heading {
  display: grid;
  gap: 4px;
}

.thread-artifact-panel-heading strong {
  color: #18181b;
  font-size: 13px;
  font-weight: 900;
}

.thread-artifact-panel-heading span {
  color: #71717a;
  font-size: 12px;
  font-weight: 700;
  line-height: 1.35;
}

.thread-artifact-subsection-note {
  display: flex;
  min-height: 30px;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin: 0;
  border: 1px dashed #d4d4d8;
  border-radius: 8px;
  padding: 6px 8px;
}

.thread-artifact-subsection-note strong {
  color: #27272a;
  font-size: 11px;
  font-weight: 900;
}

.thread-artifact-subsection-note span {
  color: #71717a;
  font-size: 11px;
  font-weight: 800;
}

.thread-artifact-deferred-note {
  margin: 0;
  border: 1px dashed #d4d4d8;
  border-radius: 8px;
  padding: 8px;
  color: #71717a;
  font-size: 11px;
  font-weight: 750;
  line-height: 1.35;
}

.thread-artifact-inert-action {
  margin: 0;
  color: #3f3f46;
  font-size: 12px;
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
:global(:root.dark) .thread-artifact-panel-heading strong,
:global(:root.dark) .thread-artifact-subsection-note strong,
:global(:root.dark) .thread-artifact-item strong {
  color: #f4f4f5;
}

:global(:root.dark) .thread-artifact-sidebar-header p,
:global(:root.dark) .thread-artifact-item p,
:global(:root.dark) .thread-artifact-section-button small,
:global(:root.dark) .thread-artifact-section-reason,
:global(:root.dark) .thread-artifact-panel-heading span,
:global(:root.dark) .thread-artifact-subsection-note span,
:global(:root.dark) .thread-artifact-deferred-note {
  color: #a1a1aa;
}

:global(:root.dark) .thread-artifact-sidebar-header span {
  background: #27272a;
  color: #d4d4d8;
}

:global(:root.dark) .thread-artifact-item {
  border-color: #3f3f46;
}

:global(:root.dark) .thread-artifact-section-button {
  border-color: #3f3f46;
  background: #18181b;
  color: #f4f4f5;
}

:global(:root.dark) .thread-artifact-section-button.is-active {
  border-color: #f4f4f5;
  background: #f4f4f5;
  color: #18181b;
}

:global(:root.dark) .thread-artifact-section-button.is-active small,
:global(:root.dark) .thread-artifact-section-button.is-active .thread-artifact-section-reason {
  color: #52525b;
}

:global(:root.dark) .thread-artifact-deferred-note {
  border-color: #52525b;
}

:global(:root.dark) .thread-artifact-subsection-note {
  border-color: #52525b;
}

:global(:root.dark) .thread-artifact-inert-action {
  color: #e4e4e7;
}
</style>
