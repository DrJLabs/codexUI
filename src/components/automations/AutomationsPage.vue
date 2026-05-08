<template>
  <main class="automations-page" aria-label="Automations">
    <section class="automations-summary" aria-label="Automation summary">
      <div class="automations-summary-item">
        <span class="automations-summary-label">Total automations</span>
        <strong>{{ definitions.length }}</strong>
      </div>
      <div class="automations-summary-item">
        <span class="automations-summary-label">Active</span>
        <strong>{{ activeCount }}</strong>
      </div>
      <div class="automations-summary-item">
        <span class="automations-summary-label">Needs attention</span>
        <strong>{{ needsAttentionCount }}</strong>
      </div>
      <div class="automations-summary-item">
        <span class="automations-summary-label">Next scheduled run</span>
        <strong>{{ nextScheduledRunLabel }}</strong>
      </div>
    </section>

    <section v-if="diagnostics.length > 0" class="automations-diagnostics" aria-label="Automation diagnostics">
      <div class="automations-diagnostics-copy">
        <strong>Repair needed for some automation records.</strong>
        <span>Use the message and path below to fix the record, then reload automations.</span>
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
      <aside class="automations-list" aria-label="Automations">
        <div class="automations-list-header">
          <h2>Automations</h2>
          <button type="button" :disabled="isLoading || isSaving" @click="startCreate()">New automation</button>
        </div>

        <p v-if="isLoading" class="automations-status">Loading automations...</p>
        <p v-else-if="definitions.length === 0" class="automations-empty">
          No automations configured yet. Choose a starting point to create one.
        </p>

        <ul v-else class="automations-card-list" aria-label="Configured automations">
          <li v-for="item in automationCards" :key="item.definition.id">
            <button
              type="button"
              class="automations-card"
              :data-active="item.definition.id === selectedAutomationId"
              :aria-current="item.definition.id === selectedAutomationId ? 'true' : undefined"
              :disabled="isLoading || isSaving"
              @click="selectAutomation(item.definition.id)"
            >
              <span class="automations-card-header">
                <span class="automations-card-title">
                  <strong>{{ item.definition.name }}</strong>
                  <span v-if="item.definition.description">{{ item.definition.description }}</span>
                </span>
                <span class="automations-status-pill" :data-status="item.definition.status">
                  {{ formatStateLabel(item.definition.status) }}
                </span>
              </span>
              <span class="automations-card-grid">
                <span>
                  <span class="automations-card-label">Schedule</span>
                  <span>{{ item.scheduleLabel }}</span>
                </span>
                <span>
                  <span class="automations-card-label">Target</span>
                  <span>{{ item.target.label }}</span>
                  <small>{{ item.target.detail }}</small>
                </span>
                <span>
                  <span class="automations-card-label">Health</span>
                  <span class="automations-health-pill" :data-tone="item.health.tone">
                    {{ item.health.label }}
                  </span>
                  <small>{{ item.lastRunLabel }}</small>
                </span>
              </span>
            </button>
          </li>
        </ul>
      </aside>

      <form class="automations-editor" aria-label="Automation editor" @submit.prevent="saveDraft">
        <div class="automations-editor-header automations-compact-header">
          <div>
            <h2>{{ draft.mode === 'edit' ? draft.name || 'Automation' : 'Create automation' }}</h2>
            <p v-if="prefilledThreadId">
              Prefilled from thread <code>{{ prefilledThreadId }}</code>
            </p>
          </div>
          <div class="automations-editor-actions automations-editor-actions-top">
            <button
              v-if="draft.mode === 'edit' && selectedAutomation?.status === 'active'"
              type="button"
              class="automations-icon-button"
              :disabled="isSaving"
              aria-label="Pause automation"
              title="Pause automation"
              @click="pauseSelected"
            >
              <IconTablerPlayerPause class="automations-action-icon" />
            </button>
            <button
              v-else-if="draft.mode === 'edit' && selectedAutomation?.status === 'paused'"
              type="button"
              class="automations-icon-button"
              :disabled="isSaving"
              aria-label="Resume automation"
              title="Resume automation"
              @click="resumeSelected"
            >
              <IconTablerPlayerPlay class="automations-action-icon" />
            </button>
            <button
              v-if="draft.mode === 'edit'"
              type="button"
              class="automations-icon-button automations-danger-icon"
              :disabled="isSaving"
              aria-label="Delete automation"
              title="Delete automation"
              @click="confirmDelete"
            >
              <IconTablerTrash class="automations-action-icon" />
            </button>
            <button
              v-if="draft.mode === 'edit'"
              type="button"
              class="automations-run-now-button"
              :disabled="isSaving || isRunningNow || !manualRunsEnabled || isSelectedAutomationDeleted"
              @click="runSelectedNow"
            >
              <IconTablerPlayerPlay v-if="!isRunningNow" class="automations-run-now-icon" />
              <span>{{ isRunningNow ? 'Starting...' : 'Run now' }}</span>
            </button>
            <button class="automations-primary" type="submit" :disabled="isLoading || isSaving || isDraftThreadUnavailable || isSelectedAutomationDeleted">
              {{ isSaving ? 'Saving...' : draft.mode === 'edit' ? 'Save changes' : 'Create automation' }}
            </button>
          </div>
        </div>

        <p v-if="mutationError" class="automations-error-inline" role="alert">{{ mutationError }}</p>
        <p v-if="missingAutomationMessage" class="automations-error-inline" role="alert">{{ missingAutomationMessage }}</p>
        <p v-if="isSelectedAutomationDeleted" class="automations-error-inline" role="alert">
          This automation was deleted in Desktop or marked deleted in storage. It cannot be edited, resumed, or run.
        </p>
        <p v-if="isDraftThreadUnavailable" class="automations-error-inline" role="alert">
          This thread already has an active heartbeat automation.
        </p>

        <fieldset class="automations-editor-fieldset" :disabled="isLoading || isSaving || isSelectedAutomationDeleted">
          <section v-if="draft.mode === 'create'" class="automations-template-strip" aria-label="Choose a starting point">
            <h3>Choose a starting point</h3>
            <div class="automations-template-groups">
              <section v-for="group in templateGroups" :key="group.id" class="automations-template-group">
                <h4>{{ group.name }}</h4>
                <div class="automations-template-actions">
                  <button
                    v-for="template in group.templates"
                    :key="template.id"
                    type="button"
                    @click="applyTemplate(template.id)"
                  >
                    <span>{{ template.name }}</span>
                    <small>{{ describeAutomationSchedule(template.schedule.rawRrule ?? template.schedule.rrule) }}</small>
                  </button>
                </div>
              </section>
            </div>
          </section>

          <section class="automations-compact-section" aria-label="Automation basics">
            <h3>Basics</h3>
            <label class="automations-field">
              <span>Name</span>
              <input v-model="draft.name" type="text" required />
            </label>

            <div v-if="draft.runMode === 'chat'" class="automations-field">
              <span>Thread</span>
              <AutomationThreadPicker
                v-model="draft.targetThreadId"
                :required="draft.mode === 'create' && draft.runMode === 'chat'"
                :unavailable-thread-ids="unavailableHeartbeatThreadIds"
              />
            </div>

            <label class="automations-field automations-field-wide">
              <span>Prompt</span>
              <textarea v-model="draft.prompt" rows="6" required />
            </label>
          </section>

          <section class="automations-compact-section" aria-label="Automation status">
            <h3>Status</h3>
            <div class="automations-compact-row">
              <span>Status</span>
              <strong v-if="selectedAutomation" class="automations-status-pill" :data-status="selectedAutomation.status">
                {{ formatStateLabel(selectedAutomation.status) }}
              </strong>
              <strong v-else class="automations-status-pill" data-status="draft">Draft</strong>
            </div>
            <div class="automations-compact-row">
              <span>Next run</span>
              <strong>{{ nextRunLabel }}</strong>
            </div>
            <div class="automations-compact-row">
              <span>Last ran</span>
              <strong>{{ lastRunLabel }}</strong>
            </div>
          </section>

          <section class="automations-compact-section" aria-label="Automation details">
            <h3>Details</h3>
            <label class="automations-compact-row automations-compact-control">
              <span>Runs in</span>
              <select v-model="draft.runMode">
                <option value="chat">Chat</option>
                <option value="local">Local</option>
                <option value="worktree">Worktree</option>
              </select>
            </label>

            <label class="automations-compact-row automations-compact-control" :data-required="requiresCwd">
              <span>Project folders <em v-if="requiresCwd">required</em></span>
              <textarea
                v-model="projectFoldersText"
                rows="2"
                :placeholder="selectedAutomationProjectLabel"
                :required="requiresCwd"
              />
            </label>

            <div class="automations-compact-row automations-compact-control">
              <span>Repeats</span>
              <div class="automations-inline-controls">
                <select v-model="scheduleFrequency">
                  <option value="minute_interval">Every N minutes</option>
                  <option value="hourly">Hourly</option>
                  <option value="hour_interval">Every N hours</option>
                  <option value="daily">Daily</option>
                  <option value="weekdays">Weekdays</option>
                  <option value="weekends">Weekends</option>
                  <option value="weekly">Weekly</option>
                  <option value="custom">Custom</option>
                </select>
                <input
                  v-if="isIntervalSchedule"
                  v-model.number="scheduleIntervalCount"
                  type="number"
                  min="1"
                  step="1"
                  :aria-label="scheduleFrequency === 'minute_interval' ? 'Interval minutes' : 'Interval hours'"
                />
                <select v-if="scheduleFrequency === 'weekly'" v-model="scheduleWeekday" aria-label="Schedule weekday">
                  <option v-for="day in weekdayOptions" :key="day.value" :value="day.value">
                    {{ day.label }}
                  </option>
                </select>
                <input v-if="usesScheduleTime" v-model="scheduleTime" type="time" aria-label="Schedule time" />
              </div>
            </div>

            <label class="automations-compact-row automations-compact-control">
              <span>Model</span>
              <select v-model="draft.model">
                <option v-for="option in modelSelectOptions" :key="option.value" :value="option.value">
                  {{ option.label }}
                </option>
              </select>
            </label>

            <label class="automations-compact-row automations-compact-control">
              <span>Reasoning</span>
              <select v-model="draft.reasoningEffort">
                <option v-for="option in reasoningEffortSelectOptions" :key="option.value" :value="option.value">
                  {{ option.label }}
                </option>
              </select>
            </label>
          </section>

          <details v-if="draft.mode === 'edit'" class="automations-runs" aria-label="Previous automation runs">
            <summary>
              <span>Previous runs</span>
              <small>{{ runHistory.length }}</small>
            </summary>
            <div class="automations-runs-toolbar">
              <button type="button" :disabled="isSaving || isRunHistoryLoading" @click="loadRunHistory()">
                {{ isRunHistoryLoading ? 'Refreshing...' : 'Refresh' }}
              </button>
            </div>
            <p v-if="runHistoryError" class="automations-error-inline" role="alert">{{ runHistoryError }}</p>
            <p v-else-if="runHistory.length === 0" class="automations-empty">
              Runs will appear here after the schedule fires or manual runs are enabled.
            </p>
            <ul v-else class="automations-run-list automations-run-list-compact">
              <li v-for="item in compactRunItems" :key="item.id" class="automations-run-item automations-run-item-compact">
                <div class="automations-run-compact-main">
                  <span class="automations-run-state-dot" :data-status="item.state" aria-hidden="true"></span>
                  <strong>{{ item.title }}</strong>
                  <span>{{ item.project }}</span>
                  <time>{{ item.age }}</time>
                </div>
                <details class="automations-run-more">
                  <summary>Run details</summary>
                  <div v-if="item.run.inboxTitle || item.run.inboxSummary" class="automations-run-inbox">
                    <strong v-if="item.run.inboxTitle">{{ item.run.inboxTitle }}</strong>
                    <p v-if="item.run.inboxSummary">{{ item.run.inboxSummary }}</p>
                  </div>
                  <div v-if="item.run.errorMessage || item.run.resultSummary" class="automations-run-summary" :data-tone="item.run.errorMessage ? 'danger' : 'neutral'">
                    <strong>{{ item.run.errorMessage ? 'Failure summary' : 'Run summary' }}</strong>
                    <p>{{ item.run.errorMessage || item.run.resultSummary }}</p>
                  </div>
                  <div class="automations-run-actions" aria-label="Run triage actions">
                    <button
                      v-if="shouldShowReadAction(item.run)"
                      type="button"
                      :disabled="isSaving"
                      @click="markRunRead(item.run.id)"
                    >
                      Read
                    </button>
                    <button
                      v-if="item.run.archivedAtIso === null"
                      type="button"
                      :disabled="isSaving"
                      @click="archiveRun(item.run.id)"
                    >
                      Archive
                    </button>
                    <button
                      v-else
                      type="button"
                      :disabled="isSaving"
                      @click="unarchiveRun(item.run.id)"
                    >
                      Unarchive
                    </button>
                  </div>
                  <dl>
                    <div>
                      <dt>Thread</dt>
                      <dd><code>{{ item.run.threadId || item.run.targetThreadId || 'n/a' }}</code></dd>
                    </div>
                    <div>
                      <dt>Turn</dt>
                      <dd><code>{{ item.run.turnId || 'n/a' }}</code></dd>
                    </div>
                    <div>
                      <dt>Project</dt>
                      <dd><code>{{ item.run.worktreePath || item.run.cwd || 'n/a' }}</code></dd>
                    </div>
                    <div>
                      <dt>Run record</dt>
                      <dd><code>{{ item.run.runJsonPath }}</code></dd>
                    </div>
                    <div>
                      <dt>Events</dt>
                      <dd><code>{{ item.run.eventsPath }}</code></dd>
                    </div>
                    <div>
                      <dt>Log</dt>
                      <dd><code>{{ item.run.logPath }}</code></dd>
                    </div>
                    <div>
                      <dt>Started</dt>
                      <dd>{{ formatTimestamp(item.run.startedAtIso) }}</dd>
                    </div>
                    <div>
                      <dt>Completed</dt>
                      <dd>{{ formatTimestamp(item.run.completedAtIso) }}</dd>
                    </div>
                  </dl>
                </details>
              </li>
            </ul>
          </details>

          <details class="automations-advanced">
            <summary>Advanced details</summary>
            <div class="automations-advanced-content">
              <div class="automations-field-grid">
                <label v-if="draft.runMode === 'chat'" class="automations-field">
                  <span>Raw thread ID</span>
                  <input v-model="draft.targetThreadId" type="text" required />
                  <small class="automations-field-help">
                    Use only when the target chat is not visible in the picker.
                  </small>
                </label>

                <label v-if="showRawRrule" class="automations-field automations-field-wide">
                  <span>Raw schedule rule</span>
                  <input v-model="draft.rrule" type="text" required />
                  <small class="automations-field-help">
                    RRULE format, for example FREQ=DAILY;BYHOUR=9;BYMINUTE=0.
                  </small>
                </label>

                <label class="automations-field automations-field-wide">
                  <span>Profile defaults</span>
                  <select :value="selectedRunProfileId" @change="applyRunProfileDefaultsFromEvent">
                    <option value="">Do not copy profile defaults</option>
                    <option v-for="profile in availableRunProfiles" :key="profile.id" :value="profile.id">
                      {{ profile.name }}
                    </option>
                  </select>
                  <small class="automations-field-help">
                    Copies only Desktop-compatible model and reasoning defaults from config profiles.
                  </small>
                </label>

                <label class="automations-field">
                  <span>Description</span>
                  <input v-model="draft.description" type="text" />
                </label>

                <label class="automations-field automations-field-wide">
                  <span>Notes</span>
                  <textarea v-model="draft.notes" rows="4" />
                </label>

                <label class="automations-field automations-field-wide">
                  <span>Local environment config</span>
                  <input v-model="draft.localEnvironmentConfigPath" type="text" placeholder="/absolute/path/to/local-env.toml" />
                  <small class="automations-field-help">
                    Runs the local setup script from this file before worktree runs. Use only trusted local configs.
                  </small>
                </label>
              </div>

              <dl class="automations-storage">
                <div v-for="detail in advancedDetails" :key="detail.label">
                  <dt>{{ detail.label }}</dt>
                  <dd>
                    <code v-if="detail.mono">{{ detail.value }}</code>
                    <span v-else>{{ detail.value }}</span>
                  </dd>
                </div>
              </dl>
            </div>
          </details>

          <div v-if="!manualRunsEnabled" class="automations-manual-disabled">
            Manual runs are disabled in this environment. Scheduled runs are unchanged.
          </div>
        </fieldset>
      </form>
    </section>
  </main>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useAutomations } from '../../composables/useAutomations'
