<template>
  <div ref="rootRef" class="automation-thread-picker">
    <button
      class="automation-thread-picker-trigger"
      type="button"
      :aria-expanded="isOpen"
      :aria-required="required"
      :disabled="disabled"
      @click="togglePicker"
    >
      <span class="automation-thread-picker-value">
        <span>{{ selectedThreadLabel }}</span>
        <small>{{ selectedThreadDetail }}</small>
      </span>
      <IconTablerChevronDown class="automation-thread-picker-chevron" />
    </button>

    <div v-if="isOpen" class="automation-thread-picker-panel">
      <div class="automation-thread-picker-controls">
        <label>
          <span>Search chats</span>
          <input
            ref="searchRef"
            v-model="searchQuery"
            type="search"
            placeholder="Title, project, or thread id"
            @keydown.escape.prevent="closePicker"
          />
        </label>

        <label>
          <span>Project</span>
          <select v-model="selectedProject">
            <option value="">All projects</option>
            <option v-for="project in projectOptions" :key="project" :value="project">
              {{ project }}
            </option>
          </select>
        </label>
      </div>

      <p v-if="loadError" class="automation-thread-picker-error" role="alert">{{ loadError }}</p>
      <p v-else-if="isLoadingInitial" class="automation-thread-picker-empty">Loading chats...</p>
      <p v-else-if="groupedRows.length === 0" class="automation-thread-picker-empty">No matching chats</p>

      <div v-else class="automation-thread-picker-results">
        <section v-for="group in groupedRows" :key="group.projectName">
          <h4>{{ group.projectName }}</h4>
          <button
            v-for="thread in group.threads"
            :key="thread.id"
            class="automation-thread-picker-row"
            type="button"
            :data-selected="thread.id === modelValue"
            :data-unavailable="isThreadUnavailable(thread.id)"
            :disabled="isThreadUnavailable(thread.id)"
            @click="selectThread(thread.id)"
          >
            <span>
              <strong>{{ thread.title }}</strong>
              <small v-if="isThreadUnavailable(thread.id)" class="automation-thread-picker-unavailable">
                Already has an active heartbeat
              </small>
              <small v-else>{{ thread.preview || thread.id }}</small>
            </span>
            <time>{{ formatThreadDate(thread.updatedAtIso) }}</time>
          </button>
        </section>
      </div>

      <button
        v-if="nextCursor"
        class="automation-thread-picker-load-more"
        type="button"
        :disabled="isLoadingMore"
        @click="loadNextPage"
      >
        {{ isLoadingMore ? 'Loading...' : 'Load more chats' }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { getThreadGroupsPage, getThreadTitleCache, searchThreads } from '../../api/codexGateway'
import type { UiProjectGroup, UiThread } from '../../types/codex'
import IconTablerChevronDown from '../icons/IconTablerChevronDown.vue'

type PickerThread = Pick<UiThread, 'id' | 'title' | 'projectName' | 'cwd' | 'updatedAtIso' | 'preview'>

const props = defineProps<{
  modelValue: string
  disabled?: boolean
  required?: boolean
  unavailableThreadIds?: string[]
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const rootRef = ref<HTMLElement | null>(null)
const searchRef = ref<HTMLInputElement | null>(null)
const isOpen = ref(false)
const isLoadingInitial = ref(false)
const isLoadingMore = ref(false)
const hasLoadedInitial = ref(false)
const nextCursor = ref<string | null>(null)
const loadError = ref('')
const searchQuery = ref('')
const selectedProject = ref('')
const groups = ref<UiProjectGroup[]>([])
const titleCache = ref<Record<string, string>>({})
const searchResultIds = ref<string[] | null>(null)
let searchTimer: number | null = null
let searchRequestId = 0

const knownThreads = computed<PickerThread[]>(() =>
  groups.value.flatMap((group) =>
    group.threads.map((thread) => ({
      id: thread.id,
      title: thread.title,
      projectName: group.projectName,
      cwd: thread.cwd,
      updatedAtIso: thread.updatedAtIso,
      preview: thread.preview,
    })),
  ),
)

const knownThreadById = computed(() => new Map(knownThreads.value.map((thread) => [thread.id, thread])))
const unavailableThreadIdSet = computed(() => new Set(props.unavailableThreadIds ?? []))

const selectedThread = computed(() => {
  const threadId = props.modelValue.trim()
  if (!threadId) return null
  const known = knownThreadById.value.get(threadId)
  if (known) return known
  return {
    id: threadId,
    title: titleCache.value[threadId] || threadId,
    projectName: 'Manual thread ID',
    cwd: '',
    updatedAtIso: '',
    preview: '',
  }
})

const selectedThreadLabel = computed(() => selectedThread.value?.title || 'Select a chat thread')
const selectedThreadDetail = computed(() => {
  if (!selectedThread.value) return 'Filter by project and chat title'
  return selectedThread.value.projectName
})

const projectOptions = computed(() =>
  Array.from(new Set(knownThreads.value.map((thread) => thread.projectName).filter(Boolean))).sort((a, b) =>
    a.localeCompare(b),
  ),
)

const searchRows = computed<PickerThread[]>(() => {
  const query = searchQuery.value.trim().toLowerCase()
  const known = knownThreads.value
  if (searchResultIds.value) {
    const rows = searchResultIds.value.flatMap((threadId) => {
      const knownThread = knownThreadById.value.get(threadId)
      if (knownThread) return [knownThread]
      const title = titleCache.value[threadId]
      return title
        ? [{
            id: threadId,
            title,
            projectName: 'Search results',
            cwd: '',
            updatedAtIso: '',
            preview: threadId,
          }]
        : []
    })
    return dedupeThreads(rows)
  }
  if (!query) return known
  return known.filter((thread) =>
    thread.title.toLowerCase().includes(query) ||
    thread.projectName.toLowerCase().includes(query) ||
    thread.preview.toLowerCase().includes(query) ||
    thread.id.toLowerCase().includes(query),
  )
})

const filteredRows = computed(() => {
  const project = selectedProject.value
  return project
    ? searchRows.value.filter((thread) => thread.projectName === project)
    : searchRows.value
})

const groupedRows = computed(() => {
  const grouped = new Map<string, PickerThread[]>()
  for (const thread of filteredRows.value) {
    const projectName = thread.projectName || 'No project'
    const rows = grouped.get(projectName)
    if (rows) rows.push(thread)
    else grouped.set(projectName, [thread])
  }
  return Array.from(grouped.entries()).map(([projectName, threads]) => ({
    projectName,
    threads,
  }))
})

watch(searchQuery, (value) => {
  if (searchTimer !== null) {
    window.clearTimeout(searchTimer)
    searchTimer = null
  }
  const query = value.trim()
  searchRequestId += 1
  searchResultIds.value = null
  if (query.length < 2) {
    return
  }
  searchTimer = window.setTimeout(() => {
    void runIndexedSearch(query)
  }, 250)
})

watch(projectOptions, (options) => {
  if (selectedProject.value && !options.includes(selectedProject.value)) {
    selectedProject.value = ''
  }
})

onMounted(() => {
  document.addEventListener('pointerdown', onDocumentPointerDown)
})

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onDocumentPointerDown)
  if (searchTimer !== null) window.clearTimeout(searchTimer)
})

