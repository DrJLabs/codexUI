<template>
  <section class="artifact-preview-panel" aria-label="Artifact preview">
    <header>
      <div>
        <p>{{ artifact?.kind?.replace(/_/g, ' ') || 'Artifact' }}</p>
        <h3>{{ artifact?.title || 'No artifact selected' }}</h3>
      </div>
      <span v-if="preview">{{ preview.contentType }}</span>
    </header>
    <pre v-if="preview?.text" class="artifact-preview-text">{{ preview.text }}</pre>
    <p v-else class="artifact-preview-empty">{{ emptyText }}</p>
  </section>
</template>

<script setup lang="ts">
import type { WorkspaceArtifact } from '../../../types/workspaceArtifacts'

defineProps<{
  artifact: WorkspaceArtifact | null
  preview: { contentType: string; text: string; byteLength: number } | null
  emptyText?: string
}>()
</script>

<style scoped>
.artifact-preview-panel {
  display: grid;
  gap: 10px;
  min-width: 0;
  border: 1px solid #e4e4e7;
  border-radius: 8px;
  padding: 10px;
  background: #fff;
}

.artifact-preview-panel header {
  display: flex;
  gap: 10px;
  align-items: start;
  justify-content: space-between;
}

.artifact-preview-panel h3,
.artifact-preview-panel p {
  margin: 0;
}

.artifact-preview-panel header p,
.artifact-preview-panel header span {
  color: #71717a;
  font-size: 10px;
  font-weight: 900;
  text-transform: uppercase;
}

.artifact-preview-panel h3 {
  overflow-wrap: anywhere;
  color: #18181b;
  font-size: 13px;
  font-weight: 900;
}

.artifact-preview-text {
  max-height: 320px;
  overflow: auto;
  border: 1px solid #e4e4e7;
  border-radius: 8px;
  margin: 0;
  padding: 10px;
  background: #fafafa;
  color: #27272a;
  font-size: 12px;
  line-height: 1.45;
  white-space: pre-wrap;
}

.artifact-preview-empty {
  color: #71717a;
  font-size: 12px;
  font-weight: 800;
}

:global(:root.dark) .artifact-preview-panel {
  border-color: #3f3f46;
  background: #09090b;
}

:global(:root.dark) .artifact-preview-panel h3,
:global(:root.dark) .artifact-preview-text {
  color: #f4f4f5;
}

:global(:root.dark) .artifact-preview-panel header p,
:global(:root.dark) .artifact-preview-panel header span,
:global(:root.dark) .artifact-preview-empty {
  color: #a1a1aa;
}

:global(:root.dark) .artifact-preview-text {
  border-color: #3f3f46;
  background: #18181b;
}
</style>
