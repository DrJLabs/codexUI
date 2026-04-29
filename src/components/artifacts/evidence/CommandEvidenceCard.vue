<template>
  <article class="command-evidence-card" :data-status="summary.status">
    <div>
      <p>{{ summary.kind }}</p>
      <strong>{{ summary.label }}</strong>
    </div>
    <span>{{ summary.detail }}</span>
  </article>
</template>

<script setup lang="ts">
import type { ArtifactEvidenceSummary } from '../../../types/evidence'

defineProps<{
  summary: ArtifactEvidenceSummary
}>()
</script>

<style scoped>
.command-evidence-card {
  display: flex;
  align-items: start;
  justify-content: space-between;
  gap: 8px;
  border: 1px solid #e4e4e7;
  border-radius: 8px;
  padding: 9px;
  background: #fff;
}

.command-evidence-card p {
  margin: 0 0 2px;
  color: #71717a;
  font-size: 10px;
  font-weight: 900;
  text-transform: uppercase;
}

.command-evidence-card strong {
  color: #18181b;
  font-size: 12px;
  font-weight: 900;
}

.command-evidence-card span {
  color: #52525b;
  font-size: 11px;
  font-weight: 800;
}

.command-evidence-card[data-status="failed"] {
  border-color: rgba(220, 38, 38, 0.35);
  background: rgba(254, 242, 242, 0.8);
}

.command-evidence-card[data-status="passed"] {
  border-color: rgba(22, 163, 74, 0.3);
  background: rgba(240, 253, 244, 0.8);
}

:global(:root.dark) .command-evidence-card {
  border-color: #3f3f46;
  background: #18181b;
}

:global(:root.dark) .command-evidence-card strong {
  color: #f4f4f5;
}

:global(:root.dark) .command-evidence-card p,
:global(:root.dark) .command-evidence-card span {
  color: #a1a1aa;
}
</style>