import AutomationThreadPicker from './AutomationThreadPicker.vue'
import IconTablerPlayerPause from '../icons/IconTablerPlayerPause.vue'
import IconTablerPlayerPlay from '../icons/IconTablerPlayerPlay.vue'
import IconTablerTrash from '../icons/IconTablerTrash.vue'
import type { AutomationRun, AutomationRunMode, AutomationTemplate } from '../../types/automations'
import {
  buildDailyRrule,
  buildHourlyRrule,
  buildHourlyIntervalRrule,
  buildMinuteIntervalRrule,
  buildWeekdaysRrule,
  buildWeekendsRrule,
  buildWeeklyRrule,
  classifyAutomationRrule,
  describeAutomationProjectLabel,
  describeAutomationRunListItem,
  describeAutomationSchedule,
  describeAutomationTarget,
  describeRunHealth,
  formatAutomationRelativeTime,
  type AutomationScheduleFrequency,
} from '../../utils/automationDisplay'

type ScheduleFrequency = AutomationScheduleFrequency

const route = useRoute()
const {
  state,
  definitions,
  diagnostics,
  isLoading,
  isSaving,
  isRunningNow,
  isRunHistoryLoading,
  errorMessage,
  mutationError,
  runHistoryError,
  missingAutomationMessage,
  selectedAutomationId,
  selectedAutomation,
  templates,
  draft,
  runHistory,
  loadAll,
  selectAutomation,
  startCreate,
  saveDraft,
  pauseSelected,
  resumeSelected,
  runSelectedNow,
  markRunRead,
  archiveRun,
  unarchiveRun,
  loadRunHistory,
  deleteSelectedAutomation,
  applyThreadPrefill,
  clearThreadPrefill,
} = useAutomations()

