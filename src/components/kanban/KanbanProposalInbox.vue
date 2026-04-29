<template>
  <section class="kanban-proposal-inbox" aria-labelledby="kanban-proposal-inbox-title">
    <header class="kanban-proposal-inbox-header">
      <div>
        <h2 id="kanban-proposal-inbox-title">Proposal inbox</h2>
        <p>{{ proposals.length }} {{ status }} proposal{{ proposals.length === 1 ? '' : 's' }}</p>
      </div>
      <div class="kanban-proposal-tabs" role="tablist" aria-label="Proposal status">
        <button
          v-for="item in statusOptions"
          :key="item"
          class="kanban-proposal-tab"
          :class="{ 'is-active': item === status }"
          type="button"
          role="tab"
          :aria-selected="item === status"
          :tabindex="item === status ? 0 : -1"
          @click="emit('update:status', item)"
        >
          {{ item }}
        </button>
      </div>
    </header>

    <p v-if="errorMessage" class="kanban-proposal-error" role="alert">{{ errorMessage }}</p>
    <p v-else-if="proposals.length === 0" class="kanban-proposal-empty">
      No {{ status }} proposals.
    </p>

    <ul v-else class="kanban-proposal-list" role="list">
      <li v-for="proposal in proposals" :key="proposal.id" class="kanban-proposal-row">
        <div class="kanban-proposal-content">
          <div class="kanban-proposal-meta">
            <span class="kanban-proposal-type" :class="`is-${proposal.type}`">{{ proposal.type }}</span>
            <span>{{ proposal.proposedBy }}</span>
            <time :datetime="proposal.createdAtIso">{{ formatDate(proposal.createdAtIso) }}</time>
          </div>
          <h3>{{ proposalTitle(proposal) }}</h3>
          <p>{{ payloadPreview(proposal) }}</p>
          <dl class="kanban-proposal-details">
            <div v-if="proposal.type === 'update'">
              <dt>Task</dt>
              <dd>{{ proposal.payload.taskId }}</dd>
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
        <div v-if="proposal.status === 'pending'" class="kanban-proposal-actions" aria-label="Proposal actions">
          <button
            class="kanban-proposal-action is-approve"
            type="button"
            :disabled="isResolving"
            :aria-label="`Approve proposal ${proposal.id}`"
            @click="emit('approve', proposal.id)"
          >
            Approve
          </button>
          <button
            class="kanban-proposal-action"
            type="button"
            :disabled="isResolving"
            :aria-label="`Reject proposal ${proposal.id}`"
            @click="emit('reject', proposal.id)"
          >
            Reject
          </button>
        </div>
      </li>
    </ul>
  </section>
</template>

<script setup lang="ts">
import type { KanbanProposal, KanbanProposalStatus } from '../../types/kanban'

defineProps<{
  proposals: KanbanProposal[]
  status: KanbanProposalStatus
  errorMessage: string
  isResolving: boolean
}>()

const emit = defineEmits<{
  'update:status': [status: KanbanProposalStatus]
  approve: [proposalId: string]
  reject: [proposalId: string]
}>()

const statusOptions: KanbanProposalStatus[] = ['pending', 'approved', 'rejected']

function proposalTitle(proposal: KanbanProposal): string {
  if (proposal.type === 'create') return proposal.payload.title || 'Create task proposal'
  return proposal.payload.patch.title || `Update ${proposal.payload.taskId}`
}

function payloadPreview(proposal: KanbanProposal): string {
  if (proposal.type === 'create') {
    const parts = [
      proposal.payload.description,
      proposal.payload.priority ? `priority: ${proposal.payload.priority}` : '',
      proposal.payload.assignee ? `assignee: ${proposal.payload.assignee}` : '',
    ].filter(Boolean)
    return parts.length > 0 ? parts.join(' | ') : 'Create a task with the proposed fields.'
  }
  const patch = proposal.payload.patch
  const keys = Object.keys(patch)
  if (keys.length === 0) return 'No recognized update fields.'
  return keys.map((key) => `${key}: ${formatPatchValue(patch[key as keyof typeof patch])}`).join(' | ')
}

function formatPatchValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return 'empty'
  if (Array.isArray(value)) return `${value.length} item${value.length === 1 ? '' : 's'}`
  if (typeof value === 'object') return 'object'
  return String(value)
}

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
.kanban-proposal-inbox {
  display: grid;
  gap: 12px;
  border: 1px solid #e4e4e7;
  border-radius: 8px;
  padding: 12px;
  background: #fff;
  color: #18181b;
}

.kanban-proposal-inbox-header {
  display: flex;
  gap: 12px;
  align-items: start;
  justify-content: space-between;
}

