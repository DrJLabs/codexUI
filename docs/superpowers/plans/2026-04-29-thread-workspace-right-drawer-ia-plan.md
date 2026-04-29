# Thread Workspace And Right Drawer IA Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Define the thread workspace model and turn the right-side drawer into the stable home for thread-scoped and project-scoped Codex Desktop parity surfaces without implementing chat/proposal automation yet.

**Architecture:** The merged `dev` branch already has the first desktop-parity primitives: right drawer shell, indexed workspace artifacts, run profiles, evidence panels, proposal cards, worktree panels, and local action registry. This phase adds a typed client-side workspace model and organizes the existing right drawer into explicit thread and project-scoped surfaces while preserving the current route gate: the right drawer opens from a selected thread. Chat-session hooks, automatic proposal tasks, global workspace drawer access, and rich worktree/action data panels are deferred to follow-up work until their data contracts are explicit.

**Tech Stack:** Vue 3 composition API, TypeScript, Express artifact APIs, Vitest, Playwright for requested browser verification.

---

## Base Truth And Branching

This plan is authored in a worktree created from `dev`, which already contains the merged desktop-parity primitive work.

- Worktree: `/home/drj/projects/codexUI-thread-workspace-right-drawer-ia-dev`
- Branch: `feature/thread-workspace-right-drawer-ia-dev`
- Base SHA: `3c4fbb75872406aee651483c876925e9f1aa9a77` (`origin/dev`)

Implementation can continue in this worktree after the plan is approved. If a fresh worktree is preferred, recreate it from updated `dev` with the same descriptive branch name:

```bash
git fetch origin --prune
git switch dev
git pull --ff-only origin dev
git worktree add /home/drj/projects/codexUI-thread-workspace-right-drawer-ia-dev -b feature/thread-workspace-right-drawer-ia-dev dev
```

## Scope

In scope:

- Create one typed model for the selected thread workspace.
- Split right-drawer information architecture into thread-scoped and project-scoped sections inside the selected-thread drawer.
- Keep current mobile behavior: right drawer opens by icon and right-edge swipe.
- Make existing artifact tabs reachable through a coherent drawer model; represent worktree artifacts through the current Run tab and leave local actions/permissions/automations disabled until their drawer data contracts are implemented.
- Add disabled/deferred entries for chat integrations and automatic proposal tasks so the future work has a visible home without pretending it is implemented.
- Update `tests.md` with manual light/dark and mobile verification.

Out of scope:

- No automatic proposal task creation.
- No chat hook execution.
- No background automations.
- No new Codex app-server protocol fields.
- No arbitrary file reads.
- No merge/push actions.
- No default enablement of dangerous options.
- No global right-drawer entry point outside selected thread routes.
- No rich `WorktreeListPanel` or `ProjectActionsMenu` wiring; this phase only shows artifact-derived counts and disabled future entries.

## File Map

Create:

- `src/types/threadWorkspace.ts` - neutral client-side types for drawer scope, section IDs, counts, and deferred capabilities.
- `src/composables/useThreadWorkspace.ts` - derives thread/workspace drawer model from selected thread, artifacts, Kanban-adjacent counts, and execution policy.
- `src/composables/useThreadWorkspace.test.ts` - unit tests for section ordering, scope separation, and deferred chat integration markers.
- `src/components/artifacts/ThreadWorkspaceHeader.vue` - compact drawer header showing selected thread, artifact count, workspace state, and deferred integration marker.

Modify:

- `src/App.vue` - replace ad hoc drawer labels/counts with `useThreadWorkspace`, preserve current icon and right-edge swipe behavior.
- `src/components/artifacts/ThreadArtifactSidebar.vue` - render sections from the workspace model instead of hardcoded tabs only.
- `tests.md` - append this phase's manual and automated verification.

Read but avoid broad edits:

