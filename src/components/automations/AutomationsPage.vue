<template>
  <main class="automations-page" aria-label="Automations">
    <section class="automations-summary" aria-label="Automation summary">
      <div class="automations-summary-item">
        <span class="automations-summary-label">Total</span>
        <strong>{{ definitions.length }}</strong>
      </div>
      <div class="automations-summary-item">
        <span class="automations-summary-label">Active</span>
        <strong>{{ activeCount }}</strong>
      </div>
      <div class="automations-summary-item">
        <span class="automations-summary-label">Paused</span>
        <strong>{{ pausedCount }}</strong>
      </div>
      <div class="automations-summary-item automations-summary-path">
        <span class="automations-summary-label">Native storage root</span>
        <strong :title="state.storageRoot">{{ state.storageRoot || 'Unavailable' }}</strong>
      </div>
    </section>

    <section v-if="diagnostics.length > 0" class="automations-diagnostics" aria-label="Automation diagnostics">
      <div class="automations-diagnostics-copy">
        <strong>Some automation records were skipped or sanitized.</strong>
        <span>Review native paths before editing imported records.</span>
      </div>
      <ul>
        <li v-for="diagnostic in diagnostics" :key="`${diagnostic.path}:${diagnostic.message}`">
          <span class="automations-diagnostic-severity">{{ diagnostic.severity }}</span>
          <span>{{ diagnostic.message }}</span>
          <code>{{ diagnostic.path }}</code>
        </li>
      </ul>
    </section>

    <section v-if="errorMessage" class="automations-error" role="alert">
      {{ errorMessage }}
      <button type="button" @click="loadAll()">Retry</button>
    </section>

    <section class="automations-workspace">
      <aside class="automations-list" aria-label="Heartbeat automations">
        <div class="automations-list-header">
          <h2>Heartbeats</h2>
          <button type="button" @click="startCreate()">New</button>
        </div>

        <p v-if="isLoading" class="automations-status">Loading automations...</p>
        <p v-else-if="definitions.length === 0" class="automations-empty">
          No heartbeat automations yet.
        </p>

        <div v-else class="automations-table-wrap">
          <table class="automations-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Status</th>
                <th>Thread</th>
                <th>RRULE</th>
                <th>Source</th>
                <th>Updated</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="definition in definitions"
                :key="definition.id"
                :data-active="definition.id === selectedAutomationId"
              >
                <td>
                  <button type="button" class="automations-row-button" @click="selectAutomation(definition.id)">
                    {{ definition.name }}
                  </button>
                </td>
                <td><span class="automations-status-pill" :data-status="definition.status">{{ definition.status }}</span></td>
                <td><code>{{ definition.targetThreadId || 'No thread' }}</code></td>
                <td><code>{{ definition.schedule.rrule }}</code></td>
                <td>{{ definition.source }}</td>
                <td>{{ formatTimestamp(definition.updatedAtIso) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </aside>

      <form class="automations-editor" aria-label="Automation editor" @submit.prevent="saveDraft">
        <div class="automations-editor-header">
          <div>
            <h2>{{ draft.mode === 'edit' ? 'Edit automation' : 'Create automation' }}</h2>
            <p v-if="draft.mode === 'create' && draft.targetThreadId">
              Prefilled for thread <code>{{ draft.targetThreadId }}</code>
            </p>
          </div>
          <span v-if="selectedAutomation" class="automations-status-pill" :data-status="selectedAutomation.status">
            {{ selectedAutomation.status }}
          </span>
        </div>

        <p v-if="mutationError" class="automations-error-inline" role="alert">{{ mutationError }}</p>

        <div class="automations-field-grid">
          <label class="automations-field">
            <span>Name</span>
            <input v-model="draft.name" type="text" required />
          </label>

          <label class="automations-field">
            <span>Target thread id</span>
            <input v-model="draft.targetThreadId" type="text" :required="draft.mode === 'create'" />
          </label>

          <label class="automations-field automations-field-wide">
            <span>Prompt</span>
            <textarea v-model="draft.prompt" rows="8" required />
          </label>

          <label class="automations-field">
            <span>Schedule (RRULE)</span>
            <input v-model="draft.rrule" type="text" required />
          </label>

          <label class="automations-field">
            <span>Description</span>
            <input v-model="draft.description" type="text" />
          </label>

          <label class="automations-field automations-field-wide">
            <span>Notes</span>
            <textarea v-model="draft.notes" rows="4" />
          </label>

          <label class="automations-field">
            <span>Run profile id</span>
            <input v-model="draft.runProfileId" type="text" />
          </label>

          <label class="automations-field">
            <span>Model</span>
            <input v-model="draft.model" type="text" />
          </label>

          <label class="automations-field">
            <span>Reasoning effort</span>
            <input v-model="draft.reasoningEffort" type="text" />
          </label>
        </div>

        <dl class="automations-storage">
          <div>
            <dt>Automation id</dt>
            <dd><code>{{ selectedAutomation?.id || 'New automation' }}</code></dd>
          </div>
          <div>
            <dt>Native path</dt>
            <dd><code>{{ selectedAutomation?.storage.nativePath || 'Created on save' }}</code></dd>
          </div>
          <div>
            <dt>Sidecar path</dt>
            <dd><code>{{ selectedAutomation?.storage.sidecarPath || 'Created on save' }}</code></dd>
          </div>
        </dl>

        <div class="automations-editor-actions">
          <button class="automations-primary" type="submit" :disabled="isSaving">
            {{ isSaving ? 'Saving...' : draft.mode === 'edit' ? 'Save' : 'Create' }}
          </button>
          <button
            v-if="selectedAutomation?.status === 'active'"
            type="button"
            :disabled="isSaving"
            @click="pauseSelected"
          >
            Pause
          </button>
          <button
            v-else-if="selectedAutomation?.status === 'paused'"
            type="button"
            :disabled="isSaving"
            @click="resumeSelected"
          >
            Resume
          </button>
          <button
            v-if="draft.mode === 'edit'"
            class="automations-danger"
            type="button"
            :disabled="isSaving"
            @click="confirmDelete"
          >
            Delete and remove native folder
          </button>
        </div>
      </form>
    </section>
  </main>
</template>

<script setup lang="ts">
import { computed, onMounted, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useAutomations } from '../../composables/useAutomations'

const route = useRoute()
const {
  state,
  definitions,
  diagnostics,
  isLoading,
  isSaving,
  errorMessage,
  mutationError,
  selectedAutomationId,
  selectedAutomation,
  draft,
  loadAll,
  selectAutomation,
  startCreate,
  saveDraft,
  pauseSelected,
  resumeSelected,
  deleteSelectedRemoveNative,
  applyThreadPrefill,
  clearThreadPrefill,
} = useAutomations()

const activeCount = computed(() => definitions.value.filter((definition) => definition.status === 'active').length)
const pausedCount = computed(() => definitions.value.filter((definition) => definition.status === 'paused').length)

watch(
  () => route.query.threadId,
  (value) => {
    const threadId = Array.isArray(value) ? value[0] : value
    if (typeof threadId === 'string' && threadId.trim()) {
      applyThreadPrefill(threadId)
      return
    }
    clearThreadPrefill()
  },
  { immediate: true },
)

onMounted(() => {
  void loadAll()
})

async function confirmDelete(): Promise<void> {
  const name = selectedAutomation.value?.name || draft.value.name || 'this automation'
  const confirmed = window.confirm(
    `Delete "${name}" and remove its native automation folder? This removes the native folder under the Codex automations storage root.`,
  )
  if (!confirmed) return
  await deleteSelectedRemoveNative()
}

function formatTimestamp(value: string): string {
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) return value || 'n/a'
  return new Date(timestamp).toLocaleString()
}
</script>

<style scoped>
.automations-page {
  display: flex;
  min-height: 100%;
  flex-direction: column;
  gap: 16px;
  padding: 18px;
  color: #111827;
}

.automations-summary,
.automations-workspace,
.automations-diagnostics,
.automations-error {
  border: 1px solid rgba(148, 163, 184, 0.28);
  background: rgba(255, 255, 255, 0.82);
}

.automations-summary {
  display: grid;
  grid-template-columns: repeat(3, minmax(96px, 160px)) minmax(220px, 1fr);
  gap: 1px;
  overflow: hidden;
  border-radius: 8px;
}

.automations-summary-item {
  min-width: 0;
  padding: 12px 14px;
}

.automations-summary-label {
  display: block;
  color: #64748b;
  font-size: 12px;
}

.automations-summary strong {
  display: block;
  min-width: 0;
  overflow-wrap: anywhere;
  font-size: 18px;
}

.automations-summary-path strong {
  font-size: 13px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', monospace;
}

.automations-diagnostics {
  border-radius: 8px;
  padding: 12px 14px;
}

.automations-diagnostics-copy {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  color: #92400e;
}

.automations-diagnostics ul {
  margin: 8px 0 0;
  padding: 0;
  list-style: none;
}

.automations-diagnostics li {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 4px 0;
  color: #475569;
}

.automations-diagnostic-severity {
  text-transform: uppercase;
  color: #b45309;
  font-size: 11px;
  font-weight: 700;
}

.automations-error {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  border-color: rgba(220, 38, 38, 0.32);
  border-radius: 8px;
  padding: 10px 12px;
  color: #b91c1c;
}

.automations-error-inline {
  margin: 0;
  color: #b91c1c;
  font-size: 13px;
}

.automations-workspace {
  display: grid;
  min-height: 0;
  flex: 1;
  grid-template-columns: minmax(360px, 1fr) minmax(360px, 520px);
  gap: 0;
  overflow: hidden;
  border-radius: 8px;
}

.automations-list,
.automations-editor {
  min-width: 0;
  padding: 14px;
}

.automations-list {
  border-right: 1px solid rgba(148, 163, 184, 0.28);
}

.automations-list-header,
.automations-editor-header,
.automations-editor-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.automations-list-header h2,
.automations-editor-header h2 {
  margin: 0;
  font-size: 16px;
}

.automations-editor-header p,
.automations-status,
.automations-empty {
  margin: 4px 0 0;
  color: #64748b;
  font-size: 13px;
}

.automations-table-wrap {
  overflow: auto;
  margin-top: 12px;
}

.automations-table {
  width: 100%;
  min-width: 760px;
  border-collapse: collapse;
  font-size: 13px;
}

.automations-table th,
.automations-table td {
  border-bottom: 1px solid rgba(148, 163, 184, 0.22);
  padding: 9px 8px;
  text-align: left;
  vertical-align: top;
}

.automations-table th {
  color: #64748b;
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
}

.automations-table tr[data-active='true'] td {
  background: rgba(37, 99, 235, 0.08);
}

.automations-row-button {
  border: 0;
  background: transparent;
  color: #0f172a;
  cursor: pointer;
  font: inherit;
  font-weight: 700;
  padding: 0;
  text-align: left;
}

.automations-status-pill {
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  padding: 2px 8px;
  background: rgba(22, 163, 74, 0.12);
  color: #15803d;
  font-size: 12px;
  font-weight: 700;
  text-transform: capitalize;
}

.automations-status-pill[data-status='paused'] {
  background: rgba(148, 163, 184, 0.18);
  color: #475569;
}

.automations-field-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  margin-top: 14px;
}

