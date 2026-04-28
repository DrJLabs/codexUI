<template>
  <aside
    v-if="message"
    class="floating-plan-dock"
    :class="{ 'is-collapsed': isCollapsed }"
    aria-label="Active plan"
  >
    <button
      type="button"
      class="floating-plan-dock-toggle"
      :aria-expanded="!isCollapsed"
      @click="toggleCollapsed"
    >
      <span class="floating-plan-dock-title">Active plan</span>
      <span v-if="isLivePlan" class="floating-plan-dock-live">Updating</span>
      <span class="floating-plan-dock-chevron" aria-hidden="true">{{ isCollapsed ? '▲' : '▼' }}</span>
    </button>
    <div v-if="!isCollapsed" class="floating-plan-dock-body">
      <PlanCard
        :message="message"
        title="Active plan"
        :render-markdown-blocks-as-html="renderMarkdownBlocksAsHtml"
        @implement-plan="$emit('implementPlan', $event)"
      />
    </div>
  </aside>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import type { UiMessage } from '../../types/codex'
import PlanCard from './PlanCard.vue'

const STORAGE_KEY = 'codexapp:floating-plan-dock:collapsed'

const props = defineProps<{
  message: UiMessage | null
  renderMarkdownBlocksAsHtml: (text: string) => string
}>()

defineEmits<{
  implementPlan: [message: UiMessage]
}>()

const isCollapsed = ref(false)
const isLivePlan = computed(() => props.message?.messageType === 'plan.live' || props.message?.plan?.isStreaming === true)

function readCollapsedFromStorage(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return window.localStorage.getItem(STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

function writeCollapsedToStorage(value: boolean): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STORAGE_KEY, value ? '1' : '0')
  } catch {
    // Ignore storage failures so private/quota-limited browsers can still use the dock.
  }
}

function toggleCollapsed(): void {
  isCollapsed.value = !isCollapsed.value
}

onMounted(() => {
  isCollapsed.value = readCollapsedFromStorage()
})

watch(isCollapsed, (value) => writeCollapsedToStorage(value))
</script>
