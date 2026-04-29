<template>
  <section class="action-run-evidence-panel" aria-label="Action run evidence">
    <header>
      <div>
        <p>Action evidence</p>
        <h3>{{ evidence?.command || 'No action run selected' }}</h3>
      </div>
      <span v-if="evidence" :data-exit-code="evidence.exitCode">{{ exitLabel }}</span>
    </header>
    <pre v-if="evidence?.output" class="action-run-output">{{ evidence.output }}</pre>
    <p v-else class="action-run-empty">Run output will appear here.</p>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { LocalActionEvidence } from '../../../types/localActions'

const props = defineProps<{
  evidence: LocalActionEvidence | null
}>()

const exitLabel = computed(() => {
  if (!props.evidence) return ''
  return props.evidence.exitCode === null ? 'running' : `exit ${props.evidence.exitCode}`
})
</script>

<style scoped>
.action-run-evidence-panel {
  display: grid;
  gap: 10px;
  min-width: 0;
  border: 1px solid #e4e4e7;
  border-radius: 8px;
  padding: 10px;
  background: #fff;
}

.action-run-evidence-panel header {
  display: flex;
  gap: 10px;
  align-items: start;
  justify-content: space-between;
}

.action-run-evidence-panel h3,
.action-run-evidence-panel p {
  margin: 0;
}

.action-run-evidence-panel header p,
.action-run-evidence-panel header span {
  color: #71717a;
  font-size: 10px;
  font-weight: 900;
  text-transform: uppercase;
}

.action-run-evidence-panel h3 {
  overflow-wrap: anywhere;
  color: #18181b;
  font-size: 13px;
  font-weight: 900;
}

.action-run-output {
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

.action-run-empty {
  color: #71717a;
  font-size: 12px;
  font-weight: 800;
}

:global(:root.dark) .action-run-evidence-panel {
  border-color: #3f3f46;
  background: #09090b;
}

:global(:root.dark) .action-run-evidence-panel h3,
:global(:root.dark) .action-run-output {
  color: #f4f4f5;
}

:global(:root.dark) .action-run-evidence-panel header p,
:global(:root.dark) .action-run-evidence-panel header span,
:global(:root.dark) .action-run-empty {
  color: #a1a1aa;
}

:global(:root.dark) .action-run-output {
  border-color: #3f3f46;
  background: #18181b;
}
</style>
