# Automations Phase 1 Right Sidebar IA Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stabilize the right sidebar IA so Automations has a first-level home without mixing Plan/Run/Evidence/Review/Proposals into the first-level product menu.

**Architecture:** Keep the existing `ThreadArtifactSidebar.vue` drawer and `useThreadWorkspace` model. Tighten the model so first-level section counts and nested thread artifact sections are authoritative, then render the nested Thread subnavigation from that model. This is a small compatibility-preserving UI contract change; it does not add automation backend routes or scheduler behavior.

**Tech Stack:** Vue 3 Composition API, TypeScript, Vitest, scoped CSS, Markdown docs.

---

## File Structure

- Modify: `src/composables/useThreadWorkspace.test.ts`
  - Add failing expectations for Thread section total count and Worktrees count ownership.
- Modify: `src/composables/useThreadWorkspace.ts`
  - Make Thread count include proposal count and Worktrees count use `activeWorktreeCount`.
- Modify: `src/components/artifacts/ThreadArtifactSidebar.vue`
  - Render the Thread panel subnavigation from `workspaceModel.threadArtifactSections`.
- Modify: `tests.md`
  - Add manual light/dark verification for Automations Phase 1 right-sidebar IA stabilization.
- Modify: `docs/superpowers/plans/2026-04-30-automations-feature-high-level-plan.md`
  - Link Phase 1 to this implementation plan after the plan is created.

## Task 1: Lock The Workspace Model Counts

**Files:**
- Modify: `src/composables/useThreadWorkspace.test.ts`
- Modify: `src/composables/useThreadWorkspace.ts`

- [ ] **Step 1: Write the failing test**

In `src/composables/useThreadWorkspace.test.ts`, update the selected-thread setup to pass `activeWorktreeCount: ref(3)`, then add these expectations:

```ts
expect(model.value.sections.find((section) => section.id === 'thread')).toMatchObject({
  count: 4,
  enabled: true,
  deferred: false,
})
expect(model.value.sections.find((section) => section.id === 'worktrees')).toMatchObject({
  count: 3,
  enabled: true,
})
```

Keep `proposalCount: ref(2)` and the two selected-thread artifacts. The test should prove the Thread section count includes proposals and Worktrees count comes from the active worktree input rather than run metadata.

- [ ] **Step 2: Run RED test**

Run:

```bash
/home/drj/projects/codexUI/node_modules/.bin/vitest run src/composables/useThreadWorkspace.test.ts
```

Expected: FAIL because the current Thread section count is `2` and the current Worktrees count is derived from run/worktree artifacts, not `activeWorktreeCount`.

- [ ] **Step 3: Implement model count fix**

In `src/composables/useThreadWorkspace.ts`, change section construction so:

```ts
const activeWorktreeCount = hasThread ? input.activeWorktreeCount.value : 0
```

and:

```ts
createSection('thread', 'Thread', artifactCount + proposalCount, hasThread, false, disabledThreadReason)
createSection('worktrees', 'Worktrees', activeWorktreeCount, hasThread, false, hasThread ? '' : disabledThreadReason)
```

- [ ] **Step 4: Run GREEN test**

Run:

```bash
/home/drj/projects/codexUI/node_modules/.bin/vitest run src/composables/useThreadWorkspace.test.ts
```

Expected: PASS.

## Task 2: Render Thread Subnavigation From The Workspace Model

**Files:**
- Modify: `src/components/artifacts/ThreadArtifactSidebar.vue`

- [ ] **Step 1: Add model-backed tab computed value**

In `src/components/artifacts/ThreadArtifactSidebar.vue`, add this computed value after `visibleThreadArtifacts`:

```ts
const threadArtifactTabs = computed(() => {
  const sections = props.workspaceModel?.threadArtifactSections
  if (!sections?.length) return tabs.value
  return sections.map((section) => ({
    id: section.id,
    label: section.label,
    count: section.count,
  }))
})
```

- [ ] **Step 2: Render model-backed tabs**

Replace:

```vue
<ArtifactTabs v-model="activeTab" :tabs="tabs" />
```

with:

```vue
<ArtifactTabs v-model="activeTab" :tabs="threadArtifactTabs" />
```

Update `threadEmptyTitle` to read from `threadArtifactTabs.value` instead of `tabs.value`:

```ts
const threadEmptyTitle = computed(() => `${threadArtifactTabs.value.find((tab) => tab.id === activeTab.value)?.label ?? 'Artifact'} artifacts`)
```

