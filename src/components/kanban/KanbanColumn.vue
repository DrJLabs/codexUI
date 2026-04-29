<template>
  <section
    class="kanban-column"
    :class="{ 'is-over-wip-limit': isOverWipLimit }"
    :aria-label="status.title"
    @dragover.prevent="onDragOver"
    @drop.prevent="onDrop"
  >
    <header class="kanban-column-header">
      <h2>{{ status.title }}</h2>
      <span>{{ countLabel }}</span>
    </header>
    <div class="kanban-column-list">
      <KanbanTaskCard
        v-for="task in tasks"
        :key="task.id"
        :task="task"
        :selected="task.id === selectedTaskId"
        @select="emit('select-task', $event)"
      />
      <div v-if="tasks.length === 0" class="kanban-column-empty">No tasks</div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { KanbanStatus, KanbanTask } from '../../types/kanban'
import KanbanTaskCard from './KanbanTaskCard.vue'

const props = defineProps<{
  status: { id: KanbanStatus; title: string }
  tasks: KanbanTask[]
  selectedTaskId: string
  wipLimit: number | null
}>()

const emit = defineEmits<{
  'select-task': [taskId: string]
  'reorder-task': [input: { taskId: string; status: KanbanStatus; beforeTaskId?: string; afterTaskId?: string }]
}>()

const countLabel = computed(() => props.wipLimit === null ? String(props.tasks.length) : `${props.tasks.length} / ${props.wipLimit}`)
const isOverWipLimit = computed(() => props.wipLimit !== null && props.tasks.length > props.wipLimit)

function onDragOver(event: DragEvent): void {
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'move'
  }
}

function onDrop(event: DragEvent): void {
  const taskId = event.dataTransfer?.getData('application/x-kanban-task-id') || event.dataTransfer?.getData('text/plain') || ''
  if (!taskId) return

  const position = resolveDropPosition(event, taskId)
  if (!position) return

  emit('reorder-task', {
    taskId,
    status: props.status.id,
    ...position,
  })
}

function resolveDropPosition(event: DragEvent, draggedTaskId: string): { beforeTaskId?: string; afterTaskId?: string } | null {
  const currentTarget = event.currentTarget
  if (!(currentTarget instanceof HTMLElement)) return null

  const target = event.target instanceof Element
    ? event.target.closest<HTMLElement>('[data-kanban-task-id]')
    : null
  const orderedTaskIds = props.tasks.map((task) => task.id).filter((taskId) => taskId !== draggedTaskId)

  if (!target || !currentTarget.contains(target)) {
    return orderedTaskIds.length > 0 ? { afterTaskId: orderedTaskIds[orderedTaskIds.length - 1] } : {}
  }

  const targetTaskId = target.dataset.kanbanTaskId ?? ''
  if (!targetTaskId || targetTaskId === draggedTaskId) return null

  const targetIndex = orderedTaskIds.indexOf(targetTaskId)
  if (targetIndex < 0) return null

  const rect = target.getBoundingClientRect()
  const isBeforeTarget = event.clientY < rect.top + rect.height / 2
  if (isBeforeTarget) {
    const afterTaskId = orderedTaskIds[targetIndex - 1]
    return {
      beforeTaskId: targetTaskId,
      ...(afterTaskId ? { afterTaskId } : {}),
    }
  }

  const beforeTaskId = orderedTaskIds[targetIndex + 1]
  return {
    afterTaskId: targetTaskId,
    ...(beforeTaskId ? { beforeTaskId } : {}),
  }
}
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

.kanban-column.is-over-wip-limit .kanban-column-header span {
  background: #fee2e2;
  color: #991b1b;
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

:global(:root.dark) .kanban-column.is-over-wip-limit .kanban-column-header span {
  background: rgba(127, 29, 29, 0.45);
  color: #fecaca;
}

:global(:root.dark) .kanban-column-empty {
  border-color: #3f3f46;
  color: #71717a;
}
</style>
