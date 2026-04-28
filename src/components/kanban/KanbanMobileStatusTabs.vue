<template>
  <div class="kanban-mobile-tabs" role="tablist" aria-label="Kanban statuses">
    <button
      v-for="status in statuses"
      :key="status.id"
      class="kanban-mobile-tab"
      :class="{ 'is-active': status.id === modelValue }"
      type="button"
      role="tab"
      :aria-selected="status.id === modelValue"
      @click="$emit('update:modelValue', status.id)"
    >
      <span>{{ status.title }}</span>
      <span class="kanban-mobile-tab-count">{{ countsByStatus[status.id] ?? 0 }}</span>
    </button>
  </div>
</template>

<script setup lang="ts">
import type { KANBAN_STATUSES, KanbanStatus } from '../../types/kanban'

defineProps<{
  statuses: typeof KANBAN_STATUSES
  modelValue: KanbanStatus
  countsByStatus: Record<KanbanStatus, number>
}>()

defineEmits<{
  'update:modelValue': [status: KanbanStatus]
}>()
</script>

<style scoped>
.kanban-mobile-tabs {
  display: none;
  gap: 6px;
  overflow-x: auto;
  padding-bottom: 2px;
}

.kanban-mobile-tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 34px;
  border: 1px solid #d4d4d8;
  border-radius: 8px;
  padding: 0 10px;
  background: #fff;
  color: #3f3f46;
  font-weight: 700;
  white-space: nowrap;
}

.kanban-mobile-tab.is-active {
  border-color: #18181b;
  background: #18181b;
  color: #fafafa;
}

.kanban-mobile-tab-count {
  color: inherit;
  opacity: 0.72;
}

:global(:root.dark) .kanban-mobile-tab {
  border-color: #3f3f46;
  background: #18181b;
  color: #e4e4e7;
}

:global(:root.dark) .kanban-mobile-tab.is-active {
  border-color: #e4e4e7;
  background: #e4e4e7;
  color: #18181b;
}

@media (max-width: 860px) {
  .kanban-mobile-tabs {
    display: flex;
  }
}
</style>
