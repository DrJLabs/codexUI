# Desktop Right Sidebar Upstream Extraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a clean upstream PR branch from updated `main` that adds a desktop-like right Summary sidebar without carrying unrelated `dev` features such as Kanban, Automations, local actions, review packets, or workspace artifact contracts.

**Architecture:** Use `upstream/main` as the implementation base because it already contains the current `ReviewPane` and header side-panel controls. Treat `dev` as a reference-only branch: reuse the drawer/toggle mechanics and dark/mobile styling ideas, but replace the visible IA with the desktop app's Summary panel sections. The first PR should add a minimal, static-but-real sidebar shell with `Summary`, `Progress`, `Artifacts`, and `Sources`; richer data wiring can land later.

**Tech Stack:** Vue 3 Composition API, TypeScript, Vitest for pure section-model tests, existing scoped CSS/Tailwind `@apply`, existing `ContentHeader`, `ReviewPane`, and Tabler icon components.

---

## Current Truth

- Current worktree branch at plan creation: `dev`.
- Local `dev`: `4af1d9bbd8937baa7f63d6648a9fd8ce2552c248`.
- Local `main` before refresh: `0acf1f5bee80f9e29c46e36f65f02aac2abc7821`.
- Fresh `upstream/main`: `3d7c41eaa334391ff652a93c33317dccf5ee7582`.
- `main...upstream/main`: `0 10`, so local `main` must be fast-forwarded before creating the upstream branch.
- `dev...main`: `111 0`, so `dev` is much broader than the clean upstream base.
- `dev` adds Kanban, Automations, artifact evidence, proposals, worktrees, local actions, and many docs. Do not branch or cherry-pick wholesale from `dev`.

## Desktop Reference Evidence

Live Linux Codex desktop reference:

- CDP endpoint: `http://127.0.0.1:3435/json/list`.
- Page target URL: `http://127.0.0.1:5176/?hostId=local&mcpAppSandboxDevtools=1`.
- Page title: `Codex`.
- Screenshot before opening the side panel: `output/playwright/desktop-right-sidebar-thread-before-toggle.png`.
- Screenshot with live right panel open: `output/playwright/desktop-right-sidebar-cdp-reference-open.png`.
- Screenshot after probing the side-panel tab affordance: `output/playwright/desktop-right-sidebar-cdp-tab-menu.png`.

What CDP confirmed:

- The desktop app uses a docked right panel, not a full page route.
- The top-right header has compact icon controls for terminal, workspace/review, and side panel visibility.
- The open right panel has a narrow tab header, a plus affordance for opening another side-panel tab, and an expand control.
- The currently reachable live panel opened as `Review`, because the thread had local git changes.

What the supplied image contributes:

- The target first tab is `Summary`.
- The Summary empty state is a simple vertical list:
  - `Progress` / `Progress displayed for longer responses`
  - `Artifacts` / `View and open files`
  - `Sources` / `Track sources used`
- The first PR should match this Summary IA, not the `dev` branch workspace-inspector IA.

## Branch And Worktree Plan

- [ ] **Step 1: Confirm clean status in the current checkout**

Run:

```bash
git status --short --branch
git worktree list
```

Expected:

- Current checkout may show untracked local-only files such as `.serena/`; do not stage them.
- No merge or rebase should be in progress.

- [ ] **Step 2: Refresh upstream base**

Run:

```bash
git fetch upstream main --prune
git switch main
git merge --ff-only upstream/main
git push origin main
```

Expected:

- `main` fast-forwards to `3d7c41eaa334391ff652a93c33317dccf5ee7582` or newer.
- If fast-forward fails, stop and resolve branch drift before continuing.

- [ ] **Step 3: Create the clean upstream worktree**

Run:

```bash
git worktree add ../codexUI-desktop-right-sidebar-upstream -b feature/desktop-right-sidebar-upstream main
cd ../codexUI-desktop-right-sidebar-upstream
git rev-parse HEAD
```

