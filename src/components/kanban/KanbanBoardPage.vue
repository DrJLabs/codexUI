<template>
  <div class="kanban-page">
    <div
      v-if="executionPolicy"
      class="kanban-page-banner"
      :data-mode="executionPolicy.executionMode"
    >
      <strong>{{ executionModeTitle }}</strong>
      <span>{{ executionModeCopy }}</span>
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
        :priority-filter="filters.priorities"
        :assignee-filter="filters.assignee"
        :assignee-options="assigneeFilterOptions"
        @update:search-query="setSearchQuery"
        @update:priority-filter="setBoardPriorityFilter"
        @update:assignee-filter="setBoardAssigneeFilter"
        @toggle-label="toggleLabelFilter"
        @clear-filters="clearBoardFilters"
        @create-task="createFirstTask"
      />
      <KanbanProposalInbox
        :proposals="proposals"
        :status="proposalStatus"
        :error-message="proposalErrorMessage"
        :is-resolving="isProposalResolving"
        @update:status="loadProposalStatus"
        @approve="approveInboxProposal"
        @reject="rejectInboxProposal"
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
          :statuses="visibleStatuses"
          :visible-tasks-by-status="visibleTasksByStatus"
          :counts-by-status="countsByStatus"
          :column-config-by-status="columnConfigByStatus"
          :selected-task-id="selectedTaskId"
          :selected-mobile-status="selectedMobileStatus"
          @select-task="selectTask"
          @reorder-task="reorderBoardTask"
          @update:selected-mobile-status="selectedMobileStatus = $event"
        />
        <div class="kanban-page-sidebar">
          <KanbanConfigPanel
            :config="config"
            :is-saving="isConfigSaving"
            @save="saveBoardConfig"
          />
          <KanbanTaskInspector
            :task="selectedTask"
            :execution-policy="executionPolicy"
            :run-profiles="runProfiles"
            :default-run-profile-id="config?.defaultRunProfileId ?? ''"
            :run-log="selectedRunLog"
            :review-packet="selectedReviewPacket"
            @close="clearSelection"
            @archive="archiveSelectedTask"
            @start-run="startSelectedTaskRun"
            @interrupt-run="interruptSelectedTaskRun"
            @refresh-run-log="refreshSelectedRunLog"
            @regenerate-review-packet="regenerateSelectedReviewPacket"
            @set-status="setSelectedTaskStatus"
            @save-summary="saveSelectedSummary"
            @save-metadata="saveSelectedMetadata"
            @add-criterion="addSelectedCriterion"
            @update-criterion="updateSelectedCriterion"
            @remove-criterion="removeSelectedCriterion"
            @toggle-criterion="toggleSelectedCriterion"
          />
        </div>
        <KanbanTaskSheet
          :task="selectedTask"
          :execution-policy="executionPolicy"
          :run-profiles="runProfiles"
          :default-run-profile-id="config?.defaultRunProfileId ?? ''"
          :run-log="selectedRunLog"
          :review-packet="selectedReviewPacket"
          @close="clearSelection"
          @archive="archiveSelectedTask"
          @start-run="startSelectedTaskRun"
          @interrupt-run="interruptSelectedTaskRun"
          @refresh-run-log="refreshSelectedRunLog"
          @regenerate-review-packet="regenerateSelectedReviewPacket"
          @set-status="setSelectedTaskStatus"
          @save-summary="saveSelectedSummary"
          @save-metadata="saveSelectedMetadata"
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
import { type KanbanActor, type KanbanMetadataPatch, type KanbanPriority, type KanbanProposalStatus, type KanbanStatus, type KanbanTaskLabel, type UpdateKanbanBoardConfigInput } from '../../types/kanban'
import KanbanBoardViewport from './KanbanBoardViewport.vue'
import KanbanConfigPanel from './KanbanConfigPanel.vue'
import KanbanEmptyState from './KanbanEmptyState.vue'
import KanbanProposalInbox from './KanbanProposalInbox.vue'
import KanbanTaskInspector from './KanbanTaskInspector.vue'
import KanbanTaskSheet from './KanbanTaskSheet.vue'
import KanbanToolbar from './KanbanToolbar.vue'

