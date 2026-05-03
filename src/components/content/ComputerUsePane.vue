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
      <div v-if="state?.screenshot" class="computer-use-pane-image-wrap">
        <img
          :src="state.screenshot.dataUrl"
          alt="Computer Use screenshot"
          @pointerup="onScreenshotPointerUp"
        />
        <span
          v-if="lastAction?.x !== undefined && lastAction?.y !== undefined"
          class="computer-use-pane-action-marker"
          :style="lastActionMarkerStyle"
          aria-hidden="true"
        ></span>
      </div>
      <p v-else class="computer-use-pane-empty">Select a target and refresh state.</p>
    </section>

    <section class="computer-use-pane-controls">
      <div class="computer-use-pane-mode-control" role="group" aria-label="Computer Use mode">
        <button type="button" :aria-pressed="actionMode === 'tap'" @click="actionMode = 'tap'">Tap</button>
        <button type="button" :aria-pressed="actionMode === 'scroll'" @click="actionMode = 'scroll'">Scroll</button>
        <button type="button" :aria-pressed="actionMode === 'drag'" @click="actionMode = 'drag'">Drag</button>
        <button type="button" :aria-pressed="actionMode === 'element'" @click="actionMode = 'element'">Element</button>
      </div>

      <p v-if="actionError" class="computer-use-pane-error">{{ actionError }}</p>

      <div class="computer-use-pane-scroll-buttons">
        <button type="button" :disabled="actionsDisabled" @click="runScroll('up')">Scroll Up</button>
        <button type="button" :disabled="actionsDisabled" @click="runScroll('down')">Scroll Down</button>
      </div>

      <form class="computer-use-pane-text-row" @submit.prevent="sendText">
        <input v-model="textDraft" type="text" placeholder="Text" :disabled="actionsDisabled" />
        <button type="submit" :disabled="actionsDisabled || textDraft.length === 0">Send</button>
      </form>

      <div class="computer-use-pane-key-grid">
        <button v-for="key in commonKeys" :key="key" type="button" :disabled="actionsDisabled" @click="pressKey(key)">
          {{ key }}
        </button>
      </div>

      <button class="computer-use-pane-refresh-state" type="button" :disabled="isLoading" @click="refreshState">
        Refresh State
      </button>
    </section>

    <section v-if="actionMode === 'element'" class="computer-use-pane-nodes">
      <div class="computer-use-pane-node-header">
        <span>Accessibility</span>
        <span>{{ state?.nodes.length ?? 0 }}</span>
      </div>
      <input v-model="nodeFilterText" class="computer-use-pane-search" type="text" placeholder="Search nodes" />
      <div class="computer-use-pane-node-list">
        <button
          v-for="node in filteredNodes"
          :key="node.id"
          type="button"
          class="computer-use-pane-node"
          :class="{ 'is-selected': node.id === selectedNodeId }"
          @click="selectedNodeId = node.id"
        >
          <span>{{ node.role }}</span>
          <strong>{{ node.name || node.value || node.id }}</strong>
        </button>
      </div>
      <div class="computer-use-pane-node-actions">
        <button type="button" :disabled="actionsDisabled || !selectedNodeId" @click="performSelectedNodeAction">Click Node</button>
        <button type="button" :disabled="actionsDisabled || !selectedNodeId || textDraft.length === 0" @click="setSelectedNodeValue">Set Value</button>
      </div>
    </section>
  </aside>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import {
  computerUseClick,
  computerUseDrag,
  computerUsePerformAction,
  computerUsePressKey,
  computerUseScroll,
  computerUseSetValue,
  computerUseTypeText,
  getComputerUseApps,
  getComputerUseState,
  getComputerUseStatus,
  getComputerUseWindows,
  mapComputerUseClientPointToScreenshotPoint,
} from '../../api/codexGateway'
import type {
  UiComputerUseActionResult,
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
  pid: number | null
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
const actionMode = ref<'tap' | 'scroll' | 'drag' | 'element'>('tap')
const textDraft = ref('')
const selectedNodeId = ref('')
const nodeFilterText = ref('')
const lastAction = ref<{ kind: string, x?: number, y?: number, atIso: string } | null>(null)
const dragStart = ref<{ x: number, y: number } | null>(null)
const actionError = ref('')
const isActionRunning = ref(false)
const commonKeys = ['Enter', 'Escape', 'Tab', 'Backspace', 'Ctrl+L', 'Ctrl+C', 'Ctrl+V']
const actionRefreshDelaysMs = [350, 650, 1000]

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
      pid: window.pid,
    }))
  }
  return apps.value.map((app) => ({
    id: app.id,
    kind: 'apps',
    label: app.name,
    meta: app.pid ? `pid ${app.pid}` : '',
    pid: app.pid,
  }))
})

