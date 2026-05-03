<template>
  <aside class="computer-use-pane" aria-label="Computer Use">
    <header class="computer-use-pane-header">
      <div>
        <p class="computer-use-pane-title">Computer Use</p>
        <p class="computer-use-pane-subtitle">{{ statusSubtitle }}</p>
      </div>
      <button class="computer-use-pane-close" type="button" aria-label="Close Computer Use" @click="emit('close')">
        <IconTablerX />
      </button>
    </header>

    <section class="computer-use-pane-status" :class="`is-${status?.readiness ?? 'unavailable'}`">
      <span>{{ status?.readiness ?? 'unavailable' }}</span>
      <button type="button" :disabled="isLoading" @click="refreshAll">
        {{ isLoading ? 'Refreshing' : 'Refresh' }}
      </button>
    </section>

    <p v-if="errorMessage" class="computer-use-pane-error">{{ errorMessage }}</p>

    <section class="computer-use-pane-targets">
      <div class="computer-use-pane-tabs">
        <button type="button" :aria-pressed="selectedTargetKind === 'apps'" @click="selectedTargetKind = 'apps'">Apps</button>
        <button type="button" :aria-pressed="selectedTargetKind === 'windows'" @click="selectedTargetKind = 'windows'">Windows</button>
      </div>
      <input v-model="filterText" class="computer-use-pane-search" type="text" placeholder="Search targets" />
      <div class="computer-use-pane-target-list">
        <button
          v-for="target in filteredTargets"
          :key="target.id"
          class="computer-use-pane-target"
          :class="{ 'is-selected': target.id === selectedTargetId }"
          type="button"
          @click="selectTarget(target.id)"
        >
          <span class="computer-use-pane-target-label">{{ target.label }}</span>
          <span v-if="target.meta" class="computer-use-pane-target-meta">{{ target.meta }}</span>
        </button>
        <p v-if="filteredTargets.length === 0" class="computer-use-pane-empty">No targets found.</p>
      </div>
    </section>

    <section class="computer-use-pane-viewport">
      <img v-if="state?.screenshot" :src="state.screenshot.dataUrl" alt="Computer Use screenshot" />
      <p v-else class="computer-use-pane-empty">Select a target and refresh state.</p>
    </section>
  </aside>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import {
  getComputerUseApps,
  getComputerUseState,
  getComputerUseStatus,
  getComputerUseWindows,
} from '../../api/codexGateway'
import type {
  UiComputerUseApp,
  UiComputerUseState,
  UiComputerUseStatus,
  UiComputerUseWindow,
} from '../../types/codex'
import IconTablerX from '../icons/IconTablerX.vue'

type TargetKind = 'apps' | 'windows'

type PaneTarget = {
  id: string
  kind: TargetKind
  label: string
  meta: string
}

const props = defineProps<{
  threadId: string
  cwd: string
}>()

const emit = defineEmits<{ close: [] }>()
const status = ref<UiComputerUseStatus | null>(null)
const apps = ref<UiComputerUseApp[]>([])
const windows = ref<UiComputerUseWindow[]>([])
const state = ref<UiComputerUseState | null>(null)
const selectedTargetKind = ref<TargetKind>('apps')
const selectedTargetId = ref('')
const filterText = ref('')
const errorMessage = ref('')
const isLoading = ref(false)

const statusSubtitle = computed(() => {
  if (!status.value) return props.cwd || props.threadId
  if (status.value.disabled) return 'Disabled'
  if (!status.value.binaryExecutable) return status.value.binaryPath || 'Binary unavailable'
  return `${status.value.toolCount} tools · ${status.value.binarySource || 'resolved'}`
})

const targets = computed<PaneTarget[]>(() => {
  if (selectedTargetKind.value === 'windows') {
    return windows.value.map((window) => ({
      id: window.id,
      kind: 'windows',
      label: window.title || window.id,
      meta: [window.appName, window.wmClass, window.pid ? `pid ${window.pid}` : ''].filter(Boolean).join(' · '),
    }))
  }
  return apps.value.map((app) => ({
    id: app.id,
    kind: 'apps',
    label: app.name,
    meta: app.pid ? `pid ${app.pid}` : '',
  }))
})

const filteredTargets = computed(() => {
  const query = filterText.value.trim().toLowerCase()
  if (!query) return targets.value
  return targets.value.filter((target) => `${target.label} ${target.meta}`.toLowerCase().includes(query))
})

const selectedTarget = computed(() => targets.value.find((target) => target.id === selectedTargetId.value) ?? null)

async function refreshAll(): Promise<void> {
  isLoading.value = true
  errorMessage.value = ''
  try {
    status.value = await getComputerUseStatus()
    if (status.value.readiness === 'unavailable') {
      apps.value = []
      windows.value = []
      state.value = null
      return
    }
    apps.value = await getComputerUseApps()
    windows.value = await getComputerUseWindows()
    if (selectedTargetId.value) await refreshState()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : 'Failed to load Computer Use'
  } finally {
    isLoading.value = false
  }
}

