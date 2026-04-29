<template>
  <Teleport to="body">
    <div v-if="task" class="kanban-sheet-backdrop" @click.self="emit('close')">
      <section
        ref="sheetRef"
        class="kanban-sheet"
        aria-label="Task details"
        role="dialog"
        aria-modal="true"
        tabindex="-1"
        @keydown.esc="emit('close')"
      >
        <KanbanTaskInspector
          :task="task"
          :execution-policy="executionPolicy"
          :run-log="runLog"
          @close="emit('close')"
          @archive="emit('archive')"
          @start-run="emit('start-run')"
          @interrupt-run="emit('interrupt-run')"
          @refresh-run-log="emit('refresh-run-log')"
          @set-status="emit('set-status', $event)"
          @save-summary="emit('save-summary', $event)"
          @add-criterion="emit('add-criterion', $event)"
          @update-criterion="(criterionId, patch) => emit('update-criterion', criterionId, patch)"
          @remove-criterion="emit('remove-criterion', $event)"
          @toggle-criterion="(criterionId, checked) => emit('toggle-criterion', criterionId, checked)"
        />
      </section>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import type { KanbanExecutionPolicy, KanbanStatus, KanbanTask, KanbanTaskLabel } from '../../types/kanban'
import KanbanTaskInspector from './KanbanTaskInspector.vue'

const props = defineProps<{
  task: KanbanTask | null
  executionPolicy: KanbanExecutionPolicy | null
  runLog: string
}>()

const emit = defineEmits<{
  close: []
  archive: []
  'start-run': []
  'interrupt-run': []
  'refresh-run-log': []
  'set-status': [status: KanbanStatus]
  'save-summary': [patch: { title: string; description: string; labels: KanbanTaskLabel[] }]
  'add-criterion': [text: string]
  'update-criterion': [criterionId: string, patch: { text?: string; checked?: boolean }]
  'remove-criterion': [criterionId: string]
  'toggle-criterion': [criterionId: string, checked: boolean]
}>()

const sheetRef = ref<HTMLElement | null>(null)

watch(() => props.task?.id ?? '', async (taskId) => {
  if (!taskId) return
  await nextTick()
  sheetRef.value?.focus()
})
</script>

<style scoped>
.kanban-sheet-backdrop {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: none;
  align-items: end;
  background: rgba(24, 24, 27, 0.42);
}

.kanban-sheet {
  width: 100%;
  max-height: 88dvh;
  overflow: auto;
  border-radius: 8px 8px 0 0;
  background: #fff;
  padding: 16px;
}

.kanban-sheet :deep(.kanban-inspector) {
  display: grid;
  max-width: none;
  border-left: 0;
  padding-left: 0;
}

:global(:root.dark) .kanban-sheet {
  background: #09090b;
  color: #f4f4f5;
}

@media (max-width: 860px) {
  .kanban-sheet-backdrop {
    display: flex;
  }
}
</style>