Expected:

- Worktree path: `/home/drj/projects/codexUI-desktop-right-sidebar-upstream`.
- Branch: `feature/desktop-right-sidebar-upstream`.
- Base SHA equals refreshed `main`.

## What To Reuse From `dev`

Reusable ideas:

- `src/App.vue` right-edge toggle concept from `dev`, specifically the header icon state, mobile overlay behavior, and right-panel transition class names.
- `IconTablerLayoutSidebar`, `IconTablerLayoutSidebarFilled`, and `IconTablerX`, which already exist on `upstream/main`.
- Dark-theme selector style from the `dev` drawer work, rewritten against the new component names.
- The idea of an `Artifacts` empty state, but not the artifact data model.

Reference commands:

```bash
git diff upstream/main..dev -- src/App.vue | rg -n "artifact|right|drawer|ThreadArtifactSidebar|side"
git show dev:src/components/artifacts/ThreadArtifactSidebar.vue
git show dev:src/composables/useThreadWorkspace.ts
```

Do not reuse as-is:

- `src/composables/useThreadWorkspace.ts`
- `src/types/threadWorkspace.ts`
- `src/components/artifacts/ThreadWorkspaceHeader.vue`
- `ThreadArtifactSidebar.vue` visible section IA
- Any `src/components/kanban/*`
- Any `src/components/automations/*`
- Any `src/types/kanban.ts`, `src/types/automations.ts`, `src/types/localActions.ts`, `src/types/proposal.ts`, `src/types/worktree.ts`
- Any server or route work required only by Kanban/Automations
- Dev docs for Kanban and Automations

## File Map For The Clean Branch

Create:

- `src/types/threadSummary.ts`
  - Defines the stable section IDs and readonly section shape for the Summary sidebar.

- `src/composables/useThreadSummarySections.ts`
  - Returns the desktop-like Summary sections in a testable pure/computed model.

- `src/composables/useThreadSummarySections.test.ts`
  - Verifies section order and empty-state copy without requiring a browser.

- `src/components/content/ThreadSummaryPane.vue`
  - Renders the right Summary panel shell and sections.

Modify:

- `src/App.vue`
  - Adds Summary panel state.
  - Adds a header icon button for the Summary side panel.
  - Makes Summary and Review mutually exclusive.
  - Renders `ThreadSummaryPane` in the existing thread content area using the same side-panel behavior pattern as `ReviewPane`.

- `tests.md`
  - Adds manual light/dark verification for the desktop-like right Summary sidebar.

Read but do not copy wholesale:

- `src/components/content/ReviewPane.vue`
- `src/components/content/ContentHeader.vue`
- `src/components/content/HeaderGitBranchDropdown.vue`
- `src/App.vue` from `dev`
- `src/components/artifacts/ThreadArtifactSidebar.vue` from `dev`

## Task 1: Add The Summary Section Model

**Files:**

- Create: `src/types/threadSummary.ts`
- Create: `src/composables/useThreadSummarySections.ts`
- Create: `src/composables/useThreadSummarySections.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/composables/useThreadSummarySections.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { useThreadSummarySections } from './useThreadSummarySections'

describe('useThreadSummarySections', () => {
  it('returns the desktop summary sections in desktop order', () => {
    const sections = useThreadSummarySections()

    expect(sections.value.map((section) => section.id)).toEqual([
      'progress',
      'artifacts',
      'sources',
    ])
    expect(sections.value).toEqual([
      {
        id: 'progress',
        title: 'Progress',
        description: 'Progress displayed for longer responses',
        disabled: true,
      },
      {
        id: 'artifacts',
        title: 'Artifacts',
        description: 'View and open files',
        disabled: true,
      },
      {
        id: 'sources',
        title: 'Sources',
        description: 'Track sources used',
        disabled: true,
      },
    ])
  })
})
```

- [ ] **Step 2: Run RED**

Run:

```bash
pnpm vitest run src/composables/useThreadSummarySections.test.ts
```

Expected: FAIL because the composable does not exist.

- [ ] **Step 3: Add the type contract**

Create `src/types/threadSummary.ts`:

```ts
export type ThreadSummarySectionId = 'progress' | 'artifacts' | 'sources'

export type ThreadSummarySection = {
  id: ThreadSummarySectionId
  title: string
  description: string
  disabled: boolean
}
```

- [ ] **Step 4: Add the composable**

Create `src/composables/useThreadSummarySections.ts`:

```ts
import { computed } from 'vue'
import type { ThreadSummarySection } from '../types/threadSummary'

export function useThreadSummarySections() {
  return computed<ThreadSummarySection[]>(() => [
    {
      id: 'progress',
      title: 'Progress',
      description: 'Progress displayed for longer responses',
      disabled: true,
    },
    {
      id: 'artifacts',
      title: 'Artifacts',
      description: 'View and open files',
      disabled: true,
    },
    {
      id: 'sources',
      title: 'Sources',
      description: 'Track sources used',
      disabled: true,
    },
  ])
}
```

- [ ] **Step 5: Run GREEN**

Run:

```bash
pnpm vitest run src/composables/useThreadSummarySections.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```bash
git add src/types/threadSummary.ts src/composables/useThreadSummarySections.ts src/composables/useThreadSummarySections.test.ts
git commit -m "feat: add thread summary sidebar model"
```

## Task 2: Build The Desktop-Like Summary Pane

**Files:**

- Create: `src/components/content/ThreadSummaryPane.vue`

- [ ] **Step 1: Add the component**

Create `src/components/content/ThreadSummaryPane.vue`:

```vue
<template>
  <aside class="thread-summary-pane" aria-label="Thread summary">
    <header class="thread-summary-pane-header">
      <div class="thread-summary-pane-tab">
        <IconTablerLayoutSidebarFilled class="thread-summary-pane-tab-icon" />
        <span>Summary</span>
      </div>
      <div class="thread-summary-pane-actions">
        <button
          class="thread-summary-pane-icon-button"
          type="button"
          aria-label="Open side panel tab"
          title="Open side panel tab"
          disabled
        >
          <span aria-hidden="true">+</span>
        </button>
        <button
          class="thread-summary-pane-icon-button"
          type="button"
          aria-label="Expand panel"
          disabled
        >
          <IconTablerArrowsMaximize class="thread-summary-pane-action-icon" />
        </button>
        <button
          class="thread-summary-pane-icon-button"
          type="button"
          aria-label="Close summary pane"
          @click="$emit('close')"
        >
          <IconTablerX class="thread-summary-pane-action-icon" />
        </button>
      </div>
    </header>

    <section class="thread-summary-pane-body">
      <button
        v-for="section in sections"
        :key="section.id"
        class="thread-summary-section"
        type="button"
        :disabled="section.disabled"
      >
        <span class="thread-summary-section-title">{{ section.title }}</span>
        <span class="thread-summary-section-description">{{ section.description }}</span>
      </button>
    </section>
  </aside>
</template>

<script setup lang="ts">
import { useThreadSummarySections } from '../../composables/useThreadSummarySections'
import IconTablerArrowsMaximize from '../icons/IconTablerArrowsMaximize.vue'
import IconTablerLayoutSidebarFilled from '../icons/IconTablerLayoutSidebarFilled.vue'
import IconTablerX from '../icons/IconTablerX.vue'

defineEmits<{
  close: []
}>()

const sections = useThreadSummarySections()
</script>

<style scoped>
@reference "tailwindcss";

.thread-summary-pane {
  @apply flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white;
}

.thread-summary-pane-header {
  @apply flex h-11 shrink-0 items-center justify-between gap-2 border-b border-zinc-200 px-3;
}

.thread-summary-pane-tab {
  @apply inline-flex min-w-0 items-center gap-2 rounded-lg bg-zinc-100 px-2.5 py-1.5 text-sm font-semibold text-zinc-900;
}