function togglePicker(): void {
  if (props.disabled) return
  isOpen.value = !isOpen.value
  if (isOpen.value) {
    void ensureLoaded()
    void nextTick(() => searchRef.value?.focus())
  }
}

function closePicker(): void {
  isOpen.value = false
}

function selectThread(threadId: string): void {
  if (isThreadUnavailable(threadId)) return
  emit('update:modelValue', threadId)
  closePicker()
}

function isThreadUnavailable(threadId: string): boolean {
  return threadId !== props.modelValue && unavailableThreadIdSet.value.has(threadId)
}

async function ensureLoaded(): Promise<void> {
  if (hasLoadedInitial.value || isLoadingInitial.value) return
  isLoadingInitial.value = true
  loadError.value = ''
  try {
    const [page, cache] = await Promise.all([
      getThreadGroupsPage(null, 100),
      getThreadTitleCache(),
    ])
    groups.value = mergeThreadGroups([], page.groups)
    nextCursor.value = page.nextCursor
    titleCache.value = cache.titles
    hasLoadedInitial.value = true
  } catch (error) {
    loadError.value = error instanceof Error ? error.message : 'Failed to load chats'
  } finally {
    isLoadingInitial.value = false
  }
}

async function loadNextPage(): Promise<void> {
  if (!nextCursor.value || isLoadingMore.value) return
  isLoadingMore.value = true
  loadError.value = ''
  try {
    const page = await getThreadGroupsPage(nextCursor.value, 100)
    groups.value = mergeThreadGroups(groups.value, page.groups)
    nextCursor.value = page.nextCursor
  } catch (error) {
    loadError.value = error instanceof Error ? error.message : 'Failed to load more chats'
  } finally {
    isLoadingMore.value = false
  }
}

