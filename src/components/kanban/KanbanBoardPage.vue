<template>
  <div class="kanban-page">
    <div v-if="executionPolicy && !executionPolicy.executionEnabled" class="kanban-page-banner">
      Execution is disabled until explicitly enabled locally.
    </div>
    <div v-if="mutationError" class="kanban-page-error" role="alert">
      {{ mutationError }}
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
        v-if="activeTaskCount === 0"
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
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
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
  subscribeToEvents,
} = useKanbanBoard()

const route = useRoute()
const router = useRouter()
const selectedMobileStatus = ref<KanbanStatus>('backlog')
const mutationError = ref('')

const labelNames = computed(() => Array.from(new Set(
  tasks.value.filter((task) => !task.archived).flatMap((task) => task.labels.map((label) => label.name)),
)).sort((left, right) => left.localeCompare(right)))

const activeTaskCount = computed(() => Object.values(countsByStatus.value).reduce((total, count) => total + count, 0))

onMounted(() => {
  void loadBoard()
  stopEventSubscription = subscribeToEvents()
})

let stopEventSubscription: (() => void) | null = null

onUnmounted(() => {
  stopEventSubscription?.()
  stopEventSubscription = null
})

watch(() => route.query.task, () => {
  const taskId = readTaskQueryParam()
  if (taskId === selectedTaskId.value) return
  if (taskId) {
    selectTask(taskId)
  } else {
    clearSelection()
  }
}, { immediate: true })

watch(selectedTaskId, (taskId) => {
  syncTaskQueryParam(taskId)
})

function createFirstTask(): void {
  void runMutation('Create task failed', () => createTask({ title: 'New task' }))
}

function readSelectedTaskId(): string {
  return selectedTask.value?.id ?? ''
}

function saveSelectedSummary(patch: { title: string; description: string; labels: KanbanTaskLabel[] }): void {
  const taskId = readSelectedTaskId()
  if (!taskId) return
  void runMutation('Save task failed', () => updateTask(taskId, patch))
}

function archiveSelectedTask(): void {
  const taskId = readSelectedTaskId()
  if (!taskId) return
  void runMutation('Archive task failed', async () => {
    await archiveTask(taskId)
    clearSelection()
  })
}

function setSelectedTaskStatus(status: KanbanStatus): void {
  const taskId = readSelectedTaskId()
  if (!taskId) return
  void runMutation('Move task failed', () => setTaskStatus(taskId, status))
}

function addSelectedCriterion(text: string): void {
  const taskId = readSelectedTaskId()
  if (!taskId) return
  void runMutation('Add criterion failed', () => addAcceptanceCriterion(taskId, text))
}

function updateSelectedCriterion(criterionId: string, patch: { text?: string; checked?: boolean }): void {
  const taskId = readSelectedTaskId()
  if (!taskId) return
  void runMutation('Update criterion failed', () => updateAcceptanceCriterion(taskId, criterionId, patch))
}

function removeSelectedCriterion(criterionId: string): void {
  const taskId = readSelectedTaskId()
  if (!taskId) return
  void runMutation('Remove criterion failed', () => removeAcceptanceCriterion(taskId, criterionId))
}

function toggleSelectedCriterion(criterionId: string, checked: boolean): void {
  const taskId = readSelectedTaskId()
  if (!taskId) return
  void runMutation('Update criterion failed', () => setCriterionChecked(taskId, criterionId, checked))
}

async function runMutation<T>(label: string, operation: () => Promise<T>): Promise<T | null> {
  mutationError.value = ''
  try {
    return await operation()
  } catch (error) {
    console.error(label, error)
    mutationError.value = error instanceof Error ? error.message : label
    return null
  }
}

function readTaskQueryParam(): string {
  const raw = route.query.task
  const value = Array.isArray(raw) ? raw[0] : raw
  return typeof value === 'string' ? value.trim() : ''
}

function syncTaskQueryParam(taskId: string): void {
  if (readTaskQueryParam() === taskId) return
  const query = { ...route.query }
  if (taskId) {
    query.task = taskId
  } else {
    delete query.task
  }
  void router.replace({ name: 'kanban', query }).catch((error: unknown) => {
    console.warn('Failed to sync Kanban task route query', error)
  })
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

.kanban-page-error {
  padding: 10px 12px;
  border: 1px solid rgba(220, 38, 38, 0.35);
  border-radius: 8px;
  background: rgba(254, 226, 226, 0.85);
  color: #991b1b;
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

:global(:root.dark) .kanban-page-error {
  border-color: rgba(248, 113, 113, 0.35);
  background: rgba(127, 29, 29, 0.35);
  color: #fecaca;
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