const weekdayOptions = [
  { value: 'MO', label: 'Monday' },
  { value: 'TU', label: 'Tuesday' },
  { value: 'WE', label: 'Wednesday' },
  { value: 'TH', label: 'Thursday' },
  { value: 'FR', label: 'Friday' },
  { value: 'SA', label: 'Saturday' },
  { value: 'SU', label: 'Sunday' },
] as const

type TemplateGroup = {
  id: string
  name: string
  templates: AutomationTemplate[]
}

const templateGroups = computed<TemplateGroup[]>(() => {
  const groups = new Map<string, TemplateGroup>()
  for (const template of templates.value) {
    const group = groups.get(template.groupId)
    if (group) {
      group.templates.push(template)
      continue
    }
    groups.set(template.groupId, {
      id: template.groupId,
      name: template.groupName,
      templates: [template],
    })
  }
  return Array.from(groups.values())
})
const templateById = computed(() => new Map(templates.value.map((template) => [template.id, template])))
const baseModelOptions = [
  { value: '', label: 'Default model' },
  { value: 'gpt-5.5', label: 'GPT-5.5' },
  { value: 'gpt-5.4', label: 'GPT-5.4' },
  { value: 'gpt-5.4-mini', label: 'GPT-5.4 Mini' },
  { value: 'gpt-5.3-codex', label: 'GPT-5.3 Codex' },
  { value: 'gpt-5.3-codex-spark', label: 'GPT-5.3 Codex Spark' },
  { value: 'gpt-5.2', label: 'GPT-5.2' },
  { value: 'gpt-5.2-codex', label: 'GPT-5.2 Codex' },
] as const
const baseReasoningEffortOptions = [
  { value: '', label: 'Default reasoning' },
  { value: 'none', label: 'None' },
  { value: 'minimal', label: 'Minimal' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'xhigh', label: 'Extra high' },
] as const

