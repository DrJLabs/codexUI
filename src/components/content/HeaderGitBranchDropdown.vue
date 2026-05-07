<template>
  <button
    class="header-git-compat-trigger"
    type="button"
    :disabled="disabled"
    :title="triggerLabel"
    :aria-label="triggerLabel"
  >
    <span class="header-git-compat-label">{{ displayLabel }}</span>
    <span v-if="dirty" class="header-git-compat-dot" aria-label="Uncommitted changes" />
  </button>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  currentBranch?: string | null
  headSha?: string | null
  headSubject?: string | null
  dirty?: boolean
  loading?: boolean
}>()

const displayLabel = computed(() => {
  if (props.currentBranch) return props.currentBranch
  if (props.headSubject) return props.headSubject
  if (props.headSha) return `Detached ${props.headSha}`
  return props.loading ? 'Loading branch...' : 'Git branch'
})
const disabled = computed(() => props.loading && !props.currentBranch && !props.headSha)
const triggerLabel = computed(() => `Git branch: ${displayLabel.value}`)
</script>

<style scoped>
@reference "tailwindcss";

.header-git-compat-trigger {
  @apply inline-flex min-h-7 max-w-56 min-w-0 items-center gap-1.5 rounded-full border border-zinc-200 bg-white px-2.5 py-1.5 text-xs text-zinc-700 outline-none disabled:cursor-not-allowed disabled:opacity-60;
}

.header-git-compat-label {
  @apply min-w-0 truncate;
}

.header-git-compat-dot {
  @apply h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500;
}

:global(:root.dark) .header-git-compat-trigger {
  border-color: var(--color-zinc-700, #3f3f46);
  background-color: var(--color-zinc-950, #09090b);
  color: var(--color-zinc-100, #f4f4f5);
}
</style>