- `src/composables/useThreadArtifacts.ts`
- `src/types/workspaceArtifacts.ts`
- `src/components/artifacts/proposals/ArtifactProposalsPanel.vue`
- `src/components/artifacts/review/ArtifactReviewPacketPanel.vue`
- `src/components/artifacts/evidence/ArtifactEvidencePanel.vue`
- `src/components/artifacts/worktree/WorktreeListPanel.vue`
- `src/components/actions/ProjectActionsMenu.vue`
- `src/server/artifacts/routes.ts`
- `src/server/actions/actionRegistry.ts`

## Drawer IA Contract

Thread-scoped sections:

```ts
type ThreadWorkspaceSectionId =
  | 'plan'
  | 'run'
  | 'evidence'
  | 'review'
  | 'proposals'
```

Workspace-scoped sections:

```ts
type WorkspaceSectionId =
  | 'worktrees'
  | 'actions'
  | 'permissions'
  | 'automations_deferred'
```

Rules:

- Thread sections depend on `selectedThreadId`.
- The model may represent project-scoped sections without a selected thread for future reuse, but `App.vue` must keep the current selected-thread route gate in this phase.
- `automations_deferred` is visible as disabled so the later chat-integration phase has an obvious home; it does not perform actions.
- Section counts must come from indexed artifacts or explicit inputs, not DOM inspection.
- The drawer must never hide the chat composer or permanently steal layout height.
- `worktrees` maps to the existing Run artifact tab in this phase because `useThreadArtifacts.ts` groups `worktree` artifacts with `run_metadata`; `actions`, `permissions`, and `automations_deferred` stay disabled.

## Task 1: Add Workspace Types

**Files:**

- Create: `src/types/threadWorkspace.ts`

- [ ] **Step 1: Write the type file**

Create `src/types/threadWorkspace.ts` with:

```ts
export type ThreadWorkspaceSectionId =
  | 'plan'
  | 'run'
  | 'evidence'
  | 'review'
  | 'proposals'

export type WorkspaceSectionId =
  | 'worktrees'
  | 'actions'
  | 'permissions'
  | 'automations_deferred'

export type ThreadWorkspaceDrawerSection = {
  id: ThreadWorkspaceSectionId | WorkspaceSectionId
  scope: 'thread' | 'workspace'
  label: string
  count: number
  enabled: boolean
  deferred: boolean
  reason: string
}

export type ThreadWorkspaceModel = {
  threadId: string
  hasThread: boolean
  artifactCount: number
  activeSectionId: ThreadWorkspaceDrawerSection['id']
  threadSections: ThreadWorkspaceDrawerSection[]
  workspaceSections: ThreadWorkspaceDrawerSection[]
  deferredFollowUps: Array<{
    id: 'chat_integration_wiring'
    notePath: string
    reason: string
  }>
}
```

- [ ] **Step 2: Run type check enough to catch syntax errors**

Run:

```bash
pnpm exec vue-tsc --noEmit
```

Expected: it may fail before consumers exist only if the file has syntax errors. Fix syntax before proceeding.

- [ ] **Step 3: Commit**

```bash
git add src/types/threadWorkspace.ts
git commit -m "feat: add thread workspace drawer types"
```

## Task 2: Build The Drawer Model Composable

**Files:**

