<template>
  <form class="kanban-metadata-editor" @submit.prevent="save">
    <div class="kanban-metadata-editor-header">
      <h3>Metadata</h3>
      <button class="kanban-metadata-editor-save" type="submit">Save</button>
    </div>
    <div class="kanban-metadata-editor-grid">
      <label>
        <span>Priority</span>
        <select v-model="priority">
          <option value="critical">Critical</option>
          <option value="high">High</option>
          <option value="normal">Normal</option>
          <option value="low">Low</option>
        </select>
      </label>
      <label>
        <span>Assignee</span>
        <input v-model="assignee" list="kanban-assignee-options" />
      </label>
      <label>
        <span>Model</span>
        <input v-model="model" type="text" />
      </label>
      <label>
        <span>Thinking</span>
        <select v-model="thinking">
          <option value="off">Off</option>
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
        </select>
      </label>
      <label>
        <span>Due date</span>
        <input v-model="dueAtIso" type="date" />
      </label>
      <label>
        <span>Estimate</span>
        <input v-model="estimateMinutes" type="number" min="0" step="1" inputmode="numeric" />
      </label>
      <label>
        <span>Actual</span>
        <input v-model="actualMinutes" type="number" min="0" step="1" inputmode="numeric" />
      </label>
    </div>
    <datalist id="kanban-assignee-options">
      <option value="operator" />
      <option value="codex:auto" />
      <option :value="threadAssignee" />
    </datalist>
  </form>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { KanbanActor, KanbanMetadataPatch, KanbanPriority, KanbanTask, KanbanThinkingLevel } from '../../types/kanban'

const props = defineProps<{
  task: KanbanTask
}>()

const emit = defineEmits<{
  save: [patch: KanbanMetadataPatch]
}>()

const priority = ref<KanbanPriority>('normal')
const assignee = ref<KanbanActor>('codex:auto')
const model = ref('')
const thinking = ref<KanbanThinkingLevel>('medium')
const dueAtIso = ref('')
const estimateMinutes = ref('')
const actualMinutes = ref('')

const threadAssignee = computed(() => `codex:thread:${props.task.codexThreadId || 'threadId'}`)

watch(() => props.task, (task) => {
  priority.value = task.priority
  assignee.value = task.assignee
  model.value = task.model
  thinking.value = task.thinking
  dueAtIso.value = task.dueAtIso.slice(0, 10)
  estimateMinutes.value = task.estimateMinutes === null ? '' : String(task.estimateMinutes)
  actualMinutes.value = task.actualMinutes === null ? '' : String(task.actualMinutes)
}, { immediate: true })

function parseMinutes(value: string): number | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  return Number(trimmed)
}

function save(): void {
  emit('save', {
    priority: priority.value,
    assignee: assignee.value,
    model: model.value.trim(),
    thinking: thinking.value,
    dueAtIso: dueAtIso.value,
    estimateMinutes: parseMinutes(estimateMinutes.value),
    actualMinutes: parseMinutes(actualMinutes.value),
  })
}
</script>

<style scoped>
.kanban-metadata-editor {
  display: grid;
  gap: 10px;
  border-top: 1px solid #e4e4e7;
  padding-top: 12px;
}

.kanban-metadata-editor-header {
  display: flex;
  gap: 8px;
  align-items: center;
  justify-content: space-between;
}

.kanban-metadata-editor-header h3 {
  margin: 0;
  font-size: 13px;
  font-weight: 900;
}

.kanban-metadata-editor-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.kanban-metadata-editor-grid label {
  display: grid;
  gap: 4px;
  min-width: 0;
}

.kanban-metadata-editor-grid span {
  color: #71717a;
  font-size: 11px;
  font-weight: 800;
}

.kanban-metadata-editor-grid input,
.kanban-metadata-editor-grid select {
  min-width: 0;
  min-height: 34px;
  border: 1px solid #d4d4d8;
  border-radius: 8px;
  padding: 0 9px;
  background: #fff;
  color: #18181b;
}

.kanban-metadata-editor-save {
  min-height: 32px;
  border: 1px solid #18181b;
  border-radius: 8px;
  padding: 0 10px;
  background: #18181b;
  color: #fafafa;
  font-weight: 800;
}

:global(:root.dark) .kanban-metadata-editor {
  border-color: #3f3f46;
}

:global(:root.dark) .kanban-metadata-editor-grid span {
  color: #a1a1aa;
}

:global(:root.dark) .kanban-metadata-editor-grid input,
:global(:root.dark) .kanban-metadata-editor-grid select {
  border-color: #3f3f46;
  background: #18181b;
  color: #f4f4f5;
}

:global(:root.dark) .kanban-metadata-editor-save {
  border-color: #e4e4e7;
  background: #e4e4e7;
  color: #18181b;
}

@media (max-width: 420px) {
  .kanban-metadata-editor-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
