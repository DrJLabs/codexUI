# Automation UI Production Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Turn the Automations route from a raw developer console into a production-ready app surface centered on user tasks, schedules, health, and safe actions.

**Architecture:** Keep the existing first-class automations API and `useAutomations` data flow. Add a small display/schedule utility module for tested transformations, then refactor `AutomationsPage.vue` to render human-readable summaries, a guided create/edit form, an advanced details section, and responsive list cards.

**Tech Stack:** Vue 3 `<script setup>`, TypeScript, Vitest, Playwright CLI for requested browser verification.

---

## Files

- Create: `src/utils/automationDisplay.ts` for schedule labels, target labels, capability copy, and run health copy.
- Create: `src/utils/automationDisplay.test.ts` for pure display and RRULE conversion coverage.
- Modify: `src/components/automations/AutomationsPage.vue` for production UI layout and controls.
- Modify: `src/composables/useAutomations.ts` to expose create-from-template helpers only if needed by the UI.
- Modify: `src/composables/useAutomations.test.ts` if draft behavior changes.
- Modify: `tests.md` with light and dark manual verification steps for the Automations UI.

## Task 1: Tested User-Facing Automation Display Helpers

**Files:**
- Create: `src/utils/automationDisplay.ts`
- Create: `src/utils/automationDisplay.test.ts`

- [x] Add tests for human schedule labels:
  - `FREQ=DAILY;BYHOUR=9;BYMINUTE=0` -> `Daily at 9:00 AM`
  - `FREQ=WEEKLY;BYDAY=MO;BYHOUR=10;BYMINUTE=30` -> `Weekly on Monday at 10:30 AM`
  - unknown RRULE -> original RRULE with `Custom schedule`
- [x] Add tests for schedule builder conversion:
  - daily preset produces `FREQ=DAILY;BYHOUR=<hour>;BYMINUTE=<minute>`
  - weekly preset produces `FREQ=WEEKLY;BYDAY=<day>;BYHOUR=<hour>;BYMINUTE=<minute>`
- [x] Add target and health label tests:
  - thread automation -> `Thread automation`
  - local cwd automation -> basename plus path
  - last failed run -> `Needs attention`
  - no runs -> `No runs yet`
- [x] Implement exported helpers:
  - `describeAutomationSchedule(rrule: string): string`
  - `buildDailyRrule(time: string): string`
  - `buildWeeklyRrule(day: string, time: string): string`
  - `describeAutomationTarget(definition: AutomationDefinition): { label: string; detail: string }`
  - `describeRunHealth(definition: AutomationDefinition, runs: AutomationRun[]): { label: string; tone: 'neutral' | 'good' | 'warning' | 'danger' }`
- [x] Run: `pnpm exec vitest run src/utils/automationDisplay.test.ts`

## Task 2: Production List, Summary, and Advanced Details

**Files:**
- Modify: `src/components/automations/AutomationsPage.vue`

- [x] Replace top summary developer fields with user-facing stats:
  - Total automations
  - Active
  - Needs attention
  - Next scheduled run
- [x] Replace the table as the primary visual with responsive list rows/cards showing:
  - Name and description
  - Human schedule label
  - Target label/detail
  - Health/last-run label
  - Status
- [x] Move storage root, feature flags, native path, sidecar path, automation id, source, kind, run profile id, model, and reasoning effort into a `<details>` block titled `Advanced details`.
- [x] Keep diagnostics visible only when present, but phrase them as repair-oriented app copy.
- [x] Ensure desktop and mobile layouts avoid horizontal page overflow.

## Task 3: Guided Create/Edit Form and Schedule Builder

**Files:**
- Modify: `src/components/automations/AutomationsPage.vue`
- Modify: `src/composables/useAutomations.ts` only if draft defaults need adjustment.
- Modify: `src/composables/useAutomations.test.ts` only if draft defaults change.

- [x] Add a `Choose a starting point` template strip above the form:
  - `Thread heartbeat`
  - `Project cron`
  - `Worktree check`
- [x] Add schedule controls before the raw RRULE field:
  - frequency select: Daily, Weekly, Custom
  - time input
  - weekday select for Weekly
- [x] Hide raw RRULE behind an advanced/custom schedule area unless Custom is selected.
- [x] Rename technical labels:
  - `Attached thread id` -> `Thread`
  - `Cwd` -> `Project folder`
  - `Run profile id` -> advanced details only
- [x] Preserve payload compatibility by still writing `draft.rrule`, `draft.runMode`, `draft.cwd`, and `draft.targetThreadId`.

## Task 4: Safer Run Controls and Feedback

**Files:**
- Modify: `src/components/automations/AutomationsPage.vue`

- [x] Disable `Run now` when `state.featureFlags.manualRun` is false.
- [x] Show inline explanation: `Manual runs are disabled in this environment. Scheduled runs are unchanged.`
- [x] Rename destructive action to `Delete automation`, keep the existing confirmation, and make the confirmation copy explain native folder removal.
- [x] Improve recent-runs empty state with next action copy: `Runs will appear here after the schedule fires or manual runs are enabled.`
- [x] Display run failure/error summaries before raw log paths.

## Task 5: Verification and Documentation

**Files:**
- Modify: `tests.md`

- [x] Run targeted unit tests:
  - `pnpm exec vitest run src/utils/automationDisplay.test.ts src/composables/useAutomations.test.ts src/api/automationsGateway.test.ts`
- [x] Run frontend build:
  - `pnpm run build:frontend`
- [x] Start dev server with temporary `CODEX_HOME`.
- [x] Seed two temporary automations through the first-class API.
- [x] Use CJS Playwright to inspect `http://127.0.0.1:<port>/#/automations` at:
  - desktop `1440x1000` light
  - desktop `1440x1000` dark
  - mobile `375x812` light
  - mobile `375x812` dark
- [x] Save screenshots under `output/playwright/`.
- [x] Append `tests.md` section with setup, steps, expected results, rollback, and light/dark verification notes.
- [x] Commit the completed task.

## Acceptance Criteria

- The default Automations page no longer exposes raw storage paths, sidecar paths, source, kind, model, run profile id, or RRULE syntax in the first viewport.
- Users can create common daily/weekly schedules without writing RRULE syntax.
- The automation list is readable on desktop and mobile without page-level horizontal overflow.
- Manual run availability is consistent with `state.featureFlags.manualRun`.
- Advanced technical data remains reachable for operators.
- Unit tests, build, and Playwright light/dark visual checks pass or any remaining gap is explicitly documented.
