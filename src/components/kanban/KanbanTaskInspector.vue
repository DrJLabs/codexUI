<template>
  <aside v-if="task" class="kanban-inspector" aria-label="Task details">
    <header class="kanban-inspector-header">
      <div>
        <p class="kanban-inspector-eyebrow">{{ task.status }}</p>
        <h2>{{ task.title }}</h2>
      </div>
      <button type="button" aria-label="Close task inspector" @click="$emit('close')">Close</button>
    </header>
    <TaskStatusActions :status="task.status" @set-status="$emit('set-status', $event)" />
    <TaskRunControls
      :task="task"
      :policy="executionPolicy"
      @start-run="$emit('start-run')"
      @interrupt-run="$emit('interrupt-run')"
    />
    <TaskRunLogPanel
      :run-id="task.currentRunId"
      :log-text="runLog"
      @refresh="$emit('refresh-run-log')"
    />
    <TaskSummaryEditor :task="task" @save="$emit('save-summary', $event)" @archive="$emit('archive')" />
    <AcceptanceCriteriaEditor
      :task="task"
      @add="$emit('add-criterion', $event)"
      @update="(criterionId, patch) => $emit('update-criterion', criterionId, patch)"
      @remove="$emit('remove-criterion', $event)"
      @toggle="(criterionId, checked) => $emit('toggle-criterion', criterionId, checked)"
    />
  </aside>
  <aside v-else class="kanban-inspector is-empty" aria-label="Task details">
    Select a task to inspect it.
  </aside>
</template>

<script setup lang="ts">
import type { KanbanExecutionPolicy, KanbanStatus, KanbanTask, KanbanTaskLabel } from '../../types/kanban'
import AcceptanceCriteriaEditor from './AcceptanceCriteriaEditor.vue'
import TaskStatusActions from './TaskStatusActions.vue'
import TaskRunControls from './TaskRunControls.vue'
import TaskRunLogPanel from './TaskRunLogPanel.vue'
import TaskSummaryEditor from './TaskSummaryEditor.vue'

defineProps<{
  task: KanbanTask | null
  executionPolicy: KanbanExecutionPolicy | null
  runLog: string
}>()

defineEmits<{
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
</script>

<style scoped>
.kanban-inspector {
  display: grid;
  align-content: start;
  gap: 16px;
  min-width: 280px;
  max-width: 360px;
  border-left: 1px solid #e4e4e7;
  padding-left: 16px;
}

.kanban-inspector.is-empty {
  color: #71717a;
  font-weight: 700;
}

.kanban-inspector-header {
  display: flex;
  gap: 12px;
  align-items: start;
  justify-content: space-between;
}

.kanban-inspector-header h2,
.kanban-inspector-eyebrow {
  margin: 0;
}

.kanban-inspector-header h2 {
  overflow-wrap: anywhere;
  font-size: 18px;
}

.kanban-inspector-eyebrow {
  color: #71717a;
  font-size: 11px;
  font-weight: 900;
  text-transform: uppercase;
}

.kanban-inspector-header button {
  border: 1px solid #d4d4d8;
  border-radius: 8px;
  padding: 6px 9px;
  background: #fff;
  color: #3f3f46;
  font-weight: 800;
}

:global(:root.dark) .kanban-inspector {
  border-color: #3f3f46;
}

:global(:root.dark) .kanban-inspector-header button {
  border-color: #3f3f46;
  background: #18181b;
  color: #e4e4e7;
}

@media (max-width: 860px) {
  .kanban-inspector {
    display: none;
  }
}
</style>