- Create: `src/composables/useThreadWorkspace.ts`
- Create: `src/composables/useThreadWorkspace.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/composables/useThreadWorkspace.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { computed, ref } from 'vue'
import type { WorkspaceArtifact } from '../types/workspaceArtifacts'
import { useThreadWorkspace } from './useThreadWorkspace'

const baseArtifact = {
  id: 'kanban:evidence:run_1',
  source: 'kanban',
  kind: 'evidence',
  title: 'Run evidence',
  threadId: 'thread_1',
  runId: 'run_1',
} satisfies WorkspaceArtifact

describe('useThreadWorkspace', () => {
  it('separates thread and workspace sections for a selected thread', () => {
    const model = useThreadWorkspace({
      threadId: ref('thread_1'),
      artifacts: computed(() => [baseArtifact]),
      proposalCount: ref(2),
      activeWorktreeCount: ref(1),
      availableActionCount: ref(3),
    })

    expect(model.value.hasThread).toBe(true)
    expect(model.value.artifactCount).toBe(1)
    expect(model.value.threadSections.map((section) => section.id)).toEqual([
      'plan',
      'run',
      'evidence',
      'review',
      'proposals',
    ])
    expect(model.value.workspaceSections.map((section) => section.id)).toEqual([
      'worktrees',
      'actions',
      'permissions',
      'automations_deferred',
    ])
    expect(model.value.threadSections.find((section) => section.id === 'evidence')).toMatchObject({
      count: 1,
      enabled: true,
      deferred: false,
    })
    expect(model.value.threadSections.find((section) => section.id === 'proposals')).toMatchObject({
      count: 2,
      enabled: true,
    })
    expect(model.value.workspaceSections.find((section) => section.id === 'automations_deferred')).toMatchObject({
      enabled: false,
      deferred: true,
    })
  })

  it('keeps project-scoped sections in the model but disabled without a selected thread', () => {
    const model = useThreadWorkspace({
      threadId: ref(''),
      artifacts: computed(() => [baseArtifact]),
      proposalCount: ref(0),
      activeWorktreeCount: ref(1),
      availableActionCount: ref(0),
    })

    expect(model.value.hasThread).toBe(false)
    expect(model.value.artifactCount).toBe(0)
    expect(model.value.threadSections.every((section) => section.enabled === false)).toBe(true)
    expect(model.value.workspaceSections.find((section) => section.id === 'worktrees')).toMatchObject({
      count: 1,
      enabled: false,
      deferred: false,
    })
    expect(model.value.workspaceSections.find((section) => section.id === 'actions')).toMatchObject({
      count: 0,
      enabled: false,
      deferred: true,
    })
    expect(model.value.deferredFollowUps).toEqual([
      {
        id: 'chat_integration_wiring',
        notePath: 'docs/superpowers/notes/2026-04-29-chat-integration-wiring-follow-up.md',
        reason: 'Kanban chat hooks are required before automatic proposal tasks can be enabled.',
      },
    ])
  })
})
```

- [ ] **Step 2: Run the failing test**

```bash
pnpm vitest run src/composables/useThreadWorkspace.test.ts
```

Expected: fail because `useThreadWorkspace` does not exist.

- [ ] **Step 3: Implement the composable**

Create `src/composables/useThreadWorkspace.ts`:

