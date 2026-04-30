# Automations Phase 4 Route And Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `#/automations` as the first usable Automations management surface for heartbeat definitions exposed by the Phase 3 API.

**Architecture:** Keep API calls in a dedicated gateway, keep server-state orchestration in a composable, and keep route rendering in focused Automations components. Wire the existing `SidebarPrimaryNav.vue` Automations row into the app shell instead of adding a separate ad hoc nav button, and make the thread menu open the shared route with the thread preselected while preserving an explicitly reachable legacy quick-edit dialog fallback.

**Tech Stack:** Vue 3 Composition API, Vue Router hash routes, existing CodexUI Express/Vite Automations API, Vitest, scoped Vue CSS plus existing global theme tokens.

---

## Scope

In scope:

- Register the `automations` hash route.
- Wire the existing primary sidebar Automations nav row in `SidebarPrimaryNav.vue`.
- List existing heartbeat automations from `/codex-api/automations/state`.
- Create and edit thread-attached heartbeat automations.
- Pause/resume and delete automations.
- Show native/sidecar storage paths and invalid-record diagnostics.
- Open the Automations route from a thread menu shortcut with the selected thread prefilled.
- Update `tests.md` with manual light/dark verification steps.

Out of scope:

- Scheduler execution.
- Manual `Run now`.
- Run history, artifact indexing, triage inbox, or Kanban projection.
- Broad redesign of the existing thread sidebar automation fallback dialog.

## File Structure

- Create: `src/api/automationsGateway.ts`
  - Browser client for Phase 3 Automations API, including Automations CSRF retry.
- Create: `src/api/automationsGateway.test.ts`
  - Gateway request/CSRF/error tests.
- Create: `src/composables/useAutomations.ts`
  - State owner for list, selected definition, draft form, loading/error/mutation state, and CRUD actions.
- Create: `src/composables/useAutomations.test.ts`
  - Composable behavior tests using an injected gateway.
- Create: `src/components/automations/AutomationsPage.vue`
  - Route container and accessible management UI.
- Modify: `src/router/index.ts`
  - Add `{ path: '/automations', name: 'automations', component: EmptyRouteView }`.
- Modify: `src/router/index.test.ts`
  - Cover the new hash route.
- Modify: `src/App.vue`
  - Add async `AutomationsPage`, mount `SidebarPrimaryNav`, header icon/title handling, route exclusion guards, and sidebar event handling.
- Modify: `src/components/sidebar/SidebarThreadTree.vue`
  - Emit `manage-automation` from the thread menu for the shared editor route.
  - Keep a visible `Quick edit automation...` fallback menu action wired to the legacy dialog in this phase.
- Modify: `src/components/sidebar/SidebarPrimaryNav.vue`
  - Convert the existing static primary nav rows into controlled buttons for Automations, Skills, and Kanban.
- Modify: `docs/superpowers/plans/2026-04-30-automations-feature-high-level-plan.md`
  - Link this Phase 4 implementation plan.
- Modify: `reports/frontend-development/automations-phase-4/plan.md`
  - Record component/data-flow artifact required by the frontend-development skill.
- Modify: `reports/frontend-development/automations-phase-4/risk-checklist.md`
  - Record loading/error/edge-case risk checklist.
- Modify: `tests.md`
  - Add manual light/dark route verification.

## UI Contract

The first route version renders a dense operational page:

- Header summary: total, active, paused, native storage root.
- Diagnostics banner when invalid native records or sidecars were skipped/sanitized.
- Left list/table of heartbeat automations:
  - name
  - status
  - target thread id
  - RRULE
  - source
  - updated timestamp
- Right editor panel:
  - `Name`
  - `Target thread id`
  - `Prompt`
  - `Schedule (RRULE)`
  - `Description`
  - `Notes`
  - `Run profile id`
  - `Model`
  - `Reasoning effort`
  - read-only storage/source path fields
  - create/save, pause/resume, delete actions
- Empty state:
  - If no automations exist, show a compact create form with the route query `threadId` prefilled when present.
- Delete behavior:
  - UI delete calls `DELETE /codex-api/automations/:id?removeNative=true` to preserve the legacy thread menu deletion behavior.
  - The button text and confirmation copy must state that the native automation folder will be removed.

## API Client Contract

`src/api/automationsGateway.ts` exports:

