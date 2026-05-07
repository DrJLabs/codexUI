import { computed, ref, type Ref } from 'vue'
import {
  archiveAutomationRun,
  createAutomation,
  deleteAutomation,
  listAutomationRuns,
  listAutomationTemplates,
  loadAutomationsState,
  markAutomationRunRead,
  pauseAutomation,
  resumeAutomation,
  runAutomationNow,
  unarchiveAutomationRun,
  updateAutomation,
  type CreateAutomationInput,
  type PatchAutomationInput,
} from '../api/automationsGateway'
import type { AutomationDefinition, AutomationDiagnostic, AutomationRun, AutomationRunMode, AutomationsState, AutomationTemplate } from '../types/automations'

export type AutomationDraft = {
  id: string
  mode: 'create' | 'edit'
  name: string
  targetThreadId: string
  prompt: string
  rrule: string
  description: string
  notes: string
  runMode: AutomationRunMode
  cwd: string
  cwds: string[]
  model: string
  reasoningEffort: string
}

export type AutomationsGateway = {
  loadAutomationsState: typeof loadAutomationsState
  listAutomationTemplates: typeof listAutomationTemplates
  createAutomation: typeof createAutomation
  updateAutomation: typeof updateAutomation
  pauseAutomation: typeof pauseAutomation
  resumeAutomation: typeof resumeAutomation
  deleteAutomation: typeof deleteAutomation
  runAutomationNow: typeof runAutomationNow
  listAutomationRuns: typeof listAutomationRuns
  markAutomationRunRead: typeof markAutomationRunRead
  archiveAutomationRun: typeof archiveAutomationRun
  unarchiveAutomationRun: typeof unarchiveAutomationRun
}

type UseAutomationsOptions = {
  gateway?: AutomationsGateway
}

const defaultGateway: AutomationsGateway = {
  loadAutomationsState,
  listAutomationTemplates,
  createAutomation,
  updateAutomation,
  pauseAutomation,
  resumeAutomation,
  deleteAutomation,
  runAutomationNow,
  listAutomationRuns,
  markAutomationRunRead,
  archiveAutomationRun,
  unarchiveAutomationRun,
}

function createEmptyState(): AutomationsState {
  return {
    storageRoot: '',
    featureFlags: {
      scheduler: false,
      manualRun: false,
      kanbanProjection: false,
      artifactIndexing: false,
    },
    sourceCounts: {
      native: 0,
      codexui: 0,
    },
    diagnostics: [],
    definitions: [],
    executionOptions: {
      defaultRunProfileId: 'workspace-coding',
      currentConfigProfileId: null,
      runProfiles: [],
    },
  }
}

function createEmptyDraft(threadId = ''): AutomationDraft {
  return {
    id: '',
    mode: 'create',
    name: 'Thread automation',
    targetThreadId: threadId,
    prompt: '',
    rrule: 'FREQ=DAILY;BYHOUR=9;BYMINUTE=0',
    description: '',
    notes: '',
    runMode: 'chat',
    cwd: '',
    cwds: [],
    model: '',
    reasoningEffort: '',
  }
}

function draftFromDefinition(definition: AutomationDefinition): AutomationDraft {
  return {
    id: definition.id,
    mode: 'edit',
    name: definition.name,
    targetThreadId: definition.targetThreadId ?? '',
    prompt: definition.prompt,
    rrule: definition.schedule.rrule,
    description: definition.description ?? '',
    notes: definition.notes,
    runMode: definition.runMode ?? 'chat',
    cwd: definition.cwd ?? '',
    cwds: definition.cwds,
    model: definition.model ?? '',
    reasoningEffort: definition.reasoningEffort ?? '',
  }
}

