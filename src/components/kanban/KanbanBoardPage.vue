<template>
  <div class="kanban-page">
    <div v-if="executionPolicy && !executionPolicy.executionEnabled" class="kanban-page-banner">
      Execution is disabled until explicitly enabled locally.
    </div>
    <KanbanEmptyState
      v-if="errorMessage"
      title="Board unavailable"
      :copy="errorMessage"
      action-label="Retry"
      @action="loadBoard"
    />
    <KanbanEmptyState
      v-else-if="isLoading"
      title="Loading board"
      copy="Fetching local Kanban state."
    />
    <KanbanEmptyState
      v-else-if="tasks.length === 0"
      title="No tasks yet"
      copy="Create a local task to start organizing work."
      action-label="Create task"
      @action="createFirstTask"
    />
    <div v-else class="kanban-page-placeholder">
      {{ tasks.length }} task{{ tasks.length === 1 ? '' : 's' }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted } from 'vue'
import { useKanbanBoard } from '../../composables/useKanbanBoard'
import KanbanEmptyState from './KanbanEmptyState.vue'

const {
  tasks,
  isLoading,
  errorMessage,
  executionPolicy,
  loadBoard,
  createTask,
} = useKanbanBoard()

onMounted(() => {
  void loadBoard()
})

function createFirstTask(): void {
  void createTask({ title: 'New task' })
}
</script>

<style scoped>
.kanban-page {
  display: grid;
  gap: 16px;
  min-height: 100%;
  padding: 16px;
}

.kanban-page-banner {
  padding: 10px 12px;
  border: 1px solid rgba(217, 119, 6, 0.35);
  border-radius: 8px;
  background: rgba(254, 243, 199, 0.75);
  color: #92400e;
  font-size: 13px;
  font-weight: 700;
}

.kanban-page-placeholder {
  padding: 16px;
  border: 1px solid rgba(113, 113, 122, 0.25);
  border-radius: 8px;
  background: rgba(250, 250, 250, 0.8);
  color: #3f3f46;
}
</style>