const scheduleFrequency = ref<ScheduleFrequency>('daily')
const scheduleTime = ref('09:00')
const scheduleWeekday = ref('MO')
const scheduleIntervalCount = ref(15)
const selectedRunProfileId = ref('')
let isSyncingScheduleControls = false

const activeCount = computed(() => definitions.value.filter((definition) => definition.status === 'active').length)
const needsAttentionCount = computed(() =>
  definitions.value.filter((definition) => {
    const tone = describeRunHealth(definition.recentRuns ?? []).tone
    return tone === 'danger' || tone === 'warning'
  }).length,
)
const requiresCwd = computed(() => draft.value.runMode === 'local' || draft.value.runMode === 'worktree')
const manualRunsEnabled = computed(() => state.value.featureFlags.manualRun)
const prefilledThreadId = computed(() => {
  const value = route.query.threadId
  const threadId = Array.isArray(value) ? value[0] : value
  const normalizedThreadId = typeof threadId === 'string' ? threadId.trim() : ''
  if (!normalizedThreadId || draft.value.targetThreadId !== normalizedThreadId) return ''
  return normalizedThreadId
})
const capabilityChips = computed(() => [
  { key: 'scheduler', label: 'Scheduler', enabled: state.value.featureFlags.scheduler },
  { key: 'manualRun', label: 'Manual run', enabled: state.value.featureFlags.manualRun },
  { key: 'artifactIndexing', label: 'Artifact indexing', enabled: state.value.featureFlags.artifactIndexing },
  { key: 'kanbanProjection', label: 'Kanban projection', enabled: state.value.featureFlags.kanbanProjection },
])
const featureFlagSummary = computed(() =>
  capabilityChips.value.map((capability) => `${capability.label} ${capability.enabled ? 'on' : 'off'}`).join(', '),
)
const automationCards = computed(() =>
  definitions.value.map((definition) => {
    const health = describeRunHealth(definition.recentRuns ?? [])
    return {
      definition,
      scheduleLabel: describeAutomationSchedule(definition.schedule.rawRrule ?? definition.schedule.rrule),
      target: describeAutomationTarget(definition),
      health,
      lastRunLabel: definition.lastRunAtIso ? `Last run ${formatTimestamp(definition.lastRunAtIso)}` : 'No completed runs',
    }
  }),
)
const nextScheduledRunLabel = computed(() => {
  let next: number | null = null
  for (const definition of definitions.value) {
    if (definition.status !== 'active' || !definition.nextRunAtIso) continue
    const timestamp = Date.parse(definition.nextRunAtIso)
    if (!Number.isFinite(timestamp)) continue
    next = next === null ? timestamp : Math.min(next, timestamp)
  }
  return next === null ? 'Not scheduled' : formatTimestamp(new Date(next).toISOString())
})
const nextRunLabel = computed(() => formatTimestamp(selectedAutomation.value?.nextRunAtIso ?? null))
const lastRunLabel = computed(() =>
  selectedAutomation.value?.lastRunAtIso
    ? formatAutomationRelativeTime(selectedAutomation.value.lastRunAtIso)
    : 'n/a',
)
const selectedAutomationProjectLabel = computed(() =>
  selectedAutomation.value ? describeAutomationProjectLabel(selectedAutomation.value) : '/absolute/project/path',
)
const compactRunItems = computed(() =>
  runHistory.value.map((run) => ({
    ...describeAutomationRunListItem(run),
    run,
  })),
)
const currentRruleClassification = computed(() => classifyAutomationRrule(draft.value.rrule))
const isIntervalSchedule = computed(() => scheduleFrequency.value === 'minute_interval' || scheduleFrequency.value === 'hour_interval')
const usesScheduleTime = computed(() =>
  scheduleFrequency.value === 'daily' ||
  scheduleFrequency.value === 'weekdays' ||
  scheduleFrequency.value === 'weekends' ||
  scheduleFrequency.value === 'weekly',
)
const showRawRrule = computed(() => scheduleFrequency.value === 'custom' || currentRruleClassification.value.frequency === 'custom')
const projectFoldersText = computed({
  get: () => (draft.value.cwds.length > 0 ? draft.value.cwds : draft.value.cwd ? [draft.value.cwd] : []).join('\n'),
  set: (value: string) => {
    const cwds = Array.from(new Set(
      value
        .split(/\r?\n/u)
        .map((line) => line.trim())
        .filter(Boolean),
    ))
    draft.value.cwds = cwds
    draft.value.cwd = cwds[0] ?? ''
  },
})
const modelSelectOptions = computed(() => ensureOption(baseModelOptions, draft.value.model, 'Current model'))
const reasoningEffortSelectOptions = computed(() =>
  ensureOption(baseReasoningEffortOptions, draft.value.reasoningEffort, 'Current reasoning effort'),
)
const availableRunProfiles = computed(() => state.value.executionOptions.runProfiles)
const unavailableHeartbeatThreadIds = computed(() =>
  definitions.value
    .filter((definition) => (
      definition.kind === 'heartbeat' &&
      definition.status === 'active' &&
      definition.id !== draft.value.id &&
      definition.targetThreadId
    ))
    .map((definition) => definition.targetThreadId as string),
)
const unavailableHeartbeatThreadIdSet = computed(() => new Set(unavailableHeartbeatThreadIds.value))
const isDraftThreadUnavailable = computed(() => {
  if (draft.value.runMode !== 'chat') return false
  const targetThreadId = draft.value.targetThreadId.trim()
  return Boolean(targetThreadId && unavailableHeartbeatThreadIdSet.value.has(targetThreadId))
})
const isSelectedAutomationDeleted = computed(() => selectedAutomation.value?.status === 'deleted')
const advancedDetails = computed(() => [
  { label: 'Native storage root', value: state.value.storageRoot || 'Unavailable', mono: true },
  { label: 'Feature flags', value: featureFlagSummary.value || 'Unavailable', mono: false },
  { label: 'Native path', value: selectedAutomation.value?.storage.nativePath || 'Created on save', mono: true },
  { label: 'Sidecar path', value: selectedAutomation.value?.storage.sidecarPath || 'Created on save', mono: true },
  { label: 'Memory path', value: selectedAutomation.value?.storage.memoryPath || 'Created on save', mono: true },
  { label: 'Automation id', value: selectedAutomation.value?.id || 'Created on save', mono: true },
  { label: 'Source', value: selectedAutomation.value?.source || 'Created on save', mono: true },
  { label: 'Kind', value: selectedAutomation.value?.kind || 'Created on save', mono: true },
])

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

