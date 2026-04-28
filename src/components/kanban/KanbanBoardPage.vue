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
    <template v-else>
      <KanbanToolbar
        :search-query="filters.searchQuery"
        :label-names="labelNames"
        :active-labels="filters.labelNames"
        @update:search-query="setSearchQuery"
        @toggle-label="toggleLabelFilter"
        @clear-filters="clearFilters"
        @create-task="createFirstTask"
      />
      <KanbanEmptyState
        v-if="tasks.length === 0"
        title="No tasks yet"
        copy="Create a local task to start organizing work."
        action-label="Create task"
        @action="createFirstTask"
      />
      <div v-else class="kanban-page-layout">
        <KanbanBoardViewport
          :statuses="KANBAN_STATUSES"
          :visible-tasks-by-status="visibleTasksByStatus"
          :counts-by-status="countsByStatus"
          :selected-task-id="selectedTaskId"
          :selected-mobile-status="selectedMobileStatus"
          @select-task="selectTask"
          @update:selected-mobile-status="selectedMobileStatus = $event"
        />
        <KanbanTaskInspector
          :task="selectedTask"
          @close="clearSelection"
          @archive="archiveSelectedTask"
          @set-status="setSelectedTaskStatus"
          @save-summary="saveSelectedSummary"
          @add-criterion="addSelectedCriterion"
          @update-criterion="updateSelectedCriterion"
          @remove-criterion="removeSelectedCriterion"
          @toggle-criterion="toggleSelectedCriterion"
        />
        <KanbanTaskSheet
          :task="selectedTask"
          @close="clearSelection"
          @archive="archiveSelectedTask"
          @set-status="setSelectedTaskStatus"
          @save-summary="saveSelectedSummary"
          @add-criterion="addSelectedCriterion"
          @update-criterion="updateSelectedCriterion"
          @remove-criterion="removeSelectedCriterion"
          @toggle-criterion="toggleSelectedCriterion"
        />
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useKanbanBoard } from '../../composables/useKanbanBoard'
import { KANBAN_STATUSES, type KanbanStatus, type KanbanTaskLabel } from '../../types/kanban'
import KanbanBoardViewport from './KanbanBoardViewport.vue'
import KanbanEmptyState from './KanbanEmptyState.vue'
import KanbanTaskInspector from './KanbanTaskInspector.vue'
import KanbanTaskSheet from './KanbanTaskSheet.vue'
import KanbanToolbar from './KanbanToolbar.vue'

const {
  tasks,
  visibleTasksByStatus,
  countsByStatus,
  selectedTaskId,
  selectedTask,
  filters,
  isLoading,
  errorMessage,
  executionPolicy,
  loadBoard,
  createTask,
  updateTask,
  archiveTask,
  setTaskStatus,
  selectTask,
  clearSelection,
  addAcceptanceCriterion,
  updateAcceptanceCriterion,
  removeAcceptanceCriterion,
  setCriterionChecked,
  setSearchQuery,
  toggleLabelFilter,
  clearFilters,
} = useKanbanBoard()

const selectedMobileStatus = ref<KanbanStatus>('backlog')

const labelNames = computed(() => Array.from(new Set(
  tasks.value.flatMap((task) => task.labels.map((label) => label.name)),
)).sort((left, right) => left.localeCompare(right)))

onMounted(() => {
  void loadBoard()
})

function createFirstTask(): void {
  void createTask({ title: 'New task' })
}

function readSelectedTaskId(): string {
  return selectedTask.value?.id ?? ''
}

function saveSelectedSummary(patch: { title: string; description: string; labels: KanbanTaskLabel[] }): void {
  const taskId = readSelectedTaskId()
  if (!taskId) return
  void updateTask(taskId, patch)
}

function archiveSelectedTask(): void {
  const taskId = readSelectedTaskId()
  if (!taskId) return
  void archiveTask(taskId)
}

function setSelectedTaskStatus(status: KanbanStatus): void {
  const taskId = readSelectedTaskId()
  if (!taskId) return
  void setTaskStatus(taskId, status)
}

function addSelectedCriterion(text: string): void {
  const taskId = readSelectedTaskId()
  if (!taskId) return
  void addAcceptanceCriterion(taskId, text)
}

function updateSelectedCriterion(criterionId: string, patch: { text?: string; checked?: boolean }): void {
  const taskId = readSelectedTaskId()
  if (!taskId) return
  void updateAcceptanceCriterion(taskId, criterionId, patch)
}

function removeSelectedCriterion(criterionId: string): void {
  const taskId = readSelectedTaskId()
  if (!taskId) return
  void removeAcceptanceCriterion(taskId, criterionId)
}

function toggleSelectedCriterion(criterionId: string, checked: boolean): void {
  const taskId = readSelectedTaskId()
  if (!taskId) return
  void setCriterionChecked(taskId, criterionId, checked)
}
</script>

<style scoped>
.kanban-page {
  display: grid;
  align-content: start;
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

.kanban-page-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(280px, 340px);
  gap: 16px;
  min-width: 0;
}

:global(:root.dark) .kanban-page-banner {
  border-color: rgba(245, 158, 11, 0.3);
  background: rgba(120, 53, 15, 0.35);
  color: #fcd34d;
}

@media (max-width: 860px) {
  .kanban-page {
    padding: 12px;
  }

  .kanban-page-layout {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