```ts
export type CreateAutomationInput = {
  kind: 'heartbeat'
  name: string
  prompt: string
  schedule: { type: 'rrule'; rrule: string }
  targetThreadId: string
  description?: string | null
  cwd?: string | null
  runMode?: 'chat' | null
  runProfileId?: string | null
  model?: string | null
  reasoningEffort?: string | null
  notes?: string
}

export type PatchAutomationInput = Partial<Omit<CreateAutomationInput, 'kind'>> & {
  targetThreadId?: string | null
}

export async function loadAutomationsState(): Promise<AutomationsState>
export async function listAutomationTemplates(): Promise<AutomationTemplate[]>
export async function createAutomation(input: CreateAutomationInput): Promise<AutomationDefinition>
export async function updateAutomation(id: string, patch: PatchAutomationInput): Promise<AutomationDefinition>
export async function pauseAutomation(id: string): Promise<AutomationDefinition>
export async function resumeAutomation(id: string): Promise<AutomationDefinition>
export async function deleteAutomation(id: string, options?: { removeNative?: boolean }): Promise<{ removed: boolean; removedNative: boolean }>
```

CSRF handling mirrors `kanbanGateway.ts` with header `x-codexui-automations-csrf` and one stale-token retry when a mutation returns `403 Invalid Automations CSRF token`.

## Composable Contract

`useAutomations()` returns:

```ts
type AutomationDraft = {
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
```

and these state/actions:

- `state`, `definitions`, `diagnostics`, `templates`
- `isLoading`, `isSaving`, `errorMessage`, `mutationError`
- `selectedAutomationId`, `selectedAutomation`, `draft`, `pendingThreadPrefill`
- `loadAll()`
- `selectAutomation(id)`
- `startCreate(threadId?: string)`
- `saveDraft()`
- `pauseSelected()`
- `resumeSelected()`
- `deleteSelectedRemoveNative()`
- `applyThreadPrefill(threadId)`

`saveDraft()` creates when `draft.mode === 'create'` and patches when `draft.mode === 'edit'`. Empty optional strings become `null` for nullable API fields and `''` for notes. If `applyThreadPrefill(threadId)` is called before definitions are loaded, `loadAll()` must apply that pending thread id after the API response instead of selecting the first automation.

## Task 1: Gateway, Route Registration, And Tests

**Files:**
- Create: `src/api/automationsGateway.ts`
- Create: `src/api/automationsGateway.test.ts`
- Modify: `src/router/index.ts`
- Modify: `src/router/index.test.ts`

- [ ] **Step 1: Write failing gateway tests**

```ts
it('loads the Automations state from the first-class API', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    expect(url).toBe('/codex-api/automations/state')
    return jsonResponse(200, { data: { storageRoot: '/tmp/automations', featureFlags: { scheduler: false, manualRun: false, kanbanProjection: false, artifactIndexing: false }, sourceCounts: { native: 0, codexui: 0 }, diagnostics: [], definitions: [] } })
  }))
  const { loadAutomationsState } = await import('./automationsGateway')
  await expect(loadAutomationsState()).resolves.toMatchObject({ storageRoot: '/tmp/automations' })
})
```

```ts
it('refreshes a stale Automations CSRF token once for protected mutations', async () => {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const headers = init?.headers as Record<string, string> | undefined
    if (url === '/codex-api/automations/csrf' && fetchMock.mock.calls.length === 1) return jsonResponse(200, { data: { csrfToken: 'old' } })
    if (url === '/codex-api/automations/auto_1/pause' && headers?.['x-codexui-automations-csrf'] === 'old') return jsonResponse(403, { error: 'Invalid Automations CSRF token' })
    if (url === '/codex-api/automations/csrf') return jsonResponse(200, { data: { csrfToken: 'new' } })
    if (url === '/codex-api/automations/auto_1/pause' && headers?.['x-codexui-automations-csrf'] === 'new') return jsonResponse(200, { data: automationFixture({ id: 'auto_1', status: 'paused' }) })
    return jsonResponse(500, { error: 'unexpected request' })
  })
  vi.stubGlobal('fetch', fetchMock)
  const { pauseAutomation } = await import('./automationsGateway')
  await expect(pauseAutomation('auto_1')).resolves.toMatchObject({ id: 'auto_1', status: 'paused' })
  expect(fetchMock).toHaveBeenCalledTimes(4)
})
```

```ts
it('sends destructive delete with removeNative=true when requested', async () => {
  const fetchMock = vi.fn(async (url: string) => {
    if (url === '/codex-api/automations/csrf') return jsonResponse(200, { data: { csrfToken: 'token' } })
    expect(url).toBe('/codex-api/automations/auto_1?removeNative=true')
    return jsonResponse(200, { data: { removed: true, removedNative: true } })
  })
  vi.stubGlobal('fetch', fetchMock)
  const { deleteAutomation } = await import('./automationsGateway')
  await expect(deleteAutomation('auto_1', { removeNative: true })).resolves.toEqual({ removed: true, removedNative: true })
})
```

- [ ] **Step 2: Write failing route test**