const {
  tasks,
  visibleTasksByStatus,
  countsByStatus,
  columnConfigByStatus,
  visibleStatuses,
  assigneeFilterOptions,
  selectedTaskId,
  selectedTask,
  filters,
  config,
  proposals,
  proposalStatus,
  proposalErrorMessage,
  isLoading,
  errorMessage,
  versionConflict,
  executionPolicy,
  runLogsByRunId,
  reviewPacketsByTaskId,
  loadBoard,
  loadProposals,
  approveProposal,
  rejectProposal,
  createTask,
  updateTask,
  archiveTask,
  setTaskStatus,
  reorderTask,
  updateConfig,
  selectTask,
  clearSelection,
  addAcceptanceCriterion,
  updateAcceptanceCriterion,
  removeAcceptanceCriterion,
  setCriterionChecked,
  startTaskRun,
  interruptTaskRun,
  refreshRunLog,
  refreshReviewPacket,
  regenerateReviewPacket,
  setSearchQuery,
  toggleLabelFilter,
  setPriorityFilter,
  setAssigneeFilter,
  clearFilters,
  subscribeToEvents,
} = useKanbanBoard()

const route = useRoute()
const router = useRouter()
const selectedMobileStatus = ref<KanbanStatus>('backlog')
const mutationError = ref('')
const isConfigSaving = ref(false)
const isProposalResolving = ref(false)

const labelNames = computed(() => Array.from(new Set(
  tasks.value.filter((task) => !task.archived).flatMap((task) => task.labels.map((label) => label.name)),
)).sort((left, right) => left.localeCompare(right)))

const activeTaskCount = computed(() => Object.values(countsByStatus.value).reduce((total, count) => total + count, 0))
const runProfiles = computed(() => config.value?.runProfiles ?? [])
const selectedRunLog = computed(() => {
  const runId = selectedTask.value?.currentRunId ?? ''
  return runId ? runLogsByRunId.value[runId] ?? '' : ''
})
const selectedReviewPacket = computed(() => {
  const taskId = selectedTask.value?.id ?? ''
  return taskId ? reviewPacketsByTaskId.value[taskId] ?? null : null
})
const executionModeTitle = computed(() => {
  switch (executionPolicy.value?.executionMode) {
    case 'local_only':
      return 'Kanban execution: Local only'
    case 'trusted_remote':
      return 'Kanban execution: Trusted remote'
    case 'open_remote':
      return 'Kanban execution: Open remote'
    case 'disabled':
    default:
      return 'Kanban execution: Disabled'
  }
})
const executionModeCopy = computed(() => {
  switch (executionPolicy.value?.executionMode) {
    case 'local_only':
      return 'Only loopback browser sessions can start or approve runs.'
    case 'trusted_remote':
      return 'Loopback and trusted Tailscale sessions can start and approve runs.'
    case 'open_remote':
      return 'Remote execution is blocked until authenticated remote access is implemented.'
    case 'disabled':
    default:
      return 'Board changes are allowed, but task runs cannot start.'
  }
})

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

watch(() => [selectedTask.value?.id ?? '', selectedTask.value?.reviewPacketId ?? ''], ([taskId, packetId]) => {
  if (!taskId || !packetId) return
  if (reviewPacketsByTaskId.value[taskId]?.id === packetId) return
  void refreshReviewPacket(taskId).catch((error: unknown) => {
    console.warn('Failed to load review packet', error)
  })
}, { immediate: true })

watch(visibleStatuses, (statuses) => {
  if (statuses.some((status) => status.id === selectedMobileStatus.value)) return
  selectedMobileStatus.value = statuses[0]?.id ?? 'backlog'
}, { immediate: true })

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

