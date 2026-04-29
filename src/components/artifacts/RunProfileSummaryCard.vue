<template>
  <article class="run-profile-summary-card">
    <p class="run-profile-summary-card-label">Run Profile</p>
    <strong>{{ name }}</strong>
    <span>{{ summary }}</span>
  </article>
</template>

<script setup lang="ts">
defineProps<{
  name: string
  summary: string
}>()
</script>

<style scoped>
.run-profile-summary-card {
  display: grid;
  gap: 4px;
  border: 1px solid #e4e4e7;
  border-radius: 8px;
  padding: 10px;
  background: #fff;
}

.run-profile-summary-card-label,
.run-profile-summary-card span {
  margin: 0;
  color: #71717a;
  font-size: 11px;
  font-weight: 800;
}

.run-profile-summary-card strong {
  color: #18181b;
  font-size: 13px;
  font-weight: 900;
}

:global(:root.dark) .run-profile-summary-card {
  border-color: #3f3f46;
  background: #18181b;
}

:global(:root.dark) .run-profile-summary-card strong {
  color: #f4f4f5;
}

:global(:root.dark) .run-profile-summary-card-label,
:global(:root.dark) .run-profile-summary-card span {
  color: #a1a1aa;
}
</style>
