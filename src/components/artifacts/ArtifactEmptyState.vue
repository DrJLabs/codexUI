<template>
  <div class="artifact-empty-state">
    <strong>{{ title }}</strong>
    <span>{{ copy }}</span>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  title: string
  copy: string
}>()
</script>

<style scoped>
.artifact-empty-state {
  display: grid;
  gap: 4px;
  border: 1px dashed #d4d4d8;
  border-radius: 8px;
  padding: 12px;
  background: #fafafa;
}

.artifact-empty-state strong {
  color: #18181b;
  font-size: 13px;
  font-weight: 900;
}

.artifact-empty-state span {
  color: #71717a;
  font-size: 12px;
  font-weight: 700;
  line-height: 1.4;
}

:global(:root.dark) .artifact-empty-state {
  border-color: #3f3f46;
  background: #18181b;
}

:global(:root.dark) .artifact-empty-state strong {
  color: #f4f4f5;
}

:global(:root.dark) .artifact-empty-state span {
  color: #a1a1aa;
}
</style>
