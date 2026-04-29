<template>
  <div class="kanban-board-viewport">
    <KanbanMobileStatusTabs
      :statuses="statuses"
      :model-value="selectedMobileStatus"
      :counts-by-status="countsByStatus"
      @update:model-value="$emit('update:selectedMobileStatus', $event)"
    />
    <div class="kanban-board-desktop">
      <KanbanColumn
        v-for="status in statuses"
        :key="status.id"
        :status="status"
        :tasks="visibleTasksByStatus[status.id]"
        :wip-limit="columnConfigByStatus[status.id]?.wipLimit ?? null"
        :selected-task-id="selectedTaskId"
        @select-task="emit('select-task', $event)"
        @reorder-task="emit('reorder-task', $event)"
      />
    </div>
    <div class="kanban-board-mobile">
      <KanbanTaskCard
        v-for="task in selectedMobileTasks"
        :key="task.id"
        :task="task"
        :selected="task.id === selectedTaskId"
        @select="emit('select-task', $event)"
      />
      <div v-if="selectedMobileTasks.length === 0" class="kanban-board-mobile-empty">
        No tasks in {{ selectedStatusTitle }}.
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { KanbanBoardColumn, KanbanStatus, KanbanTask } from '../../types/kanban'
import KanbanColumn from './KanbanColumn.vue'
import KanbanMobileStatusTabs from './KanbanMobileStatusTabs.vue'
import KanbanTaskCard from './KanbanTaskCard.vue'

type KanbanStatusOption = { id: KanbanStatus; title: string }

const props = defineProps<{
  statuses: KanbanStatusOption[]
  visibleTasksByStatus: Record<KanbanStatus, KanbanTask[]>
  countsByStatus: Record<KanbanStatus, number>
  columnConfigByStatus: Record<KanbanStatus, KanbanBoardColumn | null>
  selectedTaskId: string
  selectedMobileStatus: KanbanStatus
}>()

const emit = defineEmits<{
  'select-task': [taskId: string]
  'update:selectedMobileStatus': [status: KanbanStatus]
  'reorder-task': [input: { taskId: string; status: KanbanStatus; beforeTaskId?: string; afterTaskId?: string }]
}>()

const selectedStatusTitle = computed(() => props.statuses.find((status) => status.id === props.selectedMobileStatus)?.title ?? 'status')
const selectedMobileTasks = computed(() => props.visibleTasksByStatus[props.selectedMobileStatus] ?? [])
</script>

<style scoped>
.kanban-board-viewport {
  display: grid;
  min-width: 0;
  gap: 12px;
}

.kanban-board-desktop {
  display: grid;
  grid-auto-columns: minmax(180px, 1fr);
  grid-auto-flow: column;
  gap: 12px;
  overflow-x: auto;
}

.kanban-board-mobile {
  display: none;
  gap: 8px;
}

.kanban-board-mobile-empty {
  border: 1px dashed #d4d4d8;
  border-radius: 8px;
  padding: 16px;
  color: #71717a;
  font-weight: 700;
}

@media (max-width: 860px) {
  .kanban-board-desktop {
    display: none;
  }

  .kanban-board-mobile {
    display: grid;
  }
}
</style>