```ts
import { computed, type Ref } from 'vue'
import type { ThreadWorkspaceDrawerSection, ThreadWorkspaceModel } from '../types/threadWorkspace'
import type { WorkspaceArtifact } from '../types/workspaceArtifacts'

type CountRef = Ref<number>

export function useThreadWorkspace(input: {
  threadId: Ref<string>
  artifacts: Ref<WorkspaceArtifact[]>
  proposalCount: CountRef
  activeWorktreeCount: CountRef
  availableActionCount?: CountRef
}) {
  return computed<ThreadWorkspaceModel>(() => {
    const threadId = input.threadId.value.trim()
    const threadArtifacts = threadId
      ? input.artifacts.value.filter((artifact) => artifact.threadId === threadId)
      : []
    const artifactCount = threadArtifacts.length
    const evidenceCount = threadArtifacts.filter((artifact) => artifact.kind === 'evidence').length
    const reviewCount = threadArtifacts.filter((artifact) => artifact.kind === 'review_packet').length
    const runCount = threadArtifacts.filter((artifact) => artifact.kind === 'run_metadata').length
    const planCount = threadArtifacts.filter((artifact) => artifact.kind === 'plan').length
    const hasThread = Boolean(threadId)

    const disabledThreadReason = hasThread ? '' : 'Select a thread to inspect thread workspace artifacts.'
    const threadSections: ThreadWorkspaceDrawerSection[] = [
      createSection('plan', 'thread', 'Plan', planCount, hasThread, false, disabledThreadReason),
      createSection('run', 'thread', 'Run', runCount, hasThread, false, disabledThreadReason),
      createSection('evidence', 'thread', 'Evidence', evidenceCount, hasThread, false, disabledThreadReason),
      createSection('review', 'thread', 'Review', reviewCount, hasThread, false, disabledThreadReason),
      createSection('proposals', 'thread', 'Proposals', input.proposalCount.value, hasThread, false, disabledThreadReason),
    ]

    const workspaceSections: ThreadWorkspaceDrawerSection[] = [
      createSection('worktrees', 'workspace', 'Worktrees', input.activeWorktreeCount.value, hasThread, false, hasThread ? '' : 'Open a thread to inspect recorded worktree artifacts.'),
      createSection('actions', 'workspace', 'Actions', input.availableActionCount?.value ?? 0, false, true, 'Local action drawer wiring lands after the data contract is added.'),
      createSection('permissions', 'workspace', 'Permissions', 0, false, true, 'Permission controls land in a later phase.'),
      createSection(
        'automations_deferred',
        'workspace',
        'Automations',
        0,
        false,
        true,
        'Kanban chat hooks are required before automatic proposal tasks can be enabled.',
      ),
    ]

    return {
      threadId,
      hasThread,
      artifactCount,
      activeSectionId: hasThread ? 'evidence' : 'worktrees',
      threadSections,
      workspaceSections,
      deferredFollowUps: [
        {
          id: 'chat_integration_wiring',
          notePath: 'docs/superpowers/notes/2026-04-29-chat-integration-wiring-follow-up.md',
          reason: 'Kanban chat hooks are required before automatic proposal tasks can be enabled.',
        },
      ],
    }
  })
}

function createSection(
  id: ThreadWorkspaceDrawerSection['id'],
  scope: ThreadWorkspaceDrawerSection['scope'],
  label: string,
  count: number,
  enabled: boolean,
  deferred: boolean,
  reason: string,
): ThreadWorkspaceDrawerSection {
  return {
    id,
    scope,
    label,
    count: Math.max(0, Number.isFinite(count) ? count : 0),
    enabled,
    deferred,
    reason,
  }
}
```

- [ ] **Step 4: Run the tests**

```bash
pnpm vitest run src/composables/useThreadWorkspace.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/composables/useThreadWorkspace.ts src/composables/useThreadWorkspace.test.ts
git commit -m "feat: derive thread workspace drawer model"
```

## Task 3: Add Compact Drawer Header

**Files:**

- Create: `src/components/artifacts/ThreadWorkspaceHeader.vue`

- [ ] **Step 1: Create the component**

Create `src/components/artifacts/ThreadWorkspaceHeader.vue`:

```vue
<template>
  <header class="thread-workspace-header">
    <div>
      <p>{{ model.hasThread ? 'Thread workspace' : 'Workspace' }}</p>
      <strong>{{ model.hasThread ? model.threadId : 'No thread selected' }}</strong>
    </div>
    <span>{{ model.artifactCount }} artifacts</span>
  </header>
</template>

<script setup lang="ts">
import type { ThreadWorkspaceModel } from '../../types/threadWorkspace'

defineProps<{
  model: ThreadWorkspaceModel
}>()
</script>

<style scoped>
.thread-workspace-header {
  display: flex;
  align-items: start;
  justify-content: space-between;
  gap: 12px;
  border-bottom: 1px solid #e4e4e7;
  padding: 12px;
}

.thread-workspace-header p,
.thread-workspace-header strong {
  margin: 0;
}

.thread-workspace-header p,
.thread-workspace-header span {
  color: #71717a;
  font-size: 11px;
  font-weight: 800;
}

.thread-workspace-header strong {
  display: block;
  max-width: 16rem;
  overflow: hidden;
  color: #18181b;
  font-size: 13px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

:global(:root.dark) .thread-workspace-header {
  border-bottom-color: #3f3f46;
}

:global(:root.dark) .thread-workspace-header strong {
  color: #f4f4f5;
}

:global(:root.dark) .thread-workspace-header p,
:global(:root.dark) .thread-workspace-header span {
  color: #a1a1aa;
}
</style>
```

- [ ] **Step 2: Build**

```bash
pnpm run build
```

Expected: pass.

