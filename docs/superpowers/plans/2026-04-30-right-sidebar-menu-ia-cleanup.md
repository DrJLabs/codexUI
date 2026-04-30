# Right Sidebar Menu IA Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the right sidebar from duplicated artifact tabs into a first-level workspace menu where each section opens in place, with full-page routes available only as secondary actions.

**Architecture:** Keep the right sidebar as an inspector for the selected thread/project rather than making it a router. `useThreadWorkspace` owns the first-level section model, `ThreadArtifactSidebar.vue` owns local active-section state and renders exactly one panel at a time, and existing artifact grouping remains available inside the `Thread`/`Artifacts` panels instead of appearing as duplicate top-level buttons.

**Tech Stack:** Vue 3 Composition API, TypeScript, Vitest, existing scoped CSS, existing workspace artifact APIs.

---

## Branch And Baseline

Current branch: `dev`.

Current SHA at plan creation: `f6a68cb`.

Codex.app parity note: `/Applications/Codex.app` is not present on this host, so live desktop CDP inspection cannot be performed here. The current CodexUI drawer is the before-state source. Do not run Playwright unless explicitly requested, per repo instructions.

## Scope

In scope:

- Replace the right-sidebar first-level section groups with one clean menu.
- Make `Thread`, `Kanban`, `Automations`, `Worktrees`, `Artifacts`, `Actions`, and `Permissions` the first-level sidebar sections.
- Render only the active section's panel content.
- Move `Plan`, `Run`, `Evidence`, `Review`, and `Proposals` under the `Thread` panel.
- Keep `Kanban`, `Automations`, `Actions`, and `Permissions` as contextual/deferred panels for now.
- Keep `Worktrees` mapped to existing worktree/run artifacts.
- Keep `Artifacts` as a compact unified artifact browser.
- Preserve light and dark readability.
- Update `tests.md` with manual light/dark verification.

Out of scope:

- No automation backend/API wiring.
- No full Kanban board embedded in the sidebar.
- No local action execution wiring.
- No permission approval controls.
- No Playwright screenshots unless the user explicitly requests them.

## Target Interaction Model

First-level right-sidebar sections:

```ts
type ThreadWorkspaceSectionId =
  | 'thread'
  | 'kanban'
  | 'automations'
  | 'worktrees'
  | 'artifacts'
  | 'actions'
  | 'permissions'
```

Clicking a section changes the active panel in place. It does not route away by default.

Panel behavior:

- `Thread`: shows subnavigation for `Plan`, `Run`, `Evidence`, `Review`, and `Proposals`, then renders the selected thread-artifact group.
- `Kanban`: shows a contextual empty/deferred summary and an `Open board` secondary action.
- `Automations`: shows a contextual empty/deferred summary and an `Open automations` secondary action once the route exists; for this task it can be disabled/deferred.
- `Worktrees`: shows run/worktree artifacts for the selected thread.
- `Artifacts`: shows all indexed artifacts for the selected thread.
- `Actions`: disabled/deferred.
- `Permissions`: disabled/deferred.

## File Map

Modify:

- `src/types/threadWorkspace.ts`
  - Replace split thread/workspace section ID types with one first-level drawer section model plus a thread artifact sub-section model.

- `src/composables/useThreadWorkspace.ts`
  - Derive first-level sections and nested thread artifact sections.
  - Default active section should be `thread` when a thread is selected, otherwise `artifacts`.

- `src/composables/useThreadWorkspace.test.ts`
  - Update expectations from split `threadSections`/`workspaceSections` to one `sections` list.
  - Assert section order and deferred states.
  - Assert nested thread artifact sections still expose Plan/Run/Evidence/Review/Proposals.

- `src/components/artifacts/ThreadArtifactSidebar.vue`
  - Replace duplicated first-level groups plus `ArtifactTabs` with a clean first-level menu and active panel rendering.
  - Keep `ArtifactTabs` only inside the `Thread` panel as subnavigation, or replace it with equivalent inline buttons.
  - Render `Kanban`, `Automations`, `Actions`, and `Permissions` as short contextual/deferred panels.
  - Render `Worktrees` and `Artifacts` using existing artifact item cards.

- `tests.md`
  - Add a manual test section for right-sidebar menu cleanup in light and dark themes.

Read:

- `src/composables/useThreadArtifacts.ts`
- `src/components/artifacts/ArtifactTabs.vue`
- `src/components/artifacts/ArtifactEmptyState.vue`
- `src/App.vue`