.kanban-proposal-inbox-header h2,
.kanban-proposal-inbox-header p,
.kanban-proposal-empty,
.kanban-proposal-error,
.kanban-proposal-row h3,
.kanban-proposal-row p,
.kanban-proposal-details {
  margin: 0;
}

.kanban-proposal-inbox-header h2 {
  font-size: 14px;
  font-weight: 900;
}

.kanban-proposal-inbox-header p,
.kanban-proposal-empty,
.kanban-proposal-row p,
.kanban-proposal-details {
  color: #71717a;
  font-size: 12px;
  font-weight: 700;
}

.kanban-proposal-tabs,
.kanban-proposal-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.kanban-proposal-tab,
.kanban-proposal-action {
  border: 1px solid #d4d4d8;
  border-radius: 6px;
  padding: 6px 9px;
  background: #fafafa;
  color: #27272a;
  font-size: 12px;
  font-weight: 800;
  text-transform: capitalize;
}

.kanban-proposal-tab.is-active,
.kanban-proposal-action.is-approve {
  border-color: #2563eb;
  background: #2563eb;
  color: #fff;
}

.kanban-proposal-action:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.kanban-proposal-error {
  border: 1px solid rgba(220, 38, 38, 0.35);
  border-radius: 6px;
  padding: 8px 10px;
  background: rgba(254, 226, 226, 0.85);
  color: #991b1b;
}

.kanban-proposal-list {
  display: grid;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.kanban-proposal-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 12px;
  align-items: start;
  border-top: 1px solid #e4e4e7;
  padding-top: 10px;
}

.kanban-proposal-content {
  display: grid;
  min-width: 0;
  gap: 6px;
}

.kanban-proposal-meta,
.kanban-proposal-details,
.kanban-proposal-details div {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
}

.kanban-proposal-meta {
  color: #71717a;
  font-size: 11px;
  font-weight: 800;
}

.kanban-proposal-type {
  border: 1px solid #d4d4d8;
  border-radius: 6px;
  padding: 2px 6px;
  background: #f4f4f5;
  color: #27272a;
  text-transform: uppercase;
}

.kanban-proposal-type.is-update {
  border-color: rgba(217, 119, 6, 0.4);
  background: rgba(254, 243, 199, 0.75);
  color: #92400e;
}

.kanban-proposal-row h3 {
  overflow-wrap: anywhere;
  font-size: 13px;
  font-weight: 900;
}

.kanban-proposal-row p,
.kanban-proposal-details dd {
  overflow-wrap: anywhere;
}

.kanban-proposal-details {
  gap: 8px;
}

.kanban-proposal-details dt {
  color: #52525b;
}

.kanban-proposal-details dd {
  margin: 0;
}

:global(:root.dark) .kanban-proposal-inbox {
  border-color: #3f3f46;
  background: #18181b;
  color: #f4f4f5;
}

:global(:root.dark) .kanban-proposal-inbox-header p,
:global(:root.dark) .kanban-proposal-empty,
:global(:root.dark) .kanban-proposal-row p,
:global(:root.dark) .kanban-proposal-details,
:global(:root.dark) .kanban-proposal-meta {
  color: #a1a1aa;
}

:global(:root.dark) .kanban-proposal-tab,
:global(:root.dark) .kanban-proposal-action,
:global(:root.dark) .kanban-proposal-type {
  border-color: #3f3f46;
  background: #27272a;
  color: #f4f4f5;
}

:global(:root.dark) .kanban-proposal-tab.is-active,
:global(:root.dark) .kanban-proposal-action.is-approve {
  border-color: #60a5fa;
  background: #1d4ed8;
  color: #fff;
}

:global(:root.dark) .kanban-proposal-error {
  border-color: rgba(248, 113, 113, 0.35);
  background: rgba(127, 29, 29, 0.35);
  color: #fecaca;
}

:global(:root.dark) .kanban-proposal-row {
  border-top-color: #3f3f46;
}

:global(:root.dark) .kanban-proposal-type.is-update {
  border-color: rgba(245, 158, 11, 0.3);
  background: rgba(120, 53, 15, 0.35);
  color: #fcd34d;
}

@media (max-width: 720px) {
  .kanban-proposal-inbox-header,
  .kanban-proposal-row {
    grid-template-columns: minmax(0, 1fr);
  }

  .kanban-proposal-inbox-header {
    display: grid;
  }

  .kanban-proposal-tabs,
  .kanban-proposal-actions,
  .kanban-proposal-action {
    width: 100%;
  }

  .kanban-proposal-tab,
  .kanban-proposal-action {
    flex: 1 1 0;
  }
}
</style>
