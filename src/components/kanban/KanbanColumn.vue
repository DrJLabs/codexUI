<template>
  <section class="kanban-column" :aria-label="status.title">
    <header class="kanban-column-header">
      <h2>{{ status.title }}</h2>
      <span>{{ tasks.length }}</span>
    </header>
    <div class="kanban-column-list">
      <KanbanTaskCard
        v-for="task in tasks"
        :key="task.id"
        :task="task"
        :selected="task.id === selectedTaskId"
        @select="$emit('select-task', $event)"
      />
      <div v-if="tasks.length === 0" class="kanban-column-empty">No tasks</div>
    </div>
  </section>
</template>

<script setup lang="ts">
import type { KanbanStatus, KanbanTask } from '../../types/kanban'
import KanbanTaskCard from './KanbanTaskCard.vue'

defineProps<{
  status: { id: KanbanStatus; title: string }
  tasks: KanbanTask[]
  selectedTaskId: string
}>()

defineEmits<{
  'select-task': [taskId: string]
}>()
</script>

<style scoped>
.kanban-column {
  display: grid;
  min-width: 220px;
  grid-template-rows: auto 1fr;
  gap: 8px;
}

.kanban-column-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 32px;
  color: #52525b;
}

.kanban-column-header h2 {
  margin: 0;
  font-size: 12px;
  font-weight: 800;
  text-transform: uppercase;
}

.kanban-column-header span {
  border-radius: 999px;
  padding: 2px 7px;
  background: #e4e4e7;
  color: #3f3f46;
  font-size: 11px;
  font-weight: 800;
}

.kanban-column-list {
  display: grid;
  align-content: start;
  gap: 8px;
  min-height: 140px;
}

.kanban-column-empty {
  border: 1px dashed #d4d4d8;
  border-radius: 8px;
  padding: 12px;
  color: #a1a1aa;
  font-size: 12px;
  font-weight: 700;
  text-align: center;
}

:global(:root.dark) .kanban-column-header {
  color: #a1a1aa;
}

:global(:root.dark) .kanban-column-header span {
  background: #3f3f46;
  color: #e4e4e7;
}

:global(:root.dark) .kanban-column-empty {
  border-color: #3f3f46;
  color: #71717a;
}
</style>