watch(
  () => draft.value.rrule,
  (rrule) => {
    if (isSyncingScheduleControls) return
    syncScheduleControlsFromRrule(rrule)
  },
  { immediate: true },
)

watch(
  () => draft.value.id,
  () => {
    selectedRunProfileId.value = ''
  },
)

watch(
  () => draft.value.runMode,
  (runMode, previousRunMode) => {
    if (runMode !== 'chat' || previousRunMode === undefined || previousRunMode === 'chat') return
    draft.value.cwd = ''
    draft.value.cwds = []
  },
)

watch([scheduleFrequency, scheduleTime, scheduleWeekday, scheduleIntervalCount], () => {
  if (scheduleFrequency.value === 'custom') return
  try {
    const nextRrule = buildRruleFromScheduleControls()
    isSyncingScheduleControls = true
    draft.value.rrule = nextRrule
  } catch {
    return
  } finally {
    isSyncingScheduleControls = false
  }
})

onMounted(() => {
  void loadAll()
})

async function confirmDelete(): Promise<void> {
  const name = selectedAutomation.value?.name || draft.value.name || 'this automation'
  const confirmed = window.confirm(
    `Delete "${name}"? This also removes the native automation folder from the Codex automations storage root. This cannot be undone.`,
  )
  if (!confirmed) return
  await deleteSelectedAutomation()
}

function applyTemplate(templateId: string): void {
  const template = templateById.value.get(templateId)
  if (!template) return
  const rrule = template.schedule.rawRrule ?? template.schedule.rrule
  const classification = classifyAutomationRrule(rrule)
  applyTemplateValues({
    name: template.name,
    description: template.description,
    prompt: template.prompt,
    runMode: template.runMode,
    frequency: classification.frequency,
    time: classification.time ?? '09:00',
    weekday: classification.weekday ?? undefined,
    intervalCount: classification.intervalCount ?? undefined,
    rrule,
    clearThread: template.kind === 'cron',
  })
}

function applyTemplateValues(values: {
  name: string
  description: string
  prompt: string
  runMode: AutomationRunMode
  frequency: ScheduleFrequency
  time: string
  weekday?: string
  intervalCount?: number
  rrule?: string
  clearThread?: boolean
}): void {
  draft.value.name = values.name
  draft.value.description = values.description
  draft.value.prompt = values.prompt
  draft.value.runMode = values.runMode
  if (values.clearThread) draft.value.targetThreadId = ''
  scheduleFrequency.value = values.frequency
  scheduleTime.value = values.time
  scheduleWeekday.value = values.weekday ?? scheduleWeekday.value
  scheduleIntervalCount.value = values.intervalCount ?? scheduleIntervalCount.value
  if (values.rrule) {
    draft.value.rrule = values.rrule
    return
  }
  writeScheduleFromControls()
}

function applyRunProfileDefaults(profileId: string): void {
  selectedRunProfileId.value = profileId
  const profile = availableRunProfiles.value.find((candidate) => candidate.id === profileId)
  if (!profile) return
  draft.value.model = profile.model
  draft.value.reasoningEffort = profile.reasoningEffort
}

function applyRunProfileDefaultsFromEvent(event: Event): void {
  const target = event.target
  applyRunProfileDefaults(target instanceof HTMLSelectElement ? target.value : '')
}

function writeScheduleFromControls(): void {
  if (scheduleFrequency.value === 'custom') return
  try {
    draft.value.rrule = buildRruleFromScheduleControls()
  } catch {
    draft.value.rrule = buildDailyRrule('09:00')
    scheduleFrequency.value = 'daily'
    scheduleTime.value = '09:00'
  }
}