const filteredTargets = computed(() => {
  const query = filterText.value.trim().toLowerCase()
  if (!query) return targets.value
  return targets.value.filter((target) => `${target.label} ${target.meta}`.toLowerCase().includes(query))
})

const selectedTarget = computed(() => targets.value.find((target) => target.id === selectedTargetId.value) ?? null)
const actionsDisabled = computed(() => isActionRunning.value || status.value?.readiness === 'unavailable' || !state.value?.screenshot)
const lastActionMarkerStyle = computed(() => {
  if (!lastAction.value || !state.value?.screenshot || lastAction.value.x === undefined || lastAction.value.y === undefined) return {}
  return {
    left: `${(lastAction.value.x / state.value.screenshot.width) * 100}%`,
    top: `${(lastAction.value.y / state.value.screenshot.height) * 100}%`,
  }
})
const filteredNodes = computed(() => {
  const nodes = state.value?.nodes ?? []
  const query = nodeFilterText.value.trim().toLowerCase()
  if (!query) return nodes
  return nodes.filter((node) => `${node.role} ${node.name} ${node.value ?? ''}`.toLowerCase().includes(query))
})

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
    const [nextApps, nextWindows] = await Promise.all([
      getComputerUseApps(),
      getComputerUseWindows(),
    ])
    apps.value = nextApps
    windows.value = nextWindows
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
    appName: selected.kind === 'apps' && selected.pid === null ? selected.label : undefined,
    pid: selected.kind === 'apps' ? selected.pid ?? undefined : undefined,
    windowId: selected.kind === 'windows' ? selected.id : undefined,
    includeScreenshot: true,
    maxNodes: 250,
    maxDepth: 8,
  })
  selectedNodeId.value = ''
}

function waitForActionRefresh(delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, delayMs)
  })
}

async function refreshStateAfterAction(): Promise<void> {
  let lastRefreshError: unknown = null
  for (const delayMs of actionRefreshDelaysMs) {
    await waitForActionRefresh(delayMs)
    try {
      await refreshState()
      return
    } catch (error) {
      lastRefreshError = error
    }
  }
  throw lastRefreshError
}

function selectTarget(id: string): void {
  selectedTargetId.value = id
  void refreshState().catch((error: unknown) => {
    errorMessage.value = error instanceof Error ? error.message : 'Failed to load Computer Use state'
  })
}

function buildTargetPayload(): Record<string, unknown> {
  const selected = selectedTarget.value
  if (!selected) return {}
  return {
    appName: selected.kind === 'apps' && selected.pid === null ? selected.label : undefined,
    pid: selected.kind === 'apps' ? selected.pid ?? undefined : undefined,
    windowId: selected.kind === 'windows' ? selected.id : undefined,
  }
}

async function runAction(action: () => Promise<UiComputerUseActionResult>): Promise<UiComputerUseActionResult | null> {
  if (actionsDisabled.value) return null
  isActionRunning.value = true
  actionError.value = ''
  try {
    const result = await action()
    if (!result.ok) throw new Error(result.error || `Computer Use action failed: ${result.tool}`)
    await refreshStateAfterAction().catch((error: unknown) => {
      actionError.value = error instanceof Error ? error.message : 'Failed to refresh Computer Use state'
    })
    return result
  } catch (error) {
    actionError.value = error instanceof Error ? error.message : 'Computer Use action failed'
    return null
  } finally {
    isActionRunning.value = false
  }
}

async function onScreenshotPointerUp(event: PointerEvent): Promise<void> {
  if ((actionMode.value !== 'tap' && actionMode.value !== 'drag') || !state.value?.screenshot) return
  const image = event.currentTarget as HTMLImageElement
  const { x, y } = mapComputerUseClientPointToScreenshotPoint({
    clientX: event.clientX,
    clientY: event.clientY,
    rect: image.getBoundingClientRect(),
    screenshot: state.value.screenshot,
  })

  if (actionMode.value === 'drag') {
    if (!dragStart.value) {
      dragStart.value = { x, y }
      lastAction.value = { kind: 'drag-start', x, y, atIso: new Date().toISOString() }
      return
    }
    const start = dragStart.value
    dragStart.value = null
    await runAction(() => computerUseDrag({ ...buildTargetPayload(), startX: start.x, startY: start.y, endX: x, endY: y }))
    lastAction.value = { kind: 'drag', x, y, atIso: new Date().toISOString() }
    return
  }

  await runAction(() => computerUseClick({ ...buildTargetPayload(), x, y, button: 'left', clickCount: 1 }))
  lastAction.value = { kind: 'click', x, y, atIso: new Date().toISOString() }
}

