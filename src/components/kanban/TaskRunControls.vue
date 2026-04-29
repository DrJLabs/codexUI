<template>
  <section class="task-run-controls" aria-label="Task run controls">
    <div>
      <p class="task-run-controls-label">Run state</p>
      <strong>{{ task.runState.replace(/_/g, ' ') }}</strong>
    </div>
    <p v-if="policy" class="task-run-controls-mode">
      <span>{{ executionModeLabel }}</span>
      <small>{{ executionModeNote }}</small>
    </p>
    <p class="task-run-controls-profile">
      <span>{{ activeRunProfileLabel }}</span>
      <small>{{ activeRunProfileNote }}</small>
    </p>
    <div class="task-run-controls-actions">
      <button
        type="button"
        :disabled="!canRun"
        :title="runDisabledReason"
        @click="$emit('start-run')"
      >
        Run
      </button>
      <button
        type="button"
        :disabled="!canInterrupt"
        @click="$emit('interrupt-run')"
      >
        Stop
      </button>
    </div>
    <p v-if="runDisabledReason" class="task-run-controls-note">{{ runDisabledReason }}</p>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { CodexRunProfile, KanbanExecutionPolicy, KanbanTask } from '../../types/kanban'

const props = defineProps<{
  task: KanbanTask
  policy: KanbanExecutionPolicy | null
  runProfiles: CodexRunProfile[]
  defaultRunProfileId: string
}>()

defineEmits<{
  'start-run': []
  'interrupt-run': []
}>()

const isActive = computed(() => ['queued', 'preparing_worktree', 'starting_codex', 'running', 'waiting_for_approval', 'running_tests', 'collecting_artifacts', 'stopping'].includes(props.task.runState))
const runDisabledReason = computed(() => {
  if (props.policy?.executionMode === 'disabled') return 'Kanban execution is disabled.'
  if (props.policy?.executionMode === 'open_remote') return 'Open remote execution requires authenticated remote access.'
  if (!props.policy?.executionEnabled) return 'Execution is disabled for this session.'
  if (isActive.value) return 'This task already has an active run.'
  return ''
})
const canRun = computed(() => !runDisabledReason.value)
const canInterrupt = computed(() => isActive.value && Boolean(props.task.currentRunId))
const activeRunProfile = computed(() => {
  const profileId = props.task.runProfileId.trim() || props.defaultRunProfileId.trim()
  return props.runProfiles.find((profile) => profile.id === profileId) ?? props.runProfiles[0] ?? null
})
const activeRunProfileLabel = computed(() => activeRunProfile.value?.name ?? 'Run profile')
const activeRunProfileNote = computed(() => {
  const profile = activeRunProfile.value
  if (!profile) return 'No run profile is configured.'
  const network = profile.networkAccess ? 'network on' : 'network off'
  const model = props.task.model.trim() || profile.model.trim() || 'default model'
  return `${profile.sandboxMode}, ${profile.approvalPolicy}, ${network}, ${model}`
})
const executionModeLabel = computed(() => {
  switch (props.policy?.executionMode) {
    case 'local_only':
      return 'Local only'
    case 'trusted_remote':
      return 'Trusted remote'
    case 'open_remote':
      return 'Open remote'
    case 'disabled':
    default:
      return 'Disabled'
  }
})
const executionModeNote = computed(() => {
  switch (props.policy?.executionMode) {
    case 'local_only':
      return 'Loopback browser sessions can start runs.'
    case 'trusted_remote':
      return 'Loopback and trusted Tailscale sessions can start runs.'
    case 'open_remote':
      return 'Blocked until authenticated remote access exists.'
    case 'disabled':
    default:
      return 'Task runs are unavailable.'
  }
})
</script>

<style scoped>
.task-run-controls {
  display: grid;
  gap: 10px;
  border: 1px solid #e4e4e7;
  border-radius: 8px;
  padding: 12px;
  background: #fafafa;
}

.task-run-controls-label,
.task-run-controls-note {
  margin: 0;
  color: #71717a;
  font-size: 12px;
  font-weight: 800;
}

.task-run-controls-mode,
.task-run-controls-profile {
  display: grid;
  gap: 3px;
  margin: 0;
}

.task-run-controls-mode span,
.task-run-controls-profile span {
  color: #18181b;
  font-size: 12px;
  font-weight: 900;
}

.task-run-controls-mode small,
.task-run-controls-profile small {
  color: #71717a;
  font-size: 11px;
  font-weight: 700;
  line-height: 1.35;
}

.task-run-controls-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.task-run-controls button {
  border: 1px solid #d4d4d8;
  border-radius: 8px;
  padding: 7px 11px;
  background: #fff;
  color: #18181b;
  font-weight: 900;
}

.task-run-controls button:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

:global(:root.dark) .task-run-controls {
  border-color: #3f3f46;
  background: #18181b;
}

:global(:root.dark) .task-run-controls button {
  border-color: #52525b;
  background: #27272a;
  color: #f4f4f5;
}

:global(:root.dark) .task-run-controls-mode span,
:global(:root.dark) .task-run-controls-profile span {
  color: #f4f4f5;
}

:global(:root.dark) .task-run-controls-mode small,
:global(:root.dark) .task-run-controls-profile small,
:global(:root.dark) .task-run-controls-note {
  color: #a1a1aa;
}
</style>
