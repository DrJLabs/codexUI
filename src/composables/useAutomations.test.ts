import { describe, expect, it, vi } from 'vitest'
import { useAutomations, type AutomationsGateway } from './useAutomations'
import type { AutomationDefinition, AutomationsState, AutomationTemplate } from '../types/automations'

it('loads state and selects the first automation', async () => {
  const gateway = createGatewayFixture([automationFixture({ id: 'auto_1', name: 'Daily check' })])
  const automations = useAutomations({ gateway })
  await automations.loadAll()
  expect(automations.definitions.value).toHaveLength(1)
  expect(automations.selectedAutomationId.value).toBe('auto_1')
  expect(automations.draft.value.name).toBe('Daily check')
})

it('prefills create draft from a thread shortcut when no matching automation exists', async () => {
  const automations = useAutomations({ gateway: createGatewayFixture([]) })
  await automations.loadAll()
  automations.applyThreadPrefill('thread_123')
  expect(automations.draft.value.mode).toBe('create')
  expect(automations.draft.value.targetThreadId).toBe('thread_123')
})

it('preserves a route thread prefill across the initial async load', async () => {
  const deferred = createDeferredState([automationFixture({ id: 'auto_1', targetThreadId: 'other_thread' })])
  const automations = useAutomations({ gateway: createGatewayFixture([], { deferredState: deferred.promise }) })
  const loading = automations.loadAll()
  automations.applyThreadPrefill('thread_123')
  deferred.resolve()
  await loading
  expect(automations.draft.value.mode).toBe('create')
  expect(automations.draft.value.targetThreadId).toBe('thread_123')
})

it('selects a matching automation after initial async load when a thread prefill is pending', async () => {
  const deferred = createDeferredState([automationFixture({ id: 'auto_1', targetThreadId: 'thread_123' })])
  const automations = useAutomations({ gateway: createGatewayFixture([], { deferredState: deferred.promise }) })
  const loading = automations.loadAll()
  automations.applyThreadPrefill('thread_123')
  deferred.resolve()
  await loading
  expect(automations.selectedAutomationId.value).toBe('auto_1')
  expect(automations.draft.value.mode).toBe('edit')
})

it('selects the existing automation for a thread shortcut', async () => {
  const automations = useAutomations({ gateway: createGatewayFixture([automationFixture({ id: 'auto_1', targetThreadId: 'thread_123' })]) })
  await automations.loadAll()
  automations.applyThreadPrefill('thread_123')
  expect(automations.selectedAutomationId.value).toBe('auto_1')
  expect(automations.draft.value.mode).toBe('edit')
})

it('normalizes optional blank draft fields before save', async () => {
  const gateway = createGatewayFixture([])
  const automations = useAutomations({ gateway })
  automations.startCreate('thread_123')
  automations.draft.value.name = 'Daily check'
  automations.draft.value.prompt = 'Check the thread'
  automations.draft.value.rrule = 'FREQ=DAILY;BYHOUR=9;BYMINUTE=0'
  await automations.saveDraft()
  expect(gateway.createAutomation).toHaveBeenCalledWith(expect.objectContaining({
    description: null,
    runProfileId: null,
    model: null,
    reasoningEffort: null,
    notes: '',
  }))
})

it('selects the created automation when a prefilled target is changed before save', async () => {
  const automations = useAutomations({ gateway: createGatewayFixture([]) })
  await automations.loadAll()
  automations.applyThreadPrefill('thread_original')
  automations.draft.value.name = 'Changed target check'
  automations.draft.value.prompt = 'Check the changed target'
  automations.draft.value.targetThreadId = 'thread_changed'
  await automations.saveDraft()

  expect(automations.pendingThreadPrefill.value).toBe('')
  expect(automations.selectedAutomationId.value).toBe('auto_created')
  expect(automations.draft.value.mode).toBe('edit')
  expect(automations.draft.value.targetThreadId).toBe('thread_changed')
})

it('allows editing a detached automation without a target thread id', async () => {
  const gateway = createGatewayFixture([automationFixture({ id: 'detached', targetThreadId: null })])
  const automations = useAutomations({ gateway })
  await automations.loadAll()
  automations.draft.value.notes = 'Updated detached notes'

  await automations.saveDraft()

  expect(gateway.updateAutomation).toHaveBeenCalledWith('detached', expect.objectContaining({
    targetThreadId: null,
    notes: 'Updated detached notes',
  }))
})

it('clears a route prefill and returns to the first automation when query state is cleared', async () => {
  const automations = useAutomations({ gateway: createGatewayFixture([automationFixture({ id: 'auto_1', targetThreadId: 'thread_1' })]) })
  await automations.loadAll()
  automations.applyThreadPrefill('thread_missing')

  automations.clearThreadPrefill()

  expect(automations.pendingThreadPrefill.value).toBe('')
  expect(automations.selectedAutomationId.value).toBe('auto_1')
  expect(automations.draft.value.mode).toBe('edit')
})