async function runScroll(direction: 'up' | 'down'): Promise<void> {
  const screenshot = state.value?.screenshot
  if (!screenshot) return
  const x = Math.round(screenshot.width / 2)
  const y = Math.round(screenshot.height / 2)
  await runAction(() => computerUseScroll({ ...buildTargetPayload(), x, y, direction, pages: 1 }))
  lastAction.value = { kind: `scroll-${direction}`, x, y, atIso: new Date().toISOString() }
}

async function sendText(): Promise<void> {
  const text = textDraft.value
  if (!text) return
  const result = await runAction(() => computerUseTypeText({ ...buildTargetPayload(), text }))
  if (result) textDraft.value = ''
}

async function pressKey(key: string): Promise<void> {
  await runAction(() => computerUsePressKey({ ...buildTargetPayload(), key }))
}

async function performSelectedNodeAction(): Promise<void> {
  if (!selectedNodeId.value) return
  await runAction(() => computerUsePerformAction({ nodeId: selectedNodeId.value, action: 'click' }))
}

async function setSelectedNodeValue(): Promise<void> {
  if (!selectedNodeId.value || !textDraft.value) return
  await runAction(() => computerUseSetValue({ nodeId: selectedNodeId.value, value: textDraft.value }))
}

watch(selectedTargetKind, () => {
  selectedTargetId.value = ''
  state.value = null
  selectedNodeId.value = ''
  dragStart.value = null
})

watch(actionMode, () => {
  dragStart.value = null
  actionError.value = ''
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
.computer-use-pane-tabs button,
.computer-use-pane-mode-control button,
.computer-use-pane-scroll-buttons button,
.computer-use-pane-text-row button,
.computer-use-pane-key-grid button,
.computer-use-pane-refresh-state,
.computer-use-pane-node-actions button {
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
  position: relative;
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

.computer-use-pane-image-wrap {
  position: relative;
  display: inline-flex;
  max-height: min(58vh, 42rem);
  max-width: 100%;
}

.computer-use-pane-viewport img {
  max-height: min(58vh, 42rem);
  max-width: 100%;
  object-fit: contain;
  touch-action: none;
  user-select: none;
}

.computer-use-pane-action-marker {
  position: absolute;
  width: 0.8rem;
  height: 0.8rem;
  border: 2px solid rgb(14 165 233);
  border-radius: 999px;
  box-shadow: 0 0 0 3px rgb(14 165 233 / 0.25);
  transform: translate(-50%, -50%);
  pointer-events: none;
}

.computer-use-pane-controls,
.computer-use-pane-nodes {
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
  border: 1px solid rgb(228 228 231);
  border-radius: 0.375rem;
  background: white;
  padding: 0.65rem;
}

.computer-use-pane-mode-control,
.computer-use-pane-scroll-buttons,
.computer-use-pane-key-grid,
.computer-use-pane-node-actions {
  display: grid;
  gap: 0.4rem;
}

.computer-use-pane-mode-control {
  grid-template-columns: repeat(4, minmax(0, 1fr));
}

.computer-use-pane-scroll-buttons,
.computer-use-pane-node-actions {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.computer-use-pane-key-grid {
  grid-template-columns: repeat(auto-fit, minmax(4.5rem, 1fr));
}

.computer-use-pane-mode-control button,
.computer-use-pane-scroll-buttons button,
.computer-use-pane-text-row button,
.computer-use-pane-key-grid button,
.computer-use-pane-refresh-state,
.computer-use-pane-node-actions button {
  border: 1px solid rgb(212 212 216);
  background: white;
  color: rgb(63 63 70);
}

.computer-use-pane-mode-control button[aria-pressed='true'] {
  border-color: rgb(37 99 235);
  background: rgb(37 99 235);
  color: white;
}

.computer-use-pane-text-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 0.45rem;
}

.computer-use-pane-text-row input {
  min-width: 0;
  border: 1px solid rgb(212 212 216);
  border-radius: 0.375rem;
  background: white;
  padding: 0.5rem 0.6rem;
  color: rgb(39 39 42);
}

.computer-use-pane-node-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 0.78rem;
  font-weight: 700;
  text-transform: uppercase;
  color: rgb(82 82 91);
}

.computer-use-pane-node-list {
  display: flex;
  max-height: 12rem;
  flex-direction: column;
  gap: 0.35rem;
  overflow-y: auto;
}

.computer-use-pane-node {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.15rem;
  border: 1px solid rgb(228 228 231);
  border-radius: 0.375rem;
  background: white;
  padding: 0.5rem 0.6rem;
  text-align: left;
  color: rgb(39 39 42);
}

.computer-use-pane-node.is-selected {
  border-color: rgb(37 99 235);
  background: rgb(239 246 255);
}

.computer-use-pane-node span {
  font-size: 0.72rem;
  color: rgb(113 113 122);
}

.computer-use-pane-node strong {
  max-width: 100%;
  overflow-wrap: anywhere;
  font-size: 0.8rem;
}

button:disabled,
input:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}
</style>