- [ ] **Step 3: Commit**

```bash
git add src/components/artifacts/ThreadWorkspaceHeader.vue
git commit -m "feat: add thread workspace drawer header"
```

## Task 4: Wire The Model Into The Right Drawer

**Files:**

- Modify: `src/App.vue`
- Modify: `src/components/artifacts/ThreadArtifactSidebar.vue`

- [ ] **Step 1: Update `App.vue` imports**

Add imports near existing artifact imports:

```ts
import { useThreadWorkspace } from './composables/useThreadWorkspace'
```

Add the async component near the existing `ThreadArtifactSidebar` async component:

```ts
const ThreadWorkspaceHeader = defineAsyncComponent(() => import('./components/artifacts/ThreadWorkspaceHeader.vue'))
```

- [ ] **Step 2: Add drawer model state in `App.vue`**

Near existing `selectedThreadArtifacts` state, add:

```ts
const threadWorkspaceModel = useThreadWorkspace({
  threadId: selectedThreadId,
  artifacts: selectedThreadArtifacts,
  proposalCount: computed(() => selectedThreadArtifacts.value.filter((artifact) => artifact.kind === 'proposal').length),
  activeWorktreeCount: computed(() => selectedThreadArtifacts.value.filter((artifact) => artifact.kind === 'worktree').length),
})
```

`selectedThreadId` is already provided by the desktop state block in current `dev` and is the same source used by `loadSelectedThreadArtifacts()`. Do not introduce another selected-thread ref.
Do not add a local-action count in this phase. `ProjectActionsMenu` exists, but `App.vue` does not currently have a drawer-safe client data source for discovered actions; the Actions row stays disabled until that contract is added.

- [ ] **Step 3: Render the header and pass model to sidebar**

In the right drawer panel, replace the current header/sidebar block with:

```vue
<div class="artifact-drawer-header">
  <button
    type="button"
    class="artifact-drawer-close"
    :aria-label="t('Close artifacts')"
    :title="t('Close artifacts')"
    @click="closeArtifactDrawer"
  >
    <IconTablerX class="artifact-drawer-close-icon" />
  </button>
</div>
<ThreadWorkspaceHeader :model="threadWorkspaceModel" />
<ThreadArtifactSidebar
  class="artifact-drawer-sidebar"
  :thread-id="threadWorkspaceModel.threadId"
  :artifacts="selectedThreadArtifacts"
  :workspace-model="threadWorkspaceModel"
/>
```

- [ ] **Step 4: Update `ThreadArtifactSidebar.vue` props**

Add:

```ts
import type { ThreadWorkspaceDrawerSection, ThreadWorkspaceModel } from '../../types/threadWorkspace'
```

Extend props:

```ts
workspaceModel?: ThreadWorkspaceModel | null
```

Default it:

```ts
workspaceModel: null,
```

Add section-selection helpers below the existing computed values:

```ts
function selectThreadWorkspaceSection(section: ThreadWorkspaceDrawerSection): void {
  if (!section.enabled || section.scope !== 'thread') return
  activeTab.value = toThreadArtifactTab(section.id)
}

function selectProjectWorkspaceSection(section: ThreadWorkspaceDrawerSection): void {
  if (!section.enabled || section.scope !== 'workspace') return
  if (section.id === 'worktrees') {
    activeTab.value = 'run'
  }
}

function toThreadArtifactTab(sectionId: ThreadWorkspaceDrawerSection['id']): ThreadArtifactTabId {
  if (sectionId === 'run') return 'run'
  if (sectionId === 'evidence') return 'evidence'
  if (sectionId === 'review' || sectionId === 'proposals') return 'review'
  return 'plan'
}
```

- [ ] **Step 5: Remove duplicate sidebar header when the workspace model is present**

The parent drawer renders `ThreadWorkspaceHeader`, so the old internal `thread-artifact-sidebar-header` should only render for compatibility when no workspace model is passed:

```vue
<header
  v-if="!workspaceModel"
  class="thread-artifact-sidebar-header"
>
  <div>
    <p>Artifacts</p>
    <strong>{{ threadId ? 'Thread workspace' : 'No thread selected' }}</strong>
  </div>
  <span>{{ allArtifacts.length }}</span>
</header>
```

- [ ] **Step 6: Update sidebar rendering**

Render thread and workspace section groups before existing visible artifact list:

```vue
<div v-if="workspaceModel" class="thread-artifact-section-groups">
  <section class="thread-artifact-section-group">
    <h3>Thread</h3>
    <button
      v-for="section in workspaceModel.threadSections"
      :key="section.id"
      type="button"
      class="thread-artifact-section-button"
      :disabled="!section.enabled"
      :title="section.reason"
      @click="selectThreadWorkspaceSection(section)"
    >
      <span>{{ section.label }}</span>
      <small>{{ section.deferred ? 'Later' : section.count }}</small>
    </button>
  </section>
  <section class="thread-artifact-section-group">
    <h3>Workspace</h3>
    <button
      v-for="section in workspaceModel.workspaceSections"
      :key="section.id"
      type="button"
      class="thread-artifact-section-button"
      :disabled="!section.enabled"
      :title="section.reason"
      @click="selectProjectWorkspaceSection(section)"
    >
      <span>{{ section.label }}</span>
      <small>{{ section.deferred ? 'Later' : section.count }}</small>
    </button>
  </section>
</div>
```

Keep the existing artifact tab list and item list below this section. `proposals` maps to the existing `review` tab because `useThreadArtifacts.ts` currently groups `proposal` artifacts with `review_packet` artifacts under `review`. `worktrees` maps to the existing `run` tab because `useThreadArtifacts.ts` currently groups `worktree` artifacts with `run_metadata` artifacts under `run`.

Do not render `WorktreeListPanel` or `ProjectActionsMenu` in this phase. `WorktreeListPanel` needs a managed-worktree list source and `ProjectActionsMenu` needs a local-action discovery source plus execution policy state in `App.vue`; neither is present in the current drawer data flow.

- [ ] **Step 7: Add sidebar styles**

Add scoped styles:

```css
.thread-artifact-section-groups {
  display: grid;
  gap: 12px;
  padding: 12px;
}

.thread-artifact-section-group {
  display: grid;
  gap: 6px;
}

.thread-artifact-section-group h3 {
  margin: 0;
  color: #71717a;
  font-size: 11px;
  font-weight: 900;
  text-transform: uppercase;
}

.thread-artifact-section-button {
  display: flex;
  min-height: 34px;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  border: 1px solid #e4e4e7;
  border-radius: 8px;
  background: #fff;
  padding: 7px 9px;
  color: #27272a;
  font-size: 12px;
  font-weight: 800;
  cursor: pointer;
}

.thread-artifact-section-button:disabled {
  cursor: default;
  opacity: 0.55;
}

.thread-artifact-section-button small {
  color: #71717a;
  font-size: 11px;
  font-weight: 800;
}

:global(:root.dark) .thread-artifact-section-group h3,
:global(:root.dark) .thread-artifact-section-button small {
  color: #a1a1aa;
}

:global(:root.dark) .thread-artifact-section-button {
  border-color: #3f3f46;
  background: #18181b;
  color: #f4f4f5;
}
```

- [ ] **Step 8: Build**

```bash
pnpm run build
```

Expected: pass.

- [ ] **Step 9: Commit**

```bash
git add src/App.vue src/components/artifacts/ThreadArtifactSidebar.vue
git commit -m "feat: organize right drawer workspace sections"
```

## Task 5: Add Deferred Chat Integration Marker Without Enabling It

**Files:**

- Modify: `src/components/artifacts/ThreadArtifactSidebar.vue`
- Read: `docs/superpowers/notes/2026-04-29-chat-integration-wiring-follow-up.md`

- [ ] **Step 1: Add a small deferred row**

In `ThreadArtifactSidebar.vue`, render the deferred follow-up after workspace sections:

```vue
<p
  v-if="workspaceModel?.deferredFollowUps.length"
  class="thread-artifact-deferred-note"
>
  Chat integration wiring is tracked for a later phase.
</p>
```