it('deletes the selected automation with removeNative=true and reloads state', async () => {
  const gateway = createGatewayFixture([automationFixture({ id: 'auto_1' })])
  const automations = useAutomations({ gateway })
  await automations.loadAll()
  await automations.deleteSelectedRemoveNative()
  expect(gateway.deleteAutomation).toHaveBeenCalledWith('auto_1', { removeNative: true })
  expect(gateway.loadAutomationsState).toHaveBeenCalledTimes(2)
})

function createGatewayFixture(
  definitions: AutomationDefinition[],
  options: { deferredState?: Promise<AutomationsState> } = {},
): AutomationsGateway {
  let currentDefinitions = definitions
  const gateway: AutomationsGateway = {
    loadAutomationsState: vi.fn(async () => options.deferredState ?? stateFixture(currentDefinitions)),
    listAutomationTemplates: vi.fn(async () => templatesFixture()),
    createAutomation: vi.fn(async (input) => {
      const created = automationFixture({
        id: 'auto_created',
        name: input.name,
        prompt: input.prompt,
        targetThreadId: input.targetThreadId,
        schedule: input.schedule,
        description: input.description ?? null,
        runProfileId: input.runProfileId ?? null,
        model: input.model ?? null,
        reasoningEffort: input.reasoningEffort ?? null,
        notes: input.notes ?? '',
      })
      currentDefinitions = [created, ...currentDefinitions]
      return created
    }),
    updateAutomation: vi.fn(async (id, patch) => {
      const existing = currentDefinitions.find((definition) => definition.id === id)
      if (!existing) throw new Error('missing automation')
      const updated = {
        ...existing,
        ...patch,
        schedule: patch.schedule ?? existing.schedule,
        updatedAtIso: '2026-04-30T01:00:00.000Z',
      }
      currentDefinitions = currentDefinitions.map((definition) => definition.id === id ? updated : definition)
      return updated
    }),
    pauseAutomation: vi.fn(async (id) => {
      const existing = currentDefinitions.find((definition) => definition.id === id)
      if (!existing) throw new Error('missing automation')
      const updated = { ...existing, status: 'paused' as const, legacyStatus: 'PAUSED' as const }
      currentDefinitions = currentDefinitions.map((definition) => definition.id === id ? updated : definition)
      return updated
    }),
    resumeAutomation: vi.fn(async (id) => {
      const existing = currentDefinitions.find((definition) => definition.id === id)
      if (!existing) throw new Error('missing automation')
      const updated = { ...existing, status: 'active' as const, legacyStatus: 'ACTIVE' as const }
      currentDefinitions = currentDefinitions.map((definition) => definition.id === id ? updated : definition)
      return updated
    }),
    deleteAutomation: vi.fn(async (id) => {
      currentDefinitions = currentDefinitions.filter((definition) => definition.id !== id)
      return { removed: true, removedNative: true }
    }),
  }
  return gateway
}

function createDeferredState(definitions: AutomationDefinition[]): {
  promise: Promise<AutomationsState>
  resolve: () => void
} {
  let resolve: () => void = () => {}
  const promise = new Promise<AutomationsState>((nextResolve) => {
    resolve = () => nextResolve(stateFixture(definitions))
  })
  return { promise, resolve }
}

function stateFixture(definitions: AutomationDefinition[]): AutomationsState {
  return {
    storageRoot: '/tmp/automations',
    featureFlags: { scheduler: false, manualRun: false, kanbanProjection: false, artifactIndexing: false },
    sourceCounts: { native: definitions.filter((definition) => definition.source === 'native').length, codexui: 0 },
    diagnostics: [],
    definitions,
  }
}

function templatesFixture(): AutomationTemplate[] {
  return [
    {
      id: 'daily_thread_check',
      kind: 'heartbeat',
      name: 'Daily thread check',
      description: 'Check a thread daily.',
      schedule: { type: 'rrule', rrule: 'FREQ=DAILY;BYHOUR=9;BYMINUTE=0' },
    },
  ]
}

function automationFixture(overrides: Partial<AutomationDefinition> = {}): AutomationDefinition {
  return {
    id: 'auto_1',
    kind: 'heartbeat',
    source: 'native',
    nativeId: 'auto_1',
    name: 'Thread automation',
    description: null,
    prompt: 'Check this thread',
    status: 'active',
    legacyStatus: 'ACTIVE',
    schedule: { type: 'rrule', rrule: 'FREQ=DAILY;BYHOUR=9;BYMINUTE=0' },
    targetThreadId: 'thread_1',
    projectRoot: null,
    cwd: null,
    runMode: null,
    runProfileId: null,
    model: null,
    reasoningEffort: null,
    autoArchiveNoFindings: false,
    notifyOnFindings: false,
    kanbanProjection: { mode: 'off' },
    notes: '',
    storage: {
      nativeDirName: 'auto_1',
      nativePath: '/tmp/automations/auto_1/automation.toml',
      sidecarPath: '/tmp/automations/auto_1/codexui.json',
    },
    createdAtIso: '2026-04-30T00:00:00.000Z',
    updatedAtIso: '2026-04-30T00:00:00.000Z',
    lastRunAtIso: null,
    nextRunAtIso: null,
    version: 1,
    ...overrides,
  }
}
