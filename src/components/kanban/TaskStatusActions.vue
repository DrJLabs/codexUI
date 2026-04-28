<template>
  <div class="task-status-actions" role="group" aria-label="Task status actions">
    <button
      v-for="status in nextStatuses"
      :key="status.id"
      class="task-status-action"
      type="button"
      @click="$emit('set-status', status.id)"
    >
      {{ status.label }}
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { KanbanStatus } from '../../types/kanban'

const props = defineProps<{
  status: KanbanStatus
}>()

defineEmits<{
  'set-status': [status: KanbanStatus]
}>()

const ACTIONS: Record<KanbanStatus, Array<{ id: KanbanStatus; label: string }>> = {
  backlog: [{ id: 'ready', label: 'Mark ready' }, { id: 'cancelled', label: 'Cancel' }],
  ready: [{ id: 'backlog', label: 'Backlog' }, { id: 'running', label: 'Move to running' }, { id: 'cancelled', label: 'Cancel' }],
  running: [{ id: 'review', label: 'Send to review' }, { id: 'rework', label: 'Needs rework' }, { id: 'cancelled', label: 'Cancel' }],
  review: [{ id: 'done', label: 'Mark done' }, { id: 'rework', label: 'Request rework' }, { id: 'cancelled', label: 'Cancel' }],
  rework: [{ id: 'ready', label: 'Ready' }, { id: 'running', label: 'Move to running' }, { id: 'cancelled', label: 'Cancel' }],
  done: [{ id: 'review', label: 'Reopen review' }, { id: 'rework', label: 'Reopen rework' }],
  cancelled: [{ id: 'backlog', label: 'Reopen backlog' }],
}

const nextStatuses = computed(() => ACTIONS[props.status])
</script>

<style scoped>
.task-status-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.task-status-action {
  min-height: 32px;
  border: 1px solid #d4d4d8;
  border-radius: 8px;
  padding: 0 10px;
  background: #fff;
  color: #3f3f46;
  font-size: 12px;
  font-weight: 800;
}

:global(:root.dark) .task-status-action {
  border-color: #3f3f46;
  background: #18181b;
  color: #e4e4e7;
}
</style>