function normalizeOptionalNullable(value: string): string | null {
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

function normalizeNotes(value: string): string {
  return value.trim()
}

function normalizeDraftCwds(draft: AutomationDraft): string[] {
  const cwd = normalizeOptionalNullable(draft.cwd)
  if (!cwd) return []
  if (draft.cwds.length > 0 && draft.cwds[0] === cwd) return draft.cwds
  return [cwd]
}

export function useAutomations(options: UseAutomationsOptions = {}) {
  const gateway = options.gateway ?? defaultGateway
  const state: Ref<AutomationsState> = ref(createEmptyState())
  const templates: Ref<AutomationTemplate[]> = ref([])
  const isLoading = ref(false)
  const isSaving = ref(false)
  const isRunningNow = ref(false)
  const isRunHistoryLoading = ref(false)
  const errorMessage = ref('')
  const mutationError = ref('')
  const runHistoryError = ref('')
  const selectedAutomationId = ref('')
  const draft = ref<AutomationDraft>(createEmptyDraft())
  const runHistory: Ref<AutomationRun[]> = ref([])
  const pendingThreadPrefill = ref('')
  const hasLoaded = ref(false)
  let runHistoryRequestId = 0

  const definitions = computed(() => state.value.definitions)
  const diagnostics = computed<AutomationDiagnostic[]>(() => state.value.diagnostics)
  const selectedAutomation = computed(() =>
    definitions.value.find((definition) => definition.id === selectedAutomationId.value) ?? null,
  )

  async function loadAll(preferredAutomationId = selectedAutomationId.value): Promise<void> {
    isLoading.value = true
    errorMessage.value = ''
    try {
      const [nextState, nextTemplates] = await Promise.all([
        gateway.loadAutomationsState(),
        gateway.listAutomationTemplates(),
      ])
      state.value = nextState
      templates.value = nextTemplates
      hasLoaded.value = true
      if (pendingThreadPrefill.value) {
        const pendingThreadId = pendingThreadPrefill.value
        pendingThreadPrefill.value = ''
        applyThreadPrefill(pendingThreadId, { keepPending: false })
        return
      }
      if (preferredAutomationId && await selectAutomation(preferredAutomationId)) return
      const first = definitions.value[0]
      if (first) {
        await selectAutomation(first.id)
      } else {
        startCreate()
      }
    } catch (error) {
      errorMessage.value = error instanceof Error ? error.message : 'Failed to load automations'
    } finally {
      isLoading.value = false
    }
  }

  async function selectAutomation(id: string): Promise<boolean> {
    const definition = definitions.value.find((item) => item.id === id)
    if (!definition) return false
    selectedAutomationId.value = definition.id
    draft.value = draftFromDefinition(definition)
    runHistory.value = definition.recentRuns ?? []
    pendingThreadPrefill.value = ''
    mutationError.value = ''
    await loadRunHistory(definition.id)
    return true
  }

  function startCreate(threadId = ''): void {
    runHistoryRequestId += 1
    pendingThreadPrefill.value = ''
    selectedAutomationId.value = ''
    draft.value = createEmptyDraft(threadId)
    runHistory.value = []
    runHistoryError.value = ''
    mutationError.value = ''
  }

  function clearThreadPrefill(): void {
    pendingThreadPrefill.value = ''
    if (!selectedAutomationId.value && draft.value.mode === 'create') {
      const first = definitions.value[0]
      if (first) {
        void selectAutomation(first.id)
      } else {
        startCreate()
      }
    }
  }

  async function saveDraft(): Promise<void> {
    isSaving.value = true
    mutationError.value = ''
    try {
      if (draft.value.mode === 'create') {
        const created = await gateway.createAutomation(toCreateInput(draft.value))
        await loadAll(created.id)
      } else {
        const updated = await gateway.updateAutomation(draft.value.id, toPatchInput(draft.value))
        await loadAll(updated.id)
      }
    } catch (error) {
      mutationError.value = error instanceof Error ? error.message : 'Failed to save automation'
    } finally {
      isSaving.value = false
    }
  }

  async function pauseSelected(): Promise<void> {
    const id = selectedAutomationId.value
    if (!id) return
    await runMutation(async () => {
      const updated = await gateway.pauseAutomation(id)
      await loadAll(updated.id)
    }, 'Failed to pause automation')
  }

  async function resumeSelected(): Promise<void> {
    const id = selectedAutomationId.value
    if (!id) return
    await runMutation(async () => {
      const updated = await gateway.resumeAutomation(id)
      await loadAll(updated.id)
    }, 'Failed to resume automation')
  }

  async function runSelectedNow(): Promise<void> {
    const id = selectedAutomationId.value
    if (!id) return
    isRunningNow.value = true
    mutationError.value = ''
    try {
      await gateway.runAutomationNow(id)
      await loadAll(id)
      await loadRunHistory(id)
    } catch (error) {
      mutationError.value = error instanceof Error ? error.message : 'Failed to start automation run'
    } finally {
      isRunningNow.value = false
    }
  }

  async function deleteSelectedRemoveNative(): Promise<void> {
    const id = selectedAutomationId.value
    if (!id) return
    await runMutation(async () => {
      await gateway.deleteAutomation(id, { removeNative: true })
      await loadAll('')
    }, 'Failed to delete automation')
  }

  async function markRunRead(runId: string): Promise<void> {
    await mutateSelectedRun(runId, gateway.markAutomationRunRead, 'Failed to mark automation run read')
  }

  async function archiveRun(runId: string): Promise<void> {
    await mutateSelectedRun(runId, gateway.archiveAutomationRun, 'Failed to archive automation run')
  }

  async function unarchiveRun(runId: string): Promise<void> {
    await mutateSelectedRun(runId, gateway.unarchiveAutomationRun, 'Failed to unarchive automation run')
  }

  function applyThreadPrefill(threadId: string, options: { keepPending?: boolean } = { keepPending: true }): void {
    const normalizedThreadId = threadId.trim()
    if (!normalizedThreadId) return
    const match = definitions.value.find((definition) => definition.targetThreadId === normalizedThreadId)
    if (match) {
      pendingThreadPrefill.value = ''
      void selectAutomation(match.id)
      return
    }
    pendingThreadPrefill.value = options.keepPending === false || hasLoaded.value && !isLoading.value
      ? ''
      : normalizedThreadId
    runHistoryRequestId += 1
    selectedAutomationId.value = ''
    draft.value = createEmptyDraft(normalizedThreadId)
    runHistory.value = []
    runHistoryError.value = ''
    mutationError.value = ''
  }

  async function loadRunHistory(id = selectedAutomationId.value): Promise<void> {
    const requestId = ++runHistoryRequestId
    if (!id) {
      runHistory.value = []
      runHistoryError.value = ''
      isRunHistoryLoading.value = false
      return
    }
    isRunHistoryLoading.value = true
    runHistoryError.value = ''
    try {
      const nextRunHistory = await gateway.listAutomationRuns(id)
      if (requestId !== runHistoryRequestId || selectedAutomationId.value !== id) return
      runHistory.value = nextRunHistory
    } catch (error) {
      if (requestId !== runHistoryRequestId || selectedAutomationId.value !== id) return
      runHistoryError.value = error instanceof Error ? error.message : 'Failed to load automation runs'
    } finally {
      if (requestId === runHistoryRequestId && selectedAutomationId.value === id) {
        isRunHistoryLoading.value = false
      }
    }
  }

  async function runMutation(action: () => Promise<void>, fallbackMessage: string): Promise<void> {
    isSaving.value = true
    mutationError.value = ''
    try {
      await action()
    } catch (error) {
      mutationError.value = error instanceof Error ? error.message : fallbackMessage
    } finally {
      isSaving.value = false
    }
  }

  async function mutateSelectedRun(
    runId: string,
    action: (automationId: string, runId: string) => Promise<AutomationRun>,
    fallbackMessage: string,
  ): Promise<void> {
    const id = selectedAutomationId.value
    if (!id) return
    await runMutation(async () => {
      await action(id, runId)
      await loadRunHistory(id)
    }, fallbackMessage)
  }

  return {
    state,
    definitions,
    diagnostics,
    templates,
    isLoading,
    isSaving,
    isRunningNow,
    isRunHistoryLoading,
    errorMessage,
    mutationError,
    runHistoryError,
    selectedAutomationId,
    selectedAutomation,
    draft,
    runHistory,
    pendingThreadPrefill,
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
    deleteSelectedRemoveNative,
    applyThreadPrefill,
    clearThreadPrefill,
  }
}

function toCreateInput(draft: AutomationDraft): CreateAutomationInput {
  const targetThreadId = draft.runMode === 'chat' ? normalizeOptionalNullable(draft.targetThreadId) : null
  const cwds = normalizeDraftCwds(draft)
  return {
    kind: targetThreadId ? 'heartbeat' : 'cron',
    name: draft.name.trim(),
    prompt: draft.prompt.trim(),
    schedule: { type: 'rrule', rrule: draft.rrule.trim() },
    targetThreadId,
    description: normalizeOptionalNullable(draft.description),
    cwd: cwds[0] ?? null,
    cwds,
    runMode: draft.runMode,
    model: normalizeOptionalNullable(draft.model),
    reasoningEffort: normalizeOptionalNullable(draft.reasoningEffort),
    notes: normalizeNotes(draft.notes),
  }
}

function toPatchInput(draft: AutomationDraft): PatchAutomationInput {
  const targetThreadId = draft.runMode === 'chat' ? normalizeOptionalNullable(draft.targetThreadId) : null
  const cwds = normalizeDraftCwds(draft)
  return {
    name: draft.name.trim(),
    prompt: draft.prompt.trim(),
    schedule: { type: 'rrule', rrule: draft.rrule.trim() },
    targetThreadId,
    description: normalizeOptionalNullable(draft.description),
    cwd: cwds[0] ?? null,
    cwds,
    runMode: draft.runMode,
    model: normalizeOptionalNullable(draft.model),
    reasoningEffort: normalizeOptionalNullable(draft.reasoningEffort),
    notes: normalizeNotes(draft.notes),
  }
}
