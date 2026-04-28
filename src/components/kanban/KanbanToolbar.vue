<template>
  <div class="kanban-toolbar">
    <div class="kanban-toolbar-main">
      <input
        class="kanban-toolbar-search"
        type="search"
        :value="searchQuery"
        placeholder="Search tasks"
        aria-label="Search Kanban tasks"
        @input="$emit('update:searchQuery', ($event.target as HTMLInputElement).value)"
      />
      <div v-if="labelNames.length > 0" class="kanban-toolbar-labels" role="group" aria-label="Filter by label">
        <button
          v-for="label in labelNames"
          :key="label"
          class="kanban-toolbar-label"
          :class="{ 'is-active': activeLabels.includes(label) }"
          type="button"
          @click="$emit('toggle-label', label)"
        >
          {{ label }}
        </button>
      </div>
    </div>
    <div class="kanban-toolbar-actions">
      <button
        v-if="searchQuery || activeLabels.length > 0"
        class="kanban-toolbar-button"
        type="button"
        @click="$emit('clear-filters')"
      >
        Clear
      </button>
      <button class="kanban-toolbar-button is-primary" type="button" @click="$emit('create-task')">
        New task
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  searchQuery: string
  labelNames: string[]
  activeLabels: string[]
}>()

defineEmits<{
  'update:searchQuery': [value: string]
  'toggle-label': [label: string]
  'clear-filters': []
  'create-task': []
}>()
</script>

<style scoped>
.kanban-toolbar {
  display: flex;
  gap: 12px;
  align-items: center;
  justify-content: space-between;
}

.kanban-toolbar-main {
  display: flex;
  min-width: 0;
  flex: 1;
  gap: 8px;
  align-items: center;
}

.kanban-toolbar-search {
  width: min(320px, 100%);
  min-height: 36px;
  border: 1px solid #d4d4d8;
  border-radius: 8px;
  padding: 0 12px;
  background: #fff;
  color: #18181b;
}

.kanban-toolbar-labels {
  display: flex;
  min-width: 0;
  gap: 6px;
  overflow-x: auto;
}

.kanban-toolbar-label,
.kanban-toolbar-button {
  min-height: 34px;
  border: 1px solid #d4d4d8;
  border-radius: 8px;
  padding: 0 10px;
  background: #fff;
  color: #3f3f46;
  font-weight: 700;
  white-space: nowrap;
}

.kanban-toolbar-label.is-active {
  border-color: #2563eb;
  background: #eff6ff;
  color: #1d4ed8;
}

.kanban-toolbar-actions {
  display: flex;
  gap: 8px;
}

.kanban-toolbar-button.is-primary {
  border-color: #18181b;
  background: #18181b;
  color: #fafafa;
}

:global(:root.dark) .kanban-toolbar-search,
:global(:root.dark) .kanban-toolbar-label,
:global(:root.dark) .kanban-toolbar-button {
  border-color: #3f3f46;
  background: #18181b;
  color: #e4e4e7;
}

:global(:root.dark) .kanban-toolbar-button.is-primary {
  border-color: #e4e4e7;
  background: #e4e4e7;
  color: #18181b;
}

@media (max-width: 720px) {
  .kanban-toolbar {
    align-items: stretch;
    flex-direction: column;
  }

  .kanban-toolbar-main {
    flex-direction: column;
    align-items: stretch;
  }

  .kanban-toolbar-search {
    width: 100%;
  }
}
</style>
