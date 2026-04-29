<template>
  <section v-if="runId" class="task-run-log" aria-label="Task run log">
    <header>
      <h3>Run log</h3>
      <button type="button" @click="$emit('refresh')">Refresh</button>
    </header>
    <pre>{{ logText || 'No run output recorded yet.' }}</pre>
  </section>
</template>

<script setup lang="ts">
defineProps<{
  runId: string
  logText: string
}>()

defineEmits<{
  refresh: []
}>()
</script>

<style scoped>
.task-run-log {
  display: grid;
  gap: 8px;
}

.task-run-log header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.task-run-log h3 {
  margin: 0;
  font-size: 13px;
  font-weight: 900;
}

.task-run-log button {
  border: 1px solid #d4d4d8;
  border-radius: 8px;
  padding: 5px 8px;
  background: #fff;
  color: #3f3f46;
  font-size: 12px;
  font-weight: 900;
}

.task-run-log pre {
  min-height: 72px;
  max-height: 180px;
  overflow: auto;
  margin: 0;
  border: 1px solid #e4e4e7;
  border-radius: 8px;
  padding: 10px;
  background: #f4f4f5;
  color: #27272a;
  white-space: pre-wrap;
}

:global(:root.dark) .task-run-log button {
  border-color: #52525b;
  background: #27272a;
  color: #f4f4f5;
}

:global(:root.dark) .task-run-log pre {
  border-color: #3f3f46;
  background: #09090b;
  color: #e4e4e7;
}
</style>
