# Automations Phase 10 Desktop Parity Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Polish the Automations route so the implemented scheduler, triage, artifacts, and Kanban projection capabilities are visible, understandable, and consistent with CodexUI safety defaults.

**Architecture:** Keep the existing first-class `#/automations` route and composable. Add compact operator controls and status summaries for the capabilities already implemented in Phases 6-9 without introducing new storage behavior.

**Tech Stack:** Vue 3, TypeScript composables, existing Automations API/gateway, Vitest, existing CSS theme rules.

---

## File Map

- `src/components/automations/AutomationsPage.vue`: add visible scheduler/triage/artifact/projection status, run history triage actions, and safer empty/error wording.
- `src/composables/useAutomations.ts`: expose computed counts for unread/archived/failures only if not already local to the component.
- `src/composables/useAutomations.test.ts`: cover new derived state or action behavior if added.
- `src/style.css`: add global dark-theme overrides only if scoped styles leave light surfaces in dark mode.
- `tests.md`: append Phase 10 manual light/dark verification.

## Slice 10A: Run History Triage UI

**Files:**
- Modify: `src/components/automations/AutomationsPage.vue`
- Modify: `src/composables/useAutomations.test.ts` if composable behavior changes
- Modify: `tests.md`

- [ ] **Step 1: Add failing component/composable tests where practical**

If run triage remains component-only, no new unit test is required. If `useAutomations` gains derived counts, add tests for:

```ts
unreadRunCount
archivedRunCount
failedRunCount
```

- [ ] **Step 2: Add compact triage actions to run history**

For each run item, show:

- `inboxTitle` when present
- `inboxSummary` when present
- `Read` button when `readAtIso` is null and the run has findings or failed
- `Archive` button when `archivedAtIso` is null
- `Unarchive` button when `archivedAtIso` is set

Buttons call `markRunRead(run.id)`, `archiveRun(run.id)`, and `unarchiveRun(run.id)` from `useAutomations`.

- [ ] **Step 3: Keep layout compact and theme-safe**

Do not add card-in-card layouts. Extend `.automations-run-item` with compact action rows and ensure text wraps without overlapping.

- [ ] **Step 4: Verify and commit Slice 10A**

Run:

```bash
pnpm exec vitest run src/composables/useAutomations.test.ts src/api/automationsGateway.test.ts
pnpm run build
git diff --check
```

Commit:

```bash
git add src/components/automations/AutomationsPage.vue src/composables/useAutomations.test.ts tests.md
git commit -m "feat(automations): polish run triage ui"
```

## Slice 10B: Schedule And Thread Wording Polish

**Files:**
- Modify: `src/components/automations/AutomationsPage.vue`
- Modify: `tests.md`

- [ ] **Step 1: Add next-run display**

In the automation list, replace or augment the `Updated` column with `Next run`. Render:

- formatted `definition.nextRunAtIso` when present
- `Paused` when `definition.status === 'paused'`
- `Not scheduled` when the scheduler returned no next run

In the editor storage/details area, add `Next run` beside automation id/native path/sidecar path so the selected automation's next scheduled time is visible without scanning the list.

- [ ] **Step 2: Polish schedule and thread wording**

Replace the raw label `Schedule (RRULE)` with operator-facing copy:

```text
Schedule rule
```

Keep the RRULE value editable, but use helper text that says:

```text
RRULE format, for example FREQ=DAILY;BYHOUR=9;BYMINUTE=0.
```

Replace `Target thread id` with:

```text
Attached thread id
```

For create/edit header copy, use thread-attached wording:

```text
Prefilled from thread <id>
```

- [ ] **Step 3: Add capability summary**

In the existing summary band, show concise status chips for:

- Scheduler enabled/disabled from `state.featureFlags.scheduler`
- Manual run enabled/disabled
- Artifact indexing enabled/disabled
- Kanban projection enabled/disabled

This is status only; do not add new feature toggles.

- [ ] **Step 4: Improve empty/error wording**

Replace stale/deferred wording with current capability wording:

- no longer say artifact indexing or scheduler is absent when feature flags say present
- explain unsupported monthly/yearly schedules through diagnostics when present
- keep text concise and operational

- [ ] **Step 5: Verify and commit Slice 10B**

Run:

```bash
pnpm exec vitest run src/composables/useAutomations.test.ts src/api/automationsGateway.test.ts
pnpm run build
git diff --check
```

Commit:

```bash
git add src/components/automations/AutomationsPage.vue tests.md
git commit -m "feat(automations): polish schedule status"
```

## Slice 10C: Final Manual Verification Notes

**Files:**
- Modify: `tests.md`

- [ ] **Step 1: Append Phase 10 manual test section**

Include:

- prerequisites to start `#/automations`
- light-theme checks for list, editor, run history, triage buttons, capability chips
- dark-theme checks for the same surfaces
- next-run display checks for a scheduled active automation, a paused automation, and an unsupported/no-next-run automation
- schedule wording checks for `Schedule rule` and RRULE helper copy
- thread-attached wording checks for `Attached thread id` and prefilled thread copy
- responsive checks for 375px and tablet widths by manual browser resizing
- expected no-overlap/no-unreadable-surface results
- cleanup notes

- [ ] **Step 2: Verify and commit Slice 10C**

Run:

```bash
pnpm run build
git diff --check
```

Commit:

```bash
git add tests.md
git commit -m "docs(automations): add phase 10 manual checks"
```

## Phase 10 Final Verification

Run:

```bash
pnpm exec vitest run src/api/automationsGateway.test.ts src/composables/useAutomations.test.ts src/server/automations/__tests__/routes.test.ts src/server/artifacts/__tests__/routes.test.ts
pnpm run build
git diff --check
```

If Playwright is explicitly requested later, capture light/dark screenshots of `#/automations`; otherwise do not run Playwright for this phase.
