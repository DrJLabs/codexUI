<template>
  <div class="kanban-empty-state">
    <p class="kanban-empty-state-title">{{ title }}</p>
    <p class="kanban-empty-state-copy">{{ copy }}</p>
    <button v-if="actionLabel" class="kanban-empty-state-action" type="button" @click="$emit('action')">
      {{ actionLabel }}
    </button>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  title: string
  copy: string
  actionLabel?: string
}>()

defineEmits<{
  action: []
}>()
</script>

<style scoped>
.kanban-empty-state {
  display: grid;
  gap: 8px;
  align-content: center;
  justify-items: start;
  min-height: 180px;
  padding: 24px;
  border: 1px dashed rgba(113, 113, 122, 0.45);
  border-radius: 8px;
  background: rgba(250, 250, 250, 0.72);
}

.kanban-empty-state-title {
  margin: 0;
  font-size: 16px;
  font-weight: 700;
  color: #18181b;
}

.kanban-empty-state-copy {
  margin: 0;
  max-width: 520px;
  color: #52525b;
}

.kanban-empty-state-action {
  min-height: 36px;
  padding: 0 14px;
  border: 1px solid #18181b;
  border-radius: 8px;
  background: #18181b;
  color: #fafafa;
  font-weight: 700;
}
</style>