function syncScheduleControlsFromRrule(rrule: string): void {
  const classification = classifyAutomationRrule(rrule)
  scheduleFrequency.value = classification.frequency
  if (classification.time) scheduleTime.value = classification.time
  if (classification.weekday) scheduleWeekday.value = classification.weekday
  if (classification.intervalCount) scheduleIntervalCount.value = classification.intervalCount
}

function buildRruleFromScheduleControls(): string {
  if (scheduleFrequency.value === 'minute_interval') {
    return buildMinuteIntervalRrule(Number(scheduleIntervalCount.value || 15))
  }
  if (scheduleFrequency.value === 'hourly') return buildHourlyRrule()
  if (scheduleFrequency.value === 'hour_interval') {
    return buildHourlyIntervalRrule(Number(scheduleIntervalCount.value || 1))
  }
  if (scheduleFrequency.value === 'daily') return buildDailyRrule(scheduleTime.value || '09:00')
  if (scheduleFrequency.value === 'weekdays') return buildWeekdaysRrule(scheduleTime.value || '09:00')
  if (scheduleFrequency.value === 'weekends') return buildWeekendsRrule(scheduleTime.value || '09:00')
  if (scheduleFrequency.value === 'weekly') {
    return buildWeeklyRrule(scheduleWeekday.value || 'MO', scheduleTime.value || '09:00')
  }
  return draft.value.rrule
}

function ensureOption<T extends readonly { value: string; label: string }[]>(
  options: T,
  value: string,
  fallbackLabel: string,
): Array<{ value: string; label: string }> {
  if (!value || options.some((option) => option.value === value)) return [...options]
  return [...options, { value, label: `${fallbackLabel}: ${value}` }]
}

function formatTimestamp(value: string | null): string {
  if (!value) return 'n/a'
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) return value || 'n/a'
  return new Date(timestamp).toLocaleString()
}

function formatStateLabel(value: string): string {
  return value.replace(/_/g, ' ')
}

function shouldShowReadAction(run: AutomationRun): boolean {
  return run.readAtIso === null && (run.findings === true || run.state === 'failed')
}
</script>

<style scoped>
.automations-page {
  display: flex;
  min-height: 100%;
  min-width: 0;
  flex-direction: column;
  gap: 16px;
  overflow-x: hidden;
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
  grid-template-columns: repeat(4, minmax(0, 1fr));
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
  min-width: 0;
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
  min-width: 0;
  flex: 1;
  grid-template-columns: minmax(0, 1fr) minmax(360px, 520px);
  gap: 0;
  overflow: hidden;
  border-radius: 8px;
}

.automations-list,
.automations-editor {
  max-height: 100%;
  min-width: 0;
  overflow-x: hidden;
  overflow-y: auto;
  padding: 14px;
}

.automations-list {
  border-right: 1px solid rgba(148, 163, 184, 0.28);
}