- [ ] **Step 2: Add styles**

```css
.thread-artifact-deferred-note {
  margin: 0;
  border: 1px dashed #d4d4d8;
  border-radius: 8px;
  padding: 8px;
  color: #71717a;
  font-size: 11px;
  font-weight: 750;
  line-height: 1.35;
}

:global(:root.dark) .thread-artifact-deferred-note {
  border-color: #52525b;
  color: #a1a1aa;
}
```

- [ ] **Step 3: Confirm no automatic behavior was added**

Run:

```bash
rg -n "automations_deferred|chat_integration_wiring|proposalPolicy|auto" src docs/superpowers/notes/2026-04-29-chat-integration-wiring-follow-up.md
```

Expected:

- The new marker exists.
- No new code starts a run, creates a task, or approves a proposal from a chat message.

- [ ] **Step 4: Commit**

```bash
git add src/components/artifacts/ThreadArtifactSidebar.vue
git commit -m "docs: surface deferred chat integration marker"
```

## Task 6: Update Tests Documentation

**Files:**

- Modify: `tests.md`

- [ ] **Step 1: Append manual verification section**

Append:

```md
## Thread Workspace Right Drawer IA

### Prerequisites/Setup
- Start the dev server with `pnpm run dev -- --host 0.0.0.0 --port 5173`.
- Open a normal chat thread with the right artifact drawer available.
- Use browser viewports of 1440x900 for desktop, 768x1024 for tablet, and 375x812 for mobile checks.

### Steps
1. In light theme, open a normal chat thread and click the right drawer icon.
2. Confirm the drawer opens without hiding the chat composer.
3. Confirm the drawer shows a compact workspace header, Thread sections, Workspace sections, and the deferred chat integration marker.
4. Close the drawer and reopen it by dragging from the right screen edge on mobile.
5. At 768x1024, confirm the drawer remains usable and the composer remains visible.
6. Navigate to the home/new-thread route and confirm right drawer entry points are hidden and right-edge swipe does not open the drawer.
7. Switch to dark theme and repeat steps 1-6.
8. Select a different thread and confirm the header and artifact counts refresh.

### Expected Results
- The right drawer opens by icon and by right-edge swipe on mobile.
- Thread sections are disabled when no thread is selected.
- The drawer remains gated to selected thread routes in this phase.
- On non-thread routes, right drawer entry points are hidden and right-edge swipe does not open the drawer.
- Workspace rows render inside the selected-thread drawer; Worktrees switches to the Run tab when enabled.
- Actions, Permissions, and Automations are visible but disabled/deferred.
- The chat composer remains visible after switching threads and after opening/closing the drawer.
- Light and dark themes have readable surfaces and controls.

### Rollback/Cleanup
- Stop the dev server.
- Remove any test-only chat threads or generated artifacts if created during manual testing.
```

- [ ] **Step 2: Commit**

```bash
git add tests.md
git commit -m "docs: add right drawer IA verification"
```

## Task 7: Verify With Unit Tests, Build, And Playwright

**Files:**

- No source edits unless verification finds a bug.

- [ ] **Step 1: Run unit tests**

```bash
pnpm vitest run src/composables/useThreadWorkspace.test.ts src/composables/useThreadArtifacts.test.ts src/composables/useArtifactEvidence.test.ts
```

Expected: all tests pass.

- [ ] **Step 2: Run build**

```bash
pnpm run build
```

Expected: build succeeds.

- [ ] **Step 3: Start dev server for browser checks**

```bash
pnpm run dev -- --host 0.0.0.0 --port 5173
```

Expected: Vite serves the app on `http://127.0.0.1:5173`.

- [ ] **Step 4: Run Playwright drawer/composer regression check**

Use a CJS Playwright script under `output/playwright/thread-workspace-drawer-check.cjs`:

```js
const { chromium } = require('playwright')

async function main() {
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  await page.goto('http://127.0.0.1:5173', { waitUntil: 'networkidle' })
  await page.waitForTimeout(2000)
  const firstThread = page.locator('.thread-main-button').first()
  if (!(await firstThread.isVisible().catch(() => false))) {
    throw new Error('No existing thread row is available for drawer verification')
  }
  await firstThread.click()
  await page.waitForSelector('.artifact-drawer-edge-toggle', { state: 'visible', timeout: 10000 })
  await page.setViewportSize({ width: 375, height: 812 })
  await page.waitForTimeout(500)
  const drawerButton = page.locator('.artifact-drawer-edge-toggle').first()
  await drawerButton.click()
  await page.waitForTimeout(500)
  const drawerVisible = await page.locator('.artifact-drawer-panel').isVisible()
  const composerVisible = await page.locator('textarea, [contenteditable="true"]').last().isVisible().catch(() => false)
  await page.screenshot({ path: 'output/playwright/thread-workspace-drawer-mobile.png', fullPage: true })
  await page.locator('.artifact-drawer-close').click()
  await page.waitForTimeout(300)
  await page.mouse.move(374, 400)
  await page.mouse.down()
  await page.mouse.move(300, 400, { steps: 8 })
  await page.mouse.up()
  await page.waitForTimeout(500)
  const swipeDrawerVisible = await page.locator('.artifact-drawer-panel').isVisible()
  await page.screenshot({ path: 'output/playwright/thread-workspace-drawer-mobile-swipe.png', fullPage: true })
  await browser.close()
  if (!drawerVisible) throw new Error('Right drawer did not open')
  if (!swipeDrawerVisible) throw new Error('Right drawer did not open from right-edge swipe')
  if (!composerVisible) throw new Error('Chat composer disappeared after opening right drawer')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
```

Run:

```bash
node output/playwright/thread-workspace-drawer-check.cjs
```

Expected: script exits 0 and writes `output/playwright/thread-workspace-drawer-mobile.png` plus `output/playwright/thread-workspace-drawer-mobile-swipe.png`.

- [ ] **Step 5: Commit fixes if verification found issues**

If any verification step required code changes:

```bash
git add src/App.vue src/components/artifacts/ThreadArtifactSidebar.vue src/components/artifacts/ThreadWorkspaceHeader.vue src/composables/useThreadWorkspace.ts src/composables/useThreadWorkspace.test.ts src/types/threadWorkspace.ts tests.md
git commit -m "fix: verify right drawer workspace behavior"
```

## Task 8: PR And Review

**Files:**

- No source edits unless review finds a bug.

- [ ] **Step 1: Push branch**

```bash
git push -u origin feature/thread-workspace-right-drawer-ia-dev
```

- [ ] **Step 2: Open PR to `dev`**

```bash
gh -R DrJLabs/codexUI pr create \
  --base dev \
  --head feature/thread-workspace-right-drawer-ia-dev \
  --title "feat: define thread workspace right drawer IA" \
  --body "Adds a typed thread workspace drawer model, organizes right drawer sections, and leaves chat/proposal automation deferred until Kanban-chat hooks are designed."
```

- [ ] **Step 3: Request adversarial review**

Run local review before bot review:

```bash
git diff --stat origin/dev...HEAD
git diff origin/dev...HEAD
pnpm vitest run src/composables/useThreadWorkspace.test.ts src/composables/useThreadArtifacts.test.ts src/composables/useArtifactEvidence.test.ts
pnpm run build
```

Expected: diff is scoped, tests pass, build passes.

## Just-In-Time Checks Before The Next Phase

Before implementing the later chat integration phase, do another JIT pass. That pass must inspect the then-current code for:

- How thread IDs are stored and resumed.
- Whether chat session hooks exist or need a server-side event bus.
- How a chat message should reference a Kanban task, run, proposal, and artifact.
- Whether `proposalPolicy: auto` should only approve inert proposals or can ever create tasks.
- Whether the right drawer should show chat-generated proposals in thread scope, workspace scope, or both.
- What prevents duplicate task creation if a chat hook retries.

Do not implement automatic proposal tasks until those questions are answered in a new plan.