.automations-field {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 5px;
  color: #475569;
  font-size: 12px;
  font-weight: 700;
}

.automations-field-wide {
  grid-column: 1 / -1;
}

.automations-field input,
.automations-field textarea {
  width: 100%;
  min-width: 0;
  border: 1px solid rgba(148, 163, 184, 0.42);
  border-radius: 6px;
  background: #ffffff;
  color: #0f172a;
  font: inherit;
  font-weight: 400;
  padding: 8px 9px;
}

.automations-field textarea {
  resize: vertical;
}

.automations-storage {
  display: grid;
  gap: 8px;
  margin: 14px 0 0;
}

.automations-storage div {
  display: grid;
  grid-template-columns: 112px minmax(0, 1fr);
  gap: 10px;
}

.automations-storage dt {
  color: #64748b;
  font-size: 12px;
  font-weight: 700;
}

.automations-storage dd {
  min-width: 0;
  margin: 0;
}

.automations-page code {
  overflow-wrap: anywhere;
  color: inherit;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', monospace;
  font-size: 12px;
}

.automations-editor-actions {
  justify-content: flex-start;
  margin-top: 16px;
}

.automations-page button {
  border: 1px solid rgba(148, 163, 184, 0.42);
  border-radius: 6px;
  background: #ffffff;
  color: #0f172a;
  cursor: pointer;
  font: inherit;
  font-size: 13px;
  font-weight: 700;
  padding: 7px 10px;
}