async function refreshState(): Promise<void> {
  const selected = selectedTarget.value
  if (!selected) return
  state.value = await getComputerUseState({
    appName: selected.kind === 'apps' ? selected.label : undefined,
    windowId: selected.kind === 'windows' ? selected.id : undefined,
    includeScreenshot: true,
    maxNodes: 250,
    maxDepth: 8,
  })
}

function selectTarget(id: string): void {
  selectedTargetId.value = id
  void refreshState().catch((error: unknown) => {
    errorMessage.value = error instanceof Error ? error.message : 'Failed to load Computer Use state'
  })
}

watch(selectedTargetKind, () => {
  selectedTargetId.value = ''
  state.value = null
})

onMounted(() => {
  void refreshAll()
})
</script>

<style scoped>
.computer-use-pane {
  display: flex;
  min-height: 0;
  flex: 1;
  flex-direction: column;
  gap: 0.75rem;
  overflow: hidden;
  border: 1px solid rgb(228 228 231);
  background: rgb(250 250 250);
  padding: 0.75rem;
  color: rgb(39 39 42);
}

.computer-use-pane-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.75rem;
}

.computer-use-pane-title,
.computer-use-pane-subtitle,
.computer-use-pane-empty,
.computer-use-pane-error {
  margin: 0;
}

.computer-use-pane-title {
  font-size: 0.95rem;
  font-weight: 700;
}

.computer-use-pane-subtitle,
.computer-use-pane-target-meta,
.computer-use-pane-empty {
  font-size: 0.78rem;
  color: rgb(113 113 122);
}

.computer-use-pane-close,
.computer-use-pane-status button,
.computer-use-pane-tabs button {
  border: 1px solid rgb(212 212 216);
  background: white;
  color: rgb(63 63 70);
}

.computer-use-pane-close {
  display: inline-flex;
  height: 2rem;
  width: 2rem;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  border-radius: 0.375rem;
}

.computer-use-pane-status {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  border: 1px solid rgb(228 228 231);
  background: white;
  padding: 0.6rem 0.7rem;
  font-size: 0.78rem;
  font-weight: 700;
  text-transform: uppercase;
}

.computer-use-pane-status.is-ready {
  border-color: rgb(167 243 208);
  color: rgb(4 120 87);
}

.computer-use-pane-status.is-limited {
  border-color: rgb(253 230 138);
  color: rgb(180 83 9);
}

.computer-use-pane-status.is-unavailable {
  border-color: rgb(254 205 211);
  color: rgb(190 18 60);
}

.computer-use-pane-status button,
.computer-use-pane-tabs button {
  border-radius: 0.375rem;
  padding: 0.35rem 0.55rem;
  font-size: 0.78rem;
  font-weight: 650;
}

.computer-use-pane-error {
  border: 1px solid rgb(254 205 211);
  background: rgb(255 241 242);
  padding: 0.55rem 0.65rem;
  font-size: 0.78rem;
  color: rgb(190 18 60);
}

.computer-use-pane-targets {
  display: flex;
  min-height: 8rem;
  flex-direction: column;
  gap: 0.5rem;
}

.computer-use-pane-tabs {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.4rem;
}

.computer-use-pane-tabs button[aria-pressed='true'] {
  border-color: rgb(24 24 27);
  background: rgb(24 24 27);
  color: white;
}

.computer-use-pane-search {
  width: 100%;
  border: 1px solid rgb(212 212 216);
  border-radius: 0.375rem;
  background: white;
  padding: 0.55rem 0.65rem;
  font-size: 0.85rem;
  color: rgb(39 39 42);
  outline: none;
}

.computer-use-pane-target-list {
  display: flex;
  min-height: 0;
  max-height: 13rem;
  flex-direction: column;
  gap: 0.35rem;
  overflow-y: auto;
}

.computer-use-pane-target {
  display: flex;
  width: 100%;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.15rem;
  border: 1px solid rgb(228 228 231);
  border-radius: 0.375rem;
  background: white;
  padding: 0.55rem 0.65rem;
  text-align: left;
  color: rgb(39 39 42);
}

.computer-use-pane-target.is-selected {
  border-color: rgb(37 99 235);
  background: rgb(239 246 255);
}

.computer-use-pane-target-label {
  max-width: 100%;
  overflow-wrap: anywhere;
  font-size: 0.84rem;
  font-weight: 650;
}

.computer-use-pane-viewport {
  display: flex;
  min-height: 14rem;
  flex: 1;
  align-items: center;
  justify-content: center;
  overflow: auto;
  border: 1px solid rgb(228 228 231);
  border-radius: 0.375rem;
  background: white;
  padding: 0.5rem;
}

.computer-use-pane-viewport img {
  max-height: min(58vh, 42rem);
  max-width: 100%;
  object-fit: contain;
}
</style>
