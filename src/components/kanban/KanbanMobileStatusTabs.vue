<template>
  <div class="kanban-mobile-tabs" role="tablist" aria-label="Kanban statuses">
    <button
      v-for="(status, index) in statuses"
      :key="status.id"
      ref="tabRefs"
      class="kanban-mobile-tab"
      :class="{ 'is-active': status.id === modelValue }"
      type="button"
      role="tab"
      :aria-selected="status.id === modelValue"
      :tabindex="status.id === modelValue ? 0 : -1"
      @click="emit('update:modelValue', status.id)"
      @keydown="onTabKeydown($event, index)"
    >
      <span>{{ status.title }}</span>
      <span class="kanban-mobile-tab-count">{{ countsByStatus[status.id] ?? 0 }}</span>
    </button>
  </div>
</template>

<script setup lang="ts">
import { nextTick, ref } from 'vue'
import type { KANBAN_STATUSES, KanbanStatus } from '../../types/kanban'

const props = defineProps<{
  statuses: typeof KANBAN_STATUSES
  modelValue: KanbanStatus
  countsByStatus: Record<KanbanStatus, number>
}>()

const emit = defineEmits<{
  'update:modelValue': [status: KanbanStatus]
}>()

const tabRefs = ref<HTMLButtonElement[]>([])

function onTabKeydown(event: KeyboardEvent, currentIndex: number): void {
  const lastIndex = props.statuses.length - 1
  let nextIndex: number | null = null

  if (event.key === 'ArrowRight') nextIndex = currentIndex === lastIndex ? 0 : currentIndex + 1
  if (event.key === 'ArrowLeft') nextIndex = currentIndex === 0 ? lastIndex : currentIndex - 1
  if (event.key === 'Home') nextIndex = 0
  if (event.key === 'End') nextIndex = lastIndex
  if (nextIndex === null) return

  event.preventDefault()
  const nextStatus = props.statuses[nextIndex]
  if (!nextStatus) return
  emit('update:modelValue', nextStatus.id)
  void nextTick(() => {
    tabRefs.value[nextIndex]?.focus()
  })
}
</script>

<style scoped>
.kanban-mobile-tabs {
  display: none;
  gap: 6px;
  overflow-x: auto;
  padding-bottom: 2px;
}

.kanban-mobile-tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 34px;
  border: 1px solid #d4d4d8;
  border-radius: 8px;
  padding: 0 10px;
  background: #fff;
  color: #3f3f46;
  font-weight: 700;
  white-space: nowrap;
}

.kanban-mobile-tab.is-active {
  border-color: #18181b;
  background: #18181b;
  color: #fafafa;
}

.kanban-mobile-tab-count {
  color: inherit;
  opacity: 0.72;
}

:global(:root.dark) .kanban-mobile-tab {
  border-color: #3f3f46;
  background: #18181b;
  color: #e4e4e7;
}

:global(:root.dark) .kanban-mobile-tab.is-active {
  border-color: #e4e4e7;
  background: #e4e4e7;
  color: #18181b;
}

@media (max-width: 860px) {
  .kanban-mobile-tabs {
    display: flex;
  }
}
</style>
