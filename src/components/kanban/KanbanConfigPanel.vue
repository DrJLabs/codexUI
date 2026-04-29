<template>
  <form class="kanban-config-panel" @submit.prevent="save">
    <header class="kanban-config-panel-header">
      <h2>Board config</h2>
      <button class="kanban-config-save" type="submit" :disabled="isSaving || !config">
        {{ isSaving ? 'Saving' : 'Save' }}
      </button>
    </header>

    <div class="kanban-config-section" aria-label="Column visibility and WIP limits">
      <div v-for="column in draft.columns" :key="column.key" class="kanban-config-column-row">
        <label class="kanban-config-visible-toggle">
          <input
            type="checkbox"
            :checked="column.visible"
            :disabled="column.visible && visibleColumnCount <= 1"
            @change="setColumnVisible(column.key, ($event.target as HTMLInputElement).checked)"
          />
          <span>{{ column.title }}</span>
        </label>
        <label class="kanban-config-wip-field">
          <span>WIP</span>
          <input
            type="number"
            min="0"
            step="1"
            inputmode="numeric"
            :value="column.wipLimit ?? ''"
            placeholder="None"
            @input="setColumnWipLimit(column.key, ($event.target as HTMLInputElement).value)"
          />
        </label>
      </div>
    </div>

    <div class="kanban-config-section kanban-config-defaults">
      <label>
        <span>Default status</span>
        <select v-model="draft.defaults.status">
          <option v-for="column in draft.columns" :key="column.key" :value="column.key">
            {{ column.title }}
          </option>
        </select>
      </label>
      <label>
        <span>Default priority</span>
        <select v-model="draft.defaults.priority">
          <option value="critical">Critical</option>
          <option value="high">High</option>
          <option value="normal">Normal</option>
          <option value="low">Low</option>
        </select>
      </label>
      <label>
        <span>Proposal policy</span>
        <select v-model="draft.proposalPolicy">
          <option value="confirm">Confirm</option>
          <option value="auto">Auto</option>
        </select>
      </label>
    </div>
  </form>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { KANBAN_STATUSES, type KanbanBoardConfig, type KanbanStatus, type UpdateKanbanBoardConfigInput } from '../../types/kanban'

const props = defineProps<{
  config: KanbanBoardConfig | null
  isSaving: boolean
}>()

const emit = defineEmits<{
  save: [input: UpdateKanbanBoardConfigInput]
}>()

const defaultDraft: KanbanBoardConfig = {
  columns: KANBAN_STATUSES.map((status) => ({
    key: status.id,
    title: status.title,
    visible: true,
    wipLimit: null,
  })),
  defaults: {
    status: 'backlog',
    priority: 'normal',
  },
  reviewRequired: true,
  allowDoneDragBypass: false,
  quickViewLimit: 20,
  proposalPolicy: 'confirm',
  defaultModel: '',
  defaultThinking: 'medium',
}

const draft = ref<KanbanBoardConfig>(cloneConfig(props.config ?? defaultDraft))

const visibleColumnCount = computed(() => draft.value.columns.filter((column) => column.visible).length)

watch(() => props.config, (config) => {
  draft.value = cloneConfig(config ?? defaultDraft)
}, { deep: true })

function cloneConfig(config: KanbanBoardConfig): KanbanBoardConfig {
  return {
    ...config,
    columns: config.columns.map((column) => ({ ...column })),
    defaults: { ...config.defaults },
  }
}

function setColumnVisible(status: KanbanStatus, visible: boolean): void {
  draft.value = {
    ...draft.value,
    columns: draft.value.columns.map((column) => column.key === status ? { ...column, visible } : column),
  }
}

function setColumnWipLimit(status: KanbanStatus, rawValue: string): void {
  const trimmed = rawValue.trim()
  const wipLimit = trimmed === '' ? null : Math.max(0, Math.floor(Number(trimmed)))
  draft.value = {
    ...draft.value,
    columns: draft.value.columns.map((column) => column.key === status
      ? { ...column, wipLimit: Number.isFinite(wipLimit) ? wipLimit : null }
      : column),
  }
}

function save(): void {
  if (!props.config) return
  emit('save', {
    columns: draft.value.columns,
    defaults: draft.value.defaults,
    proposalPolicy: draft.value.proposalPolicy,
  })
}
</script>

<style scoped>
.kanban-config-panel {
  display: grid;
  gap: 12px;
  border: 1px solid #e4e4e7;
  border-radius: 8px;
  padding: 12px;
  background: #fff;
  color: #18181b;
}

.kanban-config-panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.kanban-config-panel-header h2 {
  margin: 0;
  font-size: 12px;
  font-weight: 800;
  text-transform: uppercase;
}

.kanban-config-save {
  min-height: 30px;
  border: 1px solid #18181b;
  border-radius: 8px;
  padding: 0 10px;
  background: #18181b;
  color: #fafafa;
  font-weight: 800;
}

.kanban-config-save:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.kanban-config-section {
  display: grid;
  gap: 8px;
}

.kanban-config-column-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 92px;
  gap: 8px;
  align-items: end;
}

.kanban-config-visible-toggle {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 34px;
  color: #3f3f46;
  font-size: 12px;
  font-weight: 800;
}

.kanban-config-visible-toggle input {
  width: 16px;
  height: 16px;
  margin: 0;
}

.kanban-config-wip-field,
.kanban-config-defaults label {
  display: grid;
  gap: 4px;
}

.kanban-config-wip-field span,
.kanban-config-defaults span {
  color: #71717a;
  font-size: 10px;
  font-weight: 800;
}

.kanban-config-wip-field input,
.kanban-config-defaults select {
  min-width: 0;
  min-height: 32px;
  border: 1px solid #d4d4d8;
  border-radius: 8px;
  padding: 0 8px;
  background: #fff;
  color: #18181b;
  font-weight: 700;
}

:global(:root.dark) .kanban-config-panel {
  border-color: #3f3f46;
  background: #18181b;
  color: #f4f4f5;
}

:global(:root.dark) .kanban-config-save {
  border-color: #e4e4e7;
  background: #e4e4e7;
  color: #18181b;
}

:global(:root.dark) .kanban-config-visible-toggle {
  color: #e4e4e7;
}

:global(:root.dark) .kanban-config-wip-field span,
:global(:root.dark) .kanban-config-defaults span {
  color: #a1a1aa;
}

:global(:root.dark) .kanban-config-wip-field input,
:global(:root.dark) .kanban-config-defaults select {
  border-color: #3f3f46;
  background: #27272a;
  color: #f4f4f5;
}
</style>