async function runIndexedSearch(query: string): Promise<void> {
  const requestId = ++searchRequestId
  try {
    const [results, cache] = await Promise.all([
      searchThreads(query, 200),
      Object.keys(titleCache.value).length === 0 ? getThreadTitleCache() : Promise.resolve({ titles: titleCache.value, order: [] }),
    ])
    if (requestId !== searchRequestId) return
    titleCache.value = { ...titleCache.value, ...cache.titles }
    searchResultIds.value = results.threadIds
  } catch {
    if (requestId === searchRequestId) searchResultIds.value = null
  }
}

function mergeThreadGroups(existing: UiProjectGroup[], incoming: UiProjectGroup[]): UiProjectGroup[] {
  const byProject = new Map<string, UiThread[]>()
  for (const group of [...existing, ...incoming]) {
    const rows = byProject.get(group.projectName) ?? []
    const seen = new Set(rows.map((thread) => thread.id))
    for (const thread of group.threads) {
      if (!seen.has(thread.id)) {
        rows.push(thread)
        seen.add(thread.id)
      }
    }
    byProject.set(group.projectName, rows)
  }
  return Array.from(byProject.entries()).map(([projectName, threads]) => ({
    projectName,
    threads: threads.sort(compareThreadsByUpdatedAt),
  }))
}

function compareThreadsByUpdatedAt(a: UiThread, b: UiThread): number {
  const aTime = parseSortableTimestamp(a.updatedAtIso)
  const bTime = parseSortableTimestamp(b.updatedAtIso)
  if (aTime !== bTime) return bTime - aTime
  return a.id.localeCompare(b.id)
}

function parseSortableTimestamp(value: string): number {
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? timestamp : 0
}

function dedupeThreads(threads: PickerThread[]): PickerThread[] {
  const seen = new Set<string>()
  const rows: PickerThread[] = []
  for (const thread of threads) {
    if (seen.has(thread.id)) continue
    seen.add(thread.id)
    rows.push(thread)
  }
  return rows
}

function formatThreadDate(value: string): string {
  if (!value) return ''
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) return ''
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(new Date(timestamp))
}

function onDocumentPointerDown(event: PointerEvent): void {
  if (!isOpen.value) return
  const root = rootRef.value
  if (!root || root.contains(event.target as Node)) return
  closePicker()
}
</script>

<style scoped>
.automation-thread-picker {
  position: relative;
  min-width: 0;
}

.automation-thread-picker-trigger {
  display: flex;
  width: 100%;
  min-width: 0;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  border: 1px solid rgba(148, 163, 184, 0.42);
  border-radius: 6px;
  background: #ffffff;
  color: #0f172a;
  font: inherit;
  font-weight: 400;
  padding: 8px 9px;
  text-align: left;
}

.automation-thread-picker-value {
  display: grid;
  min-width: 0;
  gap: 2px;
}