```ts
it('registers the Automations hash route', async () => {
  installRouterGlobals()
  const { routes } = await import('./index')
  expect(routes.find((entry) => entry.name === 'automations')?.path).toBe('/automations')
})
```

- [ ] **Step 3: Implement gateway**
  - Follow the `kanbanGateway.ts` request/data-wrapper style.
  - Use `encodeURIComponent(id)` for path IDs.
  - Throw API error messages from `{ error }` payloads.

- [ ] **Step 4: Register route**
  - Add `automations` route before `/new-thread`.
  - Refactor `router/index.test.ts` helper globals so Kanban and Automations route tests share setup.

- [ ] **Step 5: Run focused tests**

```bash
pnpm exec vitest run src/api/automationsGateway.test.ts src/router/index.test.ts
```

Expected: new gateway and route tests pass.

## Task 2: Composable State Owner

**Files:**
- Create: `src/composables/useAutomations.ts`
- Create: `src/composables/useAutomations.test.ts`

- [ ] **Step 1: Write failing composable tests**

```ts
it('loads state and selects the first automation', async () => {
  const gateway = createGatewayFixture([automationFixture({ id: 'auto_1', name: 'Daily check' })])
  const automations = useAutomations({ gateway })
  await automations.loadAll()
  expect(automations.definitions.value).toHaveLength(1)
  expect(automations.selectedAutomationId.value).toBe('auto_1')
  expect(automations.draft.value.name).toBe('Daily check')
})
```

```ts
it('prefills create draft from a thread shortcut when no matching automation exists', async () => {
  const automations = useAutomations({ gateway: createGatewayFixture([]) })
  await automations.loadAll()
  automations.applyThreadPrefill('thread_123')
  expect(automations.draft.value.mode).toBe('create')
  expect(automations.draft.value.targetThreadId).toBe('thread_123')
})
```

```ts
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
```

```ts
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
```

```ts
it('selects the existing automation for a thread shortcut', async () => {
  const automations = useAutomations({ gateway: createGatewayFixture([automationFixture({ id: 'auto_1', targetThreadId: 'thread_123' })]) })
  await automations.loadAll()
  automations.applyThreadPrefill('thread_123')
  expect(automations.selectedAutomationId.value).toBe('auto_1')
  expect(automations.draft.value.mode).toBe('edit')
})
```

```ts
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
```

```ts
it('deletes the selected automation with removeNative=true and reloads state', async () => {
  const gateway = createGatewayFixture([automationFixture({ id: 'auto_1' })])
  const automations = useAutomations({ gateway })
  await automations.loadAll()
  await automations.deleteSelectedRemoveNative()
  expect(gateway.deleteAutomation).toHaveBeenCalledWith('auto_1', { removeNative: true })
  expect(gateway.loadAutomationsState).toHaveBeenCalledTimes(2)
})
```

- [ ] **Step 2: Implement composable**
  - Inject the gateway for tests.
  - Use `ref` and `computed`; no global store.
  - Keep loading errors separate from mutation errors.
  - After create/update/pause/resume/delete, reload state and keep/select the affected automation when possible.

- [ ] **Step 3: Run focused tests**

```bash
pnpm exec vitest run src/composables/useAutomations.test.ts
```

Expected: composable tests pass.

## Task 3: Automations Route UI

**Files:**
- Create: `src/components/automations/AutomationsPage.vue`
- Modify: `src/App.vue`
- Modify: `src/components/sidebar/SidebarThreadTree.vue`
- Modify: `src/components/sidebar/SidebarPrimaryNav.vue`

- [ ] **Step 1: Implement `AutomationsPage.vue` against the composable**
  - Load on mount.
  - Watch `route.query.threadId` and call `applyThreadPrefill`.
  - Render loading, error, empty, diagnostics, list, editor, and action states.
  - Use semantic buttons/labels/inputs and no nested card layout.
  - Use `window.confirm()` only for destructive delete copy in this first phase.

- [ ] **Step 2: Wire App route shell and existing primary nav**
  - Add `AutomationsPage` async import.
  - Add `isAutomationsRoute`.
  - Import and mount `SidebarPrimaryNav.vue` in place of the current standalone Skills/Kanban sidebar buttons.
  - Update `SidebarPrimaryNav.vue` so the existing Automations row emits `navigate-automations`; also expose Skills and Kanban rows as the same primary navigation component.
  - Add header title/icon handling.
  - Exclude Automations from thread-route branch sync and export actions just like Skills/Kanban.
  - Render `<AutomationsPage />` when `isAutomationsRoute`.