.automations-page button:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.automations-page button.automations-primary {
  border-color: #2563eb;
  background: #2563eb;
  color: #ffffff;
}

.automations-page button.automations-danger {
  border-color: rgba(220, 38, 38, 0.45);
  color: #b91c1c;
}

:global(:root.dark) .automations-page {
  color: #e5e7eb;
}

:global(:root.dark) .automations-summary,
:global(:root.dark) .automations-workspace,
:global(:root.dark) .automations-diagnostics,
:global(:root.dark) .automations-error {
  border-color: rgba(71, 85, 105, 0.72);
  background: rgba(15, 23, 42, 0.86);
}

:global(:root.dark) .automations-summary-label,
:global(:root.dark) .automations-editor-header p,
:global(:root.dark) .automations-status,
:global(:root.dark) .automations-empty,
:global(:root.dark) .automations-table th,
:global(:root.dark) .automations-field,
:global(:root.dark) .automations-storage dt {
  color: #94a3b8;
}

:global(:root.dark) .automations-list {
  border-right-color: rgba(71, 85, 105, 0.72);
}

:global(:root.dark) .automations-table th,
:global(:root.dark) .automations-table td {
  border-bottom-color: rgba(71, 85, 105, 0.58);
}

:global(:root.dark) .automations-table tr[data-active='true'] td {
  background: rgba(59, 130, 246, 0.16);
}

