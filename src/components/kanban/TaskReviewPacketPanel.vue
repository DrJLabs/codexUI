<template>
  <section class="task-review-packet" aria-label="Task review packet">
    <header>
      <h3>Review packet</h3>
      <button type="button" @click="$emit('regenerate')">Regenerate</button>
    </header>
    <p v-if="!packetId">No packet generated yet.</p>
    <p v-else>Packet {{ packetId }}</p>
  </section>
</template>

<script setup lang="ts">
defineProps<{
  packetId: string
}>()

defineEmits<{
  regenerate: []
}>()
</script>

<style scoped>
.task-review-packet {
  display: grid;
  gap: 8px;
  border: 1px solid #e4e4e7;
  border-radius: 8px;
  padding: 12px;
}

.task-review-packet header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.task-review-packet h3,
.task-review-packet p {
  margin: 0;
}

.task-review-packet h3 {
  font-size: 13px;
  font-weight: 900;
}

.task-review-packet p {
  color: #71717a;
  font-size: 12px;
  font-weight: 800;
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