## Task 1: Update Workspace Model Contract

**Files:**

- Modify: `src/types/threadWorkspace.ts`
- Modify: `src/composables/useThreadWorkspace.ts`
- Modify: `src/composables/useThreadWorkspace.test.ts`

- [ ] **Step 1: Write failing model tests**

Update `src/composables/useThreadWorkspace.test.ts` so the selected-thread test expects:

```ts
expect(model.value.sections.map((section) => section.id)).toEqual([
  'thread',
  'kanban',
  'automations',
  'worktrees',
  'artifacts',
  'actions',
  'permissions',
])
expect(model.value.activeSectionId).toBe('thread')
expect(model.value.threadArtifactSections.map((section) => section.id)).toEqual([
  'plan',
  'run',
  'evidence',
  'review',
  'proposals',
])
expect(model.value.sections.find((section) => section.id === 'automations')).toMatchObject({
  enabled: true,
  deferred: true,
})
```

Update the no-thread test so it expects `thread`, `kanban`, `automations`, `worktrees`, `actions`, and `permissions` disabled, while `artifacts` remains enabled with a count of `0`.

- [ ] **Step 2: Run RED test**

Run:

```bash
pnpm vitest run src/composables/useThreadWorkspace.test.ts
```

Expected: FAIL because the current model exposes `threadSections` and `workspaceSections`, not `sections` and `threadArtifactSections`.

- [ ] **Step 3: Update type contract**

In `src/types/threadWorkspace.ts`, replace the current types with:

```ts
export type ThreadArtifactSectionId =
  | 'plan'
  | 'run'
  | 'evidence'
  | 'review'
  | 'proposals'

export type ThreadWorkspaceSectionId =
  | 'thread'
  | 'kanban'
  | 'automations'
  | 'worktrees'
  | 'artifacts'
  | 'actions'
  | 'permissions'

export type ThreadWorkspaceDrawerSection = {
  id: ThreadWorkspaceSectionId
  label: string
  count: number
  enabled: boolean
  deferred: boolean
  reason: string
}

export type ThreadArtifactDrawerSection = {
  id: ThreadArtifactSectionId
  label: string
  count: number
  enabled: boolean
  reason: string
}

export type ThreadWorkspaceModel = {
  threadId: string
  hasThread: boolean
  artifactCount: number
  activeSectionId: ThreadWorkspaceSectionId
  sections: ThreadWorkspaceDrawerSection[]
  threadArtifactSections: ThreadArtifactDrawerSection[]
  deferredFollowUps: Array<{
    id: 'chat_integration_wiring' | 'automations_feature'
    notePath: string
    reason: string
  }>
}
```

- [ ] **Step 4: Update composable**

In `src/composables/useThreadWorkspace.ts`, compute:

- `planCount` from `kind === 'plan'`
- `runCount` from `kind === 'run_metadata'`
- `worktreeCount` from `kind === 'worktree'`
- `evidenceCount` from `kind === 'evidence'`
- `reviewCount` from `kind === 'review_packet'`
- `proposalCount` from explicit input
- `artifactCount` from selected-thread artifacts

Create first-level sections in this order:

```ts
[
  createSection('thread', 'Thread', artifactCount + proposalCount, hasThread, false, disabledThreadReason),
  createSection('kanban', 'Kanban', 0, hasThread, true, hasThread ? 'Kanban context wiring lands after the sidebar IA cleanup.' : disabledThreadReason),
  createSection('automations', 'Automations', 0, hasThread, true, hasThread ? 'Automation wiring lands after this sidebar cleanup.' : disabledThreadReason),
  createSection('worktrees', 'Worktrees', worktreeCount, hasThread, false, hasThread ? '' : disabledThreadReason),
  createSection('artifacts', 'Artifacts', artifactCount, true, false, ''),
  createSection('actions', 'Actions', input.availableActionCount?.value ?? 0, false, true, 'Local action drawer wiring lands after the data contract is added.'),
  createSection('permissions', 'Permissions', 0, false, true, 'Permission controls land in a later phase.'),
]
```

Create `threadArtifactSections` in this order: `Plan`, `Run`, `Evidence`, `Review`, `Proposals`.

- [ ] **Step 5: Run GREEN test**

Run:

```bash
pnpm vitest run src/composables/useThreadWorkspace.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/types/threadWorkspace.ts src/composables/useThreadWorkspace.ts src/composables/useThreadWorkspace.test.ts
git commit -m "feat: simplify right sidebar workspace model"
```

## Task 2: Render Single Active Sidebar Section

**Files:**

- Modify: `src/components/artifacts/ThreadArtifactSidebar.vue`
- Modify: `tests.md`

- [ ] **Step 1: Write/update component expectations manually**

Before editing, inspect `ThreadArtifactSidebar.vue` and confirm the current duplicate pattern:

- first-level `Thread` and `Workspace` section buttons
- separate `ArtifactTabs` row below them

The change should remove that duplicate top-level relationship.

- [ ] **Step 2: Update component state and imports**

In `ThreadArtifactSidebar.vue`:

- Import `watch` in addition to `computed` and `ref`.
- Import `ThreadArtifactDrawerSection`, `ThreadWorkspaceDrawerSection`, and `ThreadWorkspaceSectionId`.
- Add `const activeSectionId = ref<ThreadWorkspaceSectionId>(props.workspaceModel?.activeSectionId ?? 'artifacts')`.
- Watch `props.workspaceModel?.activeSectionId` and set `activeSectionId` when the model changes.
- Keep `activeTab` for `Thread` subnavigation only.

- [ ] **Step 3: Replace template structure**

Render:

1. A compact header: `Workspace inspector`.
2. A first-level menu using `workspaceModel.sections`.
3. A body with exactly one active panel:
   - `Thread` panel: render `ArtifactTabs` and selected thread artifacts.
   - `Kanban` panel: deferred summary plus `Open board` label as inert text for now.
   - `Automations` panel: deferred summary referencing the high-level plan doc.
   - `Worktrees` panel: render worktree/run artifacts.
   - `Artifacts` panel: render all artifacts.
   - `Actions` and `Permissions`: deferred summaries.

Use helper functions:

```ts
function selectWorkspaceSection(section: ThreadWorkspaceDrawerSection): void
function isSectionActive(sectionId: ThreadWorkspaceSectionId): boolean
function artifactsForKinds(kinds: WorkspaceArtifact['kind'][]): WorkspaceArtifact[]
function panelTitle(sectionId: ThreadWorkspaceSectionId): string
function panelCopy(sectionId: ThreadWorkspaceSectionId): string
```

- [ ] **Step 4: Update styles**

Update scoped CSS so:

- first-level menu is a vertical list of stable-height buttons
- active button has a clear selected state
- disabled/deferred buttons remain readable
- no card is nested inside another card
- dark selectors cover menu, panels, and deferred notes

- [ ] **Step 5: Update manual tests**

Append to `tests.md`:

```md
### Feature: Right sidebar first-level workspace menu

#### Prerequisites
- App is running from this repository.
- At least one thread exists.
- Light and dark themes are available from Settings.

#### Steps
1. Open an existing thread in light theme.
2. Open the right sidebar.
3. Confirm the first-level menu shows Thread, Kanban, Automations, Worktrees, Artifacts, Actions, and Permissions.
4. Click Thread and confirm Plan, Run, Evidence, Review, and Proposals appear only inside the Thread panel.
5. Click Kanban, Automations, Worktrees, and Artifacts and confirm each replaces the panel content instead of stacking below the previous content.
6. Switch to dark theme and repeat steps 2-5.

#### Expected Results
- The old duplicated first-level Plan/Run/Evidence/Review/Proposals buttons are gone.
- Only one first-level section panel is visible at a time.
- Thread artifact subnavigation appears only inside Thread.
- Deferred sections explain that wiring lands later and do not perform actions.
- Light and dark themes remain readable.

#### Rollback/Cleanup
- None.
```

- [ ] **Step 6: Run focused tests and build**

Run:

```bash
pnpm vitest run src/composables/useThreadWorkspace.test.ts src/composables/useThreadArtifacts.test.ts
pnpm run build
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/components/artifacts/ThreadArtifactSidebar.vue tests.md
git commit -m "feat: clean up right sidebar workspace menu"
```

## Final Verification

Run:

```bash
pnpm vitest run src/composables/useThreadWorkspace.test.ts src/composables/useThreadArtifacts.test.ts
pnpm run build
git diff --check
```

Expected: all pass.

No CJS smoke test is required because this change does not alter package/runtime/module loading behavior.