.automations-editor-fieldset {
  min-width: 0;
  margin: 0;
  border: 0;
  padding: 0;
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

.automations-card-list {
  display: grid;
  gap: 10px;
  margin: 12px 0 0;
  padding: 0;
  list-style: none;
}

.automations-card {
  display: grid;
  width: 100%;
  min-width: 0;
  gap: 12px;
  border: 1px solid rgba(148, 163, 184, 0.26);
  border-radius: 8px;
  background: rgba(248, 250, 252, 0.72);
  color: #0f172a;
  cursor: pointer;
  font: inherit;
  padding: 12px;
  text-align: left;
}

.automations-card[data-active='true'] {
  border-color: rgba(37, 99, 235, 0.58);
  background: rgba(37, 99, 235, 0.08);
}

.automations-card-header {
  display: flex;
  min-width: 0;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.automations-card-title {
  display: grid;
  min-width: 0;
  gap: 3px;
}

.automations-card-title strong {
  overflow-wrap: anywhere;
}

.automations-card-title span,
.automations-card-grid small {
  color: #64748b;
  font-size: 12px;
  line-height: 1.35;
  overflow-wrap: anywhere;
}

.automations-card-grid {
  display: grid;
  min-width: 0;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}

.automations-card-grid > span {
  display: grid;
  min-width: 0;
  gap: 3px;
}

.automations-card-label {
  color: #64748b;
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
}

.automations-status-pill,
.automations-health-pill {
  display: inline-flex;
  width: fit-content;
  max-width: 100%;
  align-items: center;
  border-radius: 999px;
  padding: 2px 8px;
  background: rgba(22, 163, 74, 0.12);
  color: #15803d;
  font-size: 12px;
  font-weight: 700;
  overflow-wrap: anywhere;
  text-transform: capitalize;
}

.automations-status-pill[data-status='paused'],
.automations-status-pill[data-status='draft'],
.automations-health-pill[data-tone='neutral'] {
  background: rgba(148, 163, 184, 0.18);
  color: #475569;
}

.automations-status-pill[data-status='deleted'],
.automations-status-pill[data-status='failed'],
.automations-health-pill[data-tone='danger'] {
  background: rgba(220, 38, 38, 0.12);
  color: #b91c1c;
}

.automations-status-pill[data-status='completed_with_findings'],
.automations-health-pill[data-tone='warning'] {
  background: rgba(245, 158, 11, 0.16);
  color: #b45309;
}

.automations-template-strip {
  display: grid;
  gap: 8px;
  margin-top: 14px;
}

.automations-template-strip h3 {
  margin: 0;
  color: #475569;
  font-size: 12px;
  text-transform: uppercase;
}

.automations-template-groups,
.automations-template-group {
  display: grid;
  min-width: 0;
  gap: 8px;
}

.automations-template-group h4 {
  margin: 2px 0 0;
  color: #64748b;
  font-size: 12px;
  font-weight: 700;
}

.automations-template-actions {
  display: grid;
  min-width: 0;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 8px;
}

.automations-template-actions button {
  display: grid;
  min-width: 0;
  justify-items: start;
  gap: 3px;
  text-align: left;
}

.automations-template-actions small {
  width: 100%;
  min-width: 0;
  color: #64748b;
  font-size: 11px;
  font-weight: 500;
  overflow-wrap: anywhere;
}

.automations-editor-actions,
.automations-run-actions {
  display: flex;
  min-width: 0;
  flex-wrap: wrap;
  gap: 8px;
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
.automations-field textarea,
.automations-field select,
.automations-compact-control input,
.automations-compact-control textarea,
.automations-compact-control select {
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

.automations-compact-header {
  position: sticky;
  top: 0;
  z-index: 2;
  margin: -14px -14px 0;
  border-bottom: 1px solid rgba(148, 163, 184, 0.22);
  padding: 12px 14px;
  background: rgba(255, 255, 255, 0.94);
  -webkit-backdrop-filter: blur(10px);
  backdrop-filter: blur(10px);
}

.automations-editor-actions-top {
  justify-content: flex-end;
  margin-top: 0;
}

.automations-run-now-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 34px;
}

.automations-action-icon,
.automations-run-now-icon {
  width: 1em;
  height: 1em;
  flex: 0 0 auto;
}

.automations-icon-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  min-width: 34px;
  height: 34px;
  padding: 0;
  text-align: center;
}

.automations-danger-icon {
  color: #b91c1c;
}

.automations-compact-section {
  display: grid;
  min-width: 0;
  gap: 10px;
  margin-top: 18px;
}

.automations-compact-section h3 {
  margin: 0 0 2px;
  color: #64748b;
  font-size: 12px;
  font-weight: 800;
  text-transform: uppercase;
}

.automations-compact-row {
  display: grid;
  min-width: 0;
  grid-template-columns: minmax(104px, 0.72fr) minmax(0, 1fr);
  align-items: center;
  gap: 12px;
  color: #475569;
  font-size: 13px;
  font-weight: 700;
}

.automations-compact-row > strong,
.automations-compact-row > .automations-status-pill {
  justify-self: end;
}

.automations-compact-row > strong {
  min-width: 0;
  color: #0f172a;
  font-size: 13px;
  font-weight: 700;
  overflow-wrap: anywhere;
  text-align: right;
}

.automations-compact-control em {
  color: #b45309;
  font-style: normal;
}

.automations-compact-control input,
.automations-compact-control textarea,
.automations-compact-control select {
  justify-self: end;
  max-width: 220px;
  font-size: 13px;
  font-weight: 700;
  text-align: right;
}

.automations-compact-control textarea {
  resize: vertical;
  text-align: left;
}

.automations-inline-controls {
  display: flex;
  min-width: 0;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 6px;
}

.automations-inline-controls select,
.automations-inline-controls input {
  width: auto;
  min-width: 92px;
  max-width: 138px;
}

.automations-field em {
  color: #b45309;
  font-style: normal;
  font-weight: 700;
}

.automations-field-help {
  color: #64748b;
  font-size: 12px;
  font-weight: 500;
  line-height: 1.35;
  overflow-wrap: anywhere;
}

.automations-field textarea {
  resize: vertical;
}

.automations-schedule-builder {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}

.automations-advanced {
  min-width: 0;
  margin-top: 16px;
  border: 1px solid rgba(148, 163, 184, 0.24);
  border-radius: 8px;
  background: rgba(248, 250, 252, 0.52);
}

.automations-advanced summary {
  cursor: pointer;
  padding: 10px 12px;
  color: #334155;
  font-size: 13px;
  font-weight: 700;
}

.automations-advanced-content {
  display: grid;
  gap: 12px;
  min-width: 0;
  padding: 0 12px 12px;
}

.automations-execution-settings {
  display: grid;
  min-width: 0;
  grid-template-columns: minmax(0, 1fr);
  gap: 1rem;
}

.automations-storage {
  display: grid;
  gap: 8px;
  margin: 0;
}

.automations-storage div,
.automations-run-item dl div {
  display: grid;
  grid-template-columns: 120px minmax(0, 1fr);
  gap: 10px;
}

.automations-storage dt,
.automations-run-item dt {
  color: #64748b;
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
}

.automations-storage dd,
.automations-run-item dd {
  min-width: 0;
  margin: 0;
  color: #334155;
  font-size: 12px;
}

.automations-runs {
  margin-top: 16px;
  min-width: 0;
  border: 1px solid rgba(148, 163, 184, 0.24);
  border-radius: 8px;
  background: rgba(248, 250, 252, 0.52);
}

.automations-runs > summary {
  display: flex;
  min-width: 0;
  cursor: pointer;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 10px 12px;
  color: #334155;
  font-size: 13px;
  font-weight: 800;
}

.automations-runs > summary small {
  color: #64748b;
  font-size: 12px;
}

.automations-runs-toolbar {
  display: flex;
  justify-content: flex-end;
  padding: 0 12px 8px;
}

.automations-run-list {
  display: grid;
  gap: 2px;
  margin: 0;
  padding: 0 12px 12px;
  list-style: none;
}

.automations-run-item {
  min-width: 0;
  border-top: 1px solid rgba(148, 163, 184, 0.16);
  padding: 8px 0;
}

.automations-run-item:first-child {
  border-top: 0;
}

.automations-run-compact-main {
  display: grid;
  min-width: 0;
  grid-template-columns: 16px minmax(0, 1fr) minmax(48px, auto) minmax(34px, auto);
  align-items: center;
  gap: 8px;
  color: #64748b;
  font-size: 12px;
}

.automations-run-compact-main strong {
  min-width: 0;
  color: #0f172a;
  font-size: 13px;
  overflow-wrap: anywhere;
}

.automations-run-compact-main time {
  color: #64748b;
  font-weight: 700;
  text-align: right;
}

.automations-run-state-dot {
  display: inline-flex;
  width: 10px;
  height: 10px;
  border-radius: 999px;
  background: #93c5fd;
}

.automations-run-state-dot[data-status='completed_no_findings'],
.automations-run-state-dot[data-status='completed_with_findings'] {
  background: #9ca3af;
}

.automations-run-state-dot[data-status='failed'] {
  background: #ef4444;
}

.automations-run-state-dot[data-status='running'],
.automations-run-state-dot[data-status='queued'],
.automations-run-state-dot[data-status='starting'] {
  background: #60a5fa;
}

.automations-run-more {
  margin: 6px 0 0 24px;
}

.automations-run-more > summary {
  cursor: pointer;
  color: #64748b;
  font-size: 12px;
  font-weight: 700;
}

.automations-run-inbox,
.automations-run-summary {
  display: grid;
  min-width: 0;
  gap: 3px;
  margin-top: 8px;
  color: #334155;
  font-size: 12px;
}

.automations-run-summary {
  border-left: 3px solid rgba(148, 163, 184, 0.58);
  padding-left: 8px;
}

.automations-run-summary[data-tone='danger'] {
  border-left-color: rgba(220, 38, 38, 0.72);
}

.automations-run-inbox strong,
.automations-run-inbox p,
.automations-run-summary strong,
.automations-run-summary p {
  min-width: 0;
  overflow-wrap: anywhere;
}

.automations-run-inbox p,
.automations-run-summary p {
  margin: 0;
  color: #64748b;
  line-height: 1.4;
}

.automations-run-actions {
  margin-top: 8px;
}

.automations-run-actions button {
  padding: 5px 8px;
  font-size: 12px;
}

.automations-run-item dl {
  display: grid;
  gap: 6px;
  margin: 8px 0 0;
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

.automations-manual-disabled {
  margin-top: 14px;
  border: 1px solid rgba(245, 158, 11, 0.28);
  border-radius: 8px;
  padding: 9px 10px;
  background: rgba(245, 158, 11, 0.1);
  color: #92400e;
  font-size: 13px;
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
:global(:root.dark) .automations-field,
:global(:root.dark) .automations-field-help,
:global(:root.dark) .automations-compact-section h3,
:global(:root.dark) .automations-compact-row,
:global(:root.dark) .automations-storage dt,
:global(:root.dark) .automations-run-item dt,
:global(:root.dark) .automations-run-item dd,
:global(:root.dark) .automations-run-inbox p,
:global(:root.dark) .automations-run-summary p,
:global(:root.dark) .automations-card-title span,
:global(:root.dark) .automations-card-grid small,
:global(:root.dark) .automations-card-label {
  color: #94a3b8;
}

:global(:root.dark) .automations-list {
  border-right-color: rgba(71, 85, 105, 0.72);
}

:global(:root.dark) .automations-card,
:global(:root.dark) .automations-runs,
:global(:root.dark) .automations-advanced {
  border-color: rgba(71, 85, 105, 0.72);
  background: rgba(2, 6, 23, 0.42);
  color: #e5e7eb;
}

:global(:root.dark) .automations-compact-header {
  border-bottom-color: rgba(71, 85, 105, 0.72);
  background: rgba(15, 23, 42, 0.94);
}

:global(:root.dark) .automations-card[data-active='true'] {
  border-color: rgba(96, 165, 250, 0.72);
  background: rgba(59, 130, 246, 0.16);
}

:global(:root.dark) .automations-field input,
:global(:root.dark) .automations-field textarea,
:global(:root.dark) .automations-field select,
:global(:root.dark) .automations-compact-control input,
:global(:root.dark) .automations-compact-control textarea,
:global(:root.dark) .automations-compact-control select,
:global(:root.dark) .automations-page button {
  border-color: rgba(71, 85, 105, 0.82);
  background: rgba(2, 6, 23, 0.7);
  color: #e5e7eb;
  color-scheme: dark;
}

:global(:root.dark) .automations-field select option {
  background: #020617;
  color: #e5e7eb;
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
:global(:root.dark) .automations-diagnostic-severity,
:global(:root.dark) .automations-manual-disabled {
  color: #fbbf24;
}

:global(:root.dark) .automations-run-compact-main strong,
:global(:root.dark) .automations-compact-row > strong,
:global(:root.dark) .automations-run-inbox,
:global(:root.dark) .automations-run-summary,
:global(:root.dark) .automations-runs > summary,
:global(:root.dark) .automations-advanced summary,
:global(:root.dark) .automations-storage dd {
  color: #e5e7eb;
}

:global(:root.dark) .automations-manual-disabled {
  border-color: rgba(251, 191, 36, 0.32);
  background: rgba(245, 158, 11, 0.12);
}

@media (max-width: 980px) {
  .automations-summary,
  .automations-workspace {
    grid-template-columns: 1fr;
  }

  .automations-workspace {
    flex: 0 0 auto;
    overflow: visible;
  }

  .automations-list,
  .automations-editor {
    max-height: none;
    overflow: visible;
  }

  .automations-list {
    border-right: 0;
    border-bottom: 1px solid rgba(148, 163, 184, 0.28);
  }
}

@media (max-width: 720px) {
  .automations-card-grid,
  .automations-schedule-builder,
  .automations-execution-settings {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 640px) {
  .automations-page {
    padding: 12px;
  }

  .automations-card-header,
  .automations-editor-header {
    align-items: flex-start;
    flex-direction: column;
  }

  .automations-field-grid {
    grid-template-columns: 1fr;
  }

  .automations-field input,
  .automations-field textarea,
  .automations-field select,
  .automations-compact-control input,
  .automations-compact-control textarea,
  .automations-compact-control select {
    font-size: 16px;
    line-height: 1.4;
  }

  .automations-compact-header {
    position: static;
    align-items: stretch;
  }

  .automations-editor-actions-top {
    justify-content: flex-start;
  }

  .automations-run-now-button,
  .automations-editor-actions-top .automations-primary {
    flex: 1 1 132px;
  }

  .automations-compact-row {
    grid-template-columns: minmax(92px, 0.58fr) minmax(0, 1fr);
  }

  .automations-compact-control input,
  .automations-compact-control textarea,
  .automations-compact-control select {
    max-width: 100%;
  }

  .automations-run-compact-main {
    grid-template-columns: 14px minmax(0, 1fr) minmax(36px, auto);
  }

  .automations-run-compact-main > span:not(.automations-run-state-dot) {
    display: none;
  }

  .automations-storage div,
  .automations-run-item dl div {
    grid-template-columns: 1fr;
  }
}
</style>
