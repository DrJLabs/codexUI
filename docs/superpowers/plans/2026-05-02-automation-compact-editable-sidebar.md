# Automation Compact Editable Sidebar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform the automation editor from a form-first panel into a compact, screenshot-like, editable settings sidebar that is first-class on mobile.

**Architecture:** Keep `useAutomations` as the state/mutation source of truth and refactor only the presentation layer in `AutomationsPage.vue`. Add small formatting helpers to `automationDisplay.ts` so compact status/detail rows and run history can be tested independently before the Vue template changes.

**Tech Stack:** Vue 3 `<script setup>`, TypeScript, scoped CSS, Vitest, Playwright CJS for browser verification.

---

## Current State

- Existing automation selection opens a full edit form with 12 fields and Advanced open by default.
- Primary actions (`Save`, `Run now`, `Pause`, `Delete automation`) are at the bottom of the form, which is weak on mobile.
- Run history uses large cards with verbose paths always visible.
- The reference design is a compact operational panel: top actions, Status rows, Details rows, then dense Previous runs.

## Target Interaction

- Existing automations show an editable summary panel by default, not a separate read-only view.
- Compact rows are editable in place:
  - Status: active/paused pill plus top-row pause/resume action.
  - Runs in: `draft.runMode` select.
  - Project: compact project folder input; disabled/optional-looking for chat mode but still available.
  - Repeats: frequency/time controls on one row, with weekday only when weekly.
  - Model: `draft.model` select.
  - Reasoning: `draft.reasoningEffort` select.
- Create mode can still show the starting-point templates, then the same compact rows with required create-only fields surfaced.
- Advanced is closed by default and contains less-common controls:
  - Name
  - Thread
  - Prompt
  - Description
  - Notes
  - Run profile
  - Custom RRULE when needed
  - Storage/diagnostic metadata
- Previous runs are collapsible:
  - Closed by default on mobile.
  - Open by default on desktop for edit mode.
  - Dense rows show state icon, automation/run label, project label, and relative age.
  - Verbose run record/log/event paths stay behind per-run `<details>`.

## File Map

- Modify `src/utils/automationDisplay.ts`
  - Add compact helper functions:
    - `describeAutomationRunMode(mode)`
    - `describeAutomationProjectLabel(definition)`
    - `formatAutomationRelativeTime(value, now?)`
    - `describeAutomationRunListItem(run, now?)`
- Modify `src/utils/automationDisplay.test.ts`
  - Red-phase coverage for the helpers above.
- Modify `src/components/automations/AutomationsPage.vue`
  - Rework editor template into compact sections.
  - Move heavy fields into closed Advanced.
  - Replace verbose run cards with dense collapsible previous-runs list.
  - Add responsive CSS for mobile-first rows and sticky top action bar where safe.
- Modify `tests.md`
  - Add manual/browser verification for compact editable sidebar in light/dark/mobile.

---

## Task 1: Add Tested Compact Display Helpers

**Files:**
- Modify: `src/utils/automationDisplay.ts`
- Modify: `src/utils/automationDisplay.test.ts`

- [x] **Step 1: Write failing utility tests**

Add tests for:

```ts
describeAutomationRunMode('chat') === 'Chat'
describeAutomationRunMode('local') === 'Local'
describeAutomationRunMode('worktree') === 'Worktree'
describeAutomationProjectLabel(localDefinition) === 'apollo'
formatAutomationRelativeTime('2026-05-02T05:31:00.000Z', new Date('2026-05-02T06:00:00.000Z')) === '29m'
describeAutomationRunListItem(run, now) returns { state, title, project, age }
```

- [x] **Step 2: Verify red**

Run:

```bash
pnpm vitest run src/utils/automationDisplay.test.ts
```

Expected: FAIL because helper exports do not exist.

- [x] **Step 3: Implement helpers**

Implementation rules:

- `describeAutomationRunMode` maps `chat -> Chat`, `local -> Local`, `worktree -> Worktree`.
- `describeAutomationProjectLabel` prefers `cwd`, `projectRoot`, then first `cwds`; basename only; fallback `Thread` for chat/thread automations and `No project`.
- `formatAutomationRelativeTime` returns `m`, `h`, or `d` compact strings; future timestamps return `0m`; invalid/null returns `n/a`.
- `describeAutomationRunListItem` uses `run.automationName`, project basename from `worktreePath || cwd`, and age from `completedAtIso || startedAtIso || updatedAtIso || createdAtIso`.

- [x] **Step 4: Verify green**

Run:

```bash
pnpm vitest run src/utils/automationDisplay.test.ts
```

Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add src/utils/automationDisplay.ts src/utils/automationDisplay.test.ts
git commit -m "feat: add compact automation display helpers"
```

---

## Task 2: Recompose The Editor Into A Compact Editable Panel

**Files:**
- Modify: `src/components/automations/AutomationsPage.vue`

- [x] **Step 1: Add script computed values**

Add computed values:

- `lastRunLabel`
- `nextRunLabel`
- `selectedAutomationProjectLabel`
- `compactRunItems`
- `isExistingAutomation`

Import the new helpers from `automationDisplay.ts`.

- [x] **Step 2: Replace the edit-mode field grid with compact sections**

For existing automations, render in this order:

1. Header/action bar:
   - title/name
   - pause/resume icon button
   - delete icon button
   - `Run now` primary button
   - `Save` button appears when editable fields change through the existing draft model.
2. Status section:
   - Status pill
   - Next run
   - Last ran
3. Details section:
   - Runs in select
   - Project input
   - Repeats compact schedule controls
   - Model select
   - Reasoning select
4. Previous runs `<details class="automations-runs" :open="!isMobileDefault">`
5. Advanced `<details class="automations-advanced">`

Do not create separate read-only/edit modes.

- [x] **Step 3: Keep create mode usable**

Create mode should:

- Keep the starting-point templates.
- Show the same compact details controls.
- Keep required create fields available:
  - Name
  - Prompt
  - Thread when run mode is chat
- Use Advanced for less-common optional fields.

- [x] **Step 4: Move heavyweight fields to Advanced**

Advanced contains:

- Name
- Thread
- Prompt
- Description
- Notes
- Run profile
- Custom schedule RRULE only when `showRawRrule`
- Storage/metadata details

Advanced must be closed by default.

- [x] **Step 5: Make Previous runs dense and collapsible**

Each run row should show:

- compact state dot/check
- run title
- project label
- compact age

Per-run verbose details go inside nested `<details>`.

- [x] **Step 6: Commit**

```bash
git add src/components/automations/AutomationsPage.vue
git commit -m "feat: make automation sidebar compact and editable"
```

---

## Task 3: Mobile-First Styling And Dark Theme Polish

**Files:**
- Modify: `src/components/automations/AutomationsPage.vue`
- Modify: `src/style.css` only if scoped dark selectors are insufficient

- [x] **Step 1: Style compact sections**

CSS goals:

- No card-in-card nesting.
- Sidebar content uses section headers, key/value rows, and compact controls.
- Controls align to the right on desktop and stack cleanly on mobile.
- Buttons use icons where possible: pause/resume, trash, run.
- Text and controls do not overflow at 375px.

- [x] **Step 2: Mobile rules**

At `max-width: 640px`:

- Summary stats are either hidden or condensed.
- Action row stays near the top of the editor.
- Compact rows are one-column where needed.
- Previous runs is collapsed by default using markup/CSS defaults.
- Inputs/selects keep `font-size: 16px` to prevent iOS zoom.

- [x] **Step 3: Dark theme**

Ensure dark theme:

- uses dark input/select surfaces,
- keeps section dividers subtle,
- avoids bright card backgrounds,
- keeps status/run icons legible.

- [x] **Step 4: Commit**

```bash
git add src/components/automations/AutomationsPage.vue src/style.css
git commit -m "style: polish compact automation sidebar"
```

---

## Task 4: Documentation And Browser Verification

**Files:**
- Modify: `tests.md`

- [x] **Step 1: Add tests.md section**

Document:

- feature/change name,
- prerequisites,
- desktop light/dark checks,
- mobile 375x812 checks,
- collapsible previous runs,
- Advanced closed by default,
- in-place edit rows.

- [x] **Step 2: Run unit/build checks**

Run:

```bash
pnpm vitest run src/utils/automationDisplay.test.ts src/composables/useAutomations.test.ts
pnpm run build:frontend
git diff --check
```

Expected: all pass.

- [x] **Step 3: Rebuild port 5173 from this child worktree**

Run:

```bash
fuser -k 5173/tcp || true
setsid bash -lc 'cd /home/drj/projects/codexUI-automation-compact-sidebar-dev && pnpm run dev -- --host 0.0.0.0 --port 5173 > /tmp/codexui-automation-compact-5173.log 2>&1' >/dev/null 2>&1 &
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:5173/#/automations
```

Expected: `200`, and `/proc/<pid>/cwd` points to `/home/drj/projects/codexUI-automation-compact-sidebar-dev`.

- [x] **Step 4: Playwright verification**

Use CJS Playwright to verify:

- desktop light: compact status/details/actions visible; Advanced is closed; Previous runs is collapsible.
- desktop dark: same, with dark controls.
- mobile 375x812: no horizontal overflow; action row and compact fields visible; Advanced closed; Previous runs collapsed; focusing fields does not jump to the top.

Save screenshots:

```text
output/playwright/automation-compact-sidebar-light.png
output/playwright/automation-compact-sidebar-dark.png
output/playwright/automation-compact-sidebar-mobile.png
```

- [x] **Step 5: Commit docs**

```bash
git add tests.md
git commit -m "docs: add compact automation sidebar verification"
```

---

## Acceptance Criteria

- Existing automation panel closely matches the reference structure: action row, Status, Details, Previous runs.
- Detail rows are editable in place; there is no separate read-only view.
- Advanced is closed by default and holds lower-frequency controls.
- Previous runs is collapsible and dense.
- Mobile is first-class at 375px width with no horizontal overflow and no input zoom/jump regression.
- Unit tests, frontend build, diff check, and Playwright checks pass.
