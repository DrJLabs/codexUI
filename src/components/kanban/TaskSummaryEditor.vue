<template>
  <form class="task-summary-editor" @submit.prevent="save">
    <label class="task-summary-field">
      <span>Title</span>
      <input v-model="title" type="text" required />
    </label>
    <label class="task-summary-field">
      <span>Description</span>
      <textarea v-model="description" rows="5" />
    </label>
    <label class="task-summary-field">
      <span>Labels</span>
      <input v-model="labelsText" type="text" placeholder="frontend, polish" />
    </label>
    <div class="task-summary-actions">
      <button class="task-summary-button is-primary" type="submit">Save</button>
      <button class="task-summary-button" type="button" @click="$emit('archive')">Archive</button>
    </div>
  </form>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import type { KanbanTask, KanbanTaskLabel } from '../../types/kanban'

const props = defineProps<{
  task: KanbanTask
}>()

const emit = defineEmits<{
  save: [patch: { title: string; description: string; labels: KanbanTaskLabel[] }]
  archive: []
}>()

const title = ref(props.task.title)
const description = ref(props.task.description)
const labelsText = ref(props.task.labels.map((label) => label.name).join(', '))

watch(() => [props.task.id, props.task.title, props.task.description, props.task.labels] as const, () => {
  title.value = props.task.title
  description.value = props.task.description
  labelsText.value = props.task.labels.map((label) => label.name).join(', ')
}, { deep: true })

function labelColor(name: string): string {
  const colors = ['#2563eb', '#16a34a', '#d97706', '#dc2626', '#7c3aed', '#0891b2']
  const index = Array.from(name).reduce((total, char) => total + char.charCodeAt(0), 0) % colors.length
  return colors[index] ?? '#71717a'
}

function labelIdFromName(name: string): string {
  const normalized = name.toLowerCase().replace(/[^a-z0-9]+/gu, '_').replace(/^_+|_+$/gu, '')
  return `label_${normalized || 'custom'}`
}

function parseLabels(): KanbanTaskLabel[] {
  const labels: KanbanTaskLabel[] = []
  const usedIds = new Set<string>()
  for (const name of labelsText.value.split(',').map((label) => label.trim()).filter(Boolean)) {
    const id = labelIdFromName(name)
    if (usedIds.has(id)) continue
    usedIds.add(id)
    labels.push({
      id,
      name,
      color: labelColor(name),
    })
  }
  return labels
}

function save(): void {
  emit('save', {
    title: title.value.trim(),
    description: description.value.trim(),
    labels: parseLabels(),
  })
}
</script>

<style scoped>
.task-summary-editor {
  display: grid;
  gap: 12px;
}

.task-summary-field {
  display: grid;
  gap: 5px;
  color: #52525b;
  font-size: 12px;
  font-weight: 800;
}

.task-summary-field input,
.task-summary-field textarea {
  width: 100%;
  border: 1px solid #d4d4d8;
  border-radius: 8px;
  padding: 9px 10px;
  background: #fff;
  color: #18181b;
  font: inherit;
  font-weight: 500;
}

.task-summary-actions {
  display: flex;
  gap: 8px;
}

.task-summary-button {
  min-height: 34px;
  border: 1px solid #d4d4d8;
  border-radius: 8px;
  padding: 0 10px;
  background: #fff;
  color: #3f3f46;
  font-weight: 800;
}

.task-summary-button.is-primary {
  border-color: #18181b;
  background: #18181b;
  color: #fafafa;
}

:global(:root.dark) .task-summary-field {
  color: #a1a1aa;
}

:global(:root.dark) .task-summary-field input,
:global(:root.dark) .task-summary-field textarea,
:global(:root.dark) .task-summary-button {
  border-color: #3f3f46;
  background: #18181b;
  color: #e4e4e7;
}

:global(:root.dark) .task-summary-button.is-primary {
  border-color: #e4e4e7;
  background: #e4e4e7;
  color: #18181b;
}
</style>
