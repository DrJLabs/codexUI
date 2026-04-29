<template>
  <section class="artifact-proposals-panel" aria-labelledby="artifact-proposals-title">
    <header class="artifact-proposals-header">
      <div>
        <h2 id="artifact-proposals-title">{{ title }}</h2>
        <p>{{ proposals.length }} {{ statusLabel }} proposal{{ proposals.length === 1 ? '' : 's' }}</p>
      </div>
      <slot name="tabs" />
    </header>

    <p v-if="errorMessage" class="artifact-proposals-error" role="alert">{{ errorMessage }}</p>
    <p v-else-if="proposals.length === 0" class="artifact-proposals-empty">
      No {{ statusLabel }} proposals.
    </p>

    <ul v-else class="artifact-proposals-list" role="list">
      <li v-for="proposal in proposals" :key="proposal.id">
        <ProposalCard
          :proposal="proposal"
          :is-resolving="isResolving"
          @approve="$emit('approve', $event)"
          @reject="$emit('reject', $event)"
        />
      </li>
    </ul>
  </section>
</template>

<script setup lang="ts">
import type { WorkspaceProposal } from '../../../types/proposal'
import ProposalCard from './ProposalCard.vue'

withDefaults(defineProps<{
  proposals: WorkspaceProposal[]
  title?: string
  statusLabel?: string
  errorMessage?: string
  isResolving?: boolean
}>(), {
  title: 'Proposal inbox',
  statusLabel: 'pending',
  errorMessage: '',
  isResolving: false,
})

defineEmits<{
  approve: [proposalId: string]
  reject: [proposalId: string]
}>()
</script>

<style scoped>
.artifact-proposals-panel {
  display: grid;
  gap: 12px;
  border: 1px solid #e4e4e7;
  border-radius: 8px;
  padding: 12px;
  background: #fff;
  color: #18181b;
}

.artifact-proposals-header {
  display: flex;
  gap: 12px;
  align-items: start;
  justify-content: space-between;
}

.artifact-proposals-header h2,
.artifact-proposals-header p,
.artifact-proposals-empty,
.artifact-proposals-error {
  margin: 0;
}

.artifact-proposals-header h2 {
  font-size: 14px;
  font-weight: 900;
}

.artifact-proposals-header p,
.artifact-proposals-empty {
  color: #71717a;
  font-size: 12px;
  font-weight: 700;
}

.artifact-proposals-error {
  border: 1px solid rgba(220, 38, 38, 0.35);
  border-radius: 6px;
  padding: 8px 10px;
  background: rgba(254, 226, 226, 0.85);
  color: #991b1b;
  font-size: 12px;
  font-weight: 700;
}

.artifact-proposals-list {
  display: grid;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}

:global(:root.dark) .artifact-proposals-panel {
  border-color: #3f3f46;
  background: #09090b;
  color: #f4f4f5;
}

:global(:root.dark) .artifact-proposals-header p,
:global(:root.dark) .artifact-proposals-empty {
  color: #a1a1aa;
}

:global(:root.dark) .artifact-proposals-error {
  border-color: rgba(248, 113, 113, 0.45);
  background: rgba(127, 29, 29, 0.45);
  color: #fecaca;
}
</style>
