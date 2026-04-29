<template>
  <article class="review-packet-summary">
    <dl v-if="packet" class="review-packet-summary-grid">
      <div>
        <dt>Packet</dt>
        <dd>{{ shortId(packet.id) }}</dd>
      </div>
      <div>
        <dt>Files</dt>
        <dd>{{ packet.summary.fileCount }}</dd>
      </div>
      <div>
        <dt>Added</dt>
        <dd>+{{ packet.summary.addedLineCount }}</dd>
      </div>
      <div>
        <dt>Removed</dt>
        <dd>-{{ packet.summary.removedLineCount }}</dd>
      </div>
      <div>
        <dt>Tests</dt>
        <dd>{{ passedTestCount }} / {{ packet.testResults.length }}</dd>
      </div>
      <div>
        <dt>Proposals</dt>
        <dd>{{ packet.unresolvedProposalIds.length }}</dd>
      </div>
    </dl>
    <p v-else class="review-packet-summary-empty">{{ emptyText }}</p>
  </article>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { KanbanReviewPacket } from '../../../types/kanban'

const props = withDefaults(defineProps<{
  packet: KanbanReviewPacket | null
  emptyText?: string
}>(), {
  emptyText: 'No review packet generated yet.',
})

const passedTestCount = computed(() => props.packet?.testResults.filter((result) => result.exitCode === 0).length ?? 0)

function shortId(id: string): string {
  return id.length > 18 ? `${id.slice(0, 18)}...` : id
}
</script>

<style scoped>
.review-packet-summary {
  min-width: 0;
}

.review-packet-summary-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  margin: 0;
}

.review-packet-summary-grid div {
  min-width: 0;
  border: 1px solid #e4e4e7;
  border-radius: 8px;
  padding: 8px;
  background: #fafafa;
}

.review-packet-summary-grid dt,
.review-packet-summary-grid dd,
.review-packet-summary-empty {
  margin: 0;
}

.review-packet-summary-grid dt {
  color: #71717a;
  font-size: 10px;
  font-weight: 900;
  text-transform: uppercase;
}

.review-packet-summary-grid dd {
  overflow-wrap: anywhere;
  color: #27272a;
  font-size: 12px;
  font-weight: 900;
}

.review-packet-summary-empty {
  color: #71717a;
  font-size: 12px;
  font-weight: 800;
}

:global(:root.dark) .review-packet-summary-grid div {
  border-color: #3f3f46;
  background: #18181b;
}

:global(:root.dark) .review-packet-summary-grid dt,
:global(:root.dark) .review-packet-summary-empty {
  color: #a1a1aa;
}

:global(:root.dark) .review-packet-summary-grid dd {
  color: #f4f4f5;
}
</style>