- [ ] **Step 3: Wire thread menu shortcut**
  - Add `manage-automation: [threadId: string]` to `SidebarThreadTree` emits.
  - Change the main automation menu row to emit `manage-automation`.
  - Add a secondary `Quick edit automation...` menu row that still calls `openAutomationDialog(openThreadMenuThread.id)` so the old dialog remains reachable during this phase.
  - In `App.vue`, handle the event by routing to `{ name: 'automations', query: { threadId } }` and collapsing mobile sidebar.
  - If `router.push` rejects, leave the user on the current route and keep the visible quick-edit fallback menu action rather than deleting the legacy path.

- [ ] **Step 4: Build route-level styles**
  - Keep the route dense and operational.
  - Use existing colors/tokens and explicit dark selectors where route surfaces need them.
  - Ensure long paths wrap and do not overflow editor/list surfaces.

- [ ] **Step 5: Run build**

```bash
pnpm run build
```

Expected: TypeScript and Vue compilation pass.

## Task 4: Documentation, Manual Test Notes, And Verification

**Files:**
- Modify: `docs/superpowers/plans/2026-04-30-automations-feature-high-level-plan.md`
- Create: `reports/frontend-development/automations-phase-4/plan.md`
- Create: `reports/frontend-development/automations-phase-4/risk-checklist.md`
- Modify: `tests.md`

- [ ] **Step 1: Link Phase 4 plan from high-level plan**
  - Add `Phase 4 implementation plan: [2026-04-30-automations-phase-4-route-and-editor.md](2026-04-30-automations-phase-4-route-and-editor.md).`

- [ ] **Step 2: Add frontend-development artifacts**
  - `plan.md` records Vue/router/API data flow.
  - `risk-checklist.md` records loading, empty, diagnostics, stale CSRF, destructive delete, long paths, and light/dark risks.

- [ ] **Step 3: Update `tests.md`**
  - Add a section named `Automations Route And Shared Editor`.
  - Include prerequisites/setup, exact manual steps, expected results, and rollback/cleanup notes.
  - Include both light-theme and dark-theme verification steps/results.

- [ ] **Step 4: Perform manual UI verification**
  - Start the app with `pnpm run dev -- --host 0.0.0.0 --port 4173` after build/test errors are clear.
  - Open `http://127.0.0.1:4173/#/automations` in a browser.
  - Verify light theme:
    - the Automations primary nav row is active
    - existing definitions list
    - storage/source paths wrap without overflow
    - create/edit form saves a thread-attached heartbeat
    - pause/resume updates status
    - delete confirmation states native folder removal
    - thread menu `Manage automation...` opens `#/automations?threadId=<id>` with the draft prefilled
    - thread menu `Quick edit automation...` still opens the legacy dialog
  - Switch to dark theme and repeat the visual checks for readable surfaces, controls, and wrapped paths.
  - Stop the dev server before committing.

- [ ] **Step 5: Final focused verification**

```bash
pnpm exec vitest run src/api/automationsGateway.test.ts src/composables/useAutomations.test.ts src/router/index.test.ts
pnpm run build
git diff --check
```

Expected: all commands exit 0, and manual light/dark checks above are recorded in `tests.md`.

- [ ] **Step 6: Commit**

```bash
git add src/api/automationsGateway.ts src/api/automationsGateway.test.ts src/composables/useAutomations.ts src/composables/useAutomations.test.ts src/components/automations/AutomationsPage.vue src/router/index.ts src/router/index.test.ts src/App.vue src/components/sidebar/SidebarThreadTree.vue src/components/sidebar/SidebarPrimaryNav.vue docs/superpowers/plans/2026-04-30-automations-feature-high-level-plan.md docs/superpowers/plans/2026-04-30-automations-phase-4-route-and-editor.md reports/frontend-development/automations-phase-4/plan.md reports/frontend-development/automations-phase-4/risk-checklist.md tests.md
git commit -m "feat(automations): add management route"
```

## Self-Review

- Spec coverage:
  - `#/automations`: Task 1 and Task 3.
  - Listing existing heartbeat automations: Task 2 and Task 3.
  - Creating/editing thread-attached automation: Task 2 and Task 3.
  - Pausing/resuming: Task 1 gateway and Task 2 composable, surfaced in Task 3.
  - Deleting: Task 1, Task 2, Task 3 with `removeNative=true`.
  - Showing storage/source path: Task 3 editor.
  - Reusing editor from thread menu shortcut: Task 3 event/query prefill plus async prefill tests in Task 2.
  - Existing primary-nav Automations row: Task 3 wires `SidebarPrimaryNav.vue`.
  - Keeping dialog fallback: Task 3 keeps a visible `Quick edit automation...` legacy menu action.
- Placeholder scan: no `TBD`, `TODO`, or unsupported behavior placeholders remain.
- Type consistency: Gateway, composable, and UI use Phase 3 `AutomationDefinition`, `AutomationsState`, and `AutomationTemplate`.
