<template>
  <button
    class="kanban-task-card"
    :class="{ 'is-selected': selected }"
    type="button"
    draggable="true"
    :data-kanban-task-id="task.id"
    @click="emit('select', task.id)"
    @dragstart="onDragStart"
  >
    <span class="kanban-task-card-title">{{ task.title }}</span>
    <span v-if="task.description" class="kanban-task-card-description">{{ task.description }}</span>
    <span class="kanban-task-card-meta">
      <span class="kanban-task-card-chip">{{ task.priority }}</span>
      <span class="kanban-task-card-chip">{{ task.assignee }}</span>
      <span>{{ checkedCriteria }}/{{ task.acceptanceCriteria.length }} criteria</span>
      <span v-if="task.runState !== 'idle'" class="kanban-task-card-badge">{{ task.runState.replace(/_/g, ' ') }}</span>
    </span>
    <span v-if="task.labels.length > 0" class="kanban-task-card-labels">
      <span v-for="label in task.labels" :key="label.id" class="kanban-task-card-label" :style="{ borderColor: label.color || undefined }">
        {{ label.name }}
      </span>
    </span>
  </button>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { KanbanTask } from '../../types/kanban'

const props = defineProps<{
  task: KanbanTask
  selected: boolean
}>()

const emit = defineEmits<{
  select: [taskId: string]
  'drag-start': [taskId: string]
}>()

const checkedCriteria = computed(() => props.task.acceptanceCriteria.filter((criterion) => criterion.checked).length)

function onDragStart(event: DragEvent): void {
  event.dataTransfer?.setData('text/plain', props.task.id)
  event.dataTransfer?.setData('application/x-kanban-task-id', props.task.id)
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move'
  }
  emit('drag-start', props.task.id)
}
</script>

<style scoped>
.kanban-task-card {
  display: grid;
  width: 100%;
  gap: 6px;
  border: 1px solid #e4e4e7;
  border-radius: 8px;
  padding: 10px;
  background: #fff;
  color: #18181b;
  text-align: left;
}

.kanban-task-card:hover,
.kanban-task-card.is-selected {
  border-color: #2563eb;
}

.kanban-task-card-title {
  overflow-wrap: anywhere;
  font-size: 13px;
  font-weight: 800;
}

.kanban-task-card-description {
  display: -webkit-box;
  overflow: hidden;
  color: #71717a;
  font-size: 12px;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.kanban-task-card-meta,
.kanban-task-card-labels {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
  color: #71717a;
  font-size: 11px;
  font-weight: 700;
}

.kanban-task-card-chip,
.kanban-task-card-badge,
.kanban-task-card-label {
  border: 1px solid #d4d4d8;
  border-radius: 6px;
  padding: 2px 6px;
  background: #fafafa;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
}

:global(:root.dark) .kanban-task-card {
  border-color: #3f3f46;
  background: #18181b;
  color: #f4f4f5;
}

:global(:root.dark) .kanban-task-card-description,
:global(:root.dark) .kanban-task-card-meta,
:global(:root.dark) .kanban-task-card-labels {
  color: #a1a1aa;
}

:global(:root.dark) .kanban-task-card-chip,
:global(:root.dark) .kanban-task-card-badge,
:global(:root.dark) .kanban-task-card-label {
  border-color: #3f3f46;
  background: #27272a;
}
</style>
