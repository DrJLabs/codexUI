<template>
  <section class="task-run-controls" aria-label="Task run controls">
    <div>
      <p class="task-run-controls-label">Run state</p>
      <strong>{{ task.runState.replace(/_/g, ' ') }}</strong>
    </div>
    <div class="task-run-controls-actions">
      <button
        type="button"
        :disabled="!canRun"
        :title="runDisabledReason"
        @click="$emit('start-run')"
      >
        Run
      </button>
      <button
        type="button"
        :disabled="!canInterrupt"
        @click="$emit('interrupt-run')"
      >
        Stop
      </button>
    </div>
    <p v-if="runDisabledReason" class="task-run-controls-note">{{ runDisabledReason }}</p>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { KanbanExecutionPolicy, KanbanTask } from '../../types/kanban'

const props = defineProps<{
  task: KanbanTask
  policy: KanbanExecutionPolicy | null
}>()

defineEmits<{
  'start-run': []
  'interrupt-run': []
}>()

const isActive = computed(() => ['queued', 'preparing_worktree', 'starting_codex', 'running', 'waiting_for_approval', 'running_tests', 'collecting_artifacts', 'stopping'].includes(props.task.runState))
const runDisabledReason = computed(() => {
  if (!props.policy?.executionEnabled) return 'Execution is disabled for this session.'
  if (isActive.value) return 'This task already has an active run.'
  return ''
})
const canRun = computed(() => !runDisabledReason.value)
const canInterrupt = computed(() => props.policy?.executionEnabled === true && isActive.value && Boolean(props.task.currentRunId))
</script>

<style scoped>
.task-run-controls {
  display: grid;
  gap: 10px;
  border: 1px solid #e4e4e7;
  border-radius: 8px;
  padding: 12px;
  background: #fafafa;
}

.task-run-controls-label,
.task-run-controls-note {
  margin: 0;
  color: #71717a;
  font-size: 12px;
  font-weight: 800;
}

.task-run-controls-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.task-run-controls button {
  border: 1px solid #d4d4d8;
  border-radius: 8px;
  padding: 7px 11px;
  background: #fff;
  color: #18181b;
  font-weight: 900;
}

.task-run-controls button:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

:global(:root.dark) .task-run-controls {
  border-color: #3f3f46;
  background: #18181b;
}

:global(:root.dark) .task-run-controls button {
  border-color: #52525b;
  background: #27272a;
  color: #f4f4f5;
}
</style>
