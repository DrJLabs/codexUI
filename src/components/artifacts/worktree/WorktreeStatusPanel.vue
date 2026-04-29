<template>
  <section class="worktree-status-panel" aria-label="Worktree status">
    <header>
      <div>
        <p>Worktree</p>
        <h3>{{ worktree?.branchName || 'No worktree selected' }}</h3>
      </div>
      <span v-if="worktree" :data-status="worktree.status">{{ worktree.status }}</span>
    </header>
    <dl v-if="worktree" class="worktree-status-grid">
      <div>
        <dt>Run</dt>
        <dd>{{ worktree.runId }}</dd>
      </div>
      <div>
        <dt>Task</dt>
        <dd>{{ worktree.taskId }}</dd>
      </div>
      <div>
        <dt>Base</dt>
        <dd>{{ worktree.baseRef }}</dd>
      </div>
      <div>
        <dt>Path</dt>
        <dd>{{ worktree.worktreePath }}</dd>
      </div>
    </dl>
    <p v-else class="worktree-empty">{{ emptyText }}</p>
  </section>
</template>

<script setup lang="ts">
import type { WorkspaceWorktree } from '../../../types/worktree'

withDefaults(defineProps<{
  worktree: WorkspaceWorktree | null
  emptyText?: string
}>(), {
  emptyText: 'No managed worktree has been recorded.',
})
</script>

<style scoped>
.worktree-status-panel {
  display: grid;
  gap: 10px;
  min-width: 0;
  border: 1px solid #e4e4e7;
  border-radius: 8px;
  padding: 10px;
  background: #fff;
}

.worktree-status-panel header {
  display: flex;
  gap: 10px;
  align-items: start;
  justify-content: space-between;
}

.worktree-status-panel h3,
.worktree-status-panel p,
.worktree-status-grid {
  margin: 0;
}

.worktree-status-panel header p {
  color: #71717a;
  font-size: 10px;
  font-weight: 900;
  text-transform: uppercase;
}

.worktree-status-panel h3 {
  overflow-wrap: anywhere;
  color: #18181b;
  font-size: 13px;
  font-weight: 900;
}

.worktree-status-panel header span {
  border: 1px solid #d4d4d8;
  border-radius: 999px;
  padding: 3px 7px;
  color: #27272a;
  font-size: 10px;
  font-weight: 900;
  text-transform: uppercase;
}

.worktree-status-grid {
  display: grid;
  gap: 7px;
}

.worktree-status-grid div {
  min-width: 0;
}

.worktree-status-grid dt {
  color: #71717a;
  font-size: 10px;
  font-weight: 900;
  text-transform: uppercase;
}

.worktree-status-grid dd {
  overflow-wrap: anywhere;
  margin: 0;
  color: #27272a;
  font-size: 12px;
  font-weight: 800;
}

.worktree-empty {
  color: #71717a;
  font-size: 12px;
  font-weight: 800;
}

:global(:root.dark) .worktree-status-panel {
  border-color: #3f3f46;
  background: #09090b;
}

:global(:root.dark) .worktree-status-panel h3,
:global(:root.dark) .worktree-status-grid dd,
:global(:root.dark) .worktree-status-panel header span {
  color: #f4f4f5;
}

:global(:root.dark) .worktree-status-panel header p,
:global(:root.dark) .worktree-status-grid dt,
:global(:root.dark) .worktree-empty {
  color: #a1a1aa;
}

:global(:root.dark) .worktree-status-panel header span {
  border-color: #52525b;
}
</style>
