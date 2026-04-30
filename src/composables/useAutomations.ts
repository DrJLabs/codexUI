import { computed, ref, type Ref } from 'vue'
import {
  createAutomation,
  deleteAutomation,
  listAutomationTemplates,
  loadAutomationsState,
  pauseAutomation,
  resumeAutomation,
  updateAutomation,
  type CreateAutomationInput,
  type PatchAutomationInput,
} from '../api/automationsGateway'
import type { AutomationDefinition, AutomationDiagnostic, AutomationsState, AutomationTemplate } from '../types/automations'

export type AutomationDraft = {
  id: string
  mode: 'create' | 'edit'
  name: string
  targetThreadId: string
  prompt: string
  rrule: string
  description: string
  notes: string
  runProfileId: string
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
}

const emptyState: AutomationsState = {
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
    runProfileId: '',
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
    runProfileId: definition.runProfileId ?? '',
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

export function useAutomations(options: UseAutomationsOptions = {}) {
  const gateway = options.gateway ?? defaultGateway
  const state: Ref<AutomationsState> = ref(emptyState)
  const templates: Ref<AutomationTemplate[]> = ref([])
  const isLoading = ref(false)
  const isSaving = ref(false)
  const errorMessage = ref('')
  const mutationError = ref('')
  const selectedAutomationId = ref('')
  const draft = ref<AutomationDraft>(createEmptyDraft())
  const pendingThreadPrefill = ref('')
  const hasLoaded = ref(false)

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
      if (preferredAutomationId && selectAutomation(preferredAutomationId)) return
      const first = definitions.value[0]
      if (first) {
        selectAutomation(first.id)
      } else {
        startCreate()
      }
    } catch (error) {
      errorMessage.value = error instanceof Error ? error.message : 'Failed to load automations'
    } finally {
      isLoading.value = false
    }
  }

  function selectAutomation(id: string): boolean {
    const definition = definitions.value.find((item) => item.id === id)
    if (!definition) return false
    selectedAutomationId.value = definition.id
    draft.value = draftFromDefinition(definition)
    pendingThreadPrefill.value = ''
    mutationError.value = ''
    return true
  }

  function startCreate(threadId = ''): void {
    pendingThreadPrefill.value = ''
    selectedAutomationId.value = ''
    draft.value = createEmptyDraft(threadId)
    mutationError.value = ''
  }

  function clearThreadPrefill(): void {
    pendingThreadPrefill.value = ''
    if (!selectedAutomationId.value && draft.value.mode === 'create') {
      const first = definitions.value[0]
      if (first) {
        selectAutomation(first.id)
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

  async function deleteSelectedRemoveNative(): Promise<void> {
    const id = selectedAutomationId.value
    if (!id) return
    await runMutation(async () => {
      await gateway.deleteAutomation(id, { removeNative: true })
      await loadAll('')
    }, 'Failed to delete automation')
  }

  function applyThreadPrefill(threadId: string, options: { keepPending?: boolean } = { keepPending: true }): void {
    const normalizedThreadId = threadId.trim()
    if (!normalizedThreadId) return
    const match = definitions.value.find((definition) => definition.targetThreadId === normalizedThreadId)
    if (match) {
      pendingThreadPrefill.value = ''
      selectAutomation(match.id)
      return
    }
    pendingThreadPrefill.value = options.keepPending === false || hasLoaded.value && !isLoading.value
      ? ''
      : normalizedThreadId
    selectedAutomationId.value = ''
    draft.value = createEmptyDraft(normalizedThreadId)
    mutationError.value = ''
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

  return {
    state,
    definitions,
    diagnostics,
    templates,
    isLoading,
    isSaving,
    errorMessage,
    mutationError,
    selectedAutomationId,
    selectedAutomation,
    draft,
    pendingThreadPrefill,
    loadAll,
    selectAutomation,
    startCreate,
    saveDraft,
    pauseSelected,
    resumeSelected,
    deleteSelectedRemoveNative,
    applyThreadPrefill,
    clearThreadPrefill,
  }
}

function toCreateInput(draft: AutomationDraft): CreateAutomationInput {
  return {
    kind: 'heartbeat',
    name: draft.name.trim(),
    prompt: draft.prompt.trim(),
    schedule: { type: 'rrule', rrule: draft.rrule.trim() },
    targetThreadId: draft.targetThreadId.trim(),
    description: normalizeOptionalNullable(draft.description),
    cwd: null,
    runMode: null,
    runProfileId: normalizeOptionalNullable(draft.runProfileId),
    model: normalizeOptionalNullable(draft.model),
    reasoningEffort: normalizeOptionalNullable(draft.reasoningEffort),
    notes: normalizeNotes(draft.notes),
  }
}

function toPatchInput(draft: AutomationDraft): PatchAutomationInput {
  return {
    name: draft.name.trim(),
    prompt: draft.prompt.trim(),
    schedule: { type: 'rrule', rrule: draft.rrule.trim() },
    targetThreadId: normalizeOptionalNullable(draft.targetThreadId),
    description: normalizeOptionalNullable(draft.description),
    runProfileId: normalizeOptionalNullable(draft.runProfileId),
    model: normalizeOptionalNullable(draft.model),
    reasoningEffort: normalizeOptionalNullable(draft.reasoningEffort),
    notes: normalizeNotes(draft.notes),
  }
}