:global(:root.dark) .automations-row-button,
:global(:root.dark) .automations-field input,
:global(:root.dark) .automations-field textarea,
:global(:root.dark) .automations-page button {
  color: #e5e7eb;
}

:global(:root.dark) .automations-field input,
:global(:root.dark) .automations-field textarea,
:global(:root.dark) .automations-page button {
  border-color: rgba(71, 85, 105, 0.82);
  background: rgba(2, 6, 23, 0.7);
}

:global(:root.dark) .automations-page button.automations-primary {
  border-color: #3b82f6;
  background: #2563eb;
  color: #ffffff;
}

:global(:root.dark) .automations-page button.automations-danger,
:global(:root.dark) .automations-error-inline,
:global(:root.dark) .automations-error {
  color: #fca5a5;
}

:global(:root.dark) .automations-diagnostics-copy,
:global(:root.dark) .automations-diagnostic-severity {
  color: #fbbf24;
}

@media (max-width: 980px) {
  .automations-summary,
  .automations-workspace {
    grid-template-columns: 1fr;
  }

  .automations-list {
    border-right: 0;
    border-bottom: 1px solid rgba(148, 163, 184, 0.28);
  }
}

@media (max-width: 640px) {
  .automations-page {
    padding: 12px;
  }

  .automations-field-grid {
    grid-template-columns: 1fr;
  }

  .automations-storage div {
    grid-template-columns: 1fr;
  }
}
</style>
