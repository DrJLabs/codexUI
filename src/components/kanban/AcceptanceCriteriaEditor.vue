<template>
  <div class="acceptance-editor">
    <div v-if="task.acceptanceCriteria.length === 0" class="acceptance-editor-empty">No acceptance criteria.</div>
    <label v-for="criterion in task.acceptanceCriteria" :key="criterion.id" class="acceptance-editor-row">
      <input
        type="checkbox"
        :checked="criterion.checked"
        @change="$emit('toggle', criterion.id, ($event.target as HTMLInputElement).checked)"
      />
      <input
        :value="criterion.text"
        type="text"
        @change="$emit('update', criterion.id, { text: ($event.target as HTMLInputElement).value })"
      />
      <button type="button" @click="$emit('remove', criterion.id)">Remove</button>
    </label>
    <form class="acceptance-editor-add" @submit.prevent="add">
      <input v-model="draft" type="text" placeholder="Add acceptance criterion" />
      <button type="submit">Add</button>
    </form>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import type { KanbanTask } from '../../types/kanban'

defineProps<{
  task: KanbanTask
}>()

const emit = defineEmits<{
  add: [text: string]
  update: [criterionId: string, patch: { text?: string; checked?: boolean }]
  remove: [criterionId: string]
  toggle: [criterionId: string, checked: boolean]
}>()

const draft = ref('')

function add(): void {
  const text = draft.value.trim()
  if (!text) return
  emit('add', text)
  draft.value = ''
}
</script>

<style scoped>
.acceptance-editor {
  display: grid;
  gap: 8px;
}

.acceptance-editor-empty {
  color: #71717a;
  font-size: 13px;
  font-weight: 700;
}

.acceptance-editor-row,
.acceptance-editor-add {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  gap: 8px;
  align-items: center;
}

.acceptance-editor-row input[type='text'],
.acceptance-editor-add input {
  min-height: 34px;
  border: 1px solid #d4d4d8;
  border-radius: 8px;
  padding: 0 9px;
  background: #fff;
  color: #18181b;
}

.acceptance-editor-row button,
.acceptance-editor-add button {
  min-height: 34px;
  border: 1px solid #d4d4d8;
  border-radius: 8px;
  padding: 0 10px;
  background: #fff;
  color: #3f3f46;
  font-weight: 800;
}

:global(:root.dark) .acceptance-editor-empty {
  color: #a1a1aa;
}

:global(:root.dark) .acceptance-editor-row input[type='text'],
:global(:root.dark) .acceptance-editor-add input,
:global(:root.dark) .acceptance-editor-row button,
:global(:root.dark) .acceptance-editor-add button {
  border-color: #3f3f46;
  background: #18181b;
  color: #e4e4e7;
}

@media (max-width: 520px) {
  .acceptance-editor-row,
  .acceptance-editor-add {
    grid-template-columns: auto minmax(0, 1fr);
  }

  .acceptance-editor-row button,
  .acceptance-editor-add button {
    grid-column: 2;
  }
}
</style>