.thread-summary-pane-tab-icon,
.thread-summary-pane-action-icon {
  @apply h-4 w-4 shrink-0;
}

.thread-summary-pane-actions {
  @apply ml-auto flex shrink-0 items-center gap-1;
}

.thread-summary-pane-icon-button {
  @apply inline-flex h-7 w-7 items-center justify-center rounded-lg border border-transparent text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900 disabled:cursor-default disabled:opacity-35 disabled:hover:bg-transparent disabled:hover:text-zinc-500;
}

.thread-summary-pane-body {
  @apply flex min-h-0 flex-1 flex-col gap-8 overflow-y-auto px-5 py-6;
}

.thread-summary-section {
  @apply flex flex-col items-start gap-3 rounded-md border-0 bg-transparent p-0 text-left disabled:cursor-default;
}

.thread-summary-section-title {
  @apply text-base font-semibold text-zinc-800;
}

.thread-summary-section-description {
  @apply text-base font-medium text-zinc-500;
}

:global(:root.dark) .thread-summary-pane {
  @apply border-zinc-800 bg-zinc-950;
}

:global(:root.dark) .thread-summary-pane-header {
  @apply border-zinc-800;
}

:global(:root.dark) .thread-summary-pane-tab {
  @apply bg-zinc-900 text-zinc-100;
}

:global(:root.dark) .thread-summary-pane-icon-button {
  @apply text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100 disabled:hover:bg-transparent disabled:hover:text-zinc-400;
}

:global(:root.dark) .thread-summary-section-title {
  @apply text-zinc-200;
}

:global(:root.dark) .thread-summary-section-description {
  @apply text-zinc-500;
}
</style>
```

- [ ] **Step 2: Add missing icon if needed**

Check whether `src/components/icons/IconTablerArrowsMaximize.vue` exists:

```bash
test -f src/components/icons/IconTablerArrowsMaximize.vue
```

If it does not exist, create it using the existing icon component style:

```vue
<template>
  <svg class="icon-svg" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M16 4h4v4" />
    <path d="M14 10l6-6" />
    <path d="M8 20H4v-4" />
    <path d="M10 14l-6 6" />
  </svg>
</template>
```

Then include it in the commit for this task.

- [ ] **Step 3: Run component compile check**

Run:

```bash
pnpm run build:frontend
```

Expected: PASS. If it fails because the icon path is missing, add the icon above and rerun.

- [ ] **Step 4: Commit**

Run:

```bash
git add src/components/content/ThreadSummaryPane.vue src/components/icons/IconTablerArrowsMaximize.vue
git commit -m "feat: add desktop summary pane"
```

If the maximize icon already existed, omit it from `git add`.

## Task 3: Wire The Summary Pane Into The Existing Header

**Files:**

- Modify: `src/App.vue`

- [ ] **Step 1: Inspect current upstream layout before editing**

Run:

```bash
rg -n "ReviewPane|HeaderGitBranchDropdown|ContentHeader|isReviewPaneOpen" src/App.vue
```

Expected:

- `HeaderGitBranchDropdown` receives `:review-open="isReviewPaneOpen"`.
- `ReviewPane` renders in the thread route when `isReviewPaneOpen && selectedThreadId && composerCwd`.

- [ ] **Step 2: Add Summary pane state and async component**

In `src/App.vue`, add the async import next to `ReviewPane`:

```ts
const ThreadSummaryPane = defineAsyncComponent(() => import('./components/content/ThreadSummaryPane.vue'))
```

Add state near `isReviewPaneOpen`:

```ts
const isSummaryPaneOpen = ref(false)
```

Add helpers near the review toggle helpers:

```ts
function toggleSummaryPane(): void {
  isSummaryPaneOpen.value = !isSummaryPaneOpen.value
  if (isSummaryPaneOpen.value) {
    isReviewPaneOpen.value = false
  }
}