- [ ] **Step 3: Run targeted tests**

Run:

```bash
/home/drj/projects/codexUI/node_modules/.bin/vitest run src/composables/useThreadWorkspace.test.ts src/composables/useThreadArtifacts.test.ts
```

Expected: PASS.

## Task 3: Update Docs And Cross-Link The Phase

**Files:**
- Modify: `tests.md`
- Modify: `docs/superpowers/plans/2026-04-30-automations-feature-high-level-plan.md`

- [ ] **Step 1: Add manual verification section**

Append this section to `tests.md`:

```markdown
---

### Feature: Automations Phase 1 right sidebar IA stabilization

#### Prerequisites
- App is running from this repository.
- At least one chat thread exists.
- Light and dark themes are available from Settings.

#### Steps
1. Run `/home/drj/projects/codexUI/node_modules/.bin/vitest run src/composables/useThreadWorkspace.test.ts src/composables/useThreadArtifacts.test.ts`.
2. Run `pnpm run build`.
3. Open a thread in light theme and open the right sidebar.
4. Confirm the first-level menu shows Thread, Kanban, Automations, Worktrees, Artifacts, Actions, and Permissions.
5. Click Thread and confirm Plan, Run, Evidence, Review, and Proposals appear only inside the Thread panel.
6. Confirm the Thread row count includes visible thread artifacts plus proposal count, and Worktrees uses the active worktree count.
7. Click Automations and confirm it opens an in-place deferred panel rather than a nested artifact tab.
8. Switch to dark theme and repeat steps 3-7.

#### Expected Results
- Plan, Run, Evidence, Review, and Proposals are nested under Thread only.
- Automations has a stable first-level home and remains deferred.
- Only one first-level panel is visible at a time.
- Light and dark themes remain readable.

#### Rollback/Cleanup
- Stop the dev server if one was started.
```

- [ ] **Step 2: Link Phase 1 implementation plan**

In `docs/superpowers/plans/2026-04-30-automations-feature-high-level-plan.md`, add this line under the Phase 1 expected-outcome bullets:

```markdown
Phase 1 implementation plan: [`2026-04-30-automations-phase-1-right-sidebar-ia.md`](2026-04-30-automations-phase-1-right-sidebar-ia.md).
```

- [ ] **Step 3: Verify docs**

Run:

```bash
rg -n "Automations Phase 1 right sidebar IA stabilization|Phase 1 implementation plan" tests.md docs/superpowers/plans/2026-04-30-automations-feature-high-level-plan.md
git diff --check
```

Expected: both strings exist and whitespace check exits `0`.

## Task 4: Final Verification And Commit

**Files:**
- Verify all changed files.

- [ ] **Step 1: Run targeted unit tests**

Run:

```bash
/home/drj/projects/codexUI/node_modules/.bin/vitest run src/composables/useThreadWorkspace.test.ts src/composables/useThreadArtifacts.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run build**

Run:

```bash
pnpm run build
```

Expected: PASS. If it fails because this worktree has no `node_modules`, use the shared dependency path only for diagnostics and report the blocker.

- [ ] **Step 3: Review and commit**

Run:

```bash
git diff --stat
git diff -- src/composables/useThreadWorkspace.test.ts src/composables/useThreadWorkspace.ts src/components/artifacts/ThreadArtifactSidebar.vue tests.md docs/superpowers/plans/2026-04-30-automations-feature-high-level-plan.md docs/superpowers/plans/2026-04-30-automations-phase-1-right-sidebar-ia.md
git add src/composables/useThreadWorkspace.test.ts src/composables/useThreadWorkspace.ts src/components/artifacts/ThreadArtifactSidebar.vue tests.md docs/superpowers/plans/2026-04-30-automations-feature-high-level-plan.md docs/superpowers/plans/2026-04-30-automations-phase-1-right-sidebar-ia.md
git commit -m "feat(automations): stabilize right sidebar ia"
```

Expected: a single Phase 1 implementation commit on `feat/automations`.

## Self-Review

- Spec coverage: the plan covers one first-level right-sidebar menu, Thread-only artifact subnavigation, stable Automations home, docs, and verification.
- Unfinished-marker scan: no deferred-fill wording is present.
- Type consistency: the plan consistently uses `ThreadWorkspaceModel`, `threadArtifactSections`, `activeWorktreeCount`, and `ThreadArtifactSidebar.vue`.
