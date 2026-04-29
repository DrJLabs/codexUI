<template>
  <header class="thread-workspace-header">
    <div>
      <p>{{ model.hasThread ? 'Thread workspace' : 'Workspace' }}</p>
      <strong>{{ model.hasThread ? model.threadId : 'No thread selected' }}</strong>
    </div>
    <span>{{ model.artifactCount }} artifacts</span>
  </header>
</template>

<script setup lang="ts">
import type { ThreadWorkspaceModel } from '../../types/threadWorkspace'

defineProps<{
  model: ThreadWorkspaceModel
}>()
</script>

<style scoped>
.thread-workspace-header {
  display: flex;
  align-items: start;
  justify-content: space-between;
  gap: 12px;
  border-bottom: 1px solid #e4e4e7;
  padding: 12px;
}

.thread-workspace-header p,
.thread-workspace-header strong {
  margin: 0;
}

.thread-workspace-header p,
.thread-workspace-header span {
  color: #71717a;
  font-size: 11px;
  font-weight: 800;
}

.thread-workspace-header strong {
  display: block;
  max-width: 16rem;
  overflow: hidden;
  color: #18181b;
  font-size: 13px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

:global(:root.dark) .thread-workspace-header {
  border-bottom-color: #3f3f46;
}

:global(:root.dark) .thread-workspace-header strong {
  color: #f4f4f5;
}

:global(:root.dark) .thread-workspace-header p,
:global(:root.dark) .thread-workspace-header span {
  color: #a1a1aa;
}
</style>
