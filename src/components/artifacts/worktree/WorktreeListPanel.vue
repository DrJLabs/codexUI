<template>
  <section class="worktree-list-panel" aria-label="Managed worktrees">
    <header>
      <h2>Managed worktrees</h2>
      <span>{{ worktrees.length }}</span>
    </header>
    <p v-if="worktrees.length === 0" class="worktree-list-empty">No managed worktrees.</p>
    <ul v-else class="worktree-list" role="list">
      <li v-for="worktree in worktrees" :key="worktree.runId">
        <WorktreeStatusPanel :worktree="worktree" />
      </li>
    </ul>
  </section>
</template>

<script setup lang="ts">
import type { WorkspaceWorktree } from '../../../types/worktree'
import WorktreeStatusPanel from './WorktreeStatusPanel.vue'

defineProps<{
  worktrees: WorkspaceWorktree[]
}>()
</script>

<style scoped>
.worktree-list-panel {
  display: grid;
  gap: 10px;
  min-width: 0;
}

.worktree-list-panel header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.worktree-list-panel h2,
.worktree-list-empty {
  margin: 0;
}

.worktree-list-panel h2 {
  color: #18181b;
  font-size: 14px;
  font-weight: 900;
}

.worktree-list-panel header span {
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

.worktree-list {
  display: grid;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.worktree-list-empty {
  color: #71717a;
  font-size: 12px;
  font-weight: 800;
}

:global(:root.dark) .worktree-list-panel h2 {
  color: #f4f4f5;
}

:global(:root.dark) .worktree-list-panel header span {
  background: #27272a;
  color: #d4d4d8;
}

:global(:root.dark) .worktree-list-empty {
  color: #a1a1aa;
}
</style>
