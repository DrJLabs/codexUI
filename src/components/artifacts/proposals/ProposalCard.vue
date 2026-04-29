<template>
  <article class="proposal-card">
    <div class="proposal-card-content">
      <div class="proposal-card-meta">
        <span class="proposal-card-type" :class="`is-${proposal.type}`">{{ proposal.type }}</span>
        <span>{{ proposal.proposedBy }}</span>
        <time :datetime="proposal.createdAtIso">{{ formatDate(proposal.createdAtIso) }}</time>
      </div>
      <h3>{{ proposal.title }}</h3>
      <p>{{ proposal.summary }}</p>
      <dl class="proposal-card-details">
        <div v-if="proposal.taskId">
          <dt>Task</dt>
          <dd>{{ proposal.taskId }}</dd>
        </div>
        <div v-if="proposal.sourceRunId">
          <dt>Run</dt>
          <dd>{{ proposal.sourceRunId }}</dd>
        </div>
        <div v-if="proposal.reason">
          <dt>Reason</dt>
          <dd>{{ proposal.reason }}</dd>
        </div>
      </dl>
    </div>
    <div v-if="proposal.status === 'pending'" class="proposal-card-actions" aria-label="Proposal actions">
      <button
        class="proposal-card-action is-approve"
        type="button"
        :disabled="isResolving"
        :aria-label="`Approve proposal ${proposal.id}`"
        @click="$emit('approve', proposal.id)"
      >
        Approve
      </button>
      <button
        class="proposal-card-action"
        type="button"
        :disabled="isResolving"
        :aria-label="`Reject proposal ${proposal.id}`"
        @click="$emit('reject', proposal.id)"
      >
        Reject
      </button>
    </div>
  </article>
</template>

<script setup lang="ts">
import type { WorkspaceProposal } from '../../../types/proposal'

defineProps<{
  proposal: WorkspaceProposal
  isResolving: boolean
}>()

defineEmits<{
  approve: [proposalId: string]
  reject: [proposalId: string]
}>()

function formatDate(value: string): string {
  if (!value) return 'unknown time'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date)
}
</script>

<style scoped>
.proposal-card {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 12px;
  align-items: start;
  border-top: 1px solid #e4e4e7;
  padding-top: 10px;
}

.proposal-card-content {
  display: grid;
  min-width: 0;
  gap: 6px;
}

.proposal-card-meta,
.proposal-card-details,
.proposal-card-details div,
.proposal-card-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
}

.proposal-card-meta {
  color: #71717a;
  font-size: 11px;
  font-weight: 800;
}

.proposal-card-type {
  border: 1px solid #d4d4d8;
  border-radius: 6px;
  padding: 2px 6px;
  background: #f4f4f5;
  color: #27272a;
  text-transform: uppercase;
}

.proposal-card-type.is-update {
  border-color: rgba(217, 119, 6, 0.4);
  background: rgba(254, 243, 199, 0.75);
  color: #92400e;
}

.proposal-card h3,
.proposal-card p,
.proposal-card-details {
  margin: 0;
}

.proposal-card h3 {
  overflow-wrap: anywhere;
  color: #18181b;
  font-size: 13px;
  font-weight: 900;
}

.proposal-card p,
.proposal-card-details {
  color: #71717a;
  font-size: 12px;
  font-weight: 700;
}

.proposal-card p,
.proposal-card-details dd {
  overflow-wrap: anywhere;
}

.proposal-card-details dt {
  color: #52525b;
}

.proposal-card-details dd {
  margin: 0;
}

.proposal-card-action {
  border: 1px solid #d4d4d8;
  border-radius: 6px;
  padding: 6px 9px;
  background: #fafafa;
  color: #27272a;
  font-size: 12px;
  font-weight: 800;
}

.proposal-card-action.is-approve {
  border-color: #2563eb;
  background: #2563eb;
  color: #fff;
}

.proposal-card-action:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

:global(:root.dark) .proposal-card {
  border-color: #3f3f46;
}

:global(:root.dark) .proposal-card h3 {
  color: #f4f4f5;
}

:global(:root.dark) .proposal-card-meta,
:global(:root.dark) .proposal-card p,
:global(:root.dark) .proposal-card-details {
  color: #a1a1aa;
}

:global(:root.dark) .proposal-card-details dt {
  color: #d4d4d8;
}

:global(:root.dark) .proposal-card-action {
  border-color: #52525b;
  background: #27272a;
  color: #f4f4f5;
}

:global(:root.dark) .proposal-card-action.is-approve {
  border-color: #3b82f6;
  background: #2563eb;
  color: #fff;
}
</style>