function toggleReviewPane(): void {
  isReviewPaneOpen.value = !isReviewPaneOpen.value
  if (isReviewPaneOpen.value) {
    isSummaryPaneOpen.value = false
  }
}
```

Replace inline review toggles:

```vue
@toggle-review="toggleReviewPane"
```

- [ ] **Step 3: Add the header Summary button**

In the `ContentHeader` actions slot, add this button after `HeaderGitBranchDropdown`:

```vue
<button
  v-if="route.name === 'thread' && selectedThreadId.length > 0"
  class="content-header-summary-toggle"
  :class="{ 'is-open': isSummaryPaneOpen }"
  type="button"
  :aria-pressed="isSummaryPaneOpen"
  :aria-label="isSummaryPaneOpen ? t('Close summary') : t('Open summary')"
  :title="isSummaryPaneOpen ? t('Close summary') : t('Open summary')"
  @click="toggleSummaryPane"
>
  <IconTablerLayoutSidebarFilled v-if="isSummaryPaneOpen" class="content-header-summary-toggle-icon" />
  <IconTablerLayoutSidebar v-else class="content-header-summary-toggle-icon" />
</button>
```

Add imports if missing:

```ts
import IconTablerLayoutSidebar from './components/icons/IconTablerLayoutSidebar.vue'
import IconTablerLayoutSidebarFilled from './components/icons/IconTablerLayoutSidebarFilled.vue'
```

- [ ] **Step 4: Render Summary and Review as mutually exclusive right panels**

In the thread-route body where `ReviewPane` currently renders, replace the top panel conditional with:

```vue
<ThreadSummaryPane
  v-if="isSummaryPaneOpen && selectedThreadId && composerCwd"
  @close="isSummaryPaneOpen = false"
/>

<ReviewPane
  v-else-if="isReviewPaneOpen && selectedThreadId && composerCwd"
  :thread-id="selectedThreadId"
  :cwd="composerCwd"
  :is-thread-in-progress="isSelectedThreadInProgress"
  @close="isReviewPaneOpen = false"
/>
```

Keep the existing thread conversation/composer branch in the final `v-else`.

- [ ] **Step 5: Add header button styles**

Add the scoped styles near existing content-header control styles:

```css
.content-header-summary-toggle {
  @apply inline-flex h-8 w-8 items-center justify-center rounded-full border border-zinc-200 bg-white text-zinc-600 outline-none transition hover:bg-zinc-50 hover:text-zinc-950;
}

.content-header-summary-toggle.is-open {
  @apply border-zinc-900 bg-zinc-900 text-white hover:bg-zinc-800;
}

.content-header-summary-toggle-icon {
  @apply h-4 w-4;
}

:global(:root.dark) .content-header-summary-toggle {
  @apply border-zinc-700 bg-zinc-900 text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100;
}

:global(:root.dark) .content-header-summary-toggle.is-open {
  @apply border-zinc-100 bg-zinc-100 text-zinc-950 hover:bg-white;
}
```

- [ ] **Step 6: Run build**

Run:

```bash
pnpm run build:frontend
```

Expected: PASS.

- [ ] **Step 7: Commit**

Run:

```bash
git add src/App.vue
git commit -m "feat: wire desktop summary sidebar"
```

## Task 4: Update Manual Verification Docs

**Files:**

- Modify: `tests.md`

- [ ] **Step 1: Append the manual test section**

Append this section to `tests.md`:

```md
## Feature: Desktop-like right Summary sidebar

### Prerequisites/setup

- Start the app with `pnpm run dev`.
- Open a project thread that has a selected working directory.
- Use a browser width of at least 1024px for desktop verification.

### Steps

