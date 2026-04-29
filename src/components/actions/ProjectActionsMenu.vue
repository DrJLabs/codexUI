<template>
  <section class="project-actions-menu" aria-label="Project actions">
    <header>
      <h3>Project actions</h3>
      <span>{{ actions.length }}</span>
    </header>
    <p v-if="actions.length === 0" class="project-actions-empty">No build, test, or dev actions detected.</p>
    <div v-else class="project-actions-list" role="group" aria-label="Available project actions">
      <button
        v-for="action in actions"
        :key="action.id"
        type="button"
        :disabled="disabled"
        :title="action.command"
        @click="$emit('run', action)"
      >
        <span>{{ action.label }}</span>
        <small>{{ action.runProfile.name }}</small>
      </button>
    </div>
  </section>
</template>

<script setup lang="ts">
import type { LocalActionCommand } from '../../types/localActions'

defineProps<{
  actions: LocalActionCommand[]
  disabled?: boolean
}>()

defineEmits<{
  run: [action: LocalActionCommand]
}>()
</script>

<style scoped>
.project-actions-menu {
  display: grid;
  gap: 10px;
  min-width: 0;
  border: 1px solid #e4e4e7;
  border-radius: 8px;
  padding: 10px;
  background: #fff;
}

.project-actions-menu header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.project-actions-menu h3,
.project-actions-empty {
  margin: 0;
}

.project-actions-menu h3 {
  color: #18181b;
  font-size: 14px;
  font-weight: 900;
}

.project-actions-menu header span {
  display: grid;
  min-width: 24px;
  height: 24px;
  place-items: center;
  border-radius: 999px;
  background: #f4f4f5;
  color: #52525b;
  font-size: 11px;
  font-weight: 900;
}

.project-actions-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.project-actions-list button {
  display: grid;
  gap: 2px;
  min-width: 112px;
  border: 1px solid #d4d4d8;
  border-radius: 8px;
  padding: 8px 10px;
  background: #fafafa;
  color: #27272a;
  text-align: left;
}

.project-actions-list button:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.project-actions-list span {
  font-size: 12px;
  font-weight: 900;
  text-transform: capitalize;
}

.project-actions-list small,
.project-actions-empty {
  color: #71717a;
  font-size: 11px;
  font-weight: 800;
}

:global(:root.dark) .project-actions-menu {
  border-color: #3f3f46;
  background: #09090b;
}

:global(:root.dark) .project-actions-menu h3,
:global(:root.dark) .project-actions-list button {
  color: #f4f4f5;
}

:global(:root.dark) .project-actions-menu header span,
:global(:root.dark) .project-actions-list button {
  border-color: #52525b;
  background: #27272a;
}

:global(:root.dark) .project-actions-list small,
:global(:root.dark) .project-actions-empty {
  color: #a1a1aa;
}
</style>
