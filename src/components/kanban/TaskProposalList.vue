<template>
  <section class="task-proposals" aria-label="Task proposals">
    <h3>Proposals</h3>
    <p v-if="count === 0">No pending proposals.</p>
    <p v-else>{{ count }} pending proposal{{ count === 1 ? '' : 's' }}</p>
  </section>
</template>

<script setup lang="ts">
defineProps<{
  count: number
}>()
</script>

<style scoped>
.task-proposals {
  display: grid;
  gap: 6px;
  border: 1px solid #e4e4e7;
  border-radius: 8px;
  padding: 12px;
}

.task-proposals h3,
.task-proposals p {
  margin: 0;
}

.task-proposals h3 {
  font-size: 13px;
  font-weight: 900;
}

.task-proposals p {
  color: #71717a;
  font-size: 12px;
  font-weight: 800;
}

:global(:root.dark) .task-proposals {
  border-color: #3f3f46;
}
</style>
