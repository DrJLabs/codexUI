<template>
  <section class="artifact-review-packet" aria-label="Review packet summary">
    <header>
      <div>
        <p>Review packet</p>
        <h3>{{ title }}</h3>
      </div>
      <slot name="actions" />
    </header>
    <ReviewPacketSummaryCard :packet="packet" :empty-text="emptyText" />
    <p v-if="packet?.unresolvedProposalIds.length" class="artifact-review-packet-warning">
      {{ packet.unresolvedProposalIds.length }} unresolved proposal{{ packet.unresolvedProposalIds.length === 1 ? '' : 's' }} must be resolved before approval.
    </p>
  </section>
</template>

<script setup lang="ts">
import type { KanbanReviewPacket } from '../../../types/kanban'
import ReviewPacketSummaryCard from './ReviewPacketSummaryCard.vue'

withDefaults(defineProps<{
  packet: KanbanReviewPacket | null
  title?: string
  emptyText?: string
}>(), {
  title: 'Current packet',
  emptyText: 'No review packet generated yet.',
})
</script>

<style scoped>
.artifact-review-packet {
  display: grid;
  gap: 10px;
  min-width: 0;
}

.artifact-review-packet header {
  display: flex;
  align-items: start;
  justify-content: space-between;
  gap: 8px;
}

.artifact-review-packet h3,
.artifact-review-packet p {
  margin: 0;
}

.artifact-review-packet header p {
  color: #71717a;
  font-size: 10px;
  font-weight: 900;
  text-transform: uppercase;
}

.artifact-review-packet h3 {
  color: #27272a;
  font-size: 13px;
  font-weight: 900;
}

.artifact-review-packet-warning {
  border: 1px solid #f59e0b;
  border-radius: 8px;
  padding: 8px;
  background: #fffbeb;
  color: #92400e;
  font-size: 12px;
  font-weight: 800;
}

:global(:root.dark) .artifact-review-packet header p {
  color: #a1a1aa;
}

:global(:root.dark) .artifact-review-packet h3 {
  color: #f4f4f5;
}

:global(:root.dark) .artifact-review-packet-warning {
  border-color: #b45309;
  background: #451a03;
  color: #fbbf24;
}
</style>
