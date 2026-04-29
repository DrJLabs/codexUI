<template>
  <section class="task-review-packet" aria-label="Task review packet">
    <ArtifactReviewPacketPanel
      :packet="packet"
      :title="packetId ? `Packet ${shortPacketId}` : 'Current packet'"
      empty-text="No packet generated yet."
    >
      <template #actions>
        <button type="button" @click="$emit('regenerate')">Regenerate</button>
      </template>
    </ArtifactReviewPacketPanel>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { KanbanReviewPacket } from '../../types/kanban'
import ArtifactReviewPacketPanel from '../artifacts/review/ArtifactReviewPacketPanel.vue'

const props = defineProps<{
  packetId: string
  packet: KanbanReviewPacket | null
}>()

defineEmits<{
  regenerate: []
}>()

const shortPacketId = computed(() => props.packetId.length > 18 ? `${props.packetId.slice(0, 18)}...` : props.packetId)
</script>

<style scoped>
.task-review-packet {
  display: grid;
  gap: 8px;
  border: 1px solid #e4e4e7;
  border-radius: 8px;
  padding: 12px;
}

.task-review-packet button {
  border: 1px solid #d4d4d8;
  border-radius: 8px;
  padding: 5px 8px;
  background: #fff;
  color: #3f3f46;
  font-size: 12px;
  font-weight: 900;
}

:global(:root.dark) .task-review-packet {
  border-color: #3f3f46;
}

:global(:root.dark) .task-review-packet button {
  border-color: #52525b;
  background: #27272a;
  color: #f4f4f5;
}
</style>
