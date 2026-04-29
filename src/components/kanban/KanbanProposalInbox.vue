<template>
  <ArtifactProposalsPanel
    :proposals="workspaceProposals"
    :status-label="status"
    :error-message="errorMessage"
    :is-resolving="isResolving"
    @approve="emit('approve', $event)"
    @reject="emit('reject', $event)"
  >
    <template #tabs>
      <div class="kanban-proposal-tabs" role="group" aria-label="Proposal status">
        <button
          v-for="item in statusOptions"
          :key="item"
          class="kanban-proposal-tab"
          :class="{ 'is-active': item === status }"
          type="button"
          :aria-pressed="item === status"
          @click="emit('update:status', item)"
        >
          {{ item }}
        </button>
      </div>
    </template>
  </ArtifactProposalsPanel>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { KanbanProposal, KanbanProposalStatus } from '../../types/kanban'
import { toWorkspaceProposal } from '../../types/proposal'
import ArtifactProposalsPanel from '../artifacts/proposals/ArtifactProposalsPanel.vue'

const props = defineProps<{
  proposals: KanbanProposal[]
  status: KanbanProposalStatus
  errorMessage: string
  isResolving: boolean
}>()

const emit = defineEmits<{
  'update:status': [status: KanbanProposalStatus]
  approve: [proposalId: string]
  reject: [proposalId: string]
}>()

const statusOptions: KanbanProposalStatus[] = ['pending', 'approved', 'rejected']
const workspaceProposals = computed(() => props.proposals.map(toWorkspaceProposal))
</script>

<style scoped>
.kanban-proposal-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.kanban-proposal-tab {
  border: 1px solid #d4d4d8;
  border-radius: 6px;
  padding: 6px 9px;
  background: #fafafa;
  color: #27272a;
  font-size: 12px;
  font-weight: 800;
  text-transform: capitalize;
}

.kanban-proposal-tab.is-active {
  border-color: #2563eb;
  background: #2563eb;
  color: #fff;
}

@media (max-width: 640px) {
  .kanban-proposal-tabs {
    width: 100%;
  }
}

:global(:root.dark) .kanban-proposal-tab {
  border-color: #52525b;
  background: #27272a;
  color: #f4f4f5;
}

:global(:root.dark) .kanban-proposal-tab.is-active {
  border-color: #3b82f6;
  background: #2563eb;
  color: #fff;
}
</style>
