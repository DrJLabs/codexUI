<template>
  <section v-if="runId" class="task-run-log" aria-label="Task run log">
    <header>
      <h3>Run log</h3>
      <button type="button" @click="$emit('refresh')">Refresh</button>
    </header>
    <ArtifactEvidencePanel
      :evidence="evidence"
      empty-text="No run output recorded yet."
    />
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import ArtifactEvidencePanel from '../artifacts/evidence/ArtifactEvidencePanel.vue'
import { useArtifactEvidence } from '../../composables/useArtifactEvidence'

const props = defineProps<{
  runId: string
  logText: string
}>()

defineEmits<{
  refresh: []
}>()

const runIdRef = computed(() => props.runId)
const logTextRef = computed(() => props.logText)
const evidence = useArtifactEvidence({ runId: runIdRef, logText: logTextRef })
</script>

<style scoped>
.task-run-log {
  display: grid;
  gap: 8px;
}

.task-run-log header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.task-run-log h3 {
  margin: 0;
  font-size: 13px;
  font-weight: 900;
}

.task-run-log button {
  border: 1px solid #d4d4d8;
  border-radius: 8px;
  padding: 5px 8px;
  background: #fff;
  color: #3f3f46;
  font-size: 12px;
  font-weight: 900;
}

:global(:root.dark) .task-run-log button {
  border-color: #52525b;
  background: #27272a;
  color: #f4f4f5;
}
</style>