.automation-thread-picker-value span,
.automation-thread-picker-value small,
.automation-thread-picker-row strong,
.automation-thread-picker-row small {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.automation-thread-picker-value small {
  color: #64748b;
  font-size: 11px;
}

.automation-thread-picker-chevron {
  flex: 0 0 auto;
}

.automation-thread-picker-panel {
  position: absolute;
  z-index: 8;
  right: 0;
  left: 0;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  max-height: min(420px, 70vh);
  margin-top: 6px;
  border: 1px solid rgba(148, 163, 184, 0.38);
  border-radius: 8px;
  background: #ffffff;
  box-shadow: 0 18px 42px rgba(15, 23, 42, 0.18);
  color: #0f172a;
  overflow: hidden;
}

.automation-thread-picker-controls {
  display: grid;
  gap: 8px;
  border-bottom: 1px solid rgba(148, 163, 184, 0.2);
  padding: 10px;
}

.automation-thread-picker-controls label {
  display: grid;
  gap: 4px;
  color: #64748b;
  font-size: 11px;
  font-weight: 800;
  text-transform: uppercase;
}

.automation-thread-picker-controls input,
.automation-thread-picker-controls select {
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

.automation-thread-picker-results {
  display: grid;
  min-height: 0;
  gap: 8px;
  padding: 8px 10px;
  overscroll-behavior: contain;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
}

.automation-thread-picker-results h4 {
  margin: 4px 0 2px;
  color: #64748b;
  font-size: 11px;
  text-transform: uppercase;
}

.automation-thread-picker-row {
  display: grid;
  width: 100%;
  min-width: 0;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: #0f172a;
  padding: 8px;
  text-align: left;
}

.automation-thread-picker-row[data-selected='true'] {
  background: rgba(37, 99, 235, 0.12);
}

.automation-thread-picker-row[data-unavailable='true'] {
  cursor: not-allowed;
  opacity: 0.62;
}

.automation-thread-picker-row span {
  display: grid;
  min-width: 0;
  gap: 2px;
}

.automation-thread-picker-row small,
.automation-thread-picker-row time,
.automation-thread-picker-empty {
  color: #64748b;
  font-size: 12px;
}

.automation-thread-picker-unavailable {
  color: #b45309;
  font-weight: 700;
}

.automation-thread-picker-empty,
.automation-thread-picker-error {
  margin: 0;
  padding: 12px;
}

.automation-thread-picker-error {
  color: #b91c1c;
}

.automation-thread-picker-load-more {
  margin: 0 10px 10px;
}

:global(:root.dark) .automation-thread-picker-trigger,
:global(:root.dark) .automation-thread-picker-panel,
:global(:root.dark) .automation-thread-picker-controls input,
:global(:root.dark) .automation-thread-picker-controls select {
  border-color: rgba(71, 85, 105, 0.82);
  background: rgba(2, 6, 23, 0.96);
  color: #e5e7eb;
  color-scheme: dark;
}

:global(:root.dark) .automation-thread-picker-panel {
  box-shadow: 0 18px 42px rgba(0, 0, 0, 0.36);
}

:global(:root.dark) .automation-thread-picker-value small,
:global(:root.dark) .automation-thread-picker-controls label,
:global(:root.dark) .automation-thread-picker-results h4,
:global(:root.dark) .automation-thread-picker-row small,
:global(:root.dark) .automation-thread-picker-row time,
:global(:root.dark) .automation-thread-picker-empty {
  color: #94a3b8;
}

:global(:root.dark) .automation-thread-picker-unavailable {
  color: #f59e0b;
}

:global(:root.dark) .automation-thread-picker-row {
  color: #e5e7eb;
}

:global(:root.dark) .automation-thread-picker-row[data-selected='true'] {
  background: rgba(59, 130, 246, 0.22);
}

@media (max-width: 640px) {
  .automation-thread-picker-panel {
    position: fixed;
    top: max(96px, calc(env(safe-area-inset-top) + 72px));
    right: 12px;
    bottom: max(12px, env(safe-area-inset-bottom));
    left: 12px;
    max-height: none;
    margin-top: 0;
  }

  .automation-thread-picker-trigger,
  .automation-thread-picker-controls input,
  .automation-thread-picker-controls select {
    font-size: 16px;
    line-height: 1.4;
  }
}
</style>
