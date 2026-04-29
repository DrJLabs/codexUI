<template>
  <div class="artifact-tabs" role="tablist" aria-label="Thread artifacts">
    <button
      v-for="tab in tabs"
      :key="tab.id"
      class="artifact-tab"
      :class="{ 'is-active': tab.id === modelValue }"
      type="button"
      role="tab"
      :aria-selected="tab.id === modelValue"
      @click="$emit('update:modelValue', tab.id)"
    >
      <span>{{ tab.label }}</span>
      <small>{{ tab.count }}</small>
    </button>
  </div>
</template>

<script setup lang="ts">
import type { ThreadArtifactTab, ThreadArtifactTabId } from '../../composables/useThreadArtifacts'

defineProps<{
  tabs: ThreadArtifactTab[]
  modelValue: ThreadArtifactTabId
}>()

defineEmits<{
  'update:modelValue': [value: ThreadArtifactTabId]
}>()
</script>

<style scoped>
.artifact-tabs {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 4px;
}

.artifact-tab {
  display: flex;
  min-width: 0;
  min-height: 30px;
  align-items: center;
  justify-content: center;
  gap: 5px;
  border: 1px solid #e4e4e7;
  border-radius: 8px;
  background: #fff;
  color: #52525b;
  font-size: 11px;
  font-weight: 800;
}

.artifact-tab small {
  color: #71717a;
  font-size: 10px;
}

.artifact-tab.is-active {
  border-color: #18181b;
  background: #18181b;
  color: #fafafa;
}

.artifact-tab.is-active small {
  color: #d4d4d8;
}

:global(:root.dark) .artifact-tab {
  border-color: #3f3f46;
  background: #18181b;
  color: #d4d4d8;
}

:global(:root.dark) .artifact-tab small {
  color: #a1a1aa;
}

:global(:root.dark) .artifact-tab.is-active {
  border-color: #f4f4f5;
  background: #f4f4f5;
  color: #18181b;
}

:global(:root.dark) .artifact-tab.is-active small {
  color: #52525b;
}
</style>