1. Open an existing thread.
2. Click the right-sidebar icon in the content header.
3. Confirm the Summary sidebar opens on the right.
4. Confirm the panel header shows `Summary`, a plus affordance, and an expand affordance.
5. Confirm the body shows `Progress`, `Artifacts`, and `Sources` in that order.
6. Confirm `Progress` says `Progress displayed for longer responses`.
7. Confirm `Artifacts` says `View and open files`.
8. Confirm `Sources` says `Track sources used`.
9. Click the Summary sidebar icon again or the close button and confirm the panel closes.
10. Open the Git branch dropdown and open Review; confirm Summary closes before Review opens.
11. Switch to dark theme and repeat steps 2-9.

### Expected results

- The Summary panel is docked to the right, visually aligned with Codex desktop's right sidebar.
- The Summary and Review panels are mutually exclusive.
- Light theme uses white/zinc surfaces with readable muted descriptions.
- Dark theme uses dark zinc surfaces with readable muted descriptions.
- No Kanban, Automations, Actions, Permissions, or workspace-inspector labels appear in this upstream PR.

### Rollback/cleanup notes

- Close the Summary panel before continuing unrelated manual testing.
- If the dev server was started only for this test, stop it after verification.
```

- [ ] **Step 2: Commit**

Run:

```bash
git add tests.md
git commit -m "docs: add summary sidebar verification"
```

## Task 5: Final Verification And PR Prep

- [ ] **Step 1: Run focused unit test**

Run:

```bash
pnpm vitest run src/composables/useThreadSummarySections.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run frontend build**

Run:

```bash
pnpm run build:frontend
```

Expected: PASS.

- [ ] **Step 3: Confirm excluded dev work is absent**

Run:

```bash
git diff --name-only main..HEAD | rg "src/components/(kanban|automations)|src/types/(kanban|automations|localActions|proposal|worktree)|useThreadWorkspace|ThreadWorkspaceHeader"
```

Expected: no output.

- [ ] **Step 4: Confirm visible copy**

Run:

```bash
rg -n "Workspace inspector|Kanban|Automations|Actions|Permissions|Progress displayed for longer responses|View and open files|Track sources used" src tests.md
```

Expected:

- `Progress displayed for longer responses`, `View and open files`, and `Track sources used` appear in the new Summary model/docs.
- `Workspace inspector`, `Kanban`, `Automations`, `Actions`, and `Permissions` do not appear because of this branch's sidebar work.

- [ ] **Step 5: Review diff against main**

Run:

```bash
git diff --stat main..HEAD
git diff --name-status main..HEAD
```

Expected changed files:

- `src/types/threadSummary.ts`
- `src/composables/useThreadSummarySections.ts`
- `src/composables/useThreadSummarySections.test.ts`
- `src/components/content/ThreadSummaryPane.vue`
- `src/components/icons/IconTablerArrowsMaximize.vue` only if it was needed
- `src/App.vue`
- `tests.md`

- [ ] **Step 6: Push the upstream branch**

Run:

```bash
git push -u origin feature/desktop-right-sidebar-upstream
```

Expected: branch pushed to the fork.

## PR Positioning

Use this PR summary:

```md
Adds a desktop-like right Summary sidebar to the thread view.

This intentionally starts from the current upstream side-panel pattern instead of porting the broader `dev` right-drawer work. The branch includes only the Summary shell, desktop-matched empty-state sections, header toggle wiring, and verification docs. It deliberately excludes Kanban, Automations, workspace inspector sections, artifact evidence/review packet models, and local action surfaces so the upstream PR stays reviewable.
```

Use this test summary:

```md
Tests:
- pnpm vitest run src/composables/useThreadSummarySections.test.ts
- pnpm run build:frontend
- Manual light/dark verification documented in tests.md
```

## Follow-Up Work After The First PR

- Wire `Progress` to long-running response progress once upstream has a stable progress source.
- Wire `Artifacts` to a small file/artifact list after the data contract is accepted upstream.
- Wire `Sources` to source/citation tracking only after source metadata exists in the thread state.
- Consider extracting a generic side-panel tab shell if upstream wants `Summary` and `Review` to share one component with real tabs.