function saveSelectedMetadata(patch: KanbanMetadataPatch): void {
  const taskId = readSelectedTaskId()
  if (!taskId) return
  void runMutation('Save metadata failed', () => updateTask(taskId, patch))
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

function reorderBoardTask(input: { taskId: string; status: KanbanStatus; beforeTaskId?: string; afterTaskId?: string }): void {
  void runMutation('Reorder task failed', () => reorderTask(input.taskId, {
    status: input.status,
    ...(input.beforeTaskId ? { beforeTaskId: input.beforeTaskId } : {}),
    ...(input.afterTaskId ? { afterTaskId: input.afterTaskId } : {}),
  }))
}

function saveBoardConfig(input: UpdateKanbanBoardConfigInput): void {
  isConfigSaving.value = true
  void runMutation('Save board config failed', () => updateConfig(input)).finally(() => {
    isConfigSaving.value = false
  })
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

function startSelectedTaskRun(): void {
  const taskId = readSelectedTaskId()
  if (!taskId) return
  void runMutation('Start run failed', () => startTaskRun(taskId))
}

function interruptSelectedTaskRun(): void {
  const runId = selectedTask.value?.currentRunId ?? ''
  if (!runId) return
  void runMutation('Stop run failed', () => interruptTaskRun(runId))
}

function refreshSelectedRunLog(): void {
  const runId = selectedTask.value?.currentRunId ?? ''
  if (!runId) return
  void runMutation('Refresh run log failed', () => refreshRunLog(runId))
}

function regenerateSelectedReviewPacket(): void {
  const taskId = readSelectedTaskId()
  if (!taskId) return
  void runMutation('Regenerate review packet failed', () => regenerateReviewPacket(taskId))
}

function setBoardPriorityFilter(priorities: KanbanPriority[]): void {
  setPriorityFilter(priorities)
  void loadBoard()
}

function setBoardAssigneeFilter(assignee: KanbanActor | ''): void {
  setAssigneeFilter(assignee)
  void loadBoard()
}

function clearBoardFilters(): void {
  clearFilters()
  void loadBoard()
}

function loadProposalStatus(status: KanbanProposalStatus): void {
  void loadProposals(status).catch((error: unknown) => {
    console.error('Load proposals failed', error)
  })
}

function approveInboxProposal(proposalId: string): void {
  isProposalResolving.value = true
  void runMutation('Approve proposal failed', () => approveProposal(proposalId)).finally(() => {
    isProposalResolving.value = false
  })
}

function rejectInboxProposal(proposalId: string): void {
  isProposalResolving.value = true
  void runMutation('Reject proposal failed', () => rejectProposal(proposalId)).finally(() => {
    isProposalResolving.value = false
  })
}

async function runMutation<T>(label: string, operation: () => Promise<T>): Promise<T | null> {
  mutationError.value = ''
  try {
    return await operation()
  } catch (error) {
    console.error(label, error)
    const message = error instanceof Error ? error.message : label
    if (versionConflict.value) {
      await loadBoard()
    }
    mutationError.value = message
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
  display: grid;
  gap: 2px;
  padding: 10px 12px;
  border: 1px solid rgba(217, 119, 6, 0.35);
  border-radius: 8px;
  background: rgba(254, 243, 199, 0.75);
  color: #92400e;
  font-size: 13px;
}

.kanban-page-banner strong {
  font-weight: 900;
}

.kanban-page-banner span {
  font-weight: 700;
}

.kanban-page-banner[data-mode="trusted_remote"] {
  border-color: rgba(14, 165, 233, 0.35);
  background: rgba(224, 242, 254, 0.85);
  color: #075985;
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

.kanban-page-sidebar {
  display: grid;
  align-content: start;
  gap: 12px;
  min-width: 0;
}

:global(:root.dark) .kanban-page-banner {
  border-color: rgba(245, 158, 11, 0.3);
  background: rgba(120, 53, 15, 0.35);
  color: #fcd34d;
}

:global(:root.dark) .kanban-page-banner[data-mode="trusted_remote"] {
  border-color: rgba(56, 189, 248, 0.35);
  background: rgba(8, 47, 73, 0.55);
  color: #bae6fd;
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
