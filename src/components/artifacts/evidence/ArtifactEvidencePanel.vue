<template>
  <section class="artifact-evidence-panel" aria-label="Run evidence">
    <div class="artifact-evidence-grid">
      <CommandEvidenceCard
        v-for="summary in evidence.summaries"
        :key="summary.id"
        :summary="summary"
      />
    </div>
    <pre>{{ evidence.displayText || emptyText }}</pre>
  </section>
</template>

<script setup lang="ts">
import type { ArtifactEvidenceModel } from '../../../types/evidence'
import CommandEvidenceCard from './CommandEvidenceCard.vue'

defineProps<{
  evidence: ArtifactEvidenceModel
  emptyText?: string
}>()
</script>

<style scoped>
.artifact-evidence-panel {
  display: grid;
  gap: 8px;
}

.artifact-evidence-grid {
  display: grid;
  gap: 6px;
}

.artifact-evidence-panel pre {
  min-height: 72px;
  max-height: 180px;
  overflow: auto;
  margin: 0;
  border: 1px solid #e4e4e7;
  border-radius: 8px;
  padding: 10px;
  background: #f4f4f5;
  color: #27272a;
  white-space: pre-wrap;
}

:global(:root.dark) .artifact-evidence-panel pre {
  border-color: #3f3f46;
  background: #09090b;
  color: #e4e4e7;
}
</style>
